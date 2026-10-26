import { tokenBlock } from '../../../shared/tokens.ts'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The panel owns its page, so system preference alone decides its adaptation.
 * Only the widget has to negotiate with a host it does not control.
 *
 * No cards anywhere: hairlines and whitespace separate things instead. Amber is
 * reserved for open threads and never borrowed for install status or emphasis,
 * because it carries exactly one meaning across both surfaces.
 */
const CSS = `
${tokenBlock(':root')}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--tc-surface-1);
  color: var(--tc-text-1);
  font-family: var(--tc-font);
  font-size: 15px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; }
/* New tab, said once for every link that opens one. The arrow is not read out. */
a[target=_blank]::after { content: '\\2009\\2197'; content: '\\2009\\2197' / ''; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--tc-s3);
  padding: var(--tc-s4) var(--tc-s4) var(--tc-s3);
  border-bottom: 1px solid var(--tc-border-subtle);
  margin-bottom: var(--tc-s5);
}
.mark {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-decoration: none;
}
.mark span { color: var(--tc-text-3); font-weight: 500; }

.wrap { max-width: 880px; margin: 0 auto; padding: 0 var(--tc-s4) var(--tc-s5); }
.narrow { max-width: 380px; }

h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 0 0 var(--tc-s2);
}
.lede { color: var(--tc-text-2); margin: 0 0 var(--tc-s4); font-size: 14px; }

label { display: block; font-size: 12px; font-weight: 500; margin-bottom: var(--tc-s1); }
.field { margin-bottom: var(--tc-s3); }

input[type=text], input[type=email], input[type=password], textarea {
  width: 100%;
  font: inherit;
  font-size: 14px;
  color: var(--tc-text-1);
  background: var(--tc-surface-2);
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-control);
  padding: 9px 11px;
  transition: border-color var(--tc-fast) var(--tc-ease);
}
textarea { display: block; min-height: 72px; resize: vertical; line-height: 1.5; }
/* Ink, never amber: amber means an open thread and nothing else. */
button:focus-visible, a:focus-visible, summary:focus-visible {
  outline: var(--tc-focus-width) solid var(--tc-text-1);
  outline-offset: 2px;
}
input:focus, textarea:focus {
  border-color: var(--tc-text-1);
  box-shadow: 0 0 0 1px var(--tc-text-1);
  outline: none;
}

/* Readable text never goes below --tc-text-2: --tc-text-3 is under 4.5:1 on the light surface. */
.hint { font-size: 12px; color: var(--tc-text-2); margin-top: var(--tc-s1); }
.hint code { font-family: var(--tc-mono); font-size: 11.5px; }

button, .btn {
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: var(--tc-r-control);
  padding: 9px 14px;
  cursor: pointer;
  background: var(--tc-action-bg);
  color: var(--tc-action-fg);
  text-decoration: none;
  display: inline-block;
  transition: opacity var(--tc-fast) var(--tc-ease), transform var(--tc-fast) var(--tc-ease);
}
button:hover, .btn:hover { opacity: var(--tc-hover-opacity); }
button:active, .btn:active { transform: translateY(1px); }
button.ghost, .btn.ghost {
  background: transparent;
  color: var(--tc-text-1);
  border-color: var(--tc-border);
}
button.ghost:hover, .btn.ghost:hover { border-color: var(--tc-text-2); opacity: 1; }
/* Text actions. The vertical padding is hit area, not looks. */
button.quiet, .quiet, .tools a {
  background: transparent;
  color: var(--tc-text-2);
  border: 0;
  padding: 4px 0;
  font-size: 12px;
  text-decoration: underline;
  text-decoration-color: var(--tc-border);
  text-underline-offset: 3px;
}
button.quiet:hover, .quiet:hover, .tools a:hover { color: var(--tc-text-1); text-decoration-color: currentColor; opacity: 1; }
button.danger { background: transparent; color: var(--tc-danger); border-color: var(--tc-border); }
button.danger:hover { border-color: var(--tc-danger); opacity: 1; }
button.quiet.danger:hover { color: var(--tc-danger); }
button.wide { width: 100%; }
/* A form that is on its way: one press, and it says so. */
form[aria-busy] button { opacity: 0.6; cursor: progress; }

.error {
  font-size: 13px;
  color: var(--tc-danger);
  border: 1px solid var(--tc-danger);
  border-radius: var(--tc-r-control);
  padding: var(--tc-s2) var(--tc-s3);
  margin-bottom: var(--tc-s3);
}
.error a { font-weight: 500; }

.alt { font-size: 13px; color: var(--tc-text-2); margin-top: var(--tc-s4); }

/* Lists are hairline-separated rows, never cards. */
.rows { border-top: 1px solid var(--tc-border-subtle); }
.row {
  display: flex;
  align-items: baseline;
  gap: var(--tc-s3);
  padding: var(--tc-s3) 0;
  border-bottom: 1px solid var(--tc-border-subtle);
  text-decoration: none;
}
.row:hover .row-name { text-decoration: underline; text-underline-offset: 3px; }
.row-name { font-weight: 600; font-size: 15px; }
.row-domain { font-family: var(--tc-mono); font-size: 12px; color: var(--tc-text-2); }
.row-meta {
  margin-left: auto;
  display: flex;
  gap: var(--tc-s3);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--tc-text-2);
  white-space: nowrap;
}
.open-count { color: var(--tc-signal-text); font-weight: 600; }
.open-count::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--tc-signal);
  margin-right: 5px;
  vertical-align: 1px;
}

.empty {
  color: var(--tc-text-2);
  font-size: 14px;
  padding: var(--tc-s5) 0;
  border-top: 1px solid var(--tc-border-subtle);
}
.empty b { color: var(--tc-text-1); font-weight: 600; }
.empty svg { width: 15px; height: 15px; vertical-align: -2px; margin-right: var(--tc-s1); }

/* The snippet is the reason the panel exists, so it gets the most weight. */
.snippet-label {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: var(--tc-s2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.snippet {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-panel);
  background: var(--tc-surface-2);
  overflow: hidden;
}
.snippet code {
  flex: 1;
  min-width: 0;
  font-family: var(--tc-mono);
  font-size: 12.5px;
  line-height: 1.6;
  padding: var(--tc-s3);
  overflow-x: auto;
  white-space: pre;
  color: var(--tc-text-2);
}
/* The part that is this project's own reads loudest. */
.snippet code b { color: var(--tc-text-1); font-weight: 400; }
.snippet button {
  border-radius: 0;
  border-left: 1px solid var(--tc-border);
  background: transparent;
  color: var(--tc-text-1);
  font-size: 13px;
  min-width: 84px;
  padding: 0 var(--tc-s4);
  flex: none;
}
.snippet button:hover { background: var(--tc-surface-1); opacity: 1; }
.snippet button:active { transform: none; background: var(--tc-border-subtle); }
.snippet button[data-done] { font-weight: 600; }
.copy-fallback { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }

/* Install status is deliberately neutral. Amber means an open thread, and
   borrowing it here would make it mean two things. */
.status {
  display: flex;
  align-items: center;
  gap: var(--tc-s2);
  font-size: 13px;
  margin-top: var(--tc-s3);
  color: var(--tc-text-2);
}
.status .dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--tc-text-3);
  flex: none;
}
.status.on { color: var(--tc-text-1); }
.status.on .dot { border-color: var(--tc-text-1); background: var(--tc-text-1); }
.status b { font-weight: 600; }
/* Something on this page is watching for an event elsewhere. The pulse is that state. */
.status.listening .dot { animation: listen 1.4s var(--tc-ease) infinite alternate; }
@keyframes listen { to { opacity: 0.3; } }
.status.arrived span:last-child { animation: arrive var(--tc-slow) var(--tc-ease); }
@keyframes arrive { from { opacity: 0; transform: translateY(3px); } }

.actions { display: flex; align-items: center; gap: var(--tc-s3); margin-top: var(--tc-s3); }
.hint.danger { color: var(--tc-danger); margin-top: var(--tc-s2); }
.field.token input { max-width: 480px; font-family: var(--tc-mono); font-size: 13px; }
.steps { margin: 0 0 var(--tc-s4); padding-left: 20px; font-size: 13px; color: var(--tc-text-2); }
.steps li { margin-bottom: var(--tc-s1); }
.steps b { color: var(--tc-text-1); font-weight: 500; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tc-text-2);
  padding: 0 var(--tc-s3) var(--tc-s2) 0;
  border-bottom: 1px solid var(--tc-border-subtle);
}
td {
  padding: var(--tc-s2) var(--tc-s3) var(--tc-s2) 0;
  border-bottom: 1px solid var(--tc-border-subtle);
  vertical-align: baseline;
}
td.num, th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  padding-left: var(--tc-s3);
  padding-right: 0;
}
td.page { overflow-wrap: anywhere; }
td a { font-family: var(--tc-mono); font-size: 12px; }
td a:not(:hover) { text-decoration-color: var(--tc-border); }
td.num a { font-family: inherit; }
/* A page address as the owner scans it: the path is the part that differs. */
.host { color: var(--tc-text-2); }

.section { margin-top: var(--tc-s5); }
.section h2 {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tc-text-2);
  margin: 0 0 var(--tc-s3);
}
.section > .lede { font-size: 13px; max-width: 68ch; margin-bottom: var(--tc-s3); }
.back {
  font-size: 12px;
  color: var(--tc-text-2);
  text-decoration: none;
  display: inline-block;
  padding: 4px 0;
  margin-bottom: var(--tc-s2);
}
.back::before { content: '\\2190\\2009'; }
.back:hover { color: var(--tc-text-1); }
.split { display: flex; align-items: baseline; justify-content: space-between; gap: var(--tc-s3); }

/* Notification channels: a row each, opened only when there is something to do. */
.channel { border-top: 1px solid var(--tc-border-subtle); }
.channel:last-child { border-bottom: 1px solid var(--tc-border-subtle); }
.channel summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--tc-s1) var(--tc-s3);
  padding: var(--tc-s3) 0;
}
.channel summary b { font-weight: 600; display: flex; align-items: center; gap: var(--tc-s2); }
.channel summary .logo { width: 16px; height: 16px; }
.channel summary .meta { color: var(--tc-text-2); font-size: 13px; }
.channel summary .go { margin-left: auto; font-size: 13px; color: var(--tc-text-2); }
.channel summary .go::after { content: '\\2009\\203A'; display: inline-block; transition: transform var(--tc-fast) var(--tc-ease); }
.channel summary:hover .go { color: var(--tc-text-1); }
.channel[open] summary .go::after { transform: rotate(90deg); }
.channel[open] summary .go .closed, .channel:not([open]) summary .go .opened { display: none; }
.channel-body { padding: 0 0 var(--tc-s4); }
.channel-body .status { margin-top: 0; }

.danger-zone { display: flex; align-items: center; flex-wrap: wrap; gap: var(--tc-s2) var(--tc-s3); padding-top: var(--tc-s4); border-top: 1px solid var(--tc-border-subtle); }
.danger-zone form { margin: 0; }
.danger-zone .hint { margin: 0; }

/* Comments: one thread per block, hairlines between. */
.tabs { display: flex; gap: var(--tc-s4); font-size: 13px; border-bottom: 1px solid var(--tc-border-subtle); }
.tabs a { text-decoration: none; color: var(--tc-text-2); padding: var(--tc-s1) 0 var(--tc-s2); margin-bottom: -1px; }
.tabs a:hover { color: var(--tc-text-1); }
.tabs a[aria-current] { color: var(--tc-text-1); font-weight: 500; border-bottom: 1.5px solid var(--tc-text-1); }
.page-head { flex-wrap: wrap; row-gap: var(--tc-s1); }
.page-url { font-family: var(--tc-mono); font-size: 12px; overflow-wrap: anywhere; text-decoration-color: var(--tc-border); text-underline-offset: 3px; }
.tools { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--tc-s3); margin-left: auto; }
.tools form { margin: 0; }
.tools details[open] { flex-basis: 100%; }
.tools details form { margin-top: var(--tc-s2); display: grid; gap: var(--tc-s2); justify-items: start; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
.thread { padding: var(--tc-s3) 0 var(--tc-s4); border-top: 1px solid var(--tc-border-subtle); }
/* The thread a post just came back to, so the eye lands on what changed. */
.thread:target { animation: landed 1.6s var(--tc-ease); }
@keyframes landed { from { background: var(--tc-border-subtle); box-shadow: -12px 0 0 var(--tc-border-subtle), 12px 0 0 var(--tc-border-subtle); } }
.thread .byline { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--tc-s2); font-size: 12px; }
.thread .byline b { font-size: 13px; font-weight: 600; }
.thread .byline > a { color: var(--tc-text-2); }
.when { color: var(--tc-text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
/* The quote is painted the way the widget paints it on the page: amber while
   open, and without amber once resolved. */
.thread blockquote {
  margin: var(--tc-s2) 0 var(--tc-s3);
  font-size: 13.5px;
  line-height: 1.7;
  max-width: 68ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.thread blockquote mark {
  background: var(--tc-hl-1);
  color: var(--tc-text-1);
  padding: 2px 1px;
  border-radius: 2px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.thread.is-resolved blockquote mark { background: var(--tc-border-subtle); }
.thread.is-resolved .message { color: var(--tc-text-2); }
.comment { margin-top: var(--tc-s3); }
.comment .tools { margin-left: 0; margin-top: var(--tc-s1); }
.message { margin: var(--tc-s1) 0 0; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 68ch; }
.reply { margin-top: var(--tc-s3); }
.reply summary { font-size: 13px; padding: 6px 12px; }
.reply[open] summary { display: none; }
.reply form { max-width: 520px; }

@media (max-width: 560px) {
  .row { flex-wrap: wrap; }
  .row-meta { margin-left: 0; width: 100%; }
  .col-resolved { display: none; }
  .channel summary .meta { order: 1; flex-basis: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .status.listening .dot, .status.arrived span:last-child, .thread:target { animation: none; }
}
`

