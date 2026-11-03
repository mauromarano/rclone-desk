#!/usr/bin/env sh
# Initialize only the application's bind directory; never change file ownership
# recursively or silently adopt a nonempty directory belonging to another user.
set -eu
umask 077

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
data_directory=${RCLONE_DESK_DATA_DIR:-"$repo_root/data"}
case "$data_directory" in
  /*) ;;
  *) data_directory="$repo_root/$data_directory" ;;
esac
mkdir -p "$data_directory"
data_directory=$(realpath "$data_directory")
if [ "$data_directory" = / ] || [ "$data_directory" = "$repo_root" ]; then
  printf '%s\n' 'Choose a dedicated application data directory.' >&2
  exit 1
fi

docker run --rm \
  --mount "type=bind,source=$data_directory,target=/data" \
  alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a \
  sh -eu -c '
    owner=$(stat -c "%u:%g" /data)
    if [ "$owner" != "10001:10001" ] && [ -n "$(ls -A /data)" ]; then
      printf "%s\n" "Directory is nonempty and not owned by UID/GID 10001. Follow docs/backup.md to migrate existing data." >&2
      exit 1
    fi
    chown 10001:10001 /data
    chmod 700 /data
  '
printf 'Prepared bind directory: %s (UID/GID 10001, mode 700)\n' "$data_directory"
