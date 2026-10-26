import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { readFileSync } from 'node:fs'
import { db, type Project, type User, type Thread, type Comment } from './db.ts'
import {
  hashPassword,
  verifyPassword,
  startSession,
  endSession,
  currentUser,
  newProjectKey,
  telegramStartCode,
  ownerKey,
} from './auth.ts'
import { normalizeDomain, parsePattern, describeMatch, hostMatches, hostFromHeader, DomainError } from './domain.ts'
import { layout, escapeHtml, analytics } from './views/layout.ts'
import { relativeTime, readableTime, agoPhrase } from '../../shared/time.ts'
import { embedSnippet, MAX_NAME, MAX_MESSAGE } from '../../shared/contract.ts'
import { threadsMarkdown } from '../../shared/markdown.ts'
import { addReply, editComment, removeComment, removeThread, setResolved, threadFor, field } from './api.ts'
import { getMe, adoptChat, deliver, esc, setBot, TelegramError, TOKEN_PATTERN } from './telegram.ts'
import * as slack from './slack.ts'

type Env = { Variables: { user: User } }

export const panel = new Hono()

const MIN_PASSWORD = 8

function publicOrigin(c: { req: { url: string } }): string {
  return process.env.TC_PUBLIC_ORIGIN ?? new URL(c.req.url).origin
}

/** Names a GA event for the next page to send, so it counts only once the action has worked. */
function track(c: Context, event: string): void {
  if (process.env.TC_GA_ID) {
    setCookie(c, 'tc_ev', event, { path: '/', sameSite: 'Lax', maxAge: 60, secure: process.env.NODE_ENV === 'production' })
  }
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
  track(c, 'sign_up')
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
  track(c, 'login')
  return c.redirect('/projects')
})

panel.post('/signout', (c) => {
  endSession(c)
  track(c, 'logout')
  return c.redirect('/signin')
})

/* --------------------------------------------------------------- guarded -- */

const app = new Hono<Env>()

/**
 * Every write here rides the session cookie. SameSite=Lax already keeps it off
 * cross-site posts, but Lax counts a sibling subdomain as the same site, so a
 * post must also come from this host. A missing Origin is let through: Lax has
 * that case covered, and old browsers do not always send one.
 */
function fromHere(c: Context): boolean {
  const origin = c.req.header('Origin')
  if (!origin) return true
  try {
    const host = new URL(origin).host
    return host === new URL(c.req.url).host || host === new URL(publicOrigin(c)).host
  } catch {
    return false
  }
}

app.use('/*', async (c, next) => {
  const user = currentUser(c)
  if (!user) return c.redirect('/signin')
  if (c.req.method === 'POST' && !fromHere(c)) return c.text('Cross-site request refused.', 403)
  c.set('user', user)
  await next()
})

interface ProjectRow extends Project {
  threads: number
  open: number
  last_activity: string | null
}