/**
 * Copy, plus the one-press guard every form gets. The guard matters most on
 * Connect and Send test, which wait on Telegram or Slack before answering.
 */
const PAGE_JS = `
var live = document.getElementById('live');
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  var id = btn.getAttribute('data-copy');
  var source = document.getElementById(id);
  var idle = btn.getAttribute('data-idle') || btn.textContent;
  btn.setAttribute('data-idle', idle);
  Promise.resolve().then(function () {
    return navigator.clipboard.writeText(source.textContent);
  }).then(function () {
    if (window.gtag) gtag('event', 'copy_' + id.split('-')[0]);
    btn.textContent = 'Copied';
    btn.setAttribute('data-done', '');
    live.textContent = 'Copied to clipboard';
    clearTimeout(btn.copyTimer);
    btn.copyTimer = setTimeout(function () {
      btn.textContent = idle;
      btn.removeAttribute('data-done');
      live.textContent = '';
    }, 1600);
  }, function () {
    if (source.hidden) {
      source.hidden = false;
      source.classList.add('copy-fallback');
    }
    getSelection().selectAllChildren(source);
    live.textContent = 'Could not copy automatically. Text selected; use your device’s Copy command.';
  });
});
document.addEventListener('submit', function (e) {
  if (e.defaultPrevented) return;
  var form = e.target;
  if (form.hasAttribute('aria-busy')) return e.preventDefault();
  form.setAttribute('aria-busy', 'true');
  var btn = e.submitter;
  if (btn && btn.getAttribute('data-busy')) {
    btn.setAttribute('data-idle', btn.textContent);
    btn.textContent = btn.getAttribute('data-busy');
  }
});
// Every post comes back to #telegram or #slack. A collapsed channel opens to show what changed.
function openHash() {
  var target = location.hash && document.getElementById(location.hash.slice(1));
  if (target && target.tagName === 'DETAILS') target.open = true;
}
openHash();
addEventListener('hashchange', openHash);
// Back from the next page restores this one as it was left, mid-submit.
addEventListener('pageshow', function (e) {
  if (!e.persisted) return;
  document.querySelectorAll('form[aria-busy]').forEach(function (form) {
    form.removeAttribute('aria-busy');
    form.querySelectorAll('[data-busy][data-idle]').forEach(function (b) { b.textContent = b.getAttribute('data-idle'); });
  });
});
`

