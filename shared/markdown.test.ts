import { test } from 'node:test'
import assert from 'node:assert/strict'
import { threadsMarkdown } from './markdown.ts'
import type { ThreadDto } from '../widget/src/api.ts'

function thread(id: number, over: Partial<ThreadDto> = {}): ThreadDto {
  return {
    id,
    page_url: 'https://acme.com/pricing',
    selected_text: 'Billed\n   annually ',
    text_before: '',
    text_after: '',
    start_offset: 0,
    end_offset: 0,
    resolved: false,
    resolved_at: null,
    resolved_by_name: null,
    created_at: '',
    updated_at: '',
    comments: [
      { id, thread_id: id, name: 'Sara', message: 'Change it.\nAnd this.', created_at: '', edited_at: null },
    ],
    ...over,
  }
}

test('one block per thread, element path or a plain reason, one-line quote, replies indented', () => {
  const md = threadsMarkdown('https://acme.com/pricing', [
    { dto: thread(1), element: 'main > p:nth-of-type(3)' },
    { dto: thread(2, { resolved: true }), element: null },
  ])
  assert.equal(
    md,
    `## https://acme.com/pricing

### Thread 1 (open)
Element: main > p:nth-of-type(3)
Quote: "Billed annually"

- Sara: Change it.
  And this.

### Thread 2 (resolved)
Element: not found on the current page (the text has changed)
Quote: "Billed annually"

- Sara: Change it.
  And this.
`,
  )
})

test('without an element the line is left out, not reported as gone', () => {
  const md = threadsMarkdown('https://acme.com/pricing', [{ dto: thread(1) }])
  assert.ok(!md.includes('Element:'))
  assert.ok(md.includes('### Thread 1 (open)\nQuote: "Billed annually"'))
})
