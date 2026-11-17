---
name: gournal
description: A work journal for you and your AI agents. Muted Dracula: lavender paper and ink, serif reading text, mono for every command, one violet accent.
colors:
  violet: "#5b45b8"
  violet-text: "#4f3aa6"
  violet-wash: "#e7e1f7"
  on-violet: "#ffffff"
  paper: "#f7f6fb"
  paper-raised: "#eeedf6"
  paper-sunk: "#e6e4f0"
  code-paper: "#ebe9f4"
  ink: "#1e1d29"
  ink-soft: "#3d3b52"
  ink-muted: "#5f5c80"
  ink-faint: "#67648a"
  rule: "#d8d6e6"
  rule-strong: "#bdb9d3"
  focus-blue: "#1f6f93"
  night-violet: "#a98be6"
  night-violet-text: "#b9a0f0"
  night-violet-wash: "#332c4a"
  night-paper: "#1f2029"
  night-paper-raised: "#272938"
  night-paper-sunk: "#191a22"
  night-code-paper: "#17181f"
  night-ink: "#ecebf3"
  night-ink-soft: "#cfcfe0"
  night-ink-muted: "#9a9fc2"
  night-rule: "#353749"
  night-rule-strong: "#4a4d66"
  night-focus-blue: "#7fd6ea"
  terminal-plate: "#17181f"
  terminal-ink: "#ecebf3"
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
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1.5rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.violet-text}"
    textColor: "{colors.on-violet}"
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
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
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
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
    rounded: "{rounded.sm}"
---

# Design System: gournal

## Overview

**Creative North Star: "The Annotated Notebook"**

Gournal looks like a developer's field notebook that an editor has marked up. The ground is cool lavender paper in light and deep navy-violet in dark. The text is dark ink in a reading serif. Every command, file path, and line of output is set in a mono face, because those are the things a reader types or reads in a terminal. One violet color works as the editor's pencil: it marks the current place, the primary action, and the lines that matter.

The system has two surfaces. The docs (Starlight) keep Starlight's structure and take only color and type from the tokens. The homepage uses the same tokens in a ledger: a margin column that explains and a specimen column that shows real output. The jump between them must feel like one site.

Depth comes from tone and hairlines, not from shadows. The one dark object on a light page is the terminal plate, which holds the real recording.

**Key Characteristics:**
- Lavender paper ground in light, deep navy-violet in dark, from a muted Dracula palette. Both are tinted, never neutral gray.
- Serif for reading and display, sans for UI labels, mono for code and output only.
- One accent (violet). It never decorates. It marks.
- 1px hairline rules and boxes. No drop shadows anywhere.
- Real product output as the main visual material.

## Colors

A restrained palette: tinted paper and ink neutrals plus one violet accent. Dark theme keys start with `night-`. The theme flips on `[data-theme]`, and on the OS preference when no `data-theme` is set (site/src/styles/tokens.css).

### Primary
- **Editor's Violet** (violet / night-violet): the primary button, the current sidebar item, the active step number, the ledger's margin rule, proof brackets, and leader lines.
- **Deep Violet Text** (violet-text / night-violet-text): links and accent text on paper. It holds 7.8:1 on paper in light and 7.2:1 in dark.
- **Violet Wash** (violet-wash / night-violet-wash): the background of a marked line and of text selection. It carries ink text, never violet text.

