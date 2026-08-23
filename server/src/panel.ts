import { Hono } from 'hono'
import { db, type Project, type User } from './db.ts'
import { hashPassword, verifyPassword, startSession, endSession, currentUser, newProjectKey } from './auth.ts'
import { normalizeDomain, parsePattern, describeMatch, DomainError } from './domain.ts'
import { layout, escapeHtml } from './views/layout.ts'
import { relativeTime, readableTime, agoPhrase } from '../../shared/time.ts'
import { embedSnippet } from '../../shared/contract.ts'

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

app.get('/projects/:id', (c) => {
  const user = c.get('user')
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(Number(c.req.param('id')), user.id) as Project | undefined

  if (!project) return c.notFound()

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

  return c.html(
    layout(
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

<div class="section">
  <h2>Pages</h2>
  ${pagesSection}
</div>
`,
      { title: project.name, signedIn: true },
    ),
  )
})

app.post('/projects/:id/delete', (c) => {
  const user = c.get('user')
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(
    Number(c.req.param('id')),
    user.id,
  )
  return c.redirect('/projects')
})

panel.route('/', app)

panel.get('/', (c) => c.redirect(currentUser(c) ? '/projects' : '/signin'))