function projectsFor(userId: number): ProjectRow[] {
  return db
    .prepare(
      `SELECT p.*,
              COUNT(t.id) AS threads,
              COALESCE(SUM(CASE WHEN t.resolved = 0 THEN 1 ELSE 0 END), 0) AS open,
              MAX(t.updated_at) AS last_activity
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
<p class="lede">A project is one website. Create one and you get the line of code to paste into it.</p>
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
    <span>${
      p.last_activity
        ? `<span title="${escapeHtml(readableTime(p.last_activity))}">Active ${escapeHtml(agoPhrase(p.last_activity))}</span>`
        : p.first_seen_at
          ? 'Installed'
          : 'Not installed'
    }</span>
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
  <div class="snippet-label">Snippet for ${escapeHtml(latest.name)}</div>
  ${copyBox('snip-latest', embedSnippet(origin, latest.project_key))}
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

  track(c, 'create_project')
  // Straight to the snippet. Creating a project and collecting its snippet are
  // one action, not two.
  return c.redirect(`/projects/${project.id}`)
})

const ownedProject = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')

/**
 * A link out to a commented page. The owner key rides along only to the
 * project's own domain, and anything that is not http(s) is shown as text.
 */
function pageLink(project: Project, url: string, label: string): string {
  if (!/^https?:\/\//i.test(url)) return escapeHtml(label)
  const onDomain = hostMatches(project.domain_pattern, hostFromHeader(url) ?? '')
  const href = onDomain ? `${url}#tc-owner=${ownerKey(project)}` : url
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
}

/** A page address as the owner scans it: the host quiet, the path that tells pages apart loud. */
function urlLabel(url: string): string {
  const [, host, path] = /^https?:\/\/([^/?#]+)(.*)$/i.exec(url) ?? []
  return host ? `<span class="host">${escapeHtml(host)}</span>${escapeHtml(path || '/')}` : escapeHtml(url)
}

/** Something to copy with its Copy button inside the box. A snippet's widget URL is picked out. */
function copyBox(id: string, text: string): string {
  const code = escapeHtml(text).replace(/src=&quot;(.+?)&quot;/, 'src=&quot;<b>$1</b>&quot;')
  return `<div class="snippet"><code id="${id}">${code}</code><button data-copy="${id}" type="button">Copy</button></div>`
}

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
  const owner = `#tc-owner=${ownerKey(project)}`
  const installed = !!project.first_seen_at
  const match = describeMatch(parsePattern(project.domain_pattern))

  // "Visit", not "Open": Open is already the column of open threads.
  const pagesSection = pages.length
    ? `
<table>
  <thead>
    <tr>
      <th>Page</th>
      <th class="num">Open</th>
      <th class="num col-resolved">Resolved</th>
      <th class="num">Updated</th>
      <th class="num"><span class="sr-only">Link</span></th>
    </tr>
  </thead>
  <tbody>
    ${pages
      .map(
        (p) => `<tr>
      <td class="page"><a href="${escapeHtml(listUrl(project.id, { page: p.page_url, status: 'all' }))}" title="${escapeHtml(
        p.page_url,
      )}">${urlLabel(p.page_url)}</a></td>
      <td class="num">${p.open ? `<span class="open-count">${p.open}</span>` : ''}</td>
      <td class="num col-resolved">${p.resolved || ''}</td>
      <td class="num" title="${escapeHtml(readableTime(p.last_activity))}">${relativeTime(
        p.last_activity,
      )}</td>
      <td class="num">${pageLink(project, p.page_url, 'Visit')}</td>
    </tr>`,
      )
      .join('')}
  </tbody>
</table>`
    : installed
      ? `<p class="empty"><b>No comments yet.</b> Select some text on your site to start the first thread.</p>`
      : `<p class="empty">No pages yet. They show up here once the snippet is on your site and someone comments.</p>`

  // Installing happens in another tab, so this one watches for it rather than
  // asking for a reload, the same way Telegram's Start does.
  const install = installed
    ? `<div class="status on">
    <span class="dot"></span>
    <span>Installed. First seen ${escapeHtml(agoPhrase(project.first_seen_at))}.</span>
  </div>`
    : `<div class="status listening" id="install-status" role="status">
    <span class="dot"></span>
    <span>Waiting for the first page view. Open a page that has the snippet and this updates on its own.</span>
  </div>
<script>
(function () {
  var timer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    fetch('/projects/${project.id}/installed')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.installed) return;
        clearInterval(timer);
        var s = document.getElementById('install-status');
        s.className = 'status on arrived';
        s.lastElementChild.textContent = 'Installed just now. Select some text on your site to leave the first comment.';
      })
      .catch(function () {});
  }, 4000);
})();
</script>`

  return layout(
    `
<a class="back" href="/projects">Projects</a>
<h1>${escapeHtml(project.name)}</h1>
<p class="lede"><code>${escapeHtml(project.domain_pattern)}</code> &middot; ${escapeHtml(match)}</p>

<div class="section">
  <h2>Install</h2>
  <p class="lede">Paste this line into your site's HTML. In a shared layout or template, every page gets comments at once.</p>
  ${copyBox('snip', embedSnippet(origin, project.project_key))}
  ${install}
</div>

<div class="section" id="pages">
  <div class="split">
    <h2>Pages</h2>
    ${pages.length ? `<a class="quiet" href="${listUrl(project.id, { page: '', status: 'open' })}">All comments</a>` : ''}
  </div>
  ${pagesSection}
</div>

<div class="section">
  <h2>Notifications</h2>
  ${channel(
    'telegram',
    TELEGRAM_LOGO,
    'Telegram',
    !project.telegram_token
      ? 'A message to you or your team chat for every new comment'
      : project.telegram_chat_id
        ? `Connected to ${escapeHtml(project.telegram_chat_name)}`
        : 'One step left: press Start',
    !!project.telegram_chat_id,
    !!(flags.tgError || flags.sent === 'telegram' || project.telegram_error || (project.telegram_token && !project.telegram_chat_id)),
    telegramSection(project, flags),
  )}
  ${channel(
    'slack',
    SLACK_LOGO,
    'Slack',
    project.slack_webhook ? 'Connected' : 'Every new comment posted to a channel',
    !!project.slack_webhook,
    !!(flags.slackError || flags.sent === 'slack' || project.slack_error),
    slackSection(project, flags),
  )}
</div>

<div class="section">
  <h2>Moderate on your site</h2>
  <p class="lede">On your site anyone can read and reply. To resolve, edit and delete there too, open a page from
    <a href="#pages">Pages</a>, or add this to the end of any page address once per browser.
    Keep it private: whoever has it can moderate.</p>
  ${copyBox('owner', owner)}
</div>

<div class="section danger-zone">
  <form method="post" action="/projects/${project.id}/delete"
        onsubmit="return confirm('Delete this project and every comment in it?')">
    <button class="danger" type="submit">Delete project</button>
  </form>
  <p class="hint">Every comment on every page goes with it, and the snippet stops working. This can't be undone.</p>
</div>
`,
    { title: project.name, signedIn: true },
  )
}

