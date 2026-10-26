import type { Span } from './highlights.ts'
import { rangeFromOffsets, type TextIndex } from './anchor.ts'

/**
 * Nothing here is stored. Threads are anchored to text, not elements, so the
 * element path is derived at copy time from wherever the quote currently
 * resolves. The Markdown itself is built in `shared/markdown.ts`.
 */

/** `main > section:nth-of-type(2) > p:nth-of-type(3)`, cut short at the nearest id. */
export function elementPath(el: Element): string {
  const parts: string[] = []
  for (
    let node: Element | null = el;
    node && node.tagName !== 'BODY' && node.tagName !== 'HTML';
    node = node.parentElement
  ) {
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      parts.unshift(`#${node.id}`)
      return parts.join(' > ')
    }
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === node.tagName) : []
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag)
  }
  return parts.join(' > ') || 'body'
}

export function elementFor(index: TextIndex, span: Span | null): string | null {
  if (!span) return null
  const range = rangeFromOffsets(index, span.start, span.end)
  if (!range) return null
  snapInward(index, range)
  const node = range.commonAncestorContainer
  const el = node instanceof Element ? node : node.parentElement
  return el ? elementPath(el) : null
}

/**
 * An offset on a node boundary resolves to the END of the earlier text node,
 * so a selection starting at the first character of a paragraph begins in the
 * whitespace before it and the common ancestor jumps to the parent of both.
 * Moving such boundaries onto the text they actually touch keeps the element
 * the one holding the quote.
 */
function snapInward(index: TextIndex, range: Range): void {
  const { startContainer: s, startOffset: so, endContainer: e, endOffset: eo } = range
  if (s instanceof Text && so === s.length) {
    const next = neighbour(index, s, 'nextNode')
    if (next) range.setStart(next, 0)
  }
  if (e instanceof Text && eo === 0 && e !== range.startContainer) {
    const prev = neighbour(index, e, 'previousNode')
    if (prev) range.setEnd(prev, prev.length)
  }
}

function neighbour(index: TextIndex, from: Text, dir: 'nextNode' | 'previousNode'): Text | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  walker.currentNode = from
  for (let n = walker[dir](); n; n = walker[dir]()) if (index.byNode.has(n as Text)) return n as Text
  return null
}

/** False on an http: host page or a denied permission; the caller shows the text instead. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
