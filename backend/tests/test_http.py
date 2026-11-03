"""Exercise the HTTP boundary and real rclone on isolated local storage."""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

os.environ['APP_DATA'] = tempfile.mkdtemp(prefix='rclone-desk-http-tests-')
os.environ['APP_DISABLE_SCHEDULER'] = '1'

from backend import main  # noqa: E402


async def request(path, method='GET', value=None, host='localhost', origin=None, raw=None, content_type='application/json'):
    messages = []
    body = raw if raw is not None else (json.dumps(value).encode() if value is not None else b'')
    headers = [(b'host', host.encode()), (b'content-type', content_type.encode())]
    if origin:
        headers.append((b'origin', origin.encode()))
    delivered = False

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await asyncio.sleep(30)
        return {'type': 'http.disconnect'}

    async def send(message):
        messages.append(message)

    await main.app({'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'}, 'scheme': 'http',
                    'http_version': '1.1', 'method': method, 'path': path, 'raw_path': path.encode(),
                    'query_string': b'', 'root_path': '', 'headers': headers,
                    'client': ('127.0.0.1', 1234), 'server': ('localhost', 80)}, receive, send)
    start = next(message for message in messages if message['type'] == 'http.response.start')
    return start['status'], dict(start['headers']), b''.join(message.get('body', b'') for message in messages)


class HttpBoundaryTests(unittest.TestCase):
    def call(self, *args, **kwargs):
        return asyncio.run(request(*args, **kwargs))

    def test_hostile_host_cannot_read_configuration(self):
        status, _, _ = self.call('/api/config', host='attacker.example')
        self.assertEqual(status, 400)

    def test_cross_origin_configuration_write_is_rejected(self):
        before = main.CONFIG.read_bytes()
        status, _, _ = self.call('/api/config', 'PUT', {'content': ''}, origin='https://attacker.example')
        self.assertEqual(status, 403)
        self.assertEqual(main.CONFIG.read_bytes(), before)

    def test_same_origin_request_is_allowed_and_private(self):
        status, headers, _ = self.call('/api/config', origin='http://localhost')
        self.assertEqual(status, 200)
        self.assertEqual(headers[b'cache-control'], b'no-store')
        self.assertEqual(headers[b'x-frame-options'], b'DENY')

    def test_streamed_body_limit_applies_without_content_length(self):
        status, _, _ = self.call('/api/config', 'PUT', raw=b'x' * (2 * 1024 * 1024 + 1))
        self.assertEqual(status, 413)

    def test_form_submission_cannot_change_configuration(self):
        status, _, _ = self.call('/api/config', 'PUT', raw=b'content=', content_type='application/x-www-form-urlencoded')
        self.assertEqual(status, 415)

    def test_job_http_schema_resolves_through_transaction_decorator(self):
        status, _, _ = self.call('/api/jobs', 'POST', {'name': 'invalid without endpoints'})
        self.assertEqual(status, 422)