/**
 * A notification channel as one row that opens. It starts open whenever there
 * is something to read or do in it: an error, a test result, a pending step.
 */
function channel(id: string, logo: string, name: string, meta: string, connected: boolean, open: boolean, body: string): string {
  return `
<details class="channel" id="${id}"${open ? ' open' : ''}>
  <summary>
    <b>${logo}${name}</b>
    <span class="meta">${meta}</span>
    <span class="go"><span class="closed">${connected ? 'Manage' : 'Set up'}</span><span class="opened">Close</span></span>
  </summary>
  <div class="channel-body">${body}</div>
</details>`
}

app.get('/projects/:id/installed', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()
  return c.json({ installed: !!project.first_seen_at })
})

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
  const botLink = (href: string) =>
    project.telegram_bot
      ? `<a href="${href}" target="_blank" rel="noreferrer">@${escapeHtml(project.telegram_bot)}</a>`
      : ''

  if (!project.telegram_token) {
    return `
  ${flags.tgError ? `<div class="error">${escapeHtml(flags.tgError)}</div>` : ''}
  <ol class="steps">
    <li>In Telegram, message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and
      send <code>/newbot</code>.</li>
    <li>Give the bot any name and username. BotFather answers with a token.</li>
    <li>Paste the token below.</li>
  </ol>
  <form method="post" action="${base}">
    <div class="field token">
      <label for="token">Bot token</label>
      <input id="token" name="token" type="text" placeholder="123456789:AAH..." required
             autocomplete="off" spellcheck="false" autocapitalize="off"
             value="${escapeHtml(flags.token ?? '')}">
    </div>
    <button type="submit" data-busy="Connecting…">Connect</button>
  </form>`
  }

  if (!project.telegram_chat_id) {
    // The Start link carries the code, so pressing Start sends it without the
    // owner typing anything. A group gets the same line typed by hand.
    const code = telegramStartCode(project)
    return `
  <div class="status listening">
    <span class="dot"></span>
    <span>Last step: open ${botLink(`${base}/start`)} and press <b>Start</b>.
      For a team chat, add the bot to the group and send <code>/start ${code}</code> there instead.
      This page updates on its own once the bot hears from you.</span>
  </div>
  ${failed('Last check', project.telegram_error, project.telegram_error_at)}
  <div class="actions">
    <form method="post" action="${base}/check"><button class="ghost" type="submit" data-busy="Checking…">Check now</button></form>
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
    <span>Connected. Messages go to <b>${escapeHtml(project.telegram_chat_name)}</b> via ${botLink(`https://t.me/${escapeHtml(project.telegram_bot)}`)}.</span>
  </div>
  ${connectedFooter(base, flags.sent === 'telegram', project.telegram_error, project.telegram_error_at)}`
}

function failed(what: string, error: string | null, at: string | null): string {
  return error ? `<p class="hint danger">${what} failed ${escapeHtml(agoPhrase(at))}: ${escapeHtml(error)}</p>` : ''
}

/** A connected channel's last test or failure, then its two actions. */
function connectedFooter(base: string, sent: boolean, error: string | null, at: string | null): string {
  return `
  ${sent ? '<p class="hint">Test message sent. It should be there now.</p>' : failed('Last message', error, at)}
  <div class="actions">
    <form method="post" action="${base}/test"><button class="ghost" type="submit" data-busy="Sending…">Send test</button></form>
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
  ${flags.slackError ? `<div class="error">${escapeHtml(flags.slackError)}</div>` : ''}
  <ol class="steps">
    <li><a href="${escapeHtml(slack.NEW_APP_URL)}" target="_blank" rel="noreferrer">Create the Slack app</a>. It opens
      filled in: pick your workspace, then press <b>Next</b> and <b>Create</b>.</li>
    <li>In the app's sidebar open <b>Incoming Webhooks</b>, press <b>Add New Webhook</b>, choose a channel and
      press <b>Allow</b>.</li>
    <li>Copy the webhook URL and paste it below.</li>
  </ol>
  <form method="post" action="${base}">
    <div class="field token">
      <label for="webhook">Webhook URL</label>
      <input id="webhook" name="webhook" type="text" placeholder="https://hooks.slack.com/services/..." required
             autocomplete="off" spellcheck="false" autocapitalize="off"
             value="${escapeHtml(flags.webhook ?? '')}">
      <p class="hint">Already have a Slack app? Open it at
        <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">api.slack.com/apps</a>,
        turn on <b>Incoming Webhooks</b>, and start from step 2.</p>
    </div>
    <button type="submit" data-busy="Connecting…">Connect</button>
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
  if (connected) track(c, 'connect_telegram')
  if (c.req.header('Accept')?.includes('application/json')) return c.json({ connected })
  return c.redirect(`/projects/${project.id}#telegram`)
})

