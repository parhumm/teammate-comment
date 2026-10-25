import { db, type Project, type Thread, type Comment } from './db.ts'

/**
 * One bot per project, chosen by the owner, talking to the one chat that sent
 * the project's Start code. No webhook: the panel polls `getUpdates` once per
 * check, which is the only way a bot can learn its chat id without the owner
 * ever seeing one.
 *
 * The base URL is overridable so the whole flow can run against a local
 * stand-in.
 */
const API = process.env.TC_TELEGRAM_API ?? 'https://api.telegram.org'
const TIMEOUT_MS = 5000

const MAX_QUOTE = 300
const MAX_MESSAGE = 1500

export const TOKEN_PATTERN = /^\d{5,}:[\w-]{30,}$/

export class TelegramError extends Error {
  code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

const sql = {
  setBot: db.prepare(
    `UPDATE projects SET telegram_token = ?, telegram_bot = ?, telegram_chat_id = NULL,
       telegram_chat_name = NULL, telegram_error = NULL, telegram_error_at = NULL
     WHERE id = ? RETURNING *`,
  ),
  setChat: db.prepare(
    `UPDATE projects SET telegram_chat_id = ?, telegram_chat_name = ?,
       telegram_error = NULL, telegram_error_at = NULL WHERE id = ?`,
  ),
  setError: db.prepare(
    "UPDATE projects SET telegram_error = ?, telegram_error_at = datetime('now') WHERE id = ?",
  ),
  clearError: db.prepare(
    'UPDATE projects SET telegram_error = NULL, telegram_error_at = NULL WHERE id = ?',
  ),
}

/** Connecting a bot and disconnecting one both forget the old chat and its last error. */
export function setBot(project: Project, token: string | null, bot: string | null): Project {
  return sql.setBot.get(token, bot, project.id) as Project
}

interface Reply<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

async function call<T>(token: string, method: string, body: unknown = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new TelegramError("Couldn't reach Telegram.")
  }
  const json = (await response.json().catch(() => null)) as Reply<T> | null
  if (!json?.ok) {
    throw new TelegramError(json?.description ?? `Telegram answered ${response.status}.`, json?.error_code)
  }
  return json.result as T
}

export function getMe(token: string): Promise<{ username: string }> {
  return call(token, 'getMe')
}

interface Update {
  update_id: number
  message?: {
    chat: { id: number; type: string; first_name?: string; title?: string; username?: string }
    text?: string
  }
}

export interface Chat {
  id: string
  name: string
}

/**
 * The newest message carrying the Start code wins. Anything else in the batch,
 * whoever sent it, is ignored: a stranger who finds the bot cannot become the
 * recipient, and a service message has no text so it never matches.
 */
export function pickChat(updates: Update[], code: string): Chat | null {
  for (let i = updates.length - 1; i >= 0; i--) {
    const m = updates[i].message
    if (m?.text?.includes(code)) {
      return { id: String(m.chat.id), name: m.chat.title ?? m.chat.first_name ?? m.chat.username ?? 'Telegram' }
    }
  }
  return null
}

/**
 * Pulls what the bot has received since the last check and acknowledges all
 * of it, so a message without the code is dropped rather than left waiting to
 * be re-read. Null while the owner has not pressed Start.
 */
async function findChat(token: string, code: string): Promise<Chat | null> {
  const updates = await call<Update[]>(token, 'getUpdates', { timeout: 0, allowed_updates: ['message'] })
  if (!updates.length) return null

  await call(token, 'getUpdates', { offset: updates[updates.length - 1].update_id + 1, timeout: 0 }).catch(
    () => {},
  )
  return pickChat(updates, code)
}

/**
 * Adopts the chat that sent the Start code, stores it, and says hello so the
 * owner sees the loop close in Telegram itself. True once connected.
 */
export async function adoptChat(project: Project, code: string): Promise<boolean> {
  if (!project.telegram_token) return false
  if (project.telegram_chat_id) return true

  try {
    const chat = await findChat(project.telegram_token, code)
    if (!chat) return false
    sql.setChat.run(chat.id, chat.name, project.id)
    await send(
      project.telegram_token,
      chat.id,
      `Connected to <b>${esc(project.name)}</b>. New comments will show up here.`,
    )
    return true
  } catch (err) {
    sql.setError.run(messageOf(err), project.id)
    return false
  }
}

function send(token: string, chatId: string, text: string): Promise<unknown> {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
}

/** Delivers to the project's chat and records the outcome on the project row. */
export async function deliver(project: Project, text: string): Promise<void> {
  if (!project.telegram_token || !project.telegram_chat_id) return
  try {
    await send(project.telegram_token, project.telegram_chat_id, text)
    sql.clearError.run(project.id)
  } catch (err) {
    sql.setError.run(messageOf(err), project.id)
    throw err
  }
}

/** Fire-and-forget from the write path. A slow or dead bot never delays a comment. */
export function notify(project: Project, thread: Thread, comment: Comment, kind: 'new' | 'reply'): void {
  if (!project.telegram_token || !project.telegram_chat_id) return
  void deliver(project, telegramMessage(noticeFor(project, thread, comment, kind))).catch(() => {})
}

export interface Notice {
  kind: 'new' | 'reply'
  project: string
  pageUrl: string
  threadId: number
  who: string
  message: string
  quote: string
}

/** What every channel says about a comment, before each formats it its own way. */
export function noticeFor(project: Project, thread: Thread, comment: Comment, kind: Notice['kind']): Notice {
  return {
    kind,
    project: project.name,
    pageUrl: thread.page_url,
    threadId: thread.id,
    who: comment.name,
    message: comment.message,
    quote: thread.selected_text,
  }
}

/** Telegram's HTML subset: three characters need escaping, plus quotes inside href. */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function cut(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

export function telegramMessage(n: Notice): string {
  const verb = n.kind === 'reply' ? 'replied on' : 'commented on'
  const where = n.pageUrl.replace(/^https?:\/\//, '')
  const quote = cut(n.quote.replace(/\s+/g, ' ').trim(), MAX_QUOTE)

  return [
    `<b>${esc(n.who)}</b> ${verb} <b>${esc(n.project)}</b>`,
    `<a href="${esc(n.pageUrl)}">${esc(where)}</a>`,
    '',
    `<i>“${esc(quote)}”</i>`,
    '',
    esc(cut(n.message.trim(), MAX_MESSAGE)),
    '',
    `<a href="${esc(n.pageUrl)}#tc-${n.threadId}">Open thread</a>`,
  ].join('\n')
}

function messageOf(err: unknown): string {
  return err instanceof TelegramError ? err.message : 'Unexpected error.'
}
