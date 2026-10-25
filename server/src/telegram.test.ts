import { test } from 'node:test'
import assert from 'node:assert/strict'
import { telegramMessage, pickChat, TOKEN_PATTERN } from './telegram.ts'

test('message escapes HTML, trims the quote, and deep-links the thread', () => {
  const text = telegramMessage({
    kind: 'new',
    project: 'Pricing <site>',
    pageUrl: 'https://acme.com/pricing',
    threadId: 42,
    who: 'Sara & Co',
    message: 'Change to "cancel any time"',
    quote: '  Billed\n annually,   cancel anytime '.padEnd(400, 'x'),
  })
  assert.match(text, /^<b>Sara &amp; Co<\/b> commented on <b>Pricing &lt;site&gt;<\/b>\n/)
  assert.match(text, /<a href="https:\/\/acme\.com\/pricing">acme\.com\/pricing<\/a>/)
  assert.match(text, /<i>“Billed annually, cancel anytime x+…”<\/i>/)
  assert.ok(text.includes('Change to &quot;cancel any time&quot;'))
  assert.ok(text.endsWith('<a href="https://acme.com/pricing#tc-42">Open thread</a>'))
  assert.ok(text.length < 4096)
})

test('replies read as replies', () => {
  const text = telegramMessage({
    kind: 'reply',
    project: 'P',
    pageUrl: 'https://a.b/c',
    threadId: 1,
    who: 'O',
    email: 'o@a.b',
    message: 'm',
    quote: 'q',
  })
  assert.ok(text.startsWith('<b>O</b> (o@a.b) replied on <b>P</b>'))
})

test('token pattern accepts BotFather tokens and rejects noise', () => {
  assert.ok(TOKEN_PATTERN.test('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0'))
  assert.ok(!TOKEN_PATTERN.test('not a token'))
  assert.ok(!TOKEN_PATTERN.test('123:short'))
})

test('only a chat that sends the Start code is adopted, newest first', () => {
  const code = 'k7Qm2xPz'
  const update = (id: number, chat: Record<string, unknown>, text?: string) => ({
    update_id: id,
    message: { chat: { id, type: 'private', ...chat }, text },
  })
  const owner = update(1, { first_name: 'Owner' }, `/start ${code}`)
  const stranger = update(2, { first_name: 'Stranger' }, '/start')
  const joined = update(3, { type: 'group', title: 'Team' }) // service message, no text
  const group = update(4, { type: 'supergroup', title: 'Team' }, `/start@bot ${code}`)

  assert.deepEqual(pickChat([owner, stranger, joined], code), { id: '1', name: 'Owner' })
  assert.equal(pickChat([stranger, joined], code), null)
  assert.deepEqual(pickChat([owner, stranger, group], code), { id: '4', name: 'Team' })
  assert.equal(pickChat([], code), null)
})