/** The landing page's mark in panel ink, light on a dark tab strip. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><style>.b{fill:#2b2724}.l{stroke:#f6f3ea}@media(prefers-color-scheme:dark){.b{fill:#efebe3}.l{stroke:#2b2724}}</style><path class="b" d="M3 1.5h12A2.5 2.5 0 0 1 17.5 4v7.5A2.5 2.5 0 0 1 15 14H8.5l-4.5 3v-3H3A2.5 2.5 0 0 1 .5 11.5V4A2.5 2.5 0 0 1 3 1.5z"/><path class="l" d="M4.5 6h9M4.5 9.5h5.5" stroke-width="1.6" stroke-linecap="round"/></svg>`,
)}`

/**
 * GA4, only where TC_GA_ID is set, so a self-hosted copy reports to no one.
 * The server names an event in the short-lived tc_ev cookie once an action has
 * worked (track in panel.ts), and the next page sends it.
 */
export function analytics(): string {
  const id = process.env.TC_GA_ID
  if (!id) return ''
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');
var tcEvent = document.cookie.match(/(?:^|; )tc_ev=(\\w+)/);
if (tcEvent) {
  document.cookie = 'tc_ev=; Max-Age=0; Path=/';
  gtag('event', tcEvent[1]);
}
</script>`
}

export interface LayoutOptions {
  title: string
  signedIn?: boolean
  narrow?: boolean
}

export function layout(body: string, { title, signedIn, narrow }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · Teammate</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
${analytics()}
</head>
<body>
<header class="top">
  <a class="mark" href="/">Teammate <span>comments</span></a>
  ${
    signedIn
      ? `<form method="post" action="/signout"><button class="quiet" type="submit">Sign out</button></form>`
      : ''
  }
</header>
<main class="wrap${narrow ? ' narrow' : ''}">
${body}
</main>
<p id="live" class="sr-only" aria-live="polite"></p>
<script>${PAGE_JS}</script>
</body>
</html>`
}
