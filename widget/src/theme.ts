import type { Theme } from '../../shared/tokens.ts'

/**
 * The widget has no theme. It has one identity with two adaptations, and this
 * only decides which adaptation to wear.
 *
 * Three cheap reads, no background-colour sampling. Sampling a pixel sounds
 * more considerate but breaks on gradients, background images and sticky
 * headers, and the failure is silent and hard to explain. Declared intent
 * beats inference here.
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

  // 3. What the reader's system prefers.
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
