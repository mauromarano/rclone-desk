---
name: Rclone Desk
description: A familiar cloud file manager for clear, careful work across rclone remotes.
colors:
  ink: "#172033"
  muted: "#526078"
  quiet: "#647188"
  line: "#dfe4ec"
  line-strong: "#c9d1dd"
  surface: "#fff"
  canvas: "#f4f6f9"
  blue: "#2459d6"
  blue-dark: "#1947b4"
  blue-wash: "#edf3ff"
  green: "#1b7554"
  green-wash: "#eaf6ef"
  amber: "#8a4b08"
  amber-wash: "#fff5e2"
  red: "#b42318"
  red-wash: "#fff0ee"
  focus: "#3478ed"
typography:
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  dialog: "14px"
spacing:
  button-inline: "13px"
  pane-gap: "15px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#35435a"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "#26344b"
    rounded: "7px"
    padding: "0 10px"
    height: "38px"
  file-pane:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0"
  navigation-active:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue-dark}"
    rounded: "8px"
    padding: "0 11px"
    height: "40px"
---

# Design System: Rclone Desk

## Overview

**Creative North Star: "The Familiar Cloud File Manager"**

Rclone Desk uses the recognizable grammar of a well-made cloud file manager: a clean white working surface, legible dark type, orderly tables, and restrained blue for primary actions and selection. Its visual character is practical and calm, with enough structure to make two remote locations and their contents easy to distinguish without decorative distractions. Google Drive, Dropbox, and Nextcloud are the craft bar for this category-standard direction, not a request to imitate their branding.

Controls should feel native to the web platform and behave predictably. File and folder identity is explicit; transfer mode is visible before action; amber and red signal consequential warnings and destructive states. Responsive behavior preserves the same file-manager grammar from wide side-by-side browsing to stacked mobile panes.

**Key Characteristics:**
- Familiar cloud file-manager conventions with clear remote identity.
- White surfaces, dark readable text, restrained blue emphasis, and neutral separators.
- Explicit file/folder distinction and visible Copy/Move consequences.
- Responsive, orderly tables and controls that remain usable on narrow screens.

## Colors

A quiet neutral foundation carries most of the interface; blue marks primary interaction, while green, amber, and red communicate meaningful status.

### Primary
- **Clear Action Blue** (`{colors.blue}`): Primary buttons, selected controls, and active drop targets.
- **Deep Action Blue** (`{colors.blue-dark}`): Hover and emphasized interactive text.

### Neutral
- **Ink Navy** (`{colors.ink}`): Main headings and high-priority interface text.
- **Slate Text** (`{colors.muted}`): Supporting copy and explanatory text.
- **Quiet Slate** (`{colors.quiet}`): Secondary labels and breadcrumbs.
- **White Surface** (`{colors.surface}`): Working panes, fields, and dialogs.
- **Cool Canvas** (`{colors.canvas}`): The application background behind working surfaces.
- **Neutral Divider** (`{colors.line}`): Standard separators and borders.
- **Strong Divider** (`{colors.line-strong}`): More defined field and control boundaries.
- **Blue Wash** (`{colors.blue-wash}`): Selected navigation and light blue action states.
- **Focus Blue** (`{colors.focus}`): Visible keyboard focus outlines and field focus.
- **Success Green** (`{colors.green}`) and **Success Wash** (`{colors.green-wash}`): Successful status and confirmation feedback.
- **Warning Amber** (`{colors.amber}`) and **Warning Wash** (`{colors.amber-wash}`): Warnings and Move-mode consequence cues.
- **Destructive Red** (`{colors.red}`) and **Destructive Wash** (`{colors.red-wash}`): Errors and destructive actions.

**The Consequence Color Rule.** Keep blue for selection and primary action; reserve amber and red for meaningful warning and destructive states.

## Typography

