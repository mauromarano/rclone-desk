# Deployment

Rclone Desk is an experimental single-admin app. It has no built-in authentication. A request to the app can read or change configured remotes and perform file operations using their credentials.

## Local use

The Compose configuration builds locally and publishes the service on loopback at `127.0.0.1:${PORT:-8000}`. Start it with:

```sh
./scripts/prepare-data.sh
docker compose up --build -d
```

Open <http://localhost:8000>. Set `PORT=8080` to use another local host port. The host data directory defaults to `./data` in the repository and is mounted at `/data` in the container. Run `./scripts/prepare-data.sh` once before the first startup; it creates the directory with private permissions and sets ownership of the top-level directory to UID 10001. The app creates its config and state files with restrictive permissions.

To use a different location, export its absolute path before running both the preparation script and Compose:

```sh
export RCLONE_DESK_DATA_DIR="$HOME/rclone-desk-data"
./scripts/prepare-data.sh
docker compose up --build -d
```

Keep custom data outside the repository, or add that directory to both `.gitignore` and `.dockerignore`. For a relative `RCLONE_DESK_DATA_DIR`, the helper resolves it from the repository root. Export the value in the shell before both commands; Compose interpolation does not read a shell variable that was not exported. Do not `source` a `.env` file as shell code. `docker compose down` and `docker compose down -v` leave the host directory in place.

Keep the backend on loopback unless a trusted authentication layer is placed in front of it.

## Remote access through Caddy

Use a domain whose DNS points to the host and whose HTTPS traffic can reach Caddy. Keep the app published only on loopback. The following example uses Caddy's built-in HTTP Basic Authentication; create the password hash with `caddy hash-password` and replace the placeholder. Protect the Caddyfile and choose a strong unique password.

```caddyfile
desk.example.net {
	 basic_auth {
		 admin REPLACE_WITH_OUTPUT_OF_CADDY_HASH_PASSWORD
	 }
	 reverse_proxy 127.0.0.1:8000
}
```

Caddy obtains HTTPS certificates when DNS and inbound access are configured correctly. Do not add another public mapping for port 8000. Restrict host firewall rules so only the proxy can reach the service. This example is a deployment pattern, not a claim that a particular host or proxy configuration has been tested.

The app's host and origin allowlists are configured with `APP_ALLOWED_HOSTS` and `APP_ALLOWED_ORIGINS`, comma-separated values. Their defaults are `localhost,127.0.0.1,[::1]` and an empty origin list. For a proxy-served domain, set both explicitly; include the proxy host in the hosts list and the exact HTTPS origin in the origins list:

```yaml
services:
  rclone-ui:
    environment:
      APP_DATA: /data
      APP_ALLOWED_HOSTS: desk.example.net,localhost,127.0.0.1,[::1]
      APP_ALLOWED_ORIGINS: https://desk.example.net
```

Use only origins you control. CORS and these allowlists do not authenticate users; the proxy authentication and inaccessible upstream port are essential. The proxy must preserve the `Host` header and must not cache configuration or file responses. Continue to run one app container because scheduler and operation state are held in the single backend process.

## Data and container

`APP_DATA` defaults to `/data`; Compose bind-mounts the host directory selected by `RCLONE_DESK_DATA_DIR` there. The container runs as UID 10001. The preparation script sets the top-level directory owner without recursively changing existing files; it refuses a non-empty directory owned by another UID. For an existing installation, follow the migration instructions in [backup and restore](backup.md). Avoid mounting the Docker socket, host root, or unrelated secrets. Use narrowly scoped provider credentials.

The container image is built locally from this repository. Review the Dockerfile and dependency updates before rebuilding or upgrading an existing deployment. Keep a backup before upgrades; see [backup and restore](backup.md).

## Resource limits

Compose caps the application container at 2 GiB RAM, two CPUs, and 256 processes/threads. Tune these values for your provider and transfer workload; keep a memory limit so a hostile or unusually large remote response cannot consume the whole host. Hitting the memory limit can interrupt operations and restart the container. Cancellation and restarts do not roll back completed file changes.

The app admits four operation workers and up to 256 queued/active operations, limits metadata listings to 32 MiB of JSON, and prepares at most two downloads at a time (1 GiB and five minutes each). Temporary downloads use the container's ephemeral filesystem, so provision space separately from the persistent data volume.
