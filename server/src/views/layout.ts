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
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; }

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

input[type=text], input[type=email], input[type=password] {
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
input:focus-visible, button:focus-visible, a:focus-visible {
  outline: var(--tc-focus-width) solid var(--tc-signal);
  outline-offset: var(--tc-focus-offset);
}
input:focus { border-color: var(--tc-text-3); outline: none; }

.hint { font-size: 12px; color: var(--tc-text-3); margin-top: var(--tc-s1); }
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
  transition: opacity var(--tc-fast) var(--tc-ease);
}
button:hover, .btn:hover { opacity: var(--tc-hover-opacity); }
button.ghost, .btn.ghost {
  background: transparent;
  color: var(--tc-text-1);
  border-color: var(--tc-border);
}
button.quiet {
  background: transparent;
  color: var(--tc-text-3);
  border: 0;
  padding: 0;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
button.danger { background: transparent; color: var(--tc-danger); border-color: var(--tc-border); }
button.wide { width: 100%; }

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
.row:hover .row-name { text-decoration: underline; text-underline-offset: 2px; }
.row-name { font-weight: 600; font-size: 15px; }
.row-domain { font-family: var(--tc-mono); font-size: 12px; color: var(--tc-text-3); }
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
  font-family: var(--tc-mono);
  font-size: 12.5px;
  line-height: 1.6;
  padding: var(--tc-s3);
  overflow-x: auto;
  white-space: pre;
}
.snippet button {
  border-radius: 0;
  border-left: 1px solid var(--tc-border);
  background: transparent;
  color: var(--tc-text-1);
  font-size: 12px;
  padding: 0 var(--tc-s3);
  flex: none;
}
.snippet button:hover { background: var(--tc-surface-1); opacity: 1; }

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

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tc-text-3);
  padding: 0 var(--tc-s3) var(--tc-s2) 0;
  border-bottom: 1px solid var(--tc-border-subtle);
}
td {
  padding: var(--tc-s2) var(--tc-s3) var(--tc-s2) 0;
  border-bottom: 1px solid var(--tc-border-subtle);
  vertical-align: baseline;
}
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 0; }
td a { font-family: var(--tc-mono); font-size: 12px; }

.section { margin-top: var(--tc-s5); }
.section h2 {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tc-text-3);
  margin: 0 0 var(--tc-s3);
}
.back {
  font-size: 12px;
  color: var(--tc-text-3);
  text-decoration: none;
  display: inline-block;
  margin-bottom: var(--tc-s3);
}
.back:hover { color: var(--tc-text-1); }
.split { display: flex; align-items: baseline; justify-content: space-between; gap: var(--tc-s3); }

@media (max-width: 560px) {
  .row { flex-wrap: wrap; }
  .row-meta { margin-left: 0; width: 100%; }
}
`

const COPY_JS = `
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  var text = document.getElementById(btn.getAttribute('data-copy')).textContent;
  navigator.clipboard.writeText(text).then(function () {
    var was = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () { btn.textContent = was; }, 1600);
  });
});
`

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
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
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
<script>${COPY_JS}</script>
</body>
</html>`
}
