# Design

The visual system for both surfaces. Tokens live in
[`shared/tokens.ts`](shared/tokens.ts) and are the single source; this file explains them.

## Register

Product. Both the widget and the panel are tools serving a task, and both earn trust through
density, alignment, and complete state coverage rather than decoration.

## Theme

The widget has no theme. It has **one identity with two adaptations**. Chrome inverts; hue,
spacing, type, and shape never change.

Resolution order, three cheap reads, evaluated once at load:

1. `data-theme="light|dark"` on the script tag
2. the host page's computed `color-scheme`
3. `prefers-color-scheme`

No background-colour sampling. It sounds more considerate and breaks on gradients, background
images, and sticky headers, and it fails silently. The widget also never tries to match the
host's palette: looking almost like the host page reads worse than looking deliberately
separate from it.

The panel owns its page, so system preference alone decides its adaptation.

## Color

**Restrained, with one committed signal.**

Amber means an open thread. That is its only meaning, on both surfaces. Resolved is defined as
the *absence* of amber plus a word. It is never borrowed for buttons, focus rings, hover,
emphasis, or install status, because the moment it means two things it means nothing.

The primary action is ink, not amber, for the same reason.

Every neutral is tinted warm toward the signal hue (chroma 0.004 to 0.010). No `#000`, no
`#fff` anywhere.

| Token | Light | Dark |
|---|---|---|
| `--tc-surface-0` | `oklch(0.990 0.004 80)` | `oklch(0.210 0.008 75)` |
| `--tc-surface-1` | `oklch(0.975 0.005 80)` | `oklch(0.175 0.008 75)` |
| `--tc-surface-2` | `oklch(0.998 0.003 80)` | `oklch(0.250 0.009 75)` |
| `--tc-border-subtle` | `oklch(0.90 0.006 80)` | `oklch(0.27 0.009 75)` |
| `--tc-border` | `oklch(0.84 0.008 80)` | `oklch(0.32 0.010 75)` |
| `--tc-text-1` | `oklch(0.24 0.010 75)` | `oklch(0.95 0.005 80)` |
| `--tc-text-2` | `oklch(0.52 0.008 75)` | `oklch(0.72 0.007 78)` |
| `--tc-text-3` | `oklch(0.64 0.007 75)` | `oklch(0.60 0.007 78)` |
| `--tc-signal` | `oklch(0.70 0.145 72)` | `oklch(0.78 0.145 78)` |
| `--tc-signal-text` | `oklch(0.52 0.130 62)` | `oklch(0.82 0.130 80)` |
| `--tc-danger` | `oklch(0.55 0.170 27)` | `oklch(0.72 0.150 27)` |
| `--tc-action-bg` | `oklch(0.24 0.010 75)` | `oklch(0.95 0.005 80)` |
| `--tc-action-fg` | `oklch(0.98 0.004 80)` | `oklch(0.20 0.010 75)` |

### Highlight ramp

| Open threads | Light | Dark |
|---|---|---|
| 1 | `oklch(0.93 0.055 82)` | `oklch(0.34 0.055 78)` |
| 2 | `oklch(0.89 0.090 80)` | `oklch(0.40 0.080 76)` |
| 3+ | `oklch(0.85 0.120 78)` | `oklch(0.46 0.105 74)` |

The ramps sit at lightness extremes on purpose. A highlight paints *behind* host text whose
colour we do not control and must not change, so staying very light on light hosts and dark on
dark hosts preserves whatever contrast ratio the host already had. A mid-lightness highlight
would destroy legibility on one host or the other.

Because amber is spent on "open", **warnings never use colour alone**: they use a glyph and a
label. That is a WCAG improvement, not a workaround.

## Typography

System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Zero
bytes, and correct for the concept: the instrument should look like the operating system's
software, not like the host's content.

**`rem` is banned inside the widget.** In a shadow root it still resolves against the host
page's root font size, which we do not control; a host with `html { font-size: 10px }` would
shrink the whole widget. The widget root declares `font-size: 14px` and everything inside uses
`px` or `em`.

| Role | Size | Weight |
|---|---|---|
| Sidebar title | 15px | 600 |
| Author name | 13px | 600 |
| Message body | 13.5px | 400, line-height 1.5, max 62ch |
| Label | 12px | 500 |
| Meta (date, count) | 11.5px | 500, `tabular-nums` |

The scale ratio is tight, which is the product-register norm. Hierarchy comes from weight,
colour, and letter-spacing rather than scale contrast.

## Space and shape

4px base with deliberately uneven steps: 4 / 8 / 12 / 20 / 32. Thread rows get generous
vertical separation because scanning is their purpose; replies inside a thread get tight
separation because they read as one conversation.

Radii: 6px controls, 10px panels, pill for the launcher and selection affordance.

**No cards.** Lists are separated by hairlines and whitespace. A card per reply inside a card
per thread is the obvious wrong answer and is banned in both surfaces. A shadow and a radius
are earned only by things that genuinely float above the document: the popup, the sidebar, the
selection pill.

## Motion

120 to 220ms, `cubic-bezier(0.25, 1, 0.5, 1)`, no bounce.

| Element | Motion |
|---|---|
| Selection pill | 120ms fade plus 4px rise |
| Popup | 180ms, scale 0.96 to 1 plus fade, origin at the anchor |
| Sidebar | 220ms transform |
| Highlight pulse | opacity only, twice, 800ms total |

Nothing animates layout properties. `prefers-reduced-motion` collapses every duration to 80ms
and reduces the pulse to a single flash.

## Presence

Zero threads means near-zero chrome: the launcher is a small neutral marker with no count and
no highlights on the page. It earns amber only once something is open. Presence tracks
activity, never the reverse.
