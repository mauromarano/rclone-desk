# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A self-hosting user who manages files across multiple rclone storage remotes from a browser.

## Product Purpose

Rclone Desk provides a web interface to configure rclone remotes, browse two remotes side by side, transfer files between them, and create and run reusable copy or sync jobs.

## Positioning

The interface delegates storage and transfer behavior to rclone, including its provider ecosystem and rclone-compatible configuration, rather than implementing storage-provider integrations independently.

## Operating Context

The application runs in Docker Compose and is used through a web browser. The user may configure real remote credentials after deployment. Local confined remotes are used for credential-free testing. Configuration and jobs persist in a Docker volume.

## Capabilities and Constraints

- Configure remotes using a provider-backed wizard or an rclone-compatible INI configuration file; edit remote options in the wizard.
- Browse two remotes in parallel and drag files or folders to transfer them.
- Create buckets or containers at the root of supported object-storage remotes through rclone.
- Drag-and-drop offers explicit **Move** and **Copy** modes; Move is the default. Copy preserves the source; Move removes it after a successful transfer.
- Save and run copy and sync jobs. Sync may delete destination-only files and requires explicit confirmation before each run.
- Build and run through Docker without installing dependencies on the host.
- The app has no authentication layer and binds to `0.0.0.0`; network access must be restricted by firewall or an authenticated reverse proxy.
- Real cloud-provider credentials and live remote behavior are not part of the test environment; local remotes provide the verification path.

## Brand Commitments

The product name is Rclone Desk. No other visual identity, logo, or brand rules have been specified.

## Evidence on Hand

- Official rclone documentation: https://rclone.org/ and https://rclone.org/docs/.
- The existing implementation supports wizard configuration, INI editing, side-by-side browsing, transfers, and persistent copy/sync jobs.
- No real cloud credentials or real-provider test accounts are provided.

## Product Principles

- Keep rclone behavior and configuration authoritative.
- Make transfer consequences explicit before a file is dropped.
- Preserve source data when copying; make destructive moves and sync deletion understandable.
- Keep user credentials and job state in persistent application storage.
