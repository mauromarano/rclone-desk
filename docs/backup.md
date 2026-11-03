# Backup, restore, and volume migration

Rclone Desk stores `rclone.conf`, job state, and local test-remote data in the host directory mounted at `/data`. The default host path is `./data` in the repository. It may contain provider credentials or tokens. Store backups in a private location and encrypt them if the backup destination is not already protected.

Run the commands from the repository root. If you use a custom `RCLONE_DESK_DATA_DIR`, export it in the shell before running Compose and the commands below. Relative paths are resolved from the repository root. Do not `source` a `.env` file as shell code.

## Create a backup

Stop the app first so the configuration and state are not being written while archived:

```sh
docker compose down
DATA_DIR="${RCLONE_DESK_DATA_DIR:-./data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/$DATA_DIR" ;; esac
BACKUP_DIR="${RCLONE_DESK_BACKUP_DIR:-$HOME}"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$PWD/$BACKUP_DIR" ;; esac
BACKUP_FILE="rclone-desk-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker run --rm \
  --user 0:0 \
  -e "HOST_UID=$(id -u)" -e "HOST_GID=$(id -g)" -e "BACKUP_FILE=$BACKUP_FILE" \
  --mount "type=bind,src=$DATA_DIR,dst=/data,readonly" \
  --mount "type=bind,src=$BACKUP_DIR,dst=/backup" \
  alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a \
  sh -eu -c 'umask 077; tar -czf "/backup/$BACKUP_FILE" -C /data .; chown "$HOST_UID:$HOST_GID" "/backup/$BACKUP_FILE"; chmod 600 "/backup/$BACKUP_FILE"'
```

The archive is saved in `$HOME` by default; set `RCLONE_DESK_BACKUP_DIR` to choose another writable backup directory. The pinned helper reads the private data directory, writes the archive as mode 600, and assigns it to the invoking host user and group. Move it to protected storage and verify that it can be read. Restart the app with `docker compose up -d` when ready.

## Restore from a backup

Restore replaces the active data directory. The steps below preserve its current contents by renaming it first, then extract the archive into a fresh directory. Stop the app and replace the example archive filename with the file to restore:

The host-side `mv` and `mkdir` need write access to the data directory's parent. Make sure the account running these commands can update that parent (for example, grant it access to a custom data location) before restoring.

```sh
docker compose down
DATA_DIR="${RCLONE_DESK_DATA_DIR:-./data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/$DATA_DIR" ;; esac
BACKUP_DIR="${RCLONE_DESK_BACKUP_DIR:-$HOME}"
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$PWD/$BACKUP_DIR" ;; esac
if [ -e "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$DATA_DIR.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -m 700 "$DATA_DIR"
tar -xzf "$BACKUP_DIR/rclone-desk-data-YYYYMMDDTHHMMSSZ.tar.gz" -C "$DATA_DIR"
docker run --rm \
  --mount "type=bind,src=$DATA_DIR,dst=/data" \
  alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a \
  sh -c 'chown -R 10001:10001 /data && chmod 700 /data && chmod 600 /data/rclone.conf /data/state.json'
docker compose up -d
```

Restore only an archive you trust. Check that the app starts and that its remotes, jobs, and local test data are present before removing the `*.before-restore-*` directory. Treat restored config as a secret.

## Migrate an existing named Docker volume

This copies data from the previous Compose named volume or a prebuilt `docker run` volume into the bind-mounted host directory. It does not remove or modify the old volume. Stop the old app first and keep it stopped until the new bind-mounted installation has been checked.

For a previous Compose installation, list candidate volumes using the Compose volume label:

```sh
docker compose down
docker volume ls --filter label=com.docker.compose.volume=rclone_data
```

If you launched the prebuilt image with `-v rclone_desk_data:/data`, inspect the stopped container to confirm its volume name:

```sh
docker inspect rclone-desk --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
```

Set `OLD_VOLUME` to the exact name of the existing volume. `docker volume inspect` must succeed before mounting it; Docker's short `-v` syntax can create a missing volume, which could look like an empty source.

```sh
set -eu
OLD_VOLUME=replace-with-existing-volume-name
docker volume inspect "$OLD_VOLUME" >/dev/null
export RCLONE_DESK_DATA_DIR="${RCLONE_DESK_DATA_DIR:-./data}"
DATA_DIR="$RCLONE_DESK_DATA_DIR"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$PWD/$DATA_DIR" ;; esac
./scripts/prepare-data.sh
docker run --rm \
  --mount "type=volume,src=$OLD_VOLUME,dst=/old,readonly" \
  --mount "type=bind,src=$DATA_DIR,dst=/new" \
  alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a \
  sh -eu -c 'if [ -n "$(find /new -mindepth 1 -maxdepth 1 -print -quit)" ]; then echo "Destination is not empty; refusing to overwrite it." >&2; exit 1; fi; cp -a /old/. /new/; chown -R 10001:10001 /new; chmod 700 /new; chmod 600 /new/rclone.conf /new/state.json'
```

Start the new Compose installation with `docker compose up --build -d` and check the remotes, jobs, and local test data. Keep the old volume and a separate backup until the migrated installation is verified. Do not run `docker compose down -v` as part of this migration; it can delete volumes declared by the current Compose project.

## Move a bind-mounted installation to another host

Create a backup with the first section, copy the archive securely, and restore it on the new host using the restore steps above. Run `./scripts/prepare-data.sh` before the first Compose startup on the new host. Keep the old directory until the restored app and its data have been checked.
