import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { layout } from './views/layout.ts'

for (const unavailable of [false, true]) {
  test(`copy reveals and selects hidden Markdown when clipboard is ${unavailable ? 'unavailable' : 'denied'}`, async () => {
    const listeners: Record<string, (event: unknown) => void> = {}
    const source = { textContent: '# Thread\nComment', hidden: true, classList: new Set<string>() }
    const live = { textContent: '' }
    const button = { textContent: 'Copy as Markdown', getAttribute: (name: string) => name === 'data-copy' ? 'md' : null, setAttribute() {} }
    let selected: unknown
    const script = [...layout('', { title: 'Test' }).matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]
    runInNewContext(script, {
      document: {
        getElementById: (id: string) => id === 'live' ? live : source,
        addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener },
      },
      navigator: unavailable ? {} : { clipboard: { writeText: () => Promise.reject(new Error('Denied')) } },
      location: { hash: '' },
      addEventListener() {},
      getSelection: () => ({ selectAllChildren: (node: unknown) => { selected = node } }),
    })
    listeners.click({ target: { closest: () => button } })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(source.hidden, false)
    assert.ok(source.classList.has('copy-fallback'))
    assert.equal(selected, source)
    assert.match(live.textContent, /Text selected/)
    assert.equal(button.textContent, 'Copy as Markdown')
  })
}
