import { db, type Project } from './db.ts'
import { cut, wording, type Notice } from './telegram.ts'

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

const WEBHOOK_PATH = /^\/services\/T\w+\/B\w+\/\w+$/

/**
 * Opens Slack's "Create from a manifest" dialog already filled in, so the owner
 * only picks a workspace. Slack refuses any OAuth scope without a bot user, so
 * one is declared even though only the webhook ever posts.
 */
const MANIFEST = {
  display_information: { name: 'Teammate Comment', description: 'Posts new comments and replies to one channel.' },
  features: { bot_user: { display_name: 'Teammate Comment' } },
  oauth_config: { scopes: { bot: ['incoming-webhook'] } },
  settings: { incoming_webhooks: { incoming_webhooks_enabled: true } },
}
export const NEW_APP_URL = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(MANIFEST))}`

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
    if (project.slack_error) sql.clearError.run(project.id)
  } catch (err) {
    sql.setError.run(err instanceof SlackError ? err.message : 'Unexpected error.', project.id)
    throw err
  }
}

/** Fire-and-forget from the write path. A slow or dead webhook never delays a comment. */
export function notify(project: Project, n: Notice): void {
  if (!project.slack_webhook) return
  void deliver(project, slackMessage(n)).catch(() => {})
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
  const { verb, where, quote, message } = wording(n)

  return [
    `*${esc(n.who)}*${n.email ? ` (${esc(n.email)})` : ''} ${verb} *${esc(n.project)}*`,
    link(n.pageUrl, where),
    '',
    `> _“${esc(quote)}”_`,
    '',
    esc(message),
    '',
    link(`${n.pageUrl}#tc-${n.threadId}`, 'Open thread'),
  ].join('\n')
}
