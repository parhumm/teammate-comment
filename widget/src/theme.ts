import type { Theme } from '../../shared/tokens.ts'

/**
 * The widget has no theme. It has one identity with two adaptations, and this
 * only decides which adaptation to wear.
 *
 * Cheap reads of declared values, no background-pixel sampling. Sampling a
 * pixel sounds more considerate but breaks on gradients, background images and
 * sticky headers, and the failure is silent and hard to explain. Declared
 * intent beats inference here.
 *
 * The reader's system preference comes last, because it says nothing about the
 * page. A light-only site read on a dark-mode machine is the common case, and
 * the dark highlight ramp painted under that site's dark text is unreadable.
 *
 * Deliberately not attempted: matching the host's palette. Looking almost like
 * the host page reads worse than looking deliberately separate from it.
 */
export function resolveTheme(script: HTMLScriptElement | null): Theme {
  // 1. What the site owner said.
  const declared = script?.dataset.theme
  if (declared === 'light' || declared === 'dark') return declared

  // 2. What the host page declares for itself.
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue
    const scheme = getComputedStyle(el).colorScheme
    if (scheme && scheme !== 'normal' && scheme !== 'auto') {
      const wantsDark = scheme.includes('dark')
      const wantsLight = scheme.includes('light')
      if (wantsDark && !wantsLight) return 'dark'
      if (wantsLight && !wantsDark) return 'light'
    }
  }

  // 3. The colour of the text the highlights paint behind. Dark text is a
  //    light page; light text is a dark page. This is the one contrast the
  //    ramp has to get right, and it is a computed value, not a pixel.
  const text = document.body ? lightnessOf(getComputedStyle(document.body).color) : null
  if (text !== null) return text > 0.5 ? 'dark' : 'light'

  // 4. What the reader's system prefers.
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Perceived lightness, 0 to 1, of a colour as `getComputedStyle` serialises
 * it, or null for a form it does not emit. Browsers resolve hex, names, hsl
 * and hwb to `rgb()`, but keep `oklch()`, `oklab()`, `lab()`, `lch()` and
 * `color()` in their own syntax, so each is read on its own scale. Alpha is
 * ignored: faint text is still dark text or light text.
 */
export function lightnessOf(color: string): number | null {
  const m = /^([a-z]+)\(\s*(?:[a-z][a-z0-9-]*\s+)?(.*)\)$/i.exec(color.trim())
  if (!m) return null
  const n = m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?%?/gi) ?? []
  if (n.length < 3) return null
  const num = (s: string, scale: number) => (s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s) / scale)
  const luma = (scale: number) => 0.299 * num(n[0], scale) + 0.587 * num(n[1], scale) + 0.114 * num(n[2], scale)
  switch (m[1].toLowerCase()) {
    case 'rgb':
    case 'rgba':
      return luma(255)
    case 'color':
      return luma(1)
    case 'oklch':
    case 'oklab':
      return num(n[0], 1)
    case 'lab':
    case 'lch':
      return num(n[0], 100)
    default:
      return null
  }
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
