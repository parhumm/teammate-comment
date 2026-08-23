/**
 * The things the widget and the server must agree on exactly.
 *
 * Both of these have the same failure signature: a mismatch produces no error
 * anywhere, just wrong behaviour that looks like something else. A field cap
 * that differs makes the server silently truncate text the widget accepted. A
 * key alphabet that outgrows the widget's extraction pattern makes the server
 * serve the bundle happily while the widget never boots.
 */

/** Field caps. The server slices to these; the widget stops typing at them. */
export const MAX_NAME = 40
export const MAX_MESSAGE = 2000
export const MAX_QUOTE = 8000
export const MAX_CONTEXT = 200

/**
 * Project keys are base64url, so the extraction pattern below must cover
 * exactly the alphabet `newProjectKey` can emit.
 */
export const KEY_CHARS = 'A-Za-z0-9_-'

/** Path the server serves the bundle from, and the widget recognises itself by. */
export function widgetPath(key: string): string {
  return `/w/${key}.js`
}

export function widgetSrc(origin: string, key: string): string {
  return `${origin}${widgetPath(key)}`
}

/** The one string a site owner ever copies. */
export function embedSnippet(origin: string, key: string): string {
  return `<script src="${widgetSrc(origin, key)}"><\/script>`
}

/**
 * Recovers the project key from the widget's own script URL.
 *
 * This is what lets one cacheable bundle serve every project: the key is not
 * baked in at build time, it is read back out at runtime. A trailing query is
 * tolerated so cache-busting a snippet by hand does not break the widget.
 */
export function keyFromWidgetSrc(src: string): string | null {
  const match = new RegExp(`/w/([${KEY_CHARS}]+)\\.js(?:$|\\?)`).exec(src)
  return match ? match[1] : null
}
