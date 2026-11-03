# Backup and restore

The Compose named volume contains the app's rclone configuration, job state, and local test-remote data. It may contain provider credentials or tokens. Store backups in a private location, restrict access, and encrypt them when the backup destination is not already protected.

The commands below use the volume name resolved from the current Compose project, so they do not assume a project-name prefix. Run them from the directory containing `docker-compose.yml` and with `jq`, Docker Compose, and Docker available.

## Create a backup

Stop the app first so the configuration and state are not being written while archived:

```sh
docker compose down
DATA_VOLUME=$(docker compose config --format json | jq -r '.volumes.rclone_data.name')
docker run --rm \
  -v "${DATA_VOLUME}:/data:ro" \
  -v "$PWD:/backup" \
  alpine:3.24 \
  sh -c 'tar -czf /backup/rclone-desk-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .'
```

The archive is created in the current directory. Move it to protected storage and verify that the archive can be read. Restart the app with `docker compose up -d` when ready.

## Restore from a backup

Stop the app and identify the volume it will use:

```sh
docker compose down
DATA_VOLUME=$(docker compose config --format json | jq -r '.volumes.rclone_data.name')
```

Keep a copy of the current volume before replacing its contents. Then put the backup archive in the current directory and replace `rclone-desk-data-YYYYMMDDTHHMMSSZ.tar.gz` below with its filename:

```sh
docker run --rm \
  -v "${DATA_VOLUME}:/data" \
  -v "$PWD:/backup:ro" \
  alpine:3.24 \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/rclone-desk-data-YYYYMMDDTHHMMSSZ.tar.gz -C /data && chown -R 10001:10001 /data'
```

Start the service again with `docker compose up -d`. The image runs as UID 10001; check that restored files are accessible to the container. Treat restored configuration as a secret. Restore only archives you trust.

## Move to another host or Compose project

Stop the old service, create a backup, copy the archive securely, then create the new Compose project's volume by starting and stopping Compose once:

```sh
docker compose up -d
docker compose down
```

On the new host, follow the restore steps there. The destination volume is derived from that project's Compose configuration. Do not remove the old volume until the restored app and its data have been checked.

## Upgrade from an older root-run container

Before upgrading an existing installation, stop it and back it up. Transfer ownership of its volume to the runtime UID once:

```sh
docker compose down
DATA_VOLUME=$(docker compose config --format json | jq -r '.volumes.rclone_data.name')
docker run --rm -v "${DATA_VOLUME}:/data" alpine:3.24 \
  sh -c 'chown -R 10001:10001 /data && chmod 700 /data && chmod 600 /data/rclone.conf /data/state.json'
docker compose up --build -d
```

Do this only for the application's own volume, not an unrelated host directory. Keep the backup until configuration and local test data are checked.
