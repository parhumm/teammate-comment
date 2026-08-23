# Roadmap

V1 is deliberately scoped to **private projects, used internally**. Most of what is missing was
cut on purpose, because it was insurance against public traffic that does not exist yet.

Nothing below changes the shape of the data. Every item is additive.

---

## Shipped in V1

Select text, comment without an account, unlimited threaded replies with dates, resolve and
reopen, edit, delete, click a highlight to open its thread, sidebar in document order, graded
highlight intensity, orphan recovery, light/dark adaptation to the host page, owner accounts,
unlimited projects, wildcard domains, live install detection.

---

## Before anyone outside your team uses this

These are the blockers. In order.

### 1. A real trust model

Today **anyone can edit or delete anything**. One careless or hostile visitor can erase a page
of feedback, anonymously and permanently.

The V1-compatible fix, roughly a day:

- A random token in `localStorage`, hashed into a new `comments.author_token_hash` column.
- Edit and Delete render only on your own comments.
- Owner moderation reuses the existing session: if the visitor holds a valid owner cookie for
  the project, expose Delete on everything and show an `Owner controls active` bar.

The UI already has the shape for this. Nothing needs redesigning.

### 2. Rate limiting

No limits exist. A per-IP token bucket in SQLite is enough, and it needs a decision on what
happens when the bucket empties: silent drop reads as a bug, so it should say so.

### 3. Password recovery

There is no reset flow at all. Losing the password means editing the SQLite file. Fine while
you are the only account; unacceptable the moment a second person has one.

Cheapest fix that avoids SMTP: a recovery code generated at signup and shown once. Roughly one
column and one screen state.

### 4. Comment moderation surface

There is no way to see or remove spam without opening each page. Even a flat list of recent
comments per project, with delete, would be enough.

---

## Then

**Mobile comment creation.** Reading, replying, and resolving already work on touch, and the
sidebar becomes a bottom sheet. What is missing is creating a selection-anchored thread,
because the native iOS and Android selection callout cannot be suppressed and any workaround is
brittle across Safari versions. This was the single most fragile thing in the original plan and
deserves its own dedicated pass, not a corner of another one.

**Highlight fallback for older browsers.** The CSS Custom Highlight API needs Chrome 105+,
Safari 17.2+, Firefox 140+. Below that the widget currently loads without highlights; the
sidebar still works. A `<span>`-splitting fallback would restore them at the cost of mutating
host DOM, which is exactly what V1 refuses to do. Worth it only if real users show up on old
browsers.

**Fuzzy anchor matching.** A fifth rung using similarity scoring would recover a few more edits
that the current ladder orphans. Deliberately deferred: unpredictable recovery is worse than a
visible orphan, so this needs real orphan data before it is worth building.

**Live theme switching.** Theme resolves once at load. A host page that toggles dark mode at
runtime is picked up on the next reload. A `MutationObserver` on `<html>` would fix it.

**Sidebar virtualization.** The list renders every thread. Fine at dozens, not at hundreds.

**Offline queue.** A failed submit currently offers inline retry with the text preserved.
Queueing and sending on reconnect would be better.

**Copy link to a thread.** Deep links already work (`#tc-<id>` opens and scrolls to a thread on
load). What is missing is the button that hands you the URL.

**Live updates.** Comments load on page open and after your own writes. Two people on the same
page do not see each other until reload. Polling would cover it; WebSockets are almost
certainly overkill.

---

## Not planned

Kept out on purpose, and worth re-reading before adding any of them:

accounts for commenters, email, notifications, mentions, teams, roles, attachments, reactions,
rich text, version history, analytics dashboards, third-party integrations, and the W3C Web
Annotation data model.

Each one is individually reasonable and collectively they are a different product.
