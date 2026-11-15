---
name: gournal
description: A command-line work journal. Warm paper and ink, serif reading text, mono for every command, one rust accent.
colors:
  rust: "#b8461f"
  rust-text: "#8f3414"
  rust-wash: "#f4e1d4"
  on-rust: "#fffaf2"
  paper: "#faf6ee"
  paper-raised: "#f3ede0"
  paper-sunk: "#eee6d5"
  code-paper: "#f1eadb"
  ink: "#1d1a15"
  ink-soft: "#473f33"
  ink-muted: "#675e4e"
  ink-faint: "#706753"
  rule: "#ddd3be"
  rule-strong: "#c4b79b"
  focus-blue: "#1d5fa8"
  night-rust: "#e8885c"
  night-rust-text: "#f2a67f"
  night-rust-wash: "#33201a"
  night-paper: "#17140f"
  night-paper-raised: "#201c15"
  night-paper-sunk: "#110f0b"
  night-code-paper: "#1d1912"
  night-ink: "#f1eadc"
  night-ink-soft: "#d0c6b2"
  night-ink-muted: "#a89f8a"
  night-rule: "#342e23"
  night-rule-strong: "#4d4535"
  night-focus-blue: "#7db4f0"
  terminal-plate: "#1d1912"
  terminal-ink: "#f1eadc"
