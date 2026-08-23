# Teammate Comment

Add one script tag to any webpage and let people select text, comment anonymously, discuss in
threads, resolve, and navigate all feedback from one sidebar.

Figma comments for text, without Figma.

```html
<script src="https://your-host/w/PROJECT_KEY.js"></script>
```

That is the entire integration. No npm package, no build step, no server-side install, no
framework. The project key rides in the script URL, so there is one string to copy and nothing
to mis-wire.

Two roles share one system. **Owners** sign up once, create a project per site, and copy a
snippet. **Commenters** never have an account and never meet a signup screen: they open a page
and start marking it up.

---

## Running it

Requires Node 22.18 or newer. The server runs TypeScript directly on `node`, so there is no
transpiler, no native modules, no database server, and no build step for the server. Only the
widget is bundled.

```bash
npm install
npm run build:widget
npm run start          # panel + API on http://localhost:8787
```

Open <http://localhost:8787>, create an account, create a project, copy the snippet.

`npm run dev` does the same with `node --watch` on the server. For the widget,
`npm run watch --workspace=widget` rebuilds the bundle on save; the server re-reads it on the
next request, so a browser reload is enough.

To run the bundled demo pages against it, on a genuinely different origin so CORS and the
domain gate are actually exercised:

```bash
TC_KEY=<your project key> node demo/serve.mjs   # http://localhost:5173
```

Create the project with domain `localhost` and both demo pages will be allowed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Panel and API |
| `TC_BIND` | `127.0.0.1` | Interface to listen on. Loopback by default: the process is meant to sit behind a proxy, and signup is open, so an exposed port is an open panel. Confirm with `ss -ltnp \| grep 8787` rather than trusting this row. |
| `TC_DB` | `../data/comments.db` | SQLite file, relative to the server's cwd |
| `TC_SECRET_FILE` | `../data/.secret` | Where the session key is generated and kept |
| `TC_SECRET` | unset | Session key given inline, overrides the file |
| `TC_PUBLIC_ORIGIN` | the request's own origin | Origin written into the snippet. **Required behind a proxy**, otherwise the panel emits `localhost` snippets that never load. |
| `NODE_ENV` | unset | `production` makes the session cookie `secure` |
| `DEMO_PORT` | `5173` | Demo static server |
| `TC_API` | `http://localhost:8787` | Where the demo pages point their script tag |

There is no automated test suite. The two demo pages are the manual harness, and they differ on
purpose — one light editorial serif, one `color-scheme: dark` — so theme resolution and contrast
get exercised against designs the widget does not control.

---

## Using it

On any page carrying the snippet:

| Gesture | What happens |
|---|---|
| Select text | A **Comment** pill appears at the end of the selection |
| `c`, with text selected | The same thing without the mouse. Ignored while you are typing in a field |
| Click a highlight | Opens its thread. Where highlights overlap the smallest range wins, being the most specific thing you could have been pointing at |
| 💬 launcher, bottom right | Opens the sidebar: every thread on the page in document order, open ones counted on the badge |
| `Esc` | Closes the composer or the open thread, then the sidebar |
| `#tc-<id>` in the URL | Opens that thread and scrolls to it on load |

Your name is asked once and kept locally. Threads take unlimited replies, resolve and reopen,
and comments can be edited or deleted. Deleting the last comment in a thread deletes the thread,
because a highlight with nothing behind it has no reason to exist.

Comments belong to a page, not to a link: `?utm_source=x` and `#section` resolve to the same
page as the bare URL.

The script tag takes exactly one option.

```html
<script src="https://your-host/w/PROJECT_KEY.js" data-theme="dark"></script>
```

Without it the widget reads the host page's computed `color-scheme`, then the reader's
`prefers-color-scheme`. It never samples background pixels and never tries to match the host's
palette. Theme is resolved once, at load.

**Browser support.** Painted highlights need the CSS Custom Highlight API: Chrome 105+,
Safari 17.2+, Firefox 140+. Below that the widget still loads and every thread is still
reachable from the sidebar; the text simply is not painted. Creating a selection-anchored
thread is desktop-only in V1, gated on `pointer: fine` — touch devices read, reply and resolve.

---

## Deploying

See [DEPLOY.md](DEPLOY.md). A VPS behind a Cloudflare Tunnel: no reverse proxy, no certificate
to manage, and no inbound ports open except SSH.

```bash
TC_HOST=you@your-vps ./deploy.sh
```

