import { tokenBlock } from '../../shared/tokens.ts'

/**
 * Everything here lives inside a shadow root, so the host page's CSS cannot
 * reach in and ours cannot leak out.
 *
 * One rule that is easy to get wrong: `rem` inside a shadow root still resolves
 * against the *host page's* root font size, which we do not control. A host
 * with `html { font-size: 10px }` would shrink the entire widget. So the host
 * element declares an explicit font-size and every measurement below is px or
 * em. There is no `rem` in this file, deliberately.
 *
 * Amber appears in exactly three places: the open-thread dot, the unresolved
 * count, and the highlights (which are painted into the host document, not
 * here). It is never used for buttons, focus, hover or emphasis, because the
 * moment it means two things it means nothing.
 */
export const widgetCss = `
${tokenBlock(':host')}

:host {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: var(--tc-font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--tc-text-1);
  -webkit-font-smoothing: antialiased;
  text-align: left;
}

*, *::before, *::after { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }

.pill, .popup, .launcher, .sidebar { pointer-events: auto; }

/* ---------------------------------------------------------------- pulse -- */

.pulse {
  position: fixed;
  background: var(--tc-hl-3);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0;
}

/* ------------------------------------------------- selection affordance -- */

/* The only element that appears without being asked for, so it is the most
   restrained thing in the widget: one control, one word. */
.pill {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-pill);
  background: var(--tc-surface-0);
  box-shadow: var(--tc-shadow);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  animation: rise var(--tc-fast) var(--tc-ease) both;
}
.pill:hover { background: var(--tc-surface-2); }

@keyframes rise {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes rise { from { opacity: 0; } to { opacity: 1; } }
}

/* --------------------------------------------------------------- popup -- */

/* The one place a shadow and a radius are earned: this genuinely floats above
   the document rather than sitting in it. */
.popup {
  position: absolute;
  width: 340px;
  max-width: calc(100vw - 24px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--tc-surface-0);
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-panel);
  box-shadow: var(--tc-shadow);
  overflow: hidden;
  animation: pop var(--tc-base) var(--tc-ease) both;
}

@keyframes pop {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes pop { from { opacity: 0; } to { opacity: 1; } }
}

.quote {
  font-size: 12px;
  color: var(--tc-text-2);
  padding: var(--tc-s3) var(--tc-s3) 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.quote::before { content: '\\201C'; }
.quote::after { content: '\\201D'; }

.scroll { overflow-y: auto; padding: var(--tc-s3); display: grid; gap: var(--tc-s3); }

/* -------------------------------------------------------------- comment -- */

.comment { display: grid; gap: 3px; }
.comment.is-pending { opacity: 0.55; }

.byline {
  display: flex;
  align-items: baseline;
  gap: var(--tc-s2);
  font-size: 11.5px;
  color: var(--tc-text-3);
  font-variant-numeric: tabular-nums;
}
.byline .who { font-size: 13px; font-weight: 600; color: var(--tc-text-1); }
.byline .actions { margin-left: auto; display: flex; gap: var(--tc-s2); opacity: 0; }
.comment:hover .byline .actions,
.comment:focus-within .byline .actions { opacity: 1; }

.message {
  font-size: 13.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 62ch;
}

.link {
  background: none;
  border: 0;
  padding: 0;
  font-size: 11.5px;
  color: var(--tc-text-3);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.link:hover { color: var(--tc-text-1); }
.link.danger:hover { color: var(--tc-danger); }

.retry {
  font-size: 11.5px;
  color: var(--tc-danger);
  display: flex;
  gap: var(--tc-s2);
  align-items: baseline;
}

/* ------------------------------------------------------------- composer -- */

.composer { display: grid; gap: var(--tc-s2); }

.composer input, .composer textarea {
  width: 100%;
  font-size: 13.5px;
  background: var(--tc-surface-2);
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-control);
  padding: 8px 10px;
  resize: vertical;
}
.composer textarea { min-height: 68px; line-height: 1.45; }
.composer input:focus, .composer textarea:focus {
  outline: none;
  border-color: var(--tc-text-3);
}

.row-end { display: flex; align-items: center; gap: var(--tc-s2); justify-content: flex-end; }

.btn {
  border: 1px solid transparent;
  border-radius: var(--tc-r-control);
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: var(--tc-action-bg);
  color: var(--tc-action-fg);
  transition: opacity var(--tc-fast) var(--tc-ease);
}
.btn:hover { opacity: var(--tc-hover-opacity); }
.btn[disabled] { opacity: 0.4; cursor: default; }
.btn.ghost { background: transparent; color: var(--tc-text-1); border-color: var(--tc-border); }

:where(button, input, textarea, [tabindex]):focus-visible {
  outline: var(--tc-focus-width) solid var(--tc-signal);
  outline-offset: var(--tc-focus-offset);
}

/* ------------------------------------------------------------- launcher -- */

/* Presence tracks activity: with nothing to show this is a small neutral
   marker, and it only earns amber once there is something open. */
.launcher {
  position: absolute;
  right: 20px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--tc-border);
  border-radius: var(--tc-r-pill);
  background: var(--tc-surface-0);
  box-shadow: var(--tc-shadow);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.launcher:hover { background: var(--tc-surface-2); }
.launcher .count {
  font-variant-numeric: tabular-nums;
  color: var(--tc-signal-text);
  font-weight: 600;
}
.launcher.is-error { color: var(--tc-text-3); }

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tc-signal);
  flex: none;
}
.dot.is-resolved { background: none; border: 1.5px solid var(--tc-text-3); }

/* -------------------------------------------------------------- sidebar -- */

.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  background: var(--tc-surface-1);
  border-left: 1px solid var(--tc-border);
  box-shadow: var(--tc-shadow);
  animation: slide var(--tc-slow) var(--tc-ease) both;
}

@keyframes slide {
  from { transform: translateX(12px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes slide { from { opacity: 0; } to { opacity: 1; } }
}

.sidebar-top {
  display: flex;
  align-items: baseline;
  gap: var(--tc-s2);
  padding: var(--tc-s3) var(--tc-s3) var(--tc-s3) var(--tc-s4);
  border-bottom: 1px solid var(--tc-border-subtle);
}
.sidebar-top h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.sidebar-top .link { margin-left: auto; }

.sidebar-scroll { overflow-y: auto; flex: 1; }

/* Hairlines and whitespace, never cards. A card per reply inside a card per
   thread is the obvious wrong answer. */
.thread {
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--tc-border-subtle);
  padding: var(--tc-s3) var(--tc-s3) var(--tc-s3) var(--tc-s4);
  cursor: pointer;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--tc-s2);
}
.thread:hover { background: var(--tc-surface-0); }
.thread.is-active { background: var(--tc-surface-0); }
.thread .dot { grid-row: 1; margin-top: 6px; }
.thread .who { font-size: 13px; font-weight: 600; }
.thread .when { font-size: 11.5px; color: var(--tc-text-3); font-variant-numeric: tabular-nums; }
.thread .head { display: flex; align-items: baseline; gap: var(--tc-s2); }
.thread .excerpt {
  grid-column: 2;
  font-size: 13px;
  color: var(--tc-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.thread .replies { grid-column: 2; font-size: 11.5px; color: var(--tc-text-3); margin-top: 2px; }
.thread.is-resolved .who, .thread.is-resolved .excerpt { color: var(--tc-text-3); }

.group {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tc-text-3);
  padding: var(--tc-s4) var(--tc-s4) var(--tc-s2);
}
.group-note {
  font-size: 12px;
  color: var(--tc-text-3);
  padding: 0 var(--tc-s4) var(--tc-s3);
}

.state {
  padding: var(--tc-s5) var(--tc-s4);
  font-size: 13.5px;
  color: var(--tc-text-2);
  max-width: 40ch;
}
.state .btn { margin-top: var(--tc-s3); }

/* Below the sidebar's own width, a right-edge panel stops making sense and it
   becomes a bottom sheet. */
@media (max-width: 480px) {
  .sidebar {
    top: auto;
    left: 0;
    height: 72vh;
    width: auto;
    border-left: 0;
    border-top: 1px solid var(--tc-border);
    border-radius: var(--tc-r-panel) var(--tc-r-panel) 0 0;
  }
  @keyframes slide {
    from { transform: translateY(16px); opacity: 0; }
    to   { transform: none; opacity: 1; }
  }
  .popup { width: calc(100vw - 24px); }
  .launcher { right: 12px; bottom: 12px; }
}

/* Coarse pointers get the 44px minimum target, independent of viewport width:
   a small window on a desktop is not the same thing as a finger. */
@media (pointer: coarse) {
  .launcher { height: 44px; padding: 0 16px; }
  .link { padding: 6px 0; }
  .btn { padding: 10px 14px; }
  .thread { padding-top: var(--tc-s3); padding-bottom: var(--tc-s3); }
}
`
