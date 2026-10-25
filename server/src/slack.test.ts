import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slackMessage, isWebhook, NEW_APP_URL } from './slack.ts'

test('the Create link carries a manifest Slack accepts: the webhook scope needs a bot user', () => {
  const url = new URL(NEW_APP_URL)
  assert.equal(url.origin + url.pathname, 'https://api.slack.com/apps')
  const manifest = JSON.parse(url.searchParams.get('manifest_json')!)
  assert.deepEqual(manifest.oauth_config.scopes.bot, ['incoming-webhook'])
  assert.ok(manifest.features.bot_user.display_name)
  assert.ok(manifest.display_information.name.length <= 35)
})

test('message escapes mrkdwn, trims the quote, and deep-links the thread', () => {
  const text = slackMessage({
    kind: 'new',
    project: 'Pricing <site>',
    pageUrl: 'https://acme.com/a|b',
    threadId: 42,
    who: 'Sara & Co',
    message: 'Ping <!channel> and <@U123>',
    quote: '  Billed\n annually,   cancel anytime '.padEnd(400, 'x'),
  })
  assert.match(text, /^\*Sara &amp; Co\* commented on \*Pricing &lt;site&gt;\*\n/)
  assert.match(text, /<https:\/\/acme\.com\/a%7Cb\|acme\.com\/a\|b>/)
  assert.match(text, /> _“Billed annually, cancel anytime x+…”_/)
  assert.ok(text.includes('Ping &lt;!channel&gt; and &lt;@U123&gt;'))
  assert.ok(text.endsWith('<https://acme.com/a%7Cb#tc-42|Open thread>'))
})

test('replies read as replies', () => {
  const text = slackMessage({
    kind: 'reply',
    project: 'P',
    pageUrl: 'https://a.b/c',
    threadId: 1,
    who: 'O',
    message: 'm',
    quote: 'q',
  })
  assert.ok(text.startsWith('*O* replied on *P*'))
})

test('only Slack incoming webhooks are accepted, so nothing else is ever fetched', () => {
  assert.ok(isWebhook('https://hooks.slack.com/services/T0001/B0002/AbCdEf123456'))
  assert.ok(!isWebhook('https://hooks.slack.com/services/T0001/B0002'))
  assert.ok(!isWebhook('https://hooks.slack.com/workflows/T0001/A0002/123/abc'))
  assert.ok(!isWebhook('https://hooks.slack.com.evil.com/services/T0001/B0002/AbC'))
  assert.ok(!isWebhook('https://hooks.slack.com@evil.com/services/T0001/B0002/AbC'))
  assert.ok(!isWebhook('http://hooks.slack.com/services/T0001/B0002/AbC'))
  assert.ok(!isWebhook('https://hooks.slack.com/services/T0001/B0002/AbC?x=1'))
  assert.ok(!isWebhook('http://127.0.0.1:8787/services/T0001/B0002/AbC'))
})
