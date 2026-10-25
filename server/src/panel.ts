import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { db, type Project, type User } from './db.ts'
import {
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  currentUser,
  newProjectKey,
  telegramStartCode,
} from './auth.ts'
import { normalizeDomain, parsePattern, describeMatch, DomainError } from './domain.ts'
import { layout, escapeHtml } from './views/layout.ts'
import { relativeTime, readableTime, agoPhrase } from '../../shared/time.ts'
import { embedSnippet } from '../../shared/contract.ts'
import { getMe, adoptChat, deliver, esc, setBot, TelegramError, TOKEN_PATTERN } from './telegram.ts'
import * as slack from './slack.ts'

type Env = { Variables: { user: User } }

export const panel = new Hono()

const MIN_PASSWORD = 8

function publicOrigin(c: { req: { url: string } }): string {
  return process.env.TC_PUBLIC_ORIGIN ?? new URL(c.req.url).origin
}

/* ------------------------------------------------------------------ auth -- */

function authForm(mode: 'signup' | 'signin', error?: string, email = ''): string {
  const isSignup = mode === 'signup'
  return layout(
    `
<h1>${isSignup ? 'Create your account' : 'Sign in'}</h1>
<p class="lede">${
      isSignup
        ? 'One account holds every project you install.'
        : 'Welcome back.'
    }</p>
${error ? `<div class="error">${error}</div>` : ''}
<form method="post" action="/${mode}">
  <div class="field">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}">
  </div>
  <div class="field">
    <label for="password">Password</label>
    <input id="password" name="password" type="password"
           autocomplete="${isSignup ? 'new-password' : 'current-password'}"
           minlength="${MIN_PASSWORD}" required>
    ${isSignup ? `<p class="hint">At least ${MIN_PASSWORD} characters.</p>` : ''}
  </div>
  <button class="wide" type="submit">${isSignup ? 'Create account' : 'Sign in'}</button>
</form>
<p class="alt">${
      isSignup
        ? 'Already have an account? <a href="/signin">Sign in</a>'
        : 'No account yet? <a href="/signup">Create one</a>'
    }</p>
`,
    { title: isSignup ? 'Create your account' : 'Sign in', narrow: true },
  )
}

panel.get('/signup', (c) => (currentUser(c) ? c.redirect('/projects') : c.html(authForm('signup'))))
panel.get('/signin', (c) => (currentUser(c) ? c.redirect('/projects') : c.html(authForm('signin'))))

panel.post('/signup', async (c) => {
  const form = await c.req.formData()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')

  if (!email || !password) return c.html(authForm('signup', 'Email and password are required.', email))
  if (password.length < MIN_PASSWORD) {
    return c.html(authForm('signup', `Password must be at least ${MIN_PASSWORD} characters.`, email))
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) {
    return c.html(
      authForm('signup', 'That email already has an account. <a href="/signin">Sign in instead</a>.', email),
    )
  }

  const user = db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING *')
    .get(email, hashPassword(password)) as User

  startSession(c, user.id)
  // Straight to the one thing a new account exists to do.
  return c.redirect('/projects/new')
})

panel.post('/signin', async (c) => {
  const form = await c.req.formData()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined
  if (!user || !verifyPassword(password, user.password_hash)) {
    return c.html(authForm('signin', 'That email and password do not match.', email))
  }

  startSession(c, user.id)
  return c.redirect('/projects')
})

panel.post('/signout', (c) => {
  endSession(c)
  return c.redirect('/signin')
})

/* --------------------------------------------------------------- guarded -- */

const app = new Hono<Env>()

app.use('/*', async (c, next) => {
  const user = currentUser(c)
  if (!user) return c.redirect('/signin')
  c.set('user', user)
  await next()
})

interface ProjectRow extends Project {
  threads: number
  open: number
}

