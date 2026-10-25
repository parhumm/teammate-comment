import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from './db.ts'
import { api } from './api.ts'
import { ownerKey } from './auth.ts'
import type { Project } from './db.ts'

db.prepare("INSERT INTO users (email, password_hash) VALUES ('o@acme.com', 'x')").run()
const project = db
  .prepare("INSERT INTO projects (user_id, name, domain_pattern, project_key) VALUES (1, 'P', 'acme.com', 'k1') RETURNING *")
  .get() as unknown as Project

const call = (method: string, path: string, body?: unknown, owner?: string) =>
  api.request(`${path}${path.includes('?') ? '&' : '?'}key=k1`, {
    method,
    headers: {
      Origin: 'https://acme.com',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(owner ? { Authorization: `Bearer ${owner}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

test('readers comment; only the owner resolves, edits and deletes; email never reaches the page', async () => {
  const thread = {
    pageUrl: 'https://acme.com/a',
    name: 'Sara',
    email: 'sara@acme.com',
    message: 'hi',
    selectedText: 'x',
  }
  assert.equal((await call('POST', '/threads', { ...thread, email: 'nope' })).status, 400)
  for (const pageUrl of ['https://evil.test/a', 'https://acme.com@evil.test/a']) {
    assert.equal((await call('POST', '/threads', { ...thread, pageUrl })).status, 403)
  }

  const created = await call('POST', '/threads', thread)
  assert.equal(created.status, 201)
  const { thread: t } = await created.json()
  assert.ok(!('email' in t.comments[0]))
  assert.equal(db.prepare('SELECT email FROM comments').get()!.email, 'sara@acme.com')

  const reader = await (await call('GET', '/threads?url=https://acme.com/a')).json()
  assert.equal(reader.owner, false)
  assert.ok(!('email' in reader.threads[0].comments[0]))

  const id = t.comments[0].id
  assert.equal((await call('POST', `/threads/${t.id}/resolve`, { resolved: true })).status, 403)
  assert.equal((await call('PATCH', `/comments/${id}`, { message: 'x' })).status, 403)
  assert.equal((await call('DELETE', `/comments/${id}`)).status, 403)
  assert.equal((await call('DELETE', `/comments/${id}`, undefined, 'wrong')).status, 403)

  const key = ownerKey(project)
  assert.equal((await (await call('GET', '/threads?url=https://acme.com/a', undefined, key)).json()).owner, true)
  assert.equal((await call('POST', `/threads/${t.id}/resolve`, { resolved: true }, key)).status, 200)
  const edited = await (await call('PATCH', `/comments/${id}`, { message: 'x' }, key)).json()
  assert.ok(!('email' in edited.comment))
  assert.equal((await call('DELETE', `/comments/${id}`, undefined, key)).status, 200)
})
