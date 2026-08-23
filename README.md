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

---

## Running it

Requires Node 22 or newer (`node:sqlite` and `node --run` era). No native modules, no database
server, no build step for the server.

```bash
npm install
npm run build:widget
npm run start          # panel + API on http://localhost:8787
```

Open <http://localhost:8787>, create an account, create a project, copy the snippet.

To run the bundled demo pages against it, on a genuinely different origin so CORS and the
domain gate are actually exercised:

```bash
TC_KEY=<your project key> node demo/serve.mjs   # http://localhost:5173
```

Create the project with domain `localhost` and both demo pages will be allowed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Panel and API |
| `TC_DB` | `../data/comments.db` | SQLite file |
| `TC_SECRET` | generated into `data/.secret` | Session signing key |
| `TC_PUBLIC_ORIGIN` | request origin | Origin written into the snippet |
| `DEMO_PORT` | `5173` | Demo static server |

---

## How it fits together

```
any webpage ──> widget.js ──> HTTP API ──> SQLite
                    │
                    ├── selection ──> composer ──> thread
                    ├── highlights (painted, never wrapped)
                    └── sidebar (document order)
```

```
package.json          npm workspaces
shared/               tokens, time, url  (imported by BOTH sides)
server/src/
  db.ts               four tables
  auth.ts             scrypt + signed cookie sessions
  domain.ts           forgiving input, strict matching
  api.ts              widget API, key + domain gated
  panel.ts            server-rendered owner panel
  views/layout.ts     panel shell and CSS
widget/src/
  anchor.ts           flatten page, resolve anchors
  highlights.ts       per-segment intensity
  store.ts            state, optimistic writes
  App.tsx             selection, positioning, keyboard
demo/                 two host pages with deliberately different designs
```

---

## Decisions worth knowing

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

This is the first thing to change before exposing a project to strangers. See
[ROADMAP.md](ROADMAP.md).