typography:
  display:
    fontFamily: "Newsreader Variable, Georgia, Iowan Old Style, Times New Roman, serif"
    fontSize: "clamp(2.5rem, 1.6rem + 4vw, 4.5rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "clamp(1.875rem, 1.4rem + 1.4vw, 2.375rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: "onum"
  label:
    fontFamily: "Instrument Sans Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "4px"
  md: "8px"
  lg: "14px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
  "8": "4.5rem"
  "9": "7rem"
components:
  button-primary:
    backgroundColor: "{colors.rust}"
    textColor: "{colors.on-rust}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1.5rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.rust-text}"
    textColor: "{colors.on-rust}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1.5rem"
    height: "2.75rem"
  button-secondary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  install-plate:
    backgroundColor: "{colors.code-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
  install-plate-copied:
    backgroundColor: "{colors.rust}"
    textColor: "{colors.on-rust}"
  terminal-plate:
    backgroundColor: "{colors.terminal-plate}"
    textColor: "{colors.terminal-ink}"
    rounded: "{rounded.lg}"
  specimen:
    backgroundColor: "{colors.code-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "1rem"
  sidebar-current:
    backgroundColor: "{colors.rust}"
    textColor: "{colors.on-rust}"
    rounded: "{rounded.sm}"
---

# Design System: gournal

## Overview

**Creative North Star: "The Annotated Notebook"**

Gournal looks like a developer's field notebook that an editor has marked up. The ground is warm paper. The text is dark ink in a reading serif. Every command, file path, and line of output is set in a mono face, because those are the things a reader types or reads in a terminal. One rust color works as the editor's pencil: it marks the current place, the primary action, and the lines that matter.

The system has two surfaces. The docs (Starlight, Read mode) keep Starlight's structure and take only color and type from the tokens. The homepage (Persuade mode) uses the same tokens in a ledger: a margin column that explains and a specimen column that shows real output. The jump between them must feel like one site.

Depth comes from tone and hairlines, not from shadows. The one dark object on a light page is the terminal plate, which holds the real recording.

**Key Characteristics:**
- Warm paper ground in light, warm near-black in dark. Both are tinted, never neutral gray.
- Serif for reading and display, sans for UI labels, mono for code and output only.
- One accent (rust). It never decorates. It marks.
- 1px hairline rules and boxes. No drop shadows anywhere.
- Real product output as the main visual material.

## Colors

A restrained palette: tinted paper and ink neutrals plus one rust accent. Dark theme keys start with `night-`. The theme flips on `[data-theme]`, and on the OS preference when no `data-theme` is set (site/src/styles/tokens.css).

### Primary
- **Editor's Rust** (rust / night-rust): the primary button, the current sidebar item, the active step number, the ledger's margin rule, proof brackets, and leader lines.
- **Deep Rust Text** (rust-text / night-rust-text): links and accent text on paper. It holds 7.3:1 on paper in light and 9.2:1 in dark.
- **Rust Wash** (rust-wash / night-rust-wash): the background of a marked line and of text selection. It carries ink text, never rust text.

### Neutral
- **Notebook Paper** (paper / night-paper): the page ground.
- **Raised Paper** (paper-raised / night-paper-raised): the local-first band, pressed and hovered steps, callouts, table heads.
- **Sunk Paper** (paper-sunk / night-paper-sunk): hover on controls inside a plate.
- **Code Paper** (code-paper / night-code-paper): inline code, code blocks, the install plate, specimens, the transcript.
- **Ink** (ink / night-ink): headings and strong text.
- **Soft Ink** (ink-soft / night-ink-soft): body text.
- **Muted Ink** (ink-muted / night-ink-muted): captions, hints, timestamps, the dim lines of terminal output. It holds 5.9:1 in light and 7.0:1 in dark.
- **Faint Ink** (ink-faint): borders and icons only.
- **Rule** and **Strong Rule** (rule, rule-strong): hairlines, section dividers, plate and box borders.
- **Focus Blue** (focus-blue / night-focus-blue): the focus ring only. It is the one non-warm color, so focus is never mistaken for the accent.
- **Terminal Plate** (terminal-plate, terminal-ink): the background and text of the VHS recording and its frame. They match the VHS theme in scripts/demo/standup.tape.

### Named Rules
**The Pencil Rule.** Rust marks a place, an action, or a line. It is never a background field, a gradient, or an ornament.

**The Faint Ink Rule.** Faint ink is under 4.5:1 on some surfaces. Never use it for text.

**The Terminal Colors Rule.** Output colors on paper (Done green #3d6b2e, Blockers red #9c2f1c, Next amber #7a5a0c; in dark #b7c98f, #f0937a, #e9c47e) appear only inside code specimens and the transcript, and only to mirror the CLI's own colors.

## Typography

**Display Font:** Newsreader Variable (with Georgia, Iowan Old Style)
**Body Font:** Newsreader Variable (with Georgia)
**Label Font:** Instrument Sans Variable (with system-ui)
**Mono Font:** JetBrains Mono Variable (with ui-monospace, SF Mono, Menlo)

**Character:** A calm book serif carries the voice. A plain sans handles controls and captions. The mono is a working face: it shows what the terminal shows. All three fonts are self-hosted through Fontsource.

### Hierarchy
- **Display** (600, clamp(2.5rem, 1.6rem + 4vw, 4.5rem), 1.02): the homepage headline only. Max 15em wide, balanced wrap.
- **Headline** (600, clamp(1.875rem to 2.375rem), 1.15): section titles on the homepage and page titles in the docs.
- **Title** (600, 1.5rem to 1.25rem, 1.3): feature tile titles, step titles, h3 in docs.
- **Body** (400, 1.0625rem, 1.65): reading text, oldstyle numerals, 65 to 75ch measure in docs (46rem column).
- **Label** (500 to 600, 0.875rem): nav links, buttons, captions, hints, sidebar.
- **Code** (400, 0.72rem to 0.95rem): commands, output, paths, and the site name.

### Named Rules
**The Typed Thing Rule.** Mono is for text that a reader types or a terminal prints. Never use it as a "technical" costume for prose or labels. The site name is the one exception, because it is a command.

**The Lining Numbers Rule.** Body text uses oldstyle numerals. Display text, tables, and step numbers use lining or tabular numerals.

## Layout

The homepage is a ledger. A container of max 76rem with a fluid gutter (clamp(1rem, 0.4rem + 3vw, 3rem)) holds a margin column (minmax(17rem, 4fr)) and a specimen column (8fr). A 1px rust rule divides them. Below 60rem the ledger stacks to one column and the rule goes away. The hero margin and the transcript are sticky at 60rem and wider.

Sections are divided by a 1px rule and padded clamp(3rem, 2rem + 5vw, 7rem). Spacing follows the 4px-based scale (0.25rem to 7rem). Feature tiles sit in three columns divided by hairlines at 60rem and wider, become specimen-beside-text rows from 40rem to 60rem, and stack below 40rem.

The docs keep Starlight's layout: one left sidebar, a 46rem content column, and the "On this page" rail. Wide tables and code scroll inside their own box. The page never scrolls sideways.

## Elevation & Depth

This system is flat. It uses no box shadows. Depth comes from three tones of paper (sunk, base, raised), 1px rules, and one dark terminal plate set into the light page.

### Named Rules
**The No Shadow Rule.** Surfaces are flat at rest and in every state. A state change shifts tone or border, never adds a shadow.

## Shapes

Corners are gently rounded: 4px for inline code, sidebar items, and small marks; 8px for buttons, plates, specimens, and steps; 14px for the large terminal plate and the transcript. Step numbers sit in 2rem circles. Borders are 1px; the proof bracket stroke is 1.5px. Callouts are full hairline boxes, never side stripes.

## Components

### Buttons
- **Shape:** 8px radius, 2.75rem tall, label type.
- **Primary:** rust fill with on-rust text. Hover deepens to rust-text.
- **Secondary:** transparent with a 1px ink border and ink text. Hover fills with ink and turns the text to paper.
- **Quiet:** transparent with a 1px strong-rule border. Hover darkens the border to ink.
- **Focus:** a 2px focus-blue outline with a 3px offset on every control.

### Install plate
- **Style:** a code-paper box with a strong-rule border. A rust `$`, the command in mono, and a Copy button divided by a hairline.
- **States:** "Copied" fills the button with rust. "Selected" (no Clipboard API) uses rust wash and selects the command text. A status region announces both.

### Terminal plate
- **Style:** the VHS recording in a terminal-plate box with a 14px radius and a strong-rule border. On wide screens, proof notes sit to its right, each with a 1px rust leader line.
- **Motion:** the video autoplays muted and loops. Under reduced motion the video is hidden and the poster image shows.

### Specimen
- **Style:** a code-paper box with a hairline border that holds real output or a real call. It comes before the claim it proves.

### Navigation
- **Homepage:** the mono site name with a rust `$` on the left, label-type links on the right, a hairline below. Links wrap under the name on narrow screens. Each link has a 2.75rem tap height. External links carry a small drawn arrow.
- **Docs:** Starlight's header and sidebar. The current sidebar item is a rust fill with on-rust text.

### Proof transcript (signature)
A real standup set as text on code paper. Each How it works step is a button. Pressing, focusing, or hovering a step marks the lines it made: a rust-wash fill and a 1.5px rust bracket in the gutter that draws down from its top (clip-path, 220ms, ease-out). Below 60rem only the pressed step shows its command and text. Without script, no line is marked and the hint is hidden.

## Do's and Don'ts

### Do:
- **Do** take every color, size, and space from the `--g-*` tokens in tokens.css.
- **Do** show real gournal output, recorded or typed from a fixture, as the main proof. Label sample data as sample data.
- **Do** keep rust for marks and actions (the Pencil Rule).
- **Do** give every motion a reduced-motion state, and keep content visible with no script.
- **Do** keep phone pages free of sideways scroll. Wide code scrolls inside its box.

### Don't:
- **Don't** use drop shadows, gradients, glass, or glow.
- **Don't** set prose or labels in mono.
- **Don't** use faint ink for text.
- **Don't** add a kicker or eyebrow label above a heading.
- **Don't** use side-stripe borders thicker than 1px on callouts, cards, or list items.
- **Don't** invent numbers, testimonials, logos, or benchmarks. The product has none yet.