// The Start link goes through here so its code is never in a link on the page,
// where analytics would record it as an outbound click.
app.get('/projects/:id/telegram/start', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project?.telegram_bot) return c.notFound()
  return c.redirect(`https://t.me/${project.telegram_bot}?start=${telegramStartCode(project)}`)
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
  track(c, 'connect_slack')
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

/* -------------------------------------------------------------- comments -- */

/**
 * Every thread in a project, one page or all of them, with everything the
 * widget lets the owner do plus the one thing it cannot: the commenter's email.
 * Plain forms that post and come back to the list as it was filtered, so the
 * page needs no script beyond Copy.
 */

type Status = 'open' | 'resolved' | 'all'

interface Filter {
  /** One page's threads, or every page's when empty. */
  page: string
  status: Status
}

function filterFrom(c: Context): Filter {
  const status = c.req.query('status')
  return { page: c.req.query('page') ?? '', status: status === 'resolved' || status === 'all' ? status : 'open' }
}

function query({ page, status }: Filter): string {
  const q = String(new URLSearchParams({ ...(page ? { page } : {}), ...(status !== 'open' ? { status } : {}) }))
  return q ? `?${q}` : ''
}

function listUrl(projectId: number, filter: Filter, hash = ''): string {
  return `/projects/${projectId}/comments${query(filter)}${hash}`
}

const NAME_COOKIE = 'tc_name'

const threadsIn = db.prepare(
  `SELECT * FROM threads
   WHERE project_id = :project AND (:page = '' OR page_url = :page)
   ORDER BY MAX(updated_at) OVER (PARTITION BY page_url) DESC, page_url, start_offset, id`,
)
const commentsIn = db.prepare(
  `SELECT * FROM comments
   WHERE thread_id IN (SELECT id FROM threads WHERE project_id = :project AND (:page = '' OR page_url = :page))
   ORDER BY created_at, id`,
)

