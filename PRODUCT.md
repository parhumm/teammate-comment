# Product

## Register

product

## Users

Two groups, one account between them.

**The owner** (me, and later other developers and designers) installing the widget on sites
I control. Signs up once, creates a project per site, copies a snippet. Visits the panel
rarely: once at setup, then occasionally. Success is measured in seconds from signup to a
working script tag.

**Commenters** (teammates, clients, collaborators) marking up staging sites, drafts, and
deliverables. **No account, ever.** They arrive expecting to annotate. Desktop, in a focused
review session, leaving many comments quickly and seeing what others already flagged.

The job to be done: attach a durable, findable conversation to a specific piece of text on a
page, with no account and no setup for the people doing the talking.

## Product Purpose

Add one script tag to any webpage and let people select text, comment anonymously, discuss in
threads, resolve, and navigate all feedback from one sidebar.

The integration is client-side only. No npm package, no build step, no server-side install, no
framework. One script tag on static HTML is the entire surface area the owner touches, and the
project key rides in the script URL so there is a single string to copy and nothing to mis-wire.

## Brand Personality

Precise, unobtrusive, legible.

The widget is an instrument laid over someone else's document. It is confident about being a
separate layer and never pretends to be part of the host page. It states things plainly, never
explains itself twice, and disappears the moment the user is done with it.

## Anti-references

- Intercom, Drift, and every chat bubble that pulses for attention. This never solicits.
- Disqus and comment sections that visually colonize the page they attach to.
- Any tool that mutates the host DOM enough to break copy-paste or find-in-page.
- Decorated onboarding: tooltips, coach marks, a tour. Selection to comment is one gesture
  and needs no teaching.
- The SaaS dashboard reflex in the panel: hero metrics, sparklines, activity feeds, nav
  sections that do not exist. The panel is three screens and a snippet.

## Design Principles

1. **The host page wins.** Every conflict between widget clarity and host readability resolves
   toward the host. We are a guest.
2. **Presence tracks activity.** Zero threads means near-zero visible chrome.
3. **One color, one meaning.** Amber means an open thread. Resolved is the absence of amber.
4. **Never touch the host DOM to show state.** Highlights paint over ranges, never wrap them.
5. **The account exists to hand over a snippet.** The panel is a utility, not a destination.

## Accessibility & Inclusion

WCAG 2.2 AA as the target, on a host page whose contrast we do not control.

- Highlights paint behind host text without altering text color, preserving whatever contrast
  the host already had.
- Color is never the sole carrier of meaning. Open versus resolved uses glyph and label too.
- Full keyboard path: native selection plus a shortcut to open the composer, complete sidebar
  navigation, correct focus management inside the shadow root.
- `prefers-reduced-motion` collapses all transitions to opacity at 80ms or less.
