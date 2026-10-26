import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from './db.ts'
import { panel } from './panel.ts'

async function signUp(email: string): Promise<string> {
  const res = await panel.request('/signup', {
    method: 'POST',
    body: new URLSearchParams({ email, password: 'correct horse' }),
  })
  return res.headers.get('set-cookie')!.split(';')[0]
}

const owner = await signUp('o@acme.com')
const stranger = await signUp('s@evil.test')

const project = (userEmail: string, name: string, domain: string) =>
  db
    .prepare(
      `INSERT INTO projects (user_id, name, domain_pattern, project_key)
       VALUES ((SELECT id FROM users WHERE email = ?), ?, ?, ?) RETURNING id`,
    )
    .get(userEmail, name, domain, name)!.id as number

const mine = project('o@acme.com', 'mine', '*.acme.com')
const second = project('o@acme.com', 'second', '*.acme.com')
const theirs = project('s@evil.test', 'theirs', '*.evil.test')

function thread(projectId: number, pageUrl: string, ...comments: [string, string, string?][]): number {
  const id = db
    .prepare('INSERT INTO threads (project_id, page_url, selected_text) VALUES (?, ?, ?) RETURNING id')
    .get(projectId, pageUrl, 'Billed <b>annually</b>')!.id as number
  for (const [name, message, email] of comments) {
    db.prepare('INSERT INTO comments (thread_id, name, message, email) VALUES (?, ?, ?, ?)').run(id, name, message, email ?? null)
  }
  return id
}

