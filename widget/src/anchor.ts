/**
 * Anchoring: turning a live selection into something that survives the page
 * changing underneath it, and back again.
 *
 * The page is flattened into one string of visible text plus a map back to the
 * text nodes that produced it. Everything else works in that offset space,
 * which keeps the resolution ladder readable and makes overlap arithmetic
 * possible at all.
 *
 * The ladder is deliberately short and deterministic. Two rungs, then a
 * designed failure:
 *
 *   1. exact offsets still hold the same quote
 *   2. the quote plus its surrounding context is findable somewhere
 *   3. orphaned, surfaced in the sidebar rather than silently dropped
 *
 * There is no fuzzy similarity scoring. It buys a handful of extra recoveries
 * in exchange for non-obvious behaviour, and an orphan the reader can see beats
 * a highlight landing on the wrong sentence.
 */

export const CONTEXT_LEN = 100

interface IndexEntry {
  node: Text
  start: number
  end: number
}

export interface TextIndex {
  text: string
  nodes: IndexEntry[]
  /**
   * Reverse lookup, built during the same walk that builds `nodes`.
   *
   * Without it every offset translation is a linear scan of every text node on
   * the page, and those translations happen on selection and on every click.
   */
  byNode: Map<Text, IndexEntry>
}

export interface Anchor {
  selectedText: string
  textBefore: string
  textAfter: string
  startOffset: number
  endOffset: number
}

export type Resolution =
  | { status: 'exact' | 'context'; start: number; end: number }
  | { status: 'orphan' }

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'IFRAME', 'SVG'])

/**
 * Flattens visible text. Shadow roots are not traversed, so the widget's own
 * UI can never end up in the index it is trying to annotate.
 */
export function buildIndex(root: HTMLElement = document.body, exclude?: Element): TextIndex {
  const nodes: IndexEntry[] = []
  const byNode = new Map<Text, IndexEntry>()
  let text = ''

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      if (exclude && exclude.contains(node)) return NodeFilter.FILTER_REJECT
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode() as Text | null
  while (current) {
    const value = current.nodeValue ?? ''
    const entry: IndexEntry = { node: current, start: text.length, end: text.length + value.length }
    nodes.push(entry)
    byNode.set(current, entry)
    text += value
    current = walker.nextNode() as Text | null
  }

  return { text, nodes, byNode }
}

function locate(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  let lo = 0
  let hi = index.nodes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const entry = index.nodes[mid]
    if (offset < entry.start) hi = mid - 1
    else if (offset > entry.end) lo = mid + 1
    else return { node: entry.node, offset: offset - entry.start }
  }
  return null
}

export function rangeFromOffsets(index: TextIndex, start: number, end: number): Range | null {
  const from = locate(index, start)
  const to = locate(index, end)
  if (!from || !to) return null
  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return null
  }
  return range
}

/** The first indexed text node at or inside `node`, searched downward. */
function firstTextWithin(index: TextIndex, node: Node): IndexEntry | null {
  if (node.nodeType === Node.TEXT_NODE) return index.byNode.get(node as Text) ?? null

  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const entry = index.byNode.get(n as Text)
    if (entry) return entry
  }
  return null
}

function offsetOf(index: TextIndex, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = index.byNode.get(node as Text)
    return entry ? entry.start + offset : null
  }

  // A container boundary, which is the normal case for a triple-click or a drag
  // across block boundaries. Descend from the child rather than scanning the
  // whole flat list outward with a `contains()` call per node.
  const child = node.childNodes[offset] ?? node.lastChild
  if (!child) return null
  return firstTextWithin(index, child)?.start ?? null
}

export function anchorFromRange(index: TextIndex, range: Range): Anchor | null {
  const start = offsetOf(index, range.startContainer, range.startOffset)
  const end = offsetOf(index, range.endContainer, range.endOffset)
  if (start == null || end == null || end <= start) return null

  return {
    selectedText: index.text.slice(start, end),
    textBefore: index.text.slice(Math.max(0, start - CONTEXT_LEN), start),
    textAfter: index.text.slice(end, end + CONTEXT_LEN),
    startOffset: start,
    endOffset: end,
  }
}

/**
 * Which character sits under the pointer.
 *
 * Highlights are painted rather than wrapped, so there is no element to click
 * and no event target to read. Hit-testing has to go the other way: resolve the
 * point to a caret, then translate that caret into the same offset space the
 * anchors live in.
 *
 * `caretPositionFromPoint` is the standard; older WebKit only has
 * `caretRangeFromPoint`.
 */
export function offsetFromPoint(index: TextIndex, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }

  let node: Node | null = null
  let offset = 0

  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) {
      node = pos.offsetNode
      offset = pos.offset
    }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null

  const entry = index.byNode.get(node as Text)
  return entry ? entry.start + offset : null
}

function allIndexesOf(haystack: string, needle: string): number[] {
  if (!needle) return []
  const found: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return found
    found.push(at)
    from = at + 1
    if (found.length > 200) return found
  }
}

function nearest(candidates: number[], target: number): number {
  return candidates.reduce((best, c) =>
    Math.abs(c - target) < Math.abs(best - target) ? c : best,
  )
}

/**
 * Walks the ladder. Context tails are trimmed to 30 characters because the
 * further from the quote you look, the more likely an unrelated edit has
 * touched it.
 */
export function resolveAnchor(index: TextIndex, anchor: Anchor): Resolution {
  const { selectedText: quote, startOffset, textBefore, textAfter } = anchor
  const len = quote.length
  if (!len) return { status: 'orphan' }

  // Rung 1: the offsets still hold exactly what they held before.
  if (index.text.slice(startOffset, startOffset + len) === quote) {
    return { status: 'exact', start: startOffset, end: startOffset + len }
  }

  const before = textBefore.slice(-30)
  const after = textAfter.slice(0, 30)

  // Rung 2, tightest first: quote still sitting between its neighbours.
  if (before && after) {
    const at = index.text.indexOf(before + quote + after)
    if (at !== -1) {
      const start = at + before.length
      return { status: 'context', start, end: start + len }
    }
  }

  if (before) {
    const at = index.text.indexOf(before + quote)
    if (at !== -1) {
      const start = at + before.length
      return { status: 'context', start, end: start + len }
    }
  }

  if (after) {
    const at = index.text.indexOf(quote + after)
    if (at !== -1) return { status: 'context', start: at, end: at + len }
  }

  // The quote itself, preferring the occurrence closest to where it used to be.
  const occurrences = allIndexesOf(index.text, quote)
  if (occurrences.length) {
    const start = nearest(occurrences, startOffset)
    return { status: 'context', start, end: start + len }
  }

  return { status: 'orphan' }
}