### Neutral
- **Notebook Paper** (paper / night-paper): the page ground.
- **Raised Paper** (paper-raised / night-paper-raised): the local-first band, pressed and hovered steps, callouts, table heads.
- **Sunk Paper** (paper-sunk / night-paper-sunk): hover on controls inside a plate.
- **Code Paper** (code-paper / night-code-paper): inline code, code blocks, the install plate, specimens, the transcript.
- **Ink** (ink / night-ink): headings and strong text.
- **Soft Ink** (ink-soft / night-ink-soft): body text.
- **Muted Ink** (ink-muted / night-ink-muted): captions, hints, timestamps, the dim lines of terminal output. It holds 5.9:1 in light and 6.3:1 in dark.
- **Faint Ink** (ink-faint, dark #868ab0): borders and icons only.
- **Rule** and **Strong Rule** (rule, rule-strong): hairlines, section dividers, plate and box borders.
- **Focus Blue** (focus-blue / night-focus-blue): the focus ring only. It is a cyan, far from the violet accent, so focus is never mistaken for the accent.
- **Terminal Plate** (terminal-plate, terminal-ink): the background and text of the VHS recording and its frame. They match the VHS theme in scripts/demo/standup.tape.

### Named Rules
**The Pencil Rule.** Violet marks a place, an action, or a line. It is never a background field, a gradient, or an ornament.

**The Faint Ink Rule.** Faint ink is under 4.5:1 on some surfaces. Never use it for text.

**The Terminal Colors Rule.** Output colors on paper (Done green #2c6e33, Blockers red #b23a3a, Next amber #7c6616; in dark #7fdc97, #f08080, #e3e39a) appear only inside code specimens and the transcript, and only to mirror the CLI's own colors.

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
- **Body** (400, 1.0625rem, 1.65): reading text, oldstyle numerals. Docs use one shared 64rem column for prose and tables, so prose lines can run past 75ch on wide screens.
- **Label** (500 to 600, 0.875rem): nav links, buttons, captions, hints, sidebar.
- **Code** (400, 0.72rem to 0.95rem): commands, output, paths, and the site name.

### Named Rules
**The Typed Thing Rule.** Mono is for text that a reader types or a terminal prints. Never use it as a "technical" costume for prose or labels. The site name is the one exception, because it is a command.

**The Lining Numbers Rule.** Body text uses oldstyle numerals. Display text, tables, and step numbers use lining or tabular numerals.

## Layout

The homepage hero is one column inside a container of max 76rem with a fluid gutter (clamp(1rem, 0.4rem + 3vw, 3rem)). The order is: title, lede, install plate (up to 36rem wide), requirement line, buttons on their own row, trust line, then the demo. The demo stage fills the container width. At 60rem and wider, the proof notes sit to the right of the 44rem terminal plate. Below 60rem, the notes are hidden. The hero has no margin column and no sticky element. The other sections (How it works, Local-first) still use the ledger: a margin column (minmax(17rem, 4fr)) and a specimen column (8fr), divided by a 1px violet rule. Below 60rem the ledger stacks to one column and the rule goes away. The transcript is sticky at 60rem and wider.

Sections are divided by a 1px rule and padded clamp(3rem, 2rem + 5vw, 7rem). Spacing follows the 4px-based scale (0.25rem to 7rem). The Features section has a visible heading and an intro line above four tiles: three inputs (CLI, agents, GitHub) and one output (standups). At 60rem and wider, the output tile has a stronger rule (rule-strong) on its inline-start side. Feature tiles sit in four columns divided by hairlines at 80rem and wider, in two columns by two rows from 60rem to 80rem, become specimen-beside-text rows from 40rem to 60rem, and stack below 40rem.

The docs keep Starlight's layout: one left sidebar, a 64rem content column that fills the space between the sidebar and the rail on most laptop screens, and the "On this page" rail. Wide tables and code scroll inside their own box. The page never scrolls sideways.

## Elevation & Depth

This system is flat. It uses no box shadows. Depth comes from three tones of paper (sunk, base, raised), 1px rules, and one dark terminal plate set into the light page.

### Named Rules
**The No Shadow Rule.** Surfaces are flat at rest and in every state. A state change shifts tone or border, never adds a shadow.

## Shapes

Corners are gently rounded: 4px for inline code, sidebar items, and small marks; 8px for buttons, plates, specimens, and steps; 14px for the large terminal plate and the transcript. Step numbers sit in 2rem circles. Borders are 1px; the proof bracket stroke is 1.5px. Callouts are full hairline boxes, never side stripes.

## Components

### Buttons
- **Shape:** 8px radius, 2.75rem tall, label type.
- **Primary:** violet fill with on-violet text. Hover deepens to violet-text.
- **Secondary:** transparent with a 1px ink border and ink text. Hover fills with ink and turns the text to paper.
- **Quiet:** transparent with a 1px strong-rule border. Hover darkens the border to ink.
- **Focus:** a 2px focus-blue outline with a 3px offset on every control.

### Install plate
- **Style:** a code-paper box with a strong-rule border. A violet `$`, the command in mono, and a Copy button divided by a hairline. The plate grows to 36rem. The command does not scroll at 768 px and wider.
- **States:** "Copied" fills the button with violet. "Selected" (no Clipboard API) uses violet wash and selects the command text. A status region announces both.

### Terminal plate
- **Recording ratio:** 1200 / 1000, from Width and Height in scripts/demo/standup.tape. Change the plate aspect ratio in home.css when the tape size changes.
- **Style:** the VHS recording in a terminal-plate box with a 14px radius and a strong-rule border. On wide screens, proof notes sit to its right, each with a 1px violet leader line.
- **Motion:** the video autoplays muted and loops. Under reduced motion the video is hidden and the poster image shows.

### Specimen
- **Style:** a code-paper box with a hairline border that holds real output or a real call. It comes before the claim it proves.

### Navigation
- **Homepage:** the mono site name with a violet `$` on the left, label-type links on the right, a hairline below. Links wrap under the name on narrow screens. Each link has a 2.75rem tap height. External links carry a small drawn arrow.
- **Docs:** Starlight's header and sidebar. The current sidebar item is a violet fill with on-violet text.

### Proof transcript (signature)
A real standup set as text on code paper. Each How it works step is a button. Pressing, focusing, or hovering a step marks the lines it made: a violet-wash fill and a 1.5px violet bracket in the gutter that draws down from its top (clip-path, 220ms, ease-out). Below 60rem only the pressed step shows its command and text. Without script, no line is marked and the hint is hidden.

## Do's and Don'ts

### Do:
- **Do** take every color, size, and space from the `--g-*` tokens in tokens.css.
- **Do** show real gournal output, recorded or typed from a fixture, as the main proof. Label sample data as sample data.
- **Do** keep violet for marks and actions (the Pencil Rule).
- **Do** give every motion a reduced-motion state, and keep content visible with no script.
- **Do** keep phone pages free of sideways scroll. Wide code scrolls inside its box.

### Don't:
- **Don't** use drop shadows, gradients, glass, or glow.
- **Don't** set prose or labels in mono.
- **Don't** use faint ink for text.
- **Don't** add a kicker or eyebrow label above a heading.
- **Don't** use side-stripe borders thicker than 1px on callouts, cards, or list items.
- **Don't** invent numbers, testimonials, logos, or benchmarks. The product has none yet.