const send = (cookie: string, path: string, form?: Record<string, string>, origin = 'http://localhost') =>
  panel.request(path, {
    method: form ? 'POST' : 'GET',
    headers: { Cookie: cookie, ...(form ? { Origin: origin } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  })

const html = async (cookie: string, path: string) => (await send(cookie, path)).text()
const count = (sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args)!.n as number

test('the list shows every page or one, filtered by status, escaped, with the email only the owner sees', async () => {
  const a = thread(mine, 'https://acme.com/a', ['Sara', '<script>alert(1)</script>', 'sara@acme.com'], ['Ali', 'second'])
  const b = thread(mine, 'https://acme.com/b', ['Ali', 'on b'])
  db.prepare("UPDATE threads SET resolved = 1, resolved_by_name = 'Me' WHERE id = ?").run(b)

  assert.equal((await send('', `/projects/${mine}/comments`)).status, 302)

  const open = await html(owner, `/projects/${mine}/comments`)
  assert.ok(open.includes(`id="t${a}"`) && !open.includes(`id="t${b}"`))
  assert.ok(open.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !open.includes('<script>alert(1)'))
  assert.ok(open.includes('Billed &lt;b&gt;annually&lt;/b&gt;'))
  assert.ok(open.includes('href="mailto:sara@acme.com"'))
  assert.ok(open.includes('Open (1)') && open.includes('Resolved (1)') && open.includes('All (2)'))
  // Copy carries the same Markdown the widget makes, without an element it cannot know.
  assert.ok(open.includes('### Thread 1 (open)\nQuote: &quot;Billed &lt;b&gt;annually&lt;/b&gt;&quot;'))
  // The owner key goes only to the project's own domain.
  assert.match(open, /href="https:\/\/acme\.com\/a#tc-owner=[\w-]+"/)

  const all = await html(owner, `/projects/${mine}/comments?status=all`)
  assert.ok(all.includes(`id="t${a}"`) && all.includes(`id="t${b}"`) && all.includes('Resolved by Me'))

  const onB = await html(owner, `/projects/${mine}/comments?status=all&page=${encodeURIComponent('https://acme.com/b')}`)
  assert.ok(onB.includes(`id="t${b}"`) && !onB.includes(`id="t${a}"`))
  // Actions post back to the same filtered list.
  assert.ok(onB.includes(`/threads/${b}/resolve?page=https%3A%2F%2Facme.com%2Fb&amp;status=all"`))

  assert.ok((await html(owner, `/projects/${mine}`)).includes(`/projects/${mine}/comments?page=https%3A%2F%2Facme.com%2Fa&amp;status=all`))
})

test('reply, edit, resolve, reopen and delete, each landing back where it was taken', async () => {
  const t = thread(mine, 'https://acme.com/c', ['Sara', 'root'])
  const base = `/projects/${mine}`

  const replied = await send(owner, `${base}/threads/${t}/reply?status=all`, { name: 'Parhum', message: 'On it' })
  assert.equal(replied.status, 302)
  assert.equal(replied.headers.get('location'), `${base}/comments?status=all#t${t}`)
  const nameCookie = replied.headers.get('set-cookie')!.split(';')[0]
  assert.equal(nameCookie, 'tc_name=Parhum')
  assert.equal(count("SELECT COUNT(*) AS n FROM comments WHERE thread_id = ? AND name = 'Parhum' AND message = 'On it'", t), 1)
  assert.equal((await send(owner, `${base}/threads/${t}/reply`, { name: 'Parhum', message: '  ' })).status, 400)

  const withName = `${owner}; ${nameCookie}`
  assert.ok((await html(withName, `${base}/comments`)).includes('value="Parhum"'))

  await send(withName, `${base}/threads/${t}/resolve`, { resolved: '1' })
  assert.deepEqual(
    { ...db.prepare('SELECT resolved, resolved_by_name FROM threads WHERE id = ?').get(t) },
    { resolved: 1, resolved_by_name: 'Parhum' },
  )
  await send(withName, `${base}/threads/${t}/resolve`, { resolved: '0' })
  assert.equal(count('SELECT resolved AS n FROM threads WHERE id = ?', t), 0)

  const [root, reply] = (db.prepare('SELECT id FROM comments WHERE thread_id = ? ORDER BY id').all(t) as { id: number }[]).map((r) => r.id)
  assert.equal((await send(owner, `${base}/comments/${root}/edit`, { message: 'fixed' })).status, 302)
  const edited = db.prepare('SELECT message, edited_at FROM comments WHERE id = ?').get(root)!
  assert.equal(edited.message, 'fixed')
  assert.ok(edited.edited_at)
  assert.equal((await send(owner, `${base}/comments/${root}/edit`, { message: '' })).status, 400)

  await send(owner, `${base}/comments/${reply}/delete`, {})
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?', t), 1)
  // The last comment takes its thread with it.
  await send(owner, `${base}/comments/${root}/delete`, {})
  assert.equal(count('SELECT COUNT(*) AS n FROM threads WHERE id = ?', t), 0)

  const u = thread(mine, 'https://acme.com/c', ['Sara', 'root'], ['Ali', 'reply'])
  assert.equal((await send(owner, `${base}/threads/${u}/delete`, {})).status, 302)
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?', u), 0)
})

test("nobody reaches another account's threads, and a thread is only reachable through its own project", async () => {
  const t = thread(theirs, 'https://evil.test/x', ['Eve', 'untouched'])
  const c = db.prepare('SELECT id FROM comments WHERE thread_id = ?').get(t)!.id as number

  assert.equal((await send(owner, `/projects/${theirs}/comments`)).status, 404)
  for (const id of [theirs, mine, second]) {
    for (const [path, form] of [
      [`/threads/${t}/reply`, { name: 'x', message: 'x' }],
      [`/threads/${t}/resolve`, { resolved: '1' }],
      [`/threads/${t}/delete`, {}],
      [`/comments/${c}/edit`, { message: 'x' }],
      [`/comments/${c}/delete`, {}],
    ] as const) {
      assert.equal((await send(owner, `/projects/${id}${path}`, form)).status, 404, `${id}${path}`)
    }
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?', t), 1)
  assert.equal(db.prepare('SELECT message FROM comments WHERE id = ?').get(c)!.message, 'untouched')
  assert.equal(count('SELECT resolved AS n FROM threads WHERE id = ?', t), 0)
})

test('a post from another origin is refused, even one the cookie would ride along with', async () => {
  const t = thread(mine, 'https://acme.com/d', ['Sara', 'root'])
  for (const origin of ['https://evil.jaan.to', 'null']) {
    assert.equal((await send(owner, `/projects/${mine}/threads/${t}/delete`, {}, origin)).status, 403)
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM threads WHERE id = ?', t), 1)
  assert.equal((await send(owner, `/projects/${mine}/threads/${t}/delete`, {})).status, 302)
})

test('a project is deleted only by its owner, from the panel, with everything in it', async () => {
  const doomed = project('o@acme.com', "x');alert(1)//", '*.acme.com')
  const t = thread(doomed, 'https://acme.com/e', ['Sara', 'root'], ['Ali', 'reply'])

  // The name never lands inside the confirm's script.
  const page = await html(owner, `/projects/${doomed}`)
  assert.ok(page.includes("confirm('Delete this project and every comment in it?')"))
  assert.ok(!page.includes('alert(1)//?'))

  await send(stranger, `/projects/${doomed}/delete`, {})
  assert.equal((await send(owner, `/projects/${doomed}/delete`, {}, 'https://evil.jaan.to')).status, 403)
  assert.equal(count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', doomed), 1)

  assert.equal((await send(owner, `/projects/${doomed}/delete`, {})).status, 302)
  assert.equal(count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', doomed), 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM threads WHERE id = ?', t), 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?', t), 0)
})