function commentsPage(c: Context, project: Project, error?: string): string {
  const filter = filterFrom(c)
  const scope = { project: project.id, page: filter.page }
  // Every status in one read: the tabs count them all, the list shows one.
  const all = threadsIn.all(scope) as unknown as Thread[]
  const threads =
    filter.status === 'all' ? all : all.filter((t) => !!t.resolved === (filter.status === 'resolved'))
  const resolved = all.filter((t) => t.resolved).length
  const counts = { open: all.length - resolved, resolved }
  const comments = Map.groupBy(commentsIn.all(scope) as unknown as Comment[], (m) => m.thread_id)
  const name = getCookie(c, NAME_COOKIE) ?? ''

  const tab = (status: Status, label: string) =>
    `<a href="${escapeHtml(listUrl(project.id, { ...filter, status }))}"${
      status === filter.status ? ' aria-current="page"' : ''
    }>${label}</a>`

  const groups = [...Map.groupBy(threads, (t) => t.page_url)].map(([url, list], i) => {
    const withComments = list.map((t) => ({ thread: t, comments: comments.get(t.id) ?? [] }))
    const md = threadsMarkdown(
      url,
      withComments.map(({ thread, comments }) => ({ dto: { ...thread, resolved: !!thread.resolved, comments } })),
    )
    return `
<div class="section">
  <div class="snippet-label page-head">
    <a class="page-url" href="${escapeHtml(listUrl(project.id, { ...filter, page: url }))}" title="${escapeHtml(url)}">${urlLabel(url)}</a>
    <span class="tools">
      <button class="quiet" data-copy="md-p${i}" type="button">Copy as Markdown</button>
      ${pageLink(project, url, 'View page')}
    </span>
  </div>
  <pre id="md-p${i}" hidden>${escapeHtml(md)}</pre>
  ${withComments.map(({ thread, comments }) => threadBlock(project, thread, comments, filter, name)).join('')}
</div>`
  })

  // Says why the list is empty: nothing yet, or everything handled.
  const where = filter.page ? ' on this page' : ''
  const empty = !all.length
    ? `<b>No comments yet${where}.</b> Select some text on a page that has the snippet to start a thread.`
    : filter.status === 'open'
      ? `${CHECK}<b>All clear.</b> Every thread${where} is resolved.`
      : `Nothing resolved${where} yet.`

  return layout(
    `
<a class="back" href="/projects/${project.id}">${escapeHtml(project.name)}</a>
<h1>Comments</h1>
<p class="lede">${
      filter.page
        ? `On <code>${urlLabel(filter.page)}</code> &middot; <a href="${escapeHtml(
            listUrl(project.id, { ...filter, page: '' }),
          )}">All pages</a>`
        : 'Every page in this project. Only you see commenters&rsquo; emails.'
    }</p>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<nav class="tabs" aria-label="Threads by status">
  ${tab('open', `Open (${counts.open})`)}
  ${tab('resolved', `Resolved (${counts.resolved})`)}
  ${tab('all', `All (${counts.open + counts.resolved})`)}
</nav>
${groups.length ? groups.join('') : `<p class="empty">${empty}</p>`}
`,
    { title: `Comments · ${project.name}`, signedIn: true },
  )
}

const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`

function threadBlock(project: Project, t: Thread, comments: Comment[], filter: Filter, name: string): string {
  const base = `/projects/${project.id}`
  const q = query(filter)
  const md = threadsMarkdown(t.page_url, [{ dto: { ...t, resolved: !!t.resolved, comments } }])

  // Amber is reserved for open threads, so resolved ones say so in words.
  const status = t.resolved
    ? `<span class="when">Resolved${t.resolved_by_name ? ` by ${escapeHtml(t.resolved_by_name)}` : ''} ${escapeHtml(
        agoPhrase(t.resolved_at),
      )}</span>`
    : '<span class="open-count">Open</span>'

  const commentRows = comments
    .map(
      (m, i) => `
  <div class="comment">
    <div class="byline">
      <b>${escapeHtml(m.name)}</b>
      ${m.email ? `<a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a>` : ''}
      <span class="when" title="${escapeHtml(readableTime(m.created_at))}">${relativeTime(m.created_at)}${
        m.edited_at ? ' &middot; edited' : ''
      }</span>
    </div>
    <p class="message">${escapeHtml(m.message)}</p>
    <div class="tools">
      <details>
        <summary class="quiet">Edit</summary>
        <form method="post" action="${base}/comments/${m.id}/edit${escapeHtml(q)}">
          <textarea name="message" required maxlength="${MAX_MESSAGE}" aria-label="Edit comment">${escapeHtml(m.message)}</textarea>
          <button type="submit">Save</button>
        </form>
      </details>
      ${
        // The root is what the highlight is about; removing it is removing the thread.
        i === 0
          ? ''
          : `<form method="post" action="${base}/comments/${m.id}/delete${escapeHtml(q)}"
            onsubmit="return confirm('Delete this comment?')"><button class="quiet" type="submit">Delete</button></form>`
      }
    </div>
  </div>`,
    )
    .join('')

  return `
<article class="thread${t.resolved ? ' is-resolved' : ''}" id="t${t.id}">
  <div class="byline">
    ${status}
    <span class="tools">
      <button class="quiet" data-copy="md-t${t.id}" type="button" title="Copy this thread as Markdown">Copy</button>
      ${pageLink(project, t.page_url, 'View on page')}
      <form method="post" action="${base}/threads/${t.id}/resolve${escapeHtml(q)}">
        <input type="hidden" name="resolved" value="${t.resolved ? 0 : 1}">
        <button class="quiet" type="submit">${t.resolved ? 'Reopen' : 'Resolve'}</button>
      </form>
      <form method="post" action="${base}/threads/${t.id}/delete${escapeHtml(q)}"
            onsubmit="return confirm('Delete this thread and every comment in it?')">
        <button class="quiet danger" type="submit">Delete</button>
      </form>
    </span>
  </div>
  <blockquote><mark>${escapeHtml(t.selected_text)}</mark></blockquote>
  ${commentRows}
  <details class="reply">
    <summary class="btn ghost">Reply</summary>
    <form method="post" action="${base}/threads/${t.id}/reply${escapeHtml(q)}">
      <div class="field">
        <label for="n${t.id}">Name</label>
        <input id="n${t.id}" name="name" type="text" required maxlength="${MAX_NAME}" autocomplete="name"
               value="${escapeHtml(name)}">
      </div>
      <div class="field">
        <label for="m${t.id}">Reply</label>
        <textarea id="m${t.id}" name="message" required maxlength="${MAX_MESSAGE}"></textarea>
      </div>
      <button type="submit">Reply</button>
    </form>
  </details>
  <pre id="md-t${t.id}" hidden>${escapeHtml(md)}</pre>
</article>`
}

