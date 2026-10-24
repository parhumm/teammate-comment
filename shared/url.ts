/**
 * Comments belong to a page, not to whichever link someone happened to follow.
 * Query strings and fragments are stripped so `?utm_source=x` and `#section`
 * land on the same page as the bare URL.
 *
 * Shared rather than duplicated: if the widget and the server ever disagreed
 * about what counts as the same page, comments would be written to one key and
 * read back from another, and the bug would look like data loss.
 *
 * Anything that is not an http(s) URL comes back empty, which every caller
 * treats as missing. The result is stored and later rendered as a link in the
 * owner's panel, so a `javascript:` "page" must never get that far.
 */
export function normalizePageUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.search = ''
    url.hash = ''
    url.pathname = trimTrailingSlash(url.pathname)
    return url.toString()
  } catch {
    return ''
  }
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
