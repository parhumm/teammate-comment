/**
 * SQLite's `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` in UTC with no zone
 * marker, which `new Date()` would read as local time. Parsing goes through
 * here so a comment written a minute ago never displays as hours old.
 */
export function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Which *kind* of thing the relative time turned out to be.
 *
 * The shape is returned alongside the text rather than recovered afterwards by
 * pattern-matching the rendered string. Coupling two functions through a text
 * format means adding a case (a "yesterday", a localised token) silently yields
 * "on yesterday" with nothing to catch it.
 */
type Shape = 'instant' | 'elapsed' | 'date'

function describe(
  value: string | null | undefined,
  now: number,
): { text: string; shape: Shape } | null {
  const date = parseUtc(value)
  if (!date) return null

  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (seconds < 45) return { text: 'just now', shape: 'instant' }

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { text: `${minutes}m`, shape: 'elapsed' }

  const hours = Math.round(minutes / 60)
  if (hours < 24) return { text: `${hours}h`, shape: 'elapsed' }

  const days = Math.round(hours / 24)
  if (days < 7) return { text: `${days}d`, shape: 'elapsed' }

  return { text: `${date.getDate()} ${MONTHS[date.getMonth()]}`, shape: 'date' }
}

/**
 * Compact relative time. Recency is what people scan for, so the recent end is
 * precise and anything past a week falls back to a date.
 */
export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  return describe(value, now)?.text ?? ''
}

/**
 * `relativeTime` produces bare tokens because they read best in dense columns,
 * but a sentence needs a preposition. "just now ago" and "12 Aug ago" are both
 * wrong, so each shape gets the wording it actually takes.
 */
export function agoPhrase(value: string | null | undefined, now = Date.now()): string {
  const described = describe(value, now)
  if (!described) return ''

  switch (described.shape) {
    case 'instant':
      return described.text
    case 'elapsed':
      return `${described.text} ago`
    case 'date':
      return `on ${described.text}`
  }
}

/** The full timestamp, for `title` and `<time datetime>`. */
export function absoluteTime(value: string | null | undefined): string {
  const date = parseUtc(value)
  return date ? date.toISOString() : ''
}

export function readableTime(value: string | null | undefined): string {
  const date = parseUtc(value)
  if (!date) return ''
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