function projectsFor(userId: number): ProjectRow[] {
  return db
    .prepare(
      `SELECT p.*,
              COUNT(t.id) AS threads,
              COALESCE(SUM(CASE WHEN t.resolved = 0 THEN 1 ELSE 0 END), 0) AS open
       FROM projects p
       LEFT JOIN threads t ON t.project_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    )
    .all(userId) as ProjectRow[]
}

app.get('/projects', (c) => {
  const user = c.get('user')
  const projects = projectsFor(user.id)

  if (!projects.length) {
    return c.html(
      layout(
        `
<h1>Projects</h1>
<p class="lede">Create your first project to get a snippet.</p>
<a class="btn" href="/projects/new">New project</a>
`,
        { title: 'Projects', signedIn: true },
      ),
    )
  }

  const origin = publicOrigin(c)
  const rows = projects
    .map(
      (p) => `
<a class="row" href="/projects/${p.id}">
  <span class="row-name">${escapeHtml(p.name)}</span>
  <span class="row-domain">${escapeHtml(p.domain_pattern)}</span>
  <span class="row-meta">
    ${p.open > 0 ? `<span class="open-count">${p.open} open</span>` : ''}
    <span>${p.threads} thread${p.threads === 1 ? '' : 's'}</span>
    <span>${p.first_seen_at ? 'Installed' : 'Not installed'}</span>
  </span>
</a>`,
    )
    .join('')

  // The snippet for the most recent project stays one click away, because
  // copying it is the most common reason to open the panel at all.
  const latest = projects[0]

  return c.html(
    layout(
      `
<div class="split">
  <h1>Projects</h1>
  <a class="btn ghost" href="/projects/new">New project</a>
</div>
<div class="rows">${rows}</div>

<div class="section">
  <div class="snippet-label">
    <span>Snippet for ${escapeHtml(latest.name)}</span>
    <button class="quiet" data-copy="snip-latest" type="button">Copy</button>
  </div>
  <div class="snippet"><code id="snip-latest">${escapeHtml(embedSnippet(origin, latest.project_key))}</code></div>
</div>
`,
      { title: 'Projects', signedIn: true },
    ),
  )
})

function newProjectForm(error?: string, name = '', domain = ''): string {
  return layout(
    `
<a class="back" href="/projects">Projects</a>
<h1>New project</h1>
<p class="lede">A name and a domain. That is the whole setup.</p>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/projects">
  <div class="field">
    <label for="name">Project name</label>
    <input id="name" name="name" type="text" placeholder="Docs site" required
           value="${escapeHtml(name)}" autofocus>
  </div>
  <div class="field">
    <label for="domain">Domain</label>
    <input id="domain" name="domain" type="text" placeholder="acme.com" required
           value="${escapeHtml(domain)}" spellcheck="false" autocapitalize="off">
    <p class="hint">Subdomains are included. <code>acme.com</code> also covers
      <code>www.acme.com</code> and <code>docs.acme.com</code>.</p>
  </div>
  <button type="submit">Create project</button>
</form>
`,
    { title: 'New project', signedIn: true, narrow: true },
  )
}

app.get('/projects/new', (c) => c.html(newProjectForm()))

app.post('/projects', async (c) => {
  const user = c.get('user')
  const form = await c.req.formData()
  const name = String(form.get('name') ?? '').trim().slice(0, 80)
  const domainInput = String(form.get('domain') ?? '')

  if (!name) return c.html(newProjectForm('Give the project a name.', name, domainInput))

  let pattern: string
  try {
    pattern = normalizeDomain(domainInput).pattern
  } catch (err) {
    const message = err instanceof DomainError ? err.message : 'That does not look like a domain.'
    return c.html(newProjectForm(message, name, domainInput))
  }

  const project = db
    .prepare(
      'INSERT INTO projects (user_id, name, domain_pattern, project_key) VALUES (?, ?, ?, ?) RETURNING *',
    )
    .get(user.id, name, pattern, newProjectKey()) as Project

  // Straight to the snippet. Creating a project and collecting its snippet are
  // one action, not two.
  return c.redirect(`/projects/${project.id}`)
})

const ownedProject = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')

function projectFor(userId: number, id: string): Project | undefined {
  return ownedProject.get(Number(id), userId) as Project | undefined
}

interface PageFlags {
  /** A rejected token, shown above the field with the typed value kept. */
  tgError?: string
  token?: string
  slackError?: string
  webhook?: string
  /** Which channel just sent a test message. Each section only answers to its own name. */
  sent?: string
}

app.get('/projects/:id', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()
  return c.html(projectPage(c, project, { sent: c.req.query('sent') }))
})

function projectPage(c: { req: { url: string } }, project: Project, flags: PageFlags = {}): string {
  const pages = db
    .prepare(
      `SELECT page_url,
              COALESCE(SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END), 0) AS open,
              COALESCE(SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END), 0) AS resolved,
              MAX(updated_at) AS last_activity
       FROM threads WHERE project_id = ?
       GROUP BY page_url
       ORDER BY last_activity DESC`,
    )
    .all(project.id) as {
    page_url: string
    open: number
    resolved: number
    last_activity: string
  }[]

  const origin = publicOrigin(c)
  const installed = !!project.first_seen_at
  const match = describeMatch(parsePattern(project.domain_pattern))

  const pagesSection = pages.length
    ? `
