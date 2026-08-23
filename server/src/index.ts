import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { api } from './api.ts'
import { panel } from './panel.ts'
import { KEY_CHARS } from '../../shared/contract.ts'

const PORT = Number(process.env.PORT ?? 8787)

/**
 * Loopback by default, deliberately.
 *
 * `serve()` binds every interface when no hostname is given, which on a VPS
 * with a public IP puts the panel — and open signup — straight on the internet
 * on a port nothing is guarding. Behind a reverse proxy the process should only
 * ever be reachable through the proxy, and in dev localhost is what you want
 * anyway, so there is no case where the permissive default is the right one.
 */
const BIND = process.env.TC_BIND ?? '127.0.0.1'
const BUNDLE = resolve(process.cwd(), '../widget/dist/widget.js')

const app = new Hono()

app.route('/api', api)

/**
 * One bundle answers every `/w/<key>.js` path. The key is not baked in at build
 * time; the widget recovers it from `document.currentScript.src` at runtime, so
 * the file stays byte-identical across projects and stays cacheable. That is
 * what lets the whole integration be a single string with no attribute to
 * mistype and no src/key pair to get out of sync.
 */
let cached: { body: string; etag: string; mtime: number } | null = null

function bundle(): { body: string; etag: string } | null {
  if (!existsSync(BUNDLE)) return null
  const mtime = statSync(BUNDLE).mtimeMs
  if (!cached || cached.mtime !== mtime) {
    const body = readFileSync(BUNDLE, 'utf8')
    cached = { body, etag: `"${createHash('sha1').update(body).digest('base64url')}"`, mtime }
  }
  return cached
}

/**
 * A compressing proxy rewrites the ETag it hands out so the compressed and
 * uncompressed bodies cannot collide in a shared cache — Caddy appends `-gzip`
 * or `-zstd`. The tag that comes back in `If-None-Match` is therefore not
 * always the one we issued, so compare on the base tag.
 *
 * `W/` marks a weak validator, which is what these effectively are; it is
 * dropped for the same reason.
 */
function stripEncodingSuffix(tag: string): string {
  return tag.replace(/^W\//, '').replace(/-(?:gzip|zstd|br|deflate)"$/, '"')
}

app.get(`/w/:key{[${KEY_CHARS}]+\\.js}`, (c) => {
  const file = bundle()
  if (!file) {
    return c.text('// widget bundle not built: run npm run build:widget\n', 503, {
      'Content-Type': 'application/javascript; charset=utf-8',
    })
  }

  /**
   * One header set, used by both the 200 and the 304 — they are not allowed to
   * disagree.
   *
   * A 304 is not "an empty reply". RFC 9111 §4.3.4 has the client MERGE these
   * headers into the copy it already holds, so a field omitted here is left
   * alone but a field that is WRONG here silently rewrites the cache. Returning
   * a bare `c.body(null, 304)` sends Hono's default `Content-Type: text/plain`,
   * which overwrites the stored `application/javascript`; the next load then
   * serves a plain-text script, and `nosniff` makes the browser refuse to
   * execute it.
   *
   * That failure is genuinely nasty to read: it lands one page load AFTER the
   * response that caused it, and it alternates, because the blocked load evicts
   * the entry it just poisoned and the load after that re-fetches cleanly. It
   * is also invisible to curl, which has no cache and ignores nosniff.
   */
  const headers = {
    'Content-Type': 'application/javascript; charset=utf-8',
    // `no-cache` means "revalidate before use", not "do not store". Paired with
    // the ETag, an unchanged bundle costs one conditional request and returns a
    // bodyless 304.
    //
    // A max-age here would be a trap: the embed URL is fixed and site owners
    // cannot be asked to re-paste it, so a stale window is a window where a
    // shipped fix has not reached the pages that need it.
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    ETag: file.etag,
  }

  // A conditional request may carry a list, and a proxy that compressed the
  // response will have suffixed the tag it handed out (Caddy appends `-gzip` /
  // `-zstd`). Match against the parsed list, ignoring any such suffix, so the
  // revalidation still costs one bodyless 304 rather than a full re-download.
  const inm = c.req.header('If-None-Match')
  if (inm && inm.split(',').some((tag) => stripEncodingSuffix(tag.trim()) === file.etag)) {
    return c.body(null, 304, headers)
  }

  return c.body(file.body, 200, headers)
})

/**
 * Liveness only: no auth, no database, no upstream call. A health check that can
 * block on a dependency stops reporting whether the process is alive and starts
 * reporting the dependency instead — which is the one thing it must never do.
 *
 * Registered before the panel, whose guard redirects every unmatched path to
 * /signin and would otherwise answer this with a 302.
 */
app.get('/healthz', (c) => c.text('ok'))

app.route('/', panel)

serve({ fetch: app.fetch, port: PORT, hostname: BIND }, (info) => {
  console.log(`panel   http://${BIND}:${info.port}`)
  console.log(`widget  http://${BIND}:${info.port}/w/<key>.js`)
})
