/**
 * Comments belong to a page, not to whichever link someone happened to follow.
 * Query strings and fragments are stripped so `?utm_source=x` and `#section`
 * land on the same page as the bare URL.
 *
 * Shared rather than duplicated: if the widget and the server ever disagreed
 * about what counts as the same page, comments would be written to one key and
 * read back from another, and the bug would look like data loss.
 */
export function normalizePageUrl(input: string): string {
  try {
    const url = new URL(input)
    url.search = ''
    url.hash = ''
    url.pathname = trimTrailingSlash(url.pathname)
    return url.toString()
  } catch {
    // Only reachable for a caller-supplied string that is not a URL at all. It
    // still goes through the same trailing-slash rule, because two definitions
    // of "the same page" is exactly the divergence this file exists to prevent.
    const bare = input.split('?')[0].split('#')[0]
    return trimTrailingSlash(bare)
  }
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