app.get('/projects/:id/comments', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()
  return c.html(commentsPage(c, project))
})

/** Back to the list as it was filtered, at the thread that was acted on. */
const backTo = (c: Context, project: Project, threadId?: number) =>
  c.redirect(listUrl(project.id, filterFrom(c), threadId ? `#t${threadId}` : ''))

app.post('/projects/:id/threads/:thread/reply', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  const thread = project && threadFor(project.id, Number(c.req.param('thread')))
  if (!project || !thread) return c.notFound()

  const form = await c.req.formData()
  const name = field(form.get('name'), MAX_NAME)
  const message = field(form.get('message'), MAX_MESSAGE)
  if (!name || !message) return c.html(commentsPage(c, project, 'A reply needs a name and a message.'), 400)

  addReply(project, thread, name, null, message)
  // Remembered so the next reply is one field, not two.
  setCookie(c, NAME_COOKIE, name, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/projects',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  })
  track(c, 'reply')
  return backTo(c, project, thread.id)
})

app.post('/projects/:id/threads/:thread/resolve', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const form = await c.req.formData()
  const id = Number(c.req.param('thread'))
  const name = field(getCookie(c, NAME_COOKIE), MAX_NAME) || null
  const resolved = form.get('resolved') !== '0'
  if (!setResolved(project.id, id, resolved, name)) return c.notFound()
  track(c, resolved ? 'resolve_thread' : 'reopen_thread')
  return backTo(c, project, id)
})

app.post('/projects/:id/threads/:thread/delete', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project || !removeThread(project.id, Number(c.req.param('thread')))) return c.notFound()
  track(c, 'delete_thread')
  return backTo(c, project)
})

app.post('/projects/:id/comments/:comment/edit', async (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project) return c.notFound()

  const form = await c.req.formData()
  const message = field(form.get('message'), MAX_MESSAGE)
  if (!message) return c.html(commentsPage(c, project, 'A comment cannot be empty.'), 400)

  const comment = editComment(project.id, Number(c.req.param('comment')), message)
  if (!comment) return c.notFound()
  track(c, 'edit_comment')
  return backTo(c, project, comment.thread_id)
})

app.post('/projects/:id/comments/:comment/delete', (c) => {
  const project = projectFor(c.get('user').id, c.req.param('id'))
  if (!project || !removeComment(project.id, Number(c.req.param('comment')))) return c.notFound()
  track(c, 'delete_comment')
  return backTo(c, project)
})

app.post('/projects/:id/delete', (c) => {
  const user = c.get('user')
  const { changes } = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(
    Number(c.req.param('id')),
    user.id,
  )
  if (changes) track(c, 'delete_project')
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
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${analytics()}${LANDING.replaceAll('https://teammate.jaan.to', publicOrigin(c))}</html>`,
      ),
)

panel.route('/', app)
