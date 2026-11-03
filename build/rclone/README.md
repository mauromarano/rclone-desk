# rclone module overlay

The image builds upstream rclone **v1.75.2** from the source archive and SHA-256 pinned in `Dockerfile`, using the pinned Go 1.26.10 toolchain. These `go.mod` and `go.sum` files replace the archive's module graph before compilation; `-mod=readonly` rejects implicit graph changes.

The resulting binary identifies itself as **v1.75.2-desk.1** because this is a downstream security build, not the unmodified official binary.

## Changes from the release graph

- `github.com/go-chi/chi/v5`: 5.4.0.
- `golang.org/x/net`: 0.62.0, fixing the HTML parser used by HTTP remote listings.
- Required companion module updates include `x/crypto` 0.58.0, `x/sys` 0.49.0, `x/text` 0.43.0, and `x/term` 0.47.0. The committed graph and checksums are authoritative.

The overlay was generated with `go mod tidy` in the Dockerfile's pinned Go toolchain after setting the two explicit requirements. Go checks downloaded module content against `go.sum` and the checksum database. License files for linked modules are collected into the runtime image before build caches are removed.

For an upstream upgrade, verify the new source archive checksum, regenerate/review this overlay in the pinned toolchain, and keep the Dockerfile source/version/description and notices synchronized. Compare both the module diff and image SBOM; compile and run the local-rclone integration suite, then scan the image before tagging a release. Do not change graph pins without reviewing their transitive updates.

The scanner's unmaintained `x/crypto/openpgp` advisory is tracked in `THIRD_PARTY_NOTICES.md`; that package is not imported by the selected rclone command paths. Module presence alone is not proof of exploitability.
