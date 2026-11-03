# Rclone Desk

A private web interface for browsing rclone remotes, copying or moving files between them, and running saved copy/sync jobs. The app uses rclone's CLI directly (never an exposed rclone RC server); the config and job state live in a Docker volume.

## Start

Install Docker with the Compose plugin, then run:

```sh
docker compose up --build
```

Open `http://<server-ip>:8000`. Change the published port with `PORT=8080 docker compose up --build`. The default port binds to `0.0.0.0` (all interfaces). No host-side Node, Python, or rclone installation is needed.

## First steps and test remotes

Choose **Nuovo remote**, name it (for example `source`), select **local**, and leave **Remote locale confinato** enabled. Add a second local test remote named `archive`. Each root is created under the persistent app data directory at `/data/test-remotes/<remote-name>`; all paths are checked to stay under that root. These are real filesystem remotes operated on by rclone and are suitable for testing without cloud credentials. Add files through another container/tool or upload them into the mounted data volume before browsing.

For real storage, choose a provider in **Nuovo remote**; the provider list is alphabetical and searchable by name or description. Fill the options presented by rclone's provider catalog. Use **Modifica** next to a remote to change its type-specific options without replacing saved values; blank fields keep their current settings. For advanced authentication, paste or import a standard rclone INI file in **Configurazione**. The format is the normal rclone config, such as:

```ini
[my-drive]
type = drive
# Add the provider's required options here.
```

The editor accepts rclone-compatible INI configuration and can export it as `rclone.conf`. Treat config exports and the editor as secrets: they may contain tokens and passwords. Remote listing/status views never return configured option values. The app intentionally has no authentication layer; binding to `0.0.0.0` exposes remote management and file operations to any host that can reach the port. Restrict access with a firewall or an authenticated reverse proxy.

## Browsing and jobs

In **Trasferimenti**, choose two remotes and browse their folders. Drag a file or folder to the other pane, or use the action button on its row (also available on mobile and without drag-and-drop). The default **Sposta** action removes the source after a successful transfer. Select **Copia** to keep the source; an existing file with the same name at the destination may be overwritten.

Create a job to run a copy or sync between remote paths. Copy preserves source files. Sync makes the destination match the source and can delete destination-only files; the app warns during setup and requires explicit confirmation on every sync run. Job status, last-run time, and result/error are saved persistently.

## Data and safety

Compose creates the `rclone_data` volume for `rclone.conf`, job state, and confined local test roots. Back up this volume to preserve configuration and jobs. Do not publish this service to the internet without adding an appropriate authentication and network-security layer. The backend invokes fixed rclone argument arrays without a shell, rejects traversal paths, and does not expose rclone's privileged RC API.
