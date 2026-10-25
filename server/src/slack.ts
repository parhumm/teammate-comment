import { db, type Project, type Thread, type Comment } from './db.ts'
import { noticeFor, cut, type Notice } from './telegram.ts'

/**
 * One incoming webhook per project. Slack binds a webhook to its channel when
 * the owner creates it, so unlike Telegram there is no chat to discover and no
 * Start code to prove: the URL alone is the connection, and posting the hello
 * is the check that it works.
 *
 * The trusted origin is overridable so the whole flow can run against a local
 * stand-in. Nothing outside it is ever fetched, whatever the owner pastes.
 */
const HOOKS = process.env.TC_SLACK_HOOKS ?? 'https://hooks.slack.com'
const TIMEOUT_MS = 5000

const MAX_QUOTE = 300
const MAX_MESSAGE = 1500

const WEBHOOK_PATH = /^\/services\/T\w+\/B\w+\/\w+$/

export function isWebhook(url: string): boolean {
  return url.startsWith(`${HOOKS}/`) && WEBHOOK_PATH.test(url.slice(HOOKS.length))
}

export class SlackError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

const sql = {
  setWebhook: db.prepare(
    'UPDATE projects SET slack_webhook = ?, slack_error = NULL, slack_error_at = NULL WHERE id = ? RETURNING *',
  ),
  setError: db.prepare("UPDATE projects SET slack_error = ?, slack_error_at = datetime('now') WHERE id = ?"),
  clearError: db.prepare('UPDATE projects SET slack_error = NULL, slack_error_at = NULL WHERE id = ?'),
}

/** Connecting and disconnecting both forget the last error. */
export function setWebhook(project: Project, url: string | null): Project {
  return sql.setWebhook.get(url, project.id) as Project
}

/** Slack answers a webhook in plain text: `ok`, or an error code such as `no_service`. */
export async function post(url: string, text: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new SlackError("Couldn't reach Slack.")
  }
  if (!response.ok) {
    const reason = cut((await response.text().catch(() => '')).trim(), 80)
    throw new SlackError(`Slack answered ${response.status}${reason ? `: ${reason}` : ''}.`, response.status)
  }
}

/** Delivers to the project's channel and records the outcome on the project row. */
export async function deliver(project: Project, text: string): Promise<void> {
  if (!project.slack_webhook) return
  try {
    await post(project.slack_webhook, text)
    sql.clearError.run(project.id)
  } catch (err) {
    sql.setError.run(err instanceof SlackError ? err.message : 'Unexpected error.', project.id)
    throw err
  }
}

/** Fire-and-forget from the write path. A slow or dead webhook never delays a comment. */
export function notify(project: Project, thread: Thread, comment: Comment, kind: 'new' | 'reply'): void {
  if (!project.slack_webhook) return
  void deliver(project, slackMessage(noticeFor(project, thread, comment, kind))).catch(() => {})
}

/**
 * Slack's mrkdwn has three control characters. Escaping them is also what keeps
 * a commenter's `<!channel>` from pinging the whole channel.
 */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A link's URL ends at the first `|`, which a page path may legally contain. */
function link(url: string, label: string): string {
  return `<${esc(url).replace(/\|/g, '%7C')}|${esc(label)}>`
}

export function slackMessage(n: Notice): string {
  const verb = n.kind === 'reply' ? 'replied on' : 'commented on'
  const where = n.pageUrl.replace(/^https?:\/\//, '')
  const quote = cut(n.quote.replace(/\s+/g, ' ').trim(), MAX_QUOTE)

  return [
    `*${esc(n.who)}* ${verb} *${esc(n.project)}*`,
    link(n.pageUrl, where),
    '',
    `> _“${esc(quote)}”_`,
    '',
    esc(cut(n.message.trim(), MAX_MESSAGE)),
    '',
    link(`${n.pageUrl}#tc-${n.threadId}`, 'Open thread'),
  ].join('\n')
}
