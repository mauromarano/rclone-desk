---
version: 1
slug: "frontend-src-main-jsx"
primary_target: "frontend/src/main.jsx"
related_targets: ["frontend/src/style.css"]
---

# Rclone Desk surface brief

## Scope

Whole web application redesign; Operate surface. Preserve the product name, all current workflows, and responsive behavior.

## Audience and task

A self-hosting user configures rclone remotes, opens two remote file trees, chooses whether to copy or move files, and maintains reusable copy/sync jobs.

## Proof and content

Use actual rclone remote listings, remote configuration, and persisted jobs as the product's evidence. Local confined remotes are for testing; illustrative sample content is synthetic. Do not imply provider connectivity unless a real operation succeeds.

## Constraints

React frontend and FastAPI backend run through Docker Compose; install no host dependencies. Keep standard rclone INI import/export and provider configuration, remote editing, two-pane browsing, transfers, and sync jobs. Drag/drop uses an explicit Sposta/Copia selector, default Sposta; Copy retains the source, Move deletes it only after a successful transfer. Sync may delete destination-only files and needs confirmation on every run. Support keyboard and mobile alternatives to dragging. The service has no authentication and binds to 0.0.0.0; retain the network-exposure warning.

## Direction contract

### THESIS

A familiar, well-made cloud file manager makes two remote trees and the consequence of a transfer immediately legible; it refuses to make file operations depend on decoration or a hidden gesture.

### OWN-WORLD

The user chose the category standard over the alternate visual systems. Use the familiar file-manager grammar with a clear white working surface, dark legible type, restrained blue primary/selection color, and quiet neutral separators. Reserve amber and red for meaningful warning and destructive states. Native-feeling buttons, selects, inputs, breadcrumbs, and sortable tables; consistent spacing and explicit file/folder states.

### STORY

Select a source and destination remote, compare their contents, choose Sposta or Copia before dragging, then see a truthful success or error. Copy leaves the source; Move removes it after success. Job configuration and settings remain directly discoverable. Sync's destination-deletion consequence is stated before each run.

### FIRST VIEWPORT

A stable application shell presents File browser, Sync jobs, and Configuration navigation. The browser opens with a compact page title and transfer-mode selector above two equally weighted panes. Each pane shows its selected remote, breadcrumb, refresh, and a readable file table with name, type, size, and modified time when available. The source-to-destination relationship and the current action are visible before drag. At narrow widths the panes stack and retain remote identity; per-row Copy/Move controls make the operation usable without dragging.

### FORM

The user selected the category-standard file-manager direction through the visual-direction decision, then named Google Drive, Dropbox, and Nextcloud as craft references. The chosen form is the category-standard option (standing exit), not a catalog challenger; seed key e816277a.

### FINISH

unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions

None for this surface. Drag-and-drop defaults to Sposta; Copy is an explicit mode choice.
