# Third-party notices

This inventory describes third-party code present in the published container: the Python runtime dependency graph, JavaScript code included in the compiled browser bundle, and the rclone executable. Node, Vite, and other frontend build tools are not included in the final image.

## Python runtime (`backend/requirements.lock`)

| Package | Version | License |
| --- | ---: | --- |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.16.0 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| fastapi | 0.162.0 | MIT |
| h11 | 0.16.0 | MIT |
| httptools | 0.9.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| opentelemetry-api | 1.45.2 | Apache-2.0 |
| pydantic | 2.14.2 | MIT |
| pydantic-core | 2.50.2 | MIT |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| PyYAML | 6.0.3 | MIT |
| Starlette | 1.10.0 | BSD-3-Clause |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| uvloop | 0.23.0 | MIT |
| watchfiles | 1.3.0 | MIT |
| websockets | 17.4 | BSD-3-Clause |

The installed Python distributions retain their license metadata under `/usr/local/lib/python3.12/site-packages/*.dist-info/licenses/` when provided by upstream packages.

## Browser bundle

| Package | Version | License |
| --- | ---: | --- |
| i18next | 26.7.1 | MIT |
| lucide-react | 1.67.0 | ISC |
| React | 19.3.1 | MIT |
| React DOM | 19.3.1 | MIT |
| react-i18next | 17.1.11 | MIT |
| scheduler | 0.28.0 | MIT |

These are the frontend packages included in the browser bundle. Their upstream license texts are included in the image under `/app/frontend/dist/licenses/` and are shipped with the browser assets. Upstream project pages: [i18next](https://github.com/i18next/i18next), [Lucide](https://github.com/lucide-icons/lucide), [React](https://github.com/facebook/react), and [react-i18next](https://github.com/i18next/react-i18next).

## rclone

The image includes the rclone `v1.75.2-desk.1` executable, built from the official v1.75.2 source archive with the repository-owned Go dependency graph in `build/rclone/go.mod` and `build/rclone/go.sum`. The frozen graph updates `github.com/go-chi/chi/v5` to v5.4.0 and `golang.org/x/net` to v0.62.0; the latter requires `golang.org/x/crypto` v0.58.0 and its associated Go x modules. These changes address the reported chi and x/net advisories. The remaining x/crypto OpenPGP advisory concerns its unmaintained OpenPGP package, which this application does not invoke; rclone's self-update code uses ProtonMail/go-crypto instead, and the app does not expose rclone self-update. The executable is licensed under the MIT License. Its upstream copyright and permission notice is included in the image at `/usr/share/doc/rclone/COPYING`.

The image also includes an inventory and the upstream license/notice files found for Go modules linked into the rclone executable, the Go standard library, and its vendored source subtree under `/usr/share/doc/rclone/dependency-licenses/`. These files preserve each component's own terms; the inventory does not imply that all Go dependencies use MIT.

The corresponding rclone source is available from [the versioned official source archive](https://downloads.rclone.org/v1.75.2/rclone-v1.75.2.tar.gz) (SHA-256 `fa64537e7276196310dbb0bcea6330f03b40e5790197b88f14cce6a19f40eb67`). The Docker build overlays `build/rclone/go.mod` and `build/rclone/go.sum` onto that source before compiling with Go 1.26.10 in read-only module mode. For a listed module, retrieve its exact source with `go mod download <module>@<version>` using the module path and version in the inventory.
