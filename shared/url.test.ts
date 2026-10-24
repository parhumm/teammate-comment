import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePageUrl } from './url.ts'

test('query, fragment and trailing slash do not make a different page', () => {
  assert.equal(normalizePageUrl('https://acme.com/pricing/?utm_source=x#plans'), 'https://acme.com/pricing')
  assert.equal(normalizePageUrl('http://localhost:5173/'), 'http://localhost:5173/')
})

test('only http(s) URLs are pages', () => {
  for (const input of [
    'javascript:fetch(document.querySelector("form").action,{method:"POST"})',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/x',
    'not a url',
    '',
  ]) {
    assert.equal(normalizePageUrl(input), '', input)
  }
})
