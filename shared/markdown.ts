/**
 * What gets copied: Markdown an assistant can act on. Each thread carries where
 * on the page it points (a CSS path to the element holding the quote), the
 * exact text it was about, and every comment in order.
 *
 * Shared so the widget and the panel copy the same thing. Only the widget can
 * see the page, so only the widget passes an element; the panel leaves it out
 * and the line is dropped rather than claiming the text is gone.
 */
export interface CopyThread {
  dto: {
    resolved: boolean
    selected_text: string
    comments: { name: string; message: string }[]
  }
  /** CSS path of the element holding the quote; null when the text is gone, absent when unknown. */
  element?: string | null
}

const GONE = 'not found on the current page (the text has changed)'

export function threadsMarkdown(pageUrl: string, threads: CopyThread[]): string {
  const blocks = threads.map(({ dto, element }, i) =>
    [
      `### Thread ${i + 1} (${dto.resolved ? 'resolved' : 'open'})`,
      ...(element === undefined ? [] : [`Element: ${element ?? GONE}`]),
      `Quote: "${dto.selected_text.replace(/\s+/g, ' ').trim()}"`,
      '',
      ...dto.comments.map((c) => `- ${c.name}: ${c.message.trim().replace(/\n/g, '\n  ')}`),
    ].join('\n'),
  )
  return `${[`## ${pageUrl}`, ...blocks].join('\n\n')}\n`
}