<table>
  <thead>
    <tr>
      <th>Page</th>
      <th class="num">Open</th>
      <th class="num">Resolved</th>
      <th class="num">Last activity</th>
    </tr>
  </thead>
  <tbody>
    ${pages
      .map(
        (p) => `<tr>
      <td><a href="${escapeHtml(p.page_url)}" target="_blank" rel="noreferrer">${escapeHtml(
        p.page_url,
      )}</a></td>
      <td class="num">${p.open || ''}</td>
      <td class="num">${p.resolved || ''}</td>
      <td class="num" title="${escapeHtml(readableTime(p.last_activity))}">${relativeTime(
        p.last_activity,
      )}</td>
    </tr>`,
      )
      .join('')}
  </tbody>
</table>`
    : `<p class="empty">No pages yet. The snippet hasn't loaded anywhere.</p>`

  return layout(
    `
<a class="back" href="/projects">Projects</a>
<div class="split">
  <h1>${escapeHtml(project.name)}</h1>
  <form method="post" action="/projects/${project.id}/delete"
        onsubmit="return confirm('Delete ${escapeHtml(project.name)} and every comment in it?')">
    <button class="danger" type="submit">Delete project</button>
  </form>
</div>
<p class="lede"><code>${escapeHtml(project.domain_pattern)}</code> &middot; ${escapeHtml(match)}</p>

<div class="section">
  <div class="snippet-label">
    <span>Paste this into your page</span>
    <button class="quiet" data-copy="snip" type="button">Copy</button>
  </div>
  <div class="snippet"><code id="snip">${escapeHtml(embedSnippet(origin, project.project_key))}</code></div>
  <div class="status${installed ? ' on' : ''}">
    <span class="dot"></span>
    <span>${
      installed
        ? `Installed. First seen ${escapeHtml(agoPhrase(project.first_seen_at))}.`
        : 'Waiting for first page view'
    }</span>
  </div>
</div>

<div class="section" id="telegram">
  <h2>${TELEGRAM_LOGO}Telegram</h2>
  ${telegramSection(project, flags)}
</div>

<div class="section" id="slack">
  <h2>${SLACK_LOGO}Slack</h2>
  ${slackSection(project, flags)}
</div>

<div class="section">
  <h2>Pages</h2>
  ${pagesSection}
</div>
`,
    { title: project.name, signedIn: true },
  )
}

/** Each service's own mark, in its own colours. Decorative: the heading already names it. */
const TELEGRAM_LOGO = `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#26A5E4"/><path fill="#fff" d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`
const SLACK_LOGO = `<svg class="logo" viewBox="0 0 127 127" aria-hidden="true"><path fill="#E01E5A" d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"/><path fill="#36C5F0" d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"/><path fill="#2EB67D" d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"/><path fill="#ECB22E" d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"/></svg>`

/**
 * Three states, one section: no token, token but nobody has pressed Start,
 * connected. The middle one is the only moment that needs the owner to leave
 * the panel, so it says exactly where to go and then watches for them to
 * come back.
 */