**Display Font:** System UI sans-serif (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
**Body Font:** System UI sans-serif (same platform stack)
**Label/Mono Font:** System UI sans-serif for interface labels; system monospace is limited to the INI editor.

**Character:** The platform-native sans-serif stack keeps the interface familiar and legible. Compact labels and table data remain subordinate to clear headings and readable explanatory copy.

### Hierarchy
- **Display / page heading** (weight 690, 24–30px, line-height 1.2): Page titles, scaled with viewport width.
- **Headline** (weight 680, 15–19px): Section and dialog headings.
- **Body** (regular, typically 11–13px, line-height 1.45–1.65): File metadata, instructions, and supporting text.
- **Label** (weight 650–720, typically 10–12px): Table headings, pane roles, navigation labels, and compact controls.
- **Configuration text** (12px monospace, line-height 1.6): INI editor content only.

**The Platform Type Rule.** Use the system sans-serif stack for the interface; keep monospace confined to configuration editing.

## Layout

The desktop shell pairs a fixed-width navigation rail with a flexible main area. The sidebar is 248px wide, narrowing to 218px at the medium breakpoint; the main content is capped at 1660px. A sticky 62px top bar anchors desktop context. File browsing uses two equal, min-width-safe panes separated by 15px; each pane keeps remote selection, breadcrumbs, a sortable table, and a footer together.

At 1100px, the two-pane layout hides secondary date metadata to protect table readability. At 760px, the app shell switches to vertical flow and the stacked panes restore dates; at 420px, dates hide again as controls compact. Navigation becomes horizontally scrollable, and per-row transfer actions remain available throughout. Use the established responsive rhythm and preserve usable controls rather than forcing desktop columns onto a narrow screen.

## Elevation & Depth

Depth is primarily conveyed through white surfaces against a pale canvas, fine separators, and restrained state fills. A dialog receives structural elevation from a single soft shadow; success feedback also uses a light shadow. Normal panes and tables remain flat.

### Shadow Vocabulary
- **Dialog elevation** (`0 18px 52px rgba(23, 32, 51, .18)`): Modal dialogs above the dimmed application.
- **Success toast** (`0 8px 24px rgba(17, 42, 31, .1)`): Brief confirmation feedback.

## Shapes

The form language is gently rounded and familiar rather than ornamental. Standard controls and navigation use 8px corners; file panes and larger containers use 12px; dialogs use 14px. Borders are thin, neutral, and structural. Segmented choices use a nested radius, and status pills use fully rounded ends. Preserve native select and input affordances.

## Components

### Buttons
Compact, confident actions use restrained color and clear labels.
- **Shape:** Gently rounded corners (8px); standard actions are at least 36px tall.
- **Primary:** Blue fill with white text; darker blue on hover.
- **Secondary:** White fill with a stronger neutral outline; subtle neutral hover fill.
- **Danger:** Red fill for destructive actions; darkens on hover.
- **Focus:** A visible 3px blue keyboard outline with a 2px offset.
- **Disabled:** Noninteractive cursor and reduced opacity.

### Inputs / Fields
Native-feeling fields use a white fill and legible dark text.
- **Style:** Neutral outlined, 7px corners, 38px minimum height, compact horizontal padding.
- **Focus:** Blue border and a restrained blue focus halo.
- **Disabled:** Muted text on a pale neutral fill.

### Navigation
The sidebar presents primary destinations and remotes with compact labels. Inactive items are quiet and transparent; hover adds a pale neutral fill, and the active destination receives a blue-wash fill with deep blue text. On mobile, primary navigation becomes a horizontal strip and remote/sidebar status sections are hidden from this rail.

### Chips
Compact status and mode tags pair a pale semantic fill with readable text. Blue identifies Copy; amber marks Move and sync-related warning context. Keep these chips informational rather than using color alone to communicate consequences.

### Cards / Containers
File panes and tabular containers are white, bordered, and gently rounded (12px). Thin separators organize headers, rows, and footers; tables use compact sortable headings, explicit file/folder icons, and per-row transfer actions. A drop-active pane receives a blue border and inset emphasis. Dialogs are more elevated and may become bottom sheets on mobile.

### Dialogs
Dialogs use a white surface, defined border, and soft structural shadow; confirmation dialogs keep warning context visible. Focus is contained, Escape closes the dialog, and focus returns to its trigger. On narrow screens dialogs align to the bottom as full-width sheets. Entry motion is brief and honors reduced-motion preferences.

### Remote configuration
Remote creation and editing use a dedicated full-page workspace rather than a dialog. The provider picker starts with the active provider visible; searching or browsing opens an alphabetized, directly selectable list by name or description. While choosing, hide provider-specific fields and prevent saving so a previous provider's settings cannot be mistaken for the new selection. Finite provider choices, such as the S3 backend, use native selects. Core options stay visible while optional advanced settings are progressively disclosed.

## Do's and Don'ts

### Do:
- **Do** use a white working surface, legible dark text, restrained blue interaction color, and quiet neutral separators.
- **Do** keep file and folder identity visible and make table headings sortable.
- **Do** expose Copy and Move choices and their consequences before transfer; retain row actions as a non-drag alternative.
- **Do** use amber for warnings and red for destructive or error states; preserve visible keyboard focus.
- **Do** stack panes responsively while retaining their remote identity and actions.

### Don't:
- **Don't** invent a competing visual metaphor or borrow another product's branding.
- **Don't** rely on dragging as the only way to transfer a file.
- **Don't** use blue as a substitute for warning or destructive meaning.
- **Don't** hide file-versus-folder identity in the table.


## Brand assets and motion

The original Rclone Desk mark uses two file panes in ink and action blue joined by a white directional connector. Use the SVG in `frontend/public/images/rclone-desk-mark.svg`; favicon, inverse, and social-preview variants share the same geometry. It is independent artwork and does not reuse rclone or provider trademarks. Asset provenance is recorded in `docs/images/README.md`.

Remote listing waits show a live loading message, a bounded skeleton sequence, and a blue scanning line. Respect reduced-motion preferences and keep user supplied filenames and remote names outside translation. English is the default interface language; Italian is optional.
