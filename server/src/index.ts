import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { api } from './api.ts'
import { panel } from './panel.ts'
import { KEY_CHARS } from '../../shared/contract.ts'

const PORT = Number(process.env.PORT ?? 8787)
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

app.get(`/w/:key{[${KEY_CHARS}]+\\.js}`, (c) => {
  const file = bundle()
  if (!file) {
    return c.text('// widget bundle not built: run npm run build:widget\n', 503, {
      'Content-Type': 'application/javascript; charset=utf-8',
    })
  }

  if (c.req.header('If-None-Match') === file.etag) return c.body(null, 304)

  return c.body(file.body, 200, {
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
  })
})

app.route('/', panel)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`panel   http://localhost:${info.port}`)
  console.log(`widget  http://localhost:${info.port}/w/<key>.js`)
})
