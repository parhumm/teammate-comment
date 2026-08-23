import type { TextIndex } from './anchor.ts'
import { rangeFromOffsets } from './anchor.ts'
import { HL_RAMP, EASE, type Theme } from '../../shared/tokens.ts'

/**
 * Highlights are painted with the CSS Custom Highlight API, which draws over
 * ranges without touching the host DOM. That is the whole reason this product
 * can promise it will not damage the page it annotates: copy-paste stays clean,
 * find-in-page still matches, and the host's own CSS cannot fight us.
 *
 * It also makes overlap tractable. Wrapping elements around overlapping ranges
 * is a nesting problem with no clean answer; painting them is just arithmetic.
 */

export const HL_LEVELS = [1, 2, 3] as const

export function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
}

export interface Span {
  start: number
  end: number
}

export interface Segment extends Span {
  count: number
}

/**
 * Splits overlapping spans into non-overlapping segments carrying a count.
 *
 * Intensity answers "how many separate people flagged this", so it counts open
 * threads covering each stretch of text. Replies never enter into it: a long
 * argument between two people is one concern, and should not out-shout three
 * distinct ones.
 */
export function segmentsFor(spans: Span[]): Segment[] {
  const events: { at: number; delta: number }[] = []
  for (const s of spans) {
    if (s.end <= s.start) continue
    events.push({ at: s.start, delta: 1 }, { at: s.end, delta: -1 })
  }
  if (!events.length) return []

  events.sort((a, b) => a.at - b.at || b.delta - a.delta)

  const out: Segment[] = []
  let count = 0
  let cursor = events[0].at

  for (const event of events) {
    if (event.at > cursor && count > 0) {
      const last = out[out.length - 1]
      if (last && last.end === cursor && last.count === count) last.end = event.at
      else out.push({ start: cursor, end: event.at, count })
    }
    count += event.delta
    cursor = event.at
  }

  return out
}

/** Intensity saturates at three: past that the difference stops being readable. */
export function levelFor(count: number): 1 | 2 | 3 {
  return count >= 3 ? 3 : (count as 1 | 2)
}

const STYLE_ID = 'tc-highlight-style'

/**
 * The `::highlight()` rules must live in the host document, because the ranges
 * they paint are in the host document. Literal colour values are written rather
 * than custom properties so nothing of ours leaks into the host's cascade.
 */
export function installHighlightStyles(theme: Theme): void {
  const existing = document.getElementById(STYLE_ID)
  if (existing) existing.remove()

  const [one, two, three] = HL_RAMP[theme]
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
::highlight(tc-hl-1) { background-color: ${one}; }
::highlight(tc-hl-2) { background-color: ${two}; }
::highlight(tc-hl-3) { background-color: ${three}; }
`
  document.head.appendChild(style)
}

function clearHighlights(): void {
  for (const level of HL_LEVELS) CSS.highlights.delete(`tc-hl-${level}`)
}

/**
 * Repaints every highlight from the current set of open spans. Cheap enough to
 * run on any change, which keeps intensity honest without incremental
 * bookkeeping to get wrong.
 */
export function paintHighlights(index: TextIndex, openSpans: Span[]): void {
  if (!supportsHighlights()) return
  clearHighlights()
  if (!openSpans.length) return

  const buckets: Record<number, Range[]> = Object.fromEntries(HL_LEVELS.map((l) => [l, []]))

  for (const segment of segmentsFor(openSpans)) {
    const range = rangeFromOffsets(index, segment.start, segment.end)
    if (range) buckets[levelFor(segment.count)].push(range)
  }

  for (const level of HL_LEVELS) {
    const ranges = buckets[level]
    if (ranges.length) CSS.highlights.set(`tc-hl-${level}`, new Highlight(...ranges))
  }
}

/**
 * The emphasis pulse after jumping to a thread.
 *
 * Overlay rects rather than an animated highlight, because the Custom Highlight
 * API is not animatable. Only opacity moves, so nothing here can trigger
 * layout on the host page.
 */
export function pulseRange(range: Range, layer: HTMLElement, reducedMotion: boolean): void {
  const rects = Array.from(range.getClientRects())
  if (!rects.length) return

  for (const rect of rects) {
    const mark = document.createElement('div')
    mark.className = 'pulse'
    mark.style.left = `${rect.left}px`
    mark.style.top = `${rect.top}px`
    mark.style.width = `${rect.width}px`
    mark.style.height = `${rect.height}px`
    layer.appendChild(mark)

    const keyframes = reducedMotion
      ? [{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0.75 }, { opacity: 0 }, { opacity: 0.75 }, { opacity: 0 }]

    mark
      .animate(keyframes, {
        duration: reducedMotion ? 160 : 800,
        easing: EASE,
      })
      .addEventListener('finish', () => mark.remove())
  }
}
