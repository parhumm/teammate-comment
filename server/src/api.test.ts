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

test('only the owner deletes a thread, its comments go with it, and ids from another project are not found', async () => {
  const key = ownerKey(project)
  const other = db
    .prepare("INSERT INTO projects (user_id, name, domain_pattern, project_key) VALUES (1, 'Q', 'other.test', 'k2') RETURNING *")
    .get() as unknown as Project
  const foreign = db
    .prepare("INSERT INTO threads (project_id, page_url, selected_text) VALUES (?, 'https://other.test/a', 'x') RETURNING id")
    .get(other.id)!.id as number
  const foreignComment = db
    .prepare("INSERT INTO comments (thread_id, name, message) VALUES (?, 'Ali', 'theirs') RETURNING id")
    .get(foreign)!.id as number

  const body = { pageUrl: 'https://acme.com/b', name: 'Sara', message: 'root', selectedText: 'y' }
  const { thread: t } = await (await call('POST', '/threads', body)).json()
  await call('POST', `/threads/${t.id}/comments`, { name: 'Ali', message: 'reply' })

  assert.equal((await call('DELETE', `/threads/${t.id}`)).status, 403)
  assert.equal((await call('DELETE', `/threads/${t.id}`, undefined, 'wrong')).status, 403)

  // k1's owner key is valid, but these rows belong to k2.
  assert.equal((await call('DELETE', `/threads/${foreign}`, undefined, key)).status, 404)
  assert.equal((await call('PATCH', `/comments/${foreignComment}`, { message: 'x' }, key)).status, 404)
  assert.equal((await call('DELETE', `/comments/${foreignComment}`, undefined, key)).status, 404)
  assert.equal((await call('POST', `/threads/${foreign}/resolve`, {}, key)).status, 404)
  assert.equal(db.prepare('SELECT message FROM comments WHERE id = ?').get(foreignComment)!.message, 'theirs')

  assert.equal((await call('DELETE', `/threads/${t.id}`, undefined, key)).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?').get(t.id)!.n, 0)
  assert.equal((await call('DELETE', `/threads/${t.id}`, undefined, key)).status, 404)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM threads WHERE id = ?').get(foreign)!.n, 1)
})

test('deleting a reply keeps the thread; deleting the root takes the thread and its replies', async () => {
  const key = ownerKey(project)
  const body = { pageUrl: 'https://acme.com/c', name: 'Sara', message: 'root', selectedText: 'z' }
  const { thread: t } = await (await call('POST', '/threads', body)).json()
  const reply = async () => (await (await call('POST', `/threads/${t.id}/comments`, { name: 'Ali', message: 'r' })).json()).comment.id

  const first = await reply()
  await reply()
  assert.deepEqual(await (await call('DELETE', `/comments/${first}`, undefined, key)).json(), { ok: true, threadDeleted: false })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?').get(t.id)!.n, 2)

  const root = t.comments[0].id
  assert.deepEqual(await (await call('DELETE', `/comments/${root}`, undefined, key)).json(), { ok: true, threadDeleted: true })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM threads WHERE id = ?').get(t.id)!.n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?').get(t.id)!.n, 0)
})
