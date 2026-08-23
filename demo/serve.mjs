import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A static server for the demo pages, on a different port from the API.
 *
 * The different port matters: it makes the demo a genuinely cross-origin host
 * page, so the widget exercises the real CORS path and the real domain gate
 * rather than a same-origin shortcut that would hide bugs until deploy.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DEMO_PORT ?? 5173)
const API = process.env.TC_API ?? 'http://localhost:8787'
const KEY = process.env.TC_KEY ?? ''

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' }

if (!KEY) {
  console.error('Set TC_KEY to a project key from the panel, e.g.')
  console.error('  TC_KEY=abc123 node demo/serve.mjs')
  process.exit(1)
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const file = resolve(HERE, '.' + (path === '/' ? '/index.html' : path))

  if (!file.startsWith(HERE) || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('Not found')
  }

  const ext = extname(file)
  let body = readFileSync(file)

  if (ext === '.html') {
    // The served HTML is exactly what a real static page looks like: one script
    // tag, key in the URL, nothing else.
    body = Buffer.from(String(body).replaceAll('__WIDGET_SRC__', `${API}/w/${KEY}.js`))
  }

  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' })
  res.end(body)
}).listen(PORT, () => {
  console.log(`demo    http://localhost:${PORT}       (light, editorial serif)`)
  console.log(`demo    http://localhost:${PORT}/dark.html  (dark, color-scheme: dark)`)
  console.log(`widget  ${API}/w/${KEY}.js`)
})