function telegramSection(project: Project, flags: PageFlags): string {
  const base = `/projects/${project.id}/telegram`
  const botUrl = `https://t.me/${escapeHtml(project.telegram_bot)}`
  const botLink = (href: string) =>
    project.telegram_bot
      ? `<a href="${href}" target="_blank" rel="noreferrer">@${escapeHtml(project.telegram_bot)}</a>`
      : ''

  if (!project.telegram_token) {
    return `
  <p class="lede">Get a message the moment someone comments.</p>
  ${flags.tgError ? `<div class="error">${escapeHtml(flags.tgError)}</div>` : ''}
  <form method="post" action="${base}">
    <div class="field token">
      <label for="token">Bot token</label>
      <input id="token" name="token" type="text" placeholder="123456789:AAH..." required
             autocomplete="off" spellcheck="false" autocapitalize="off"
             value="${escapeHtml(flags.token ?? '')}">
      <p class="hint">Message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>,
        send <code>/newbot</code>, and paste the token it gives you.</p>
    </div>
    <button type="submit">Connect</button>
  </form>`
  }

  if (!project.telegram_chat_id) {
    // The Start link carries the code, so pressing Start sends it without the
    // owner typing anything. A group gets the same line typed by hand.
    const code = telegramStartCode(project)
    return `
  <div class="status">
    <span class="dot"></span>
    <span>Token saved. Open ${botLink(`${botUrl}?start=${code}`)} and press <b>Start</b>.
      For a team, add the bot to a group and send <code>/start ${code}</code> there.
      This page updates on its own.</span>
  </div>
  ${failed('Last check', project.telegram_error, project.telegram_error_at)}
  <div class="actions">
    <form method="post" action="${base}/check"><button class="ghost" type="submit">Check again</button></form>
    <form method="post" action="${base}/disconnect"><button class="quiet" type="submit">Disconnect</button></form>
  </div>
<script>
(function () {
  var timer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    fetch('${base}/check', { method: 'POST', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.connected) { clearInterval(timer); location.reload(); } })
      .catch(function () {});
  }, 3000);
})();
</script>`
  }

  return `
  <div class="status on">
    <span class="dot"></span>
    <span>Connected. Messages go to <b>${escapeHtml(project.telegram_chat_name)}</b> via ${botLink(botUrl)}.</span>
  </div>
  ${connectedFooter(base, flags.sent === 'telegram', project.telegram_error, project.telegram_error_at)}`
}

function failed(what: string, error: string | null, at: string | null): string {
  return error ? `<p class="hint danger">${what} failed ${escapeHtml(agoPhrase(at))}: ${escapeHtml(error)}</p>` : ''
}

/** A connected channel's last test or failure, then its two actions. */
function connectedFooter(base: string, sent: boolean, error: string | null, at: string | null): string {
  return `
  ${sent ? '<p class="hint">Test message sent.</p>' : failed('Last message', error, at)}
  <div class="actions">
    <form method="post" action="${base}/test"><button class="ghost" type="submit">Send test</button></form>
    <form method="post" action="${base}/disconnect"><button class="quiet" type="submit">Disconnect</button></form>
  </div>`
}

/**
 * Two states: no webhook, connected. A webhook is saved only after its hello
 * reached the channel, so there is nothing in between to wait on.
 */
function slackSection(project: Project, flags: PageFlags): string {
  const base = `/projects/${project.id}/slack`

  if (!project.slack_webhook) {
    return `
  <p class="lede">Post every new comment to a Slack channel.</p>
  ${flags.slackError ? `<div class="error">${escapeHtml(flags.slackError)}</div>` : ''}
  <form method="post" action="${base}">
    <div class="field token">
      <label for="webhook">Webhook URL</label>
      <input id="webhook" name="webhook" type="text" placeholder="https://hooks.slack.com/services/..." required
             autocomplete="off" spellcheck="false" autocapitalize="off"
             value="${escapeHtml(flags.webhook ?? '')}">
      <p class="hint">Create an app at <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">api.slack.com/apps</a>,
        turn on Incoming Webhooks, add one to a channel, and paste its URL.</p>
    </div>
    <button type="submit">Connect</button>
  </form>`
  }

  return `
  <div class="status on">
    <span class="dot"></span>
    <span>Connected. Messages go to the channel this webhook was made for.</span>
  </div>
  ${connectedFooter(base, flags.sent === 'slack', project.slack_error, project.slack_error_at)}`
}

