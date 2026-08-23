/**
 * Forgiving on input, strict on matching.
 *
 * People type domains a dozen different ways and none of them are wrong, so
 * every reasonable spelling normalizes to one canonical pattern. Matching, by
 * contrast, has to be exact about boundaries: a naive `endsWith` would let
 * `acme.com.evil.test` pass as `acme.com`, so subdomain matching always tests
 * against a leading dot.
 *
 * Canonical patterns:
 *   `*.acme.com`  apex plus every subdomain (the default; what people mean)
 *   `acme.com`    that exact host only (the advanced narrowing)
 */

export interface NormalizedDomain {
  /** The bare host, e.g. `acme.com` */
  base: string
  /** Canonical stored pattern, e.g. `*.acme.com` */
  pattern: string
  /** Whether subdomains are included */
  subdomains: boolean
}

export class DomainError extends Error {}

export function normalizeDomain(input: string, subdomains = true): NormalizedDomain {
  let raw = (input ?? '').trim().toLowerCase()
  if (!raw) throw new DomainError('Enter a domain.')

  // Accept a pasted URL, with or without a scheme.
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  // Drop anything after the authority.
  raw = raw.split('/')[0].split('?')[0].split('#')[0]
  // Drop credentials and port.
  raw = raw.split('@').pop() ?? raw
  raw = raw.split(':')[0]
  // Accept an explicit wildcard, and treat `www.` as the generic prefix it is.
  raw = raw.replace(/^\*\./, '')
  raw = raw.replace(/^www\./, '')
  // Trailing dot is legal in DNS and noise here.
  raw = raw.replace(/\.$/, '')

  if (!raw) throw new DomainError('Enter a domain.')
  if (!/^[a-z0-9.-]+$/.test(raw)) throw new DomainError('That does not look like a domain.')
  if (raw.startsWith('.') || raw.includes('..')) {
    throw new DomainError('That does not look like a domain.')
  }
  if (raw !== 'localhost' && !raw.includes('.')) {
    throw new DomainError('That does not look like a domain.')
  }

  return { base: raw, pattern: subdomains ? `*.${raw}` : raw, subdomains }
}

export function parsePattern(pattern: string): NormalizedDomain {
  const subdomains = pattern.startsWith('*.')
  const base = subdomains ? pattern.slice(2) : pattern
  return { base, pattern, subdomains }
}

/**
 * Tests a request host against a stored pattern. The leading-dot test is what
 * keeps `acme.com.evil.test` and `evil-acme.com` out.
 */
export function hostMatches(pattern: string, host: string): boolean {
  const { base, subdomains } = parsePattern(pattern)
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h === base) return true
  return subdomains && h.endsWith(`.${base}`)
}

/** Extracts a hostname from an Origin or Referer header value. */
export function hostFromHeader(value: string | undefined | null): string | null {
  if (!value || value === 'null') return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The match preview shown under the domain field. Showing concrete hosts beats
 * explaining the rule, because the rule is only ever read once.
 */
export function describeMatch({ base, subdomains }: NormalizedDomain): string {
  if (!subdomains) return `Matches ${base} only.`
  return `Matches ${base} and every subdomain.`
}
