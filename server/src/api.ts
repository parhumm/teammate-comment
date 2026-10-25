import { Hono, type Context } from 'hono'
import { db, type Project, type Thread, type Comment } from './db.ts'
import { hostMatches, hostFromHeader } from './domain.ts'
import { isOwnerKey } from './auth.ts'
import { normalizePageUrl } from '../../shared/url.ts'
import { MAX_NAME, MAX_EMAIL, MAX_MESSAGE, MAX_QUOTE, MAX_CONTEXT } from '../../shared/contract.ts'
import * as telegram from './telegram.ts'
import * as slack from './slack.ts'

type Env = { Variables: { project: Project } }

/**
 * What the widget may see of a comment, spelled out rather than `*`. Anyone who
 * opens the page reads these, so a commenter's email stays out, and so does any
 * column added later until someone decides it belongs here.
 */
const COMMENT = 'id, thread_id, name, message, created_at, updated_at, edited_at'

export const api = new Hono<Env>()

/**
 * Statements are compiled once at import rather than on every request.
 *
 * `node:sqlite` recompiles the SQL each time `prepare` is called, and against
 * small indexed tables that compile costs several times more than the query it
 * is preparing. A single page load would otherwise pay for three.
 */
const sql = {
  projectByKey: db.prepare('SELECT * FROM projects WHERE project_key = ?'),
  markSeen: db.prepare("UPDATE projects SET first_seen_at = datetime('now') WHERE id = ?"),

  threadsForPage: db.prepare(
    'SELECT * FROM threads WHERE project_id = ? AND page_url = ? ORDER BY start_offset, id',
  ),
  // A subquery rather than a generated `IN (?,?,...)`: the SQL text stays
  // constant regardless of thread count, so this statement can be cached at all.
  commentsForPage: db.prepare(
    `SELECT ${COMMENT} FROM comments
     WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ? AND page_url = ?)
     ORDER BY created_at, id`,
  ),

  threadById: db.prepare('SELECT * FROM threads WHERE id = ? AND project_id = ?'),
  insertThread: db.prepare(
    `INSERT INTO threads
      (project_id, page_url, selected_text, text_before, text_after, start_offset, end_offset)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ),
  touchThread: db.prepare("UPDATE threads SET updated_at = datetime('now') WHERE id = ?"),
  removeThread: db.prepare('DELETE FROM threads WHERE id = ?'),
  setResolved: db.prepare(
    `UPDATE threads SET
       resolved = :resolved,
       resolved_at = CASE WHEN :resolved = 1 THEN datetime('now') ELSE NULL END,
       resolved_by_name = CASE WHEN :resolved = 1 THEN :name ELSE NULL END,
       updated_at = datetime('now')
     WHERE id = :id AND project_id = :projectId RETURNING *`,
  ),

  insertComment: db.prepare(
    `INSERT INTO comments (thread_id, name, email, message) VALUES (?, ?, ?, ?) RETURNING ${COMMENT}`,
  ),
  commentsFor: db.prepare(
    `SELECT ${COMMENT} FROM comments WHERE thread_id = ? ORDER BY created_at, id`,
  ),
  ownedComment: db.prepare(
    `SELECT c.id, c.thread_id FROM comments c JOIN threads t ON t.id = c.thread_id
     WHERE c.id = ? AND t.project_id = ?`,
  ),
  editComment: db.prepare(
    `UPDATE comments SET message = ?, updated_at = datetime('now'), edited_at = datetime('now')
     WHERE id = ? RETURNING ${COMMENT}`,
  ),
  removeComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  countComments: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?'),
}

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

/** Trims and caps a user-supplied string field. */
function field(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

/** Optional, but if given it has to be something the owner can actually write to. */
function email(value: unknown): string | null | Response {
  const address = field(value, MAX_EMAIL)
  if (!address) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : bad("That email doesn't look right.")
}

/** Tells every connected channel, fire-and-forget, so none of them delays the write. */
function notify(project: Project, thread: Thread, comment: Comment, kind: 'new' | 'reply'): void {
  const notice = telegram.noticeFor(project, thread, comment, kind)
  telegram.notify(project, notice)
  slack.notify(project, notice)
}

/**
 * CORS runs ahead of the gate, and applies to failures as well as successes.
 *
 * Both halves of that matter. A preflight carries no body and no key, so
 * demanding one would reject every write before the real request was ever made.
 * And a rejection the browser will not let the widget read is a silent failure:
 * the whole point of answering "this domain isn't allowed" is that somebody
 * sees it on the page where it happened.
 *
 * Headers are written onto `c.res` after the handler returns so they land on
 * raw `Response` objects too, which is what the error path produces.
 */
api.use('/*', async (c, next) => {
  const origin = c.req.header('Origin')

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204, {
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    })
  }

  await next()

  if (origin) {
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Vary', 'Origin')
  }
})

/**
 * The gate: authenticates the project key and enforces the domain allowlist.
 * Two questions with one answer, so they are asked in one place.
 *
 * The key is read from the query string for every method, so routing never has
 * to touch the request body.
 */
api.use('/*', async (c, next) => {
  const host = hostFromHeader(c.req.header('Origin')) ?? hostFromHeader(c.req.header('Referer'))

  const key = c.req.query('key')
  if (!key) return bad('Missing project key.', 400)

  const project = sql.projectByKey.get(key) as Project | undefined
  if (!project) return bad('Unknown project key.', 404)

  if (!host || !hostMatches(project.domain_pattern, host)) {
    return bad("This domain isn't allowed for this project.", 403)
  }

  if (!project.first_seen_at) sql.markSeen.run(project.id)

  c.set('project', project)
  await next()
})

/** The owner's key rides in a header, never the query string, so it stays out of logs. */
function isOwner(c: Context<Env>): boolean {
  const auth = c.req.header('Authorization')
  return isOwnerKey(c.get('project'), auth?.replace(/^Bearer /, ''))
}

const notOwner = () => bad('Only the project owner can do that.', 403)

function threadsForPage(projectId: number, pageUrl: string) {
  const threads = sql.threadsForPage.all(projectId, pageUrl) as Thread[]
  if (!threads.length) return []

  const comments = sql.commentsForPage.all(projectId, pageUrl) as Comment[]

  const byThread = new Map<number, Comment[]>()
  for (const comment of comments) {
    const list = byThread.get(comment.thread_id) ?? []
    list.push(comment)
    byThread.set(comment.thread_id, list)
  }

  return threads.map((t) => ({
    ...t,
    resolved: !!t.resolved,
    comments: byThread.get(t.id) ?? [],
  }))
}

api.get('/threads', (c) => {
  const project = c.get('project')
  const url = c.req.query('url')
  if (!url) return bad('Missing page url.')
  return c.json({ threads: threadsForPage(project.id, normalizePageUrl(url)), owner: isOwner(c) })
})

api.post('/threads', async (c) => {
  const project = c.get('project')
  const body = await c.req.json().catch(() => null)
  if (!body) return bad('Invalid body.')

  const name = field(body.name, MAX_NAME)
  const from = email(body.email)
  const message = field(body.message, MAX_MESSAGE)
  const pageUrl = normalizePageUrl(String(body.pageUrl ?? ''))
  const selected = String(body.selectedText ?? '').slice(0, MAX_QUOTE)

  if (!name) return bad('Name is required.')
  if (from instanceof Response) return from
  if (!message) return bad('Message is required.')
  if (!pageUrl) return bad('Page url is required.')
  // Origin is only a header, so check the stored URL too: the panel links to
  // it with the owner key attached.
  if (!hostMatches(project.domain_pattern, hostFromHeader(pageUrl) ?? '')) {
    return bad("This page isn't on this project's domain.", 403)
  }
  if (!selected) return bad('Selected text is required.')

  const thread = sql.insertThread.get(
    project.id,
    pageUrl,
    selected,
    String(body.textBefore ?? '').slice(0, MAX_CONTEXT),
    String(body.textAfter ?? '').slice(0, MAX_CONTEXT),
    Number(body.startOffset ?? 0),
    Number(body.endOffset ?? 0),
  ) as Thread

  const comment = sql.insertComment.get(thread.id, name, from, message) as Comment
  notify(project, thread, { ...comment, email: from }, 'new')
  return c.json({ thread: { ...thread, resolved: false, comments: [comment] } }, 201)
})

api.post('/threads/:id/comments', async (c) => {
  const project = c.get('project')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  if (!body) return bad('Invalid body.')

  const thread = sql.threadById.get(id, project.id) as Thread | undefined
  if (!thread) return bad('Thread not found.', 404)

  const name = field(body.name, MAX_NAME)
  const from = email(body.email)
  const message = field(body.message, MAX_MESSAGE)
  if (!name) return bad('Name is required.')
  if (from instanceof Response) return from
  if (!message) return bad('Message is required.')

  const comment = sql.insertComment.get(id, name, from, message) as Comment
  sql.touchThread.run(id)
  notify(project, thread, { ...comment, email: from }, 'reply')
  return c.json({ comment }, 201)
})

api.patch('/comments/:id', async (c) => {
  if (!isOwner(c)) return notOwner()
  const project = c.get('project')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null)

  const message = field(body?.message, MAX_MESSAGE)
  if (!message) return bad('Message is required.')

  if (!sql.ownedComment.get(id, project.id)) return bad('Comment not found.', 404)

  return c.json({ comment: sql.editComment.get(message, id) as Comment })
})

/**
 * Removing the last comment in a thread removes the thread too, because a
 * thread with nothing in it is a highlight with no reason to exist.
 */
api.delete('/comments/:id', (c) => {
  if (!isOwner(c)) return notOwner()
  const project = c.get('project')
  const id = Number(c.req.param('id'))

  const row = sql.ownedComment.get(id, project.id) as { thread_id: number } | undefined
  if (!row) return bad('Comment not found.', 404)

  sql.removeComment.run(id)

  const left = sql.countComments.get(row.thread_id) as { n: number }
  const threadDeleted = left.n === 0
  if (threadDeleted) sql.removeThread.run(row.thread_id)

  return c.json({ ok: true, threadDeleted })
})

api.post('/threads/:id/resolve', async (c) => {
  if (!isOwner(c)) return notOwner()
  const project = c.get('project')
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))

  const resolved = body?.resolved !== false
  const name = field(body?.name, MAX_NAME) || null

  const thread = sql.setResolved.get({
    resolved: resolved ? 1 : 0,
    name,
    id,
    projectId: project.id,
  }) as Thread | undefined

  if (!thread) return bad('Thread not found.', 404)

  // Every endpoint that returns a thread returns a whole one, comments
  // included. A partial thread here would look harmless and then break any
  // consumer that assumes the shape is consistent.
  const comments = sql.commentsFor.all(thread.id) as Comment[]
  return c.json({ thread: { ...thread, resolved: !!thread.resolved, comments } })
})
