/**
 * The single source of design tokens for both surfaces.
 *
 * Amber is the only carrier of meaning in this system: it means "open thread".
 * Resolved is defined as the absence of amber, never as a second hue. Every
 * neutral is tinted warm toward the signal hue rather than sitting at chroma 0.
 */

export type Theme = 'light' | 'dark'

/** The only two roots this system is emitted into. */
export type TokenRoot = ':root' | ':host'

/**
 * The highlight ramp, as data.
 *
 * It is exported rather than only written into the CSS below because the
 * `::highlight()` rules have to be emitted into the *host document*, where our
 * custom properties do not reach. Both consumers read these same values, so the
 * ramp has one definition even though it is rendered into two style scopes.
 *
 * The ramps sit at lightness extremes deliberately. A highlight paints behind
 * host text whose colour we do not control and must not change, so staying very
 * light on light hosts and dark on dark hosts preserves whatever contrast the
 * host already had. A mid-lightness highlight would destroy legibility on one
 * host or the other.
 */
export const HL_RAMP: Record<Theme, readonly [string, string, string]> = {
  light: ['oklch(0.93 0.055 82)', 'oklch(0.89 0.090 80)', 'oklch(0.85 0.120 78)'],
  dark: ['oklch(0.34 0.055 78)', 'oklch(0.40 0.080 76)', 'oklch(0.46 0.105 74)'],
}

/** Exported because the Web Animations API cannot read a custom property. */
export const EASE = 'cubic-bezier(0.25, 1, 0.5, 1)'

const LIGHT = `
  --tc-surface-0: oklch(0.990 0.004 80);
  --tc-surface-1: oklch(0.975 0.005 80);
  --tc-surface-2: oklch(0.998 0.003 80);
  --tc-border-subtle: oklch(0.90 0.006 80);
  --tc-border: oklch(0.84 0.008 80);
  --tc-text-1: oklch(0.24 0.010 75);
  --tc-text-2: oklch(0.52 0.008 75);
  --tc-text-3: oklch(0.64 0.007 75);
  --tc-signal: oklch(0.70 0.145 72);
  --tc-signal-text: oklch(0.52 0.130 62);
  --tc-danger: oklch(0.55 0.170 27);
  --tc-action-bg: oklch(0.24 0.010 75);
  --tc-action-fg: oklch(0.98 0.004 80);
  --tc-hl-1: ${HL_RAMP.light[0]};
  --tc-hl-2: ${HL_RAMP.light[1]};
  --tc-hl-3: ${HL_RAMP.light[2]};
  --tc-shadow: 0 1px 2px oklch(0.24 0.01 75 / 0.06), 0 8px 24px oklch(0.24 0.01 75 / 0.10);
`

const DARK = `
  --tc-surface-0: oklch(0.210 0.008 75);
  --tc-surface-1: oklch(0.175 0.008 75);
  --tc-surface-2: oklch(0.250 0.009 75);
  --tc-border-subtle: oklch(0.27 0.009 75);
  --tc-border: oklch(0.32 0.010 75);
  --tc-text-1: oklch(0.95 0.005 80);
  --tc-text-2: oklch(0.72 0.007 78);
  --tc-text-3: oklch(0.60 0.007 78);
  --tc-signal: oklch(0.78 0.145 78);
  --tc-signal-text: oklch(0.82 0.130 80);
  --tc-danger: oklch(0.72 0.150 27);
  --tc-action-bg: oklch(0.95 0.005 80);
  --tc-action-fg: oklch(0.20 0.010 75);
  --tc-hl-1: ${HL_RAMP.dark[0]};
  --tc-hl-2: ${HL_RAMP.dark[1]};
  --tc-hl-3: ${HL_RAMP.dark[2]};
  --tc-shadow: 0 1px 2px oklch(0 0 0 / 0.30), 0 8px 24px oklch(0 0 0 / 0.44);
`

/**
 * Invariants: these never change between adaptations. The widget is one
 * identity with two adaptations, not two themes. Chrome inverts; hue, spacing,
 * type and shape do not.
 *
 * The focus ring lives here rather than in each surface's stylesheet because it
 * is an accessibility contract, and two copies of a contract can drift.
 */
const INVARIANT = `
  --tc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --tc-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --tc-s1: 4px;
  --tc-s2: 8px;
  --tc-s3: 12px;
  --tc-s4: 20px;
  --tc-s5: 32px;

  --tc-r-control: 6px;
  --tc-r-panel: 10px;
  --tc-r-pill: 999px;

  --tc-focus-width: 2px;
  --tc-focus-offset: 1px;
  --tc-hover-opacity: 0.88;

  --tc-ease: ${EASE};
  --tc-fast: 120ms;
  --tc-base: 180ms;
  --tc-slow: 220ms;
`

/**
 * Emits the token block for one of the two supported roots.
 *
 * Light is defined on the bare selector so it is never only available inside a
 * media query. Dark is redefined twice: once for an explicit resolved theme
 * (the widget decides its own adaptation and stamps the attribute) and once for
 * system preference (the panel owns its page, so the media query suffices).
 *
 * The two roots need different selector grammar. `:host` will not accept a
 * trailing compound selector -- `:host[data-x]` is invalid and silently never
 * matches, while `:host([data-x])` works. A plain `:root` wants the opposite.
 * Getting this wrong fails quietly, with the widget staying light on a dark
 * page, so the root is a closed union rather than an arbitrary string.
 */
export function tokenBlock(root: TokenRoot): string {
  const qualify = (suffix: string) => (root === ':host' ? `:host(${suffix})` : `${root}${suffix}`)

  return `
${root} {${INVARIANT}${LIGHT}}
${qualify('[data-tc-theme="dark"]')} {${DARK}}
@media (prefers-color-scheme: dark) {
  ${qualify(':not([data-tc-theme="light"])')} {${DARK}}
}
@media (prefers-reduced-motion: reduce) {
  ${root} {
    --tc-fast: 80ms;
    --tc-base: 80ms;
    --tc-slow: 80ms;
  }
}
`
}