app.post('/projects/:id/telegram', async (c) => {
  const user = c.get('user')
  const project = projectFor(user.id, c.req.param('id'))
  if (!project) return c.notFound()

  const form = await c.req.formData()
  const token = String(form.get('token') ?? '').trim()
  const reject = (tgError: string) => c.html(projectPage(c, project, { tgError, token }))

  if (!TOKEN_PATTERN.test(token)) {
    return reject("That doesn't look like a bot token. BotFather's look like 123456789:AAH...")
  }

  let me: { username: string }
  try {
    me = await getMe(token)
  } catch (err) {
    const rejected = err instanceof TelegramError && err.code === 401
    return reject(rejected ? 'Telegram did not accept that token.' : "Couldn't reach Telegram. Try again in a moment.")
  }

  const saved = setBot(project, token, me.username)

  // Drains whatever the bot received before the owner could have seen the
  // code, so a stale message from anyone else is gone before the first check.
  await adoptChat(saved, telegramStartCode(saved))
  return c.redirect(`/projects/${project.id}#telegram`)
})

app.post('/projects/:id/telegram/check', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const connected = await adoptChat(project, telegramStartCode(project))
  if (c.req.header('Accept')?.includes('application/json')) return c.json({ connected })
  return c.redirect(`/projects/${project.id}#telegram`)
})

app.post('/projects/:id/telegram/test', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const sent = await deliver(
    project,
    `Test from <b>${esc(project.name)}</b>. New comments will show up here.`,
  ).then(
    () => true,
    () => false,
  )
  return c.redirect(`/projects/${project.id}${sent ? '?sent=telegram' : ''}#telegram`)
})

app.post('/projects/:id/telegram/disconnect', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  setBot(project, null, null)
  return c.redirect(`/projects/${project.id}#telegram`)
})

app.post('/projects/:id/slack', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const form = await c.req.formData()
  const webhook = String(form.get('webhook') ?? '').trim()
  const reject = (slackError: string) => c.html(projectPage(c, project, { slackError, webhook }))

  if (!slack.isWebhook(webhook)) {
    return reject("That doesn't look like a webhook URL. Slack's start with https://hooks.slack.com/services/")
  }

  // Posting is the only way to learn a webhook works, so the hello goes out
  // before anything is saved.
  try {
    await slack.post(webhook, `Connected to *${slack.esc(project.name)}*. New comments will show up here.`)
  } catch (err) {
    const rejected = err instanceof slack.SlackError && err.status !== undefined && err.status < 500
    return reject(
      rejected ? `Slack did not accept that webhook. ${err.message}` : "Couldn't reach Slack. Try again in a moment.",
    )
  }

  slack.setWebhook(project, webhook)
  return c.redirect(`/projects/${project.id}#slack`)
})

app.post('/projects/:id/slack/test', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const sent = await slack
    .deliver(project, `Test from *${slack.esc(project.name)}*. New comments will show up here.`)
    .then(
      () => true,
      () => false,
    )
  return c.redirect(`/projects/${project.id}${sent ? '?sent=slack' : ''}#slack`)
})

app.post('/projects/:id/slack/disconnect', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  slack.setWebhook(project, null)
  return c.redirect(`/projects/${project.id}#slack`)
})

app.post('/projects/:id/delete', (c) => {
  const user = c.get('user')
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(
    Number(c.req.param('id')),
    user.id,
  )
  return c.redirect('/projects')
})

/**
 * Registered ahead of the guarded routes, whose `/*` guard would otherwise send
 * a signed-out visitor straight to /signin. The page is authored without a
 * document skeleton (it doubles as a hosted preview), so the skeleton is added
 * here, and its links are written against the production origin. The head is
 * left open on purpose: the page's title, meta and styles stay in it, and its
 * first element closes it implicitly, as HTML allows.
 */
const LANDING = readFileSync(new URL('./views/landing.html', import.meta.url), 'utf8')

panel.get('/', (c) =>
  currentUser(c)
    ? c.redirect('/projects')
    : c.html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${LANDING.replaceAll('https://teammate.jaan.to', publicOrigin(c))}</html>`,
      ),
)

panel.route('/', app)