class LocalRcloneTests(unittest.TestCase):
    def setUp(self):
        main.OPERATIONS.clear()
        main.CANCEL_EVENTS.clear()
        main.CONFIG_USERS = 0
        self.source = main.TEST_ROOT / 'http-source'
        self.destination = main.TEST_ROOT / 'http-destination'
        self.source.mkdir(exist_ok=True)
        self.destination.mkdir(exist_ok=True)
        main.secure_write(main.CONFIG, '[source]\ntype=local\n[destination]\ntype=local\n')
        main.save_state({'local_roots': {'source': str(self.source), 'destination': str(self.destination)}, 'jobs': []})

    def wait_operation(self, operation):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with main.OPERATIONS_LOCK:
                row = dict(main.OPERATIONS[operation['id']])
            if row['status'] not in ('queued', 'running'):
                self.assertEqual(row['status'], 'success', row)
                return
            time.sleep(.05)
        self.fail('Local rclone operation did not finish')

    def test_copy_preserves_source_and_move_removes_it(self):
        (self.source / 'copy.txt').write_text('copy contents')
        self.wait_operation(main.transfer(main.TransferInput(source_remote='source', source_path='copy.txt',
                                                            destination_remote='destination', destination_path='copied.txt', mode='copy')))
        self.assertEqual((self.destination / 'copied.txt').read_text(), 'copy contents')
        self.assertTrue((self.source / 'copy.txt').exists())
        self.wait_operation(main.transfer(main.TransferInput(source_remote='source', source_path='copy.txt',
                                                            destination_remote='destination', destination_path='moved.txt', mode='move')))
        self.assertFalse((self.source / 'copy.txt').exists())
        self.assertEqual((self.destination / 'moved.txt').read_text(), 'copy contents')

    def test_sync_requires_consent_and_removes_destination_only_files(self):
        for root in (self.source, self.destination):
            (root / 'sync').mkdir(exist_ok=True)
        (self.source / 'sync/keep.txt').write_text('keep')
        (self.destination / 'sync/delete.txt').write_text('delete')
        job = main.create_job(main.JobInput(name='sync', mode='sync', source_remote='source', source_path='sync',
                                            destination_remote='destination', destination_path='sync'))
        with self.assertRaises(main.HTTPException):
            main.run_job(job['id'], main.RunInput())
        result = main.run_job(job['id'], main.RunInput(confirm_sync_deletions=True))
        self.wait_operation({'id': result['operation_id']})
        self.assertFalse((self.destination / 'sync/delete.txt').exists())
        self.assertEqual((self.destination / 'sync/keep.txt').read_text(), 'keep')

    def test_archive_preserves_duplicate_basenames_and_releases_spool(self):
        for directory in ('one', 'two'):
            (self.source / directory).mkdir(exist_ok=True)
            (self.source / directory / 'report.txt').write_text(directory)
        response = main.download_archive('source', main.DownloadSelectionInput(paths=['one/report.txt', 'two/report.txt']))
        spool = Path(response.path)
        with zipfile.ZipFile(spool) as archive:
            self.assertEqual(archive.namelist(), ['one/report.txt', 'two/report.txt'])
            self.assertEqual(archive.read('two/report.txt'), b'two')

        async def send_response():
            async def send(_):
                pass
            await response({'type': 'http', 'method': 'GET', 'headers': [], 'extensions': {}, 'asgi': {'spec_version': '2.4'}}, None, send)
        asyncio.run(send_response())
        self.assertFalse(spool.exists())

    def test_download_budget_rejection_releases_admission(self):
        (self.source / 'oversize.txt').write_text('larger than budget')
        with patch.object(main, 'MAX_DOWNLOAD_BYTES', 1), self.assertRaises(main.HTTPException) as raised:
            main.download('source', 'oversize.txt')
        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(list(main.DOWNLOAD_ROOT.iterdir()), [])

    def test_cancel_queued_operation_prevents_execution(self):
        with patch.object(main.EXECUTOR, 'submit'):
            operation = main.start_operation('cancel', ['deletefile', str(self.source / 'never')])
        main.cancel_operation(operation['id'])
        with patch.object(main.subprocess, 'Popen') as start:
            main.run_tracked(operation['id'], ['deletefile', str(self.source / 'never')])
        start.assert_not_called()
        self.assertEqual(main.OPERATIONS[operation['id']]['message'], 'Operation cancelled')

    def test_download_deadline_kills_and_reaps_a_stalled_child(self):
        real_popen = subprocess.Popen
        children = []

        def stalled_child(*args, **kwargs):
            child = real_popen([sys.executable, '-c', 'import time; time.sleep(60)'], **kwargs)
            children.append(child)
            return child

        with patch.object(main.subprocess, 'Popen', side_effect=stalled_child):
            with self.assertRaises(main.HTTPException) as raised:
                main.copy_remote_to_stream('unused', BytesIO(), 100, time.monotonic() + .1)
        self.assertEqual(raised.exception.status_code, 504)
        self.assertIsNotNone(children[0].poll())

    def test_disconnected_download_releases_file_and_slot(self):
        (self.source / 'disconnect.txt').write_text('download')
        response = main.download('source', 'disconnect.txt')
        spool = Path(response.path)

        async def disconnect():
            async def send(_):
                raise RuntimeError('simulated client disconnect')
            await response({'type': 'http', 'method': 'GET', 'headers': [], 'extensions': {}, 'asgi': {'spec_version': '2.4'}}, None, send)

        with self.assertRaises(RuntimeError):
            asyncio.run(disconnect())
        self.assertFalse(spool.exists())
        acquired = [main.DOWNLOAD_SLOTS.acquire(blocking=False) for _ in range(2)]
        for success in acquired:
            if success:
                main.DOWNLOAD_SLOTS.release()
        self.assertEqual(acquired, [True, True])
