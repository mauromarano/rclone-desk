"""Browser boundary and request limits for a single-admin deployment."""

import asyncio
import json
import os

from starlette.middleware.trustedhost import TrustedHostMiddleware


class RequestBoundary:
    MAX_BODY = 2 * 1024 * 1024

    def __init__(self, app):
        self.app = app
        self.origins = {item.strip().rstrip('/') for item in os.getenv('APP_ALLOWED_ORIGINS', '').split(',') if item.strip()}

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])

        async def reject(status, detail):
            body = json.dumps({'detail': detail}).encode()
            await send({'type': 'http.response.start', 'status': status, 'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
            await send({'type': 'http.response.body', 'body': body})

        if scope['method'] not in ('GET', 'HEAD', 'OPTIONS'):
            origin = headers.get(b'origin', b'').decode('latin1').rstrip('/')
            same_origin = scope['scheme'] + '://' + headers.get(b'host', b'').decode('latin1')
            if headers.get(b'sec-fetch-site') == b'cross-site' or (origin and origin != same_origin and origin not in self.origins):
                return await reject(403, 'Cross-origin writes are not allowed')
            if not headers.get(b'content-type', b'').lower().startswith(b'application/json'):
                return await reject(415, 'Use application/json')
        try:
            length = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await reject(400, 'Invalid Content-Length')
        if length < 0 or length > self.MAX_BODY:
            return await reject(413, 'Request body exceeds 2 MiB')
        # Buffer only up to the limit, including requests without Content-Length.
        body = bytearray()
        while True:
            try:
                message = await asyncio.wait_for(receive(), timeout=30)
            except TimeoutError:
                return await reject(408, 'Request body timed out')
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > self.MAX_BODY:
                return await reject(413, 'Request body exceeds 2 MiB')
            if not message.get('more_body', False):
                break
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()

        async def secure_send(message):
            if message['type'] == 'http.response.start':
                additional = [
                    (b'x-content-type-options', b'nosniff'),
                    (b'x-frame-options', b'DENY'),
                    (b'referrer-policy', b'no-referrer'),
                    (b'content-security-policy', b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"),
                ]
                if scope['path'].startswith('/api/'):
                    additional.append((b'cache-control', b'no-store'))
                message['headers'] = [(key, value) for key, value in message.get('headers', []) if key.lower() not in {key for key, _ in additional}] + additional
            await send(message)

        await self.app(scope, bounded_receive, secure_send)


def install_boundary(app):
    app.add_middleware(RequestBoundary)
    hosts = [item.strip() for item in os.getenv('APP_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]').split(',') if item.strip()]
    if not hosts or '*' in hosts:
        raise RuntimeError('APP_ALLOWED_HOSTS must explicitly list trusted hostnames')
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts, www_redirect=False)