Builds the widget locally, ships the artifacts, restarts the service. The remote install is
three third-party packages — Hono, its node adapter, and Preact — because Vite and TypeScript
never reach the server.

---

## How it fits together

```
any webpage ──> widget.js ──> HTTP API ──> SQLite
                    │
                    ├── selection ──> composer ──> thread
                    ├── highlights (painted, never wrapped)
                    └── sidebar (document order)
```

| Route | Who calls it |
|---|---|
| `/w/<key>.js` | The host page. One bundle serves every project, revalidated by ETag, CORS open to every origin |
| `/api/*` | The widget. Every request carries `?key=`, and the requesting host is matched against the project's domain pattern before anything else runs |
| `/healthz` | Your process supervisor. Liveness only: no auth, no database, no upstream call |
| everything else | The owner panel: `/signin`, `/signup`, `/projects`, `/projects/:id`. Server-rendered HTML, no client JS |

```
package.json          npm workspaces
shared/               imported by BOTH sides, so the two cannot drift
  contract.ts         field caps, key alphabet, the snippet itself
  tokens.ts           design tokens, the single source
  url.ts              what counts as "the same page"
  time.ts             relative timestamps
server/src/
  index.ts            bundle serving, ETag revalidation, /healthz
  db.ts               four tables
  auth.ts             scrypt + signed cookie sessions
  domain.ts           forgiving input, strict matching
  api.ts              widget API, key + domain gated
  panel.ts            server-rendered owner panel
  views/layout.ts     panel shell and CSS
widget/src/
  index.tsx           key recovery, shadow root, theme, mount
  anchor.ts           flatten page, resolve anchors
  highlights.ts       per-segment intensity
  store.ts            state, optimistic writes
  theme.ts            three cheap reads, once at load
  App.tsx             selection, positioning, keyboard
  components/         composer, thread popup, sidebar
demo/                 two host pages with deliberately different designs
```

---

## Decisions worth knowing

**The key rides in the script URL.** It is not baked in at build time; the widget reads it back
out of `document.currentScript.src` at runtime. That is what lets one byte-identical, cacheable
bundle serve every project, and it removes the classic failure of a `data-` attribute that does
not match the `src` sitting next to it.

**Highlights never touch the host DOM.** They are painted with the CSS Custom Highlight API,
so copy-paste stays clean, find-in-page still matches highlighted text, and the host's CSS
cannot fight us. It also makes overlap tractable: wrapping overlapping ranges in elements is a
nesting problem with no good answer, painting them is arithmetic.

**Intensity counts open threads, not comments.** One selection with forty replies is one
concern and stays light. Three separate people flagging the same sentence is three, and goes
strong. Resolving steps it back down.

**Orphans are a state, not an error.** When the anchored text is edited away, the conversation
still happened. It moves to a labelled group in the sidebar rather than disappearing.

**The resolution ladder is short and deterministic.** Exact offsets, then quote-plus-context,
then orphan. No fuzzy similarity scoring: it buys a few recoveries in exchange for behaviour
nobody can predict, and a highlight landing confidently on the wrong sentence is worse than an
orphan the reader can judge.

**`rem` is banned inside the widget.** Inside a shadow root it still resolves against the host
page's root font size, which we do not control. The widget declares its own `font-size` and
uses `px` and `em` only.

**Amber means exactly one thing.** An open thread. Resolved is the absence of amber. It is
never borrowed for buttons, focus, emphasis, or install status.

---

## Trust model

**Anyone can edit or delete anything.** V1 is built for private projects with trusted
commenters. There are no per-comment ownership tokens and no moderation mode.

The domain allowlist is a scoping tool, not a security boundary. It keeps a key pasted on the
wrong site from writing into your project, and it is enforced against `Origin` or `Referer` —
headers a browser sets honestly and a script does not have to.

Both are the first things to change before exposing a project to strangers. See
[ROADMAP.md](ROADMAP.md).

---

## The rest of the docs

| | |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Who it is for, the job to be done, and what it refuses to become |
| [DESIGN.md](DESIGN.md) | The visual system both surfaces share: tokens, theme resolution, the amber rule |
| [DEPLOY.md](DEPLOY.md) | VPS, systemd, HTTPS, backups, and what to check when something is wrong |
| [ROADMAP.md](ROADMAP.md) | Shipped in V1, what blocks public use, and what is deliberately not planned |
