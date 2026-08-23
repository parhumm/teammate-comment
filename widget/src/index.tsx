import { render } from 'preact'
import { App } from './App.tsx'
import { Store } from './store.ts'
import { Api } from './api.ts'
import { widgetCss } from './styles.ts'
import { resolveTheme, prefersReducedMotion } from './theme.ts'
import { installHighlightStyles, supportsHighlights } from './highlights.ts'
import { normalizePageUrl } from '../../shared/url.ts'
import { keyFromWidgetSrc } from '../../shared/contract.ts'

/**
 * The whole integration is one string:
 *
 *   <script src="https://host/w/PROJECT_KEY.js"></script>
 *
 * The key is not baked into the bundle at build time. It is read back out of
 * the script's own src at runtime, which is what lets a single cacheable file
 * serve every project and removes the classic failure of a `data-` attribute
 * that does not match the src it sits next to.
 */
interface Found {
  script: HTMLScriptElement
  key: string
  origin: string
}

/**
 * `document.currentScript` is only meaningful while this file is executing, so
 * the lookup happens once at module scope and the result is passed onward. The
 * alternative -- rediscovering it later -- means either scanning the document
 * again or writing to a browser global on a page we do not own.
 */
function locateScript(): Found | null {
  const current = document.currentScript as HTMLScriptElement | null
  if (current) {
    // `script.src` is already absolute, which resolves any <base href> for us.
    const key = keyFromWidgetSrc(current.src)
    if (key) return { script: current, key, origin: new URL(current.src).origin }
  }
  return null
}

const found = locateScript()

function boot(script: Found): void {
  const { key, origin } = script

  // A fixed, pointer-transparent overlay. The host page's layout is never
  // touched: nothing here is in its flow and nothing here can reflow it.
  const host = document.createElement('div')
  host.id = 'teammate-comment'
  const shadow = host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)

  const theme = resolveTheme(script.script)
  host.setAttribute('data-tc-theme', theme)

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(widgetCss)
  shadow.adoptedStyleSheets = [sheet]

  // `::highlight()` rules have to live in the host document, because the ranges
  // they paint live there too.
  if (supportsHighlights()) installHighlightStyles(theme)

  const root = document.createElement('div')
  const pulseLayer = document.createElement('div')
  shadow.append(root, pulseLayer)

  const api = new Api(origin, key)
  const store = new Store(api, normalizePageUrl(location.href), host)

  render(
    <App
      store={store}
      pulseLayer={pulseLayer}
      reducedMotion={prefersReducedMotion()}
      canCreate={matchMedia('(pointer: fine)').matches}
    />,
    root,
  )

  store.load()
}

if (found) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(found))
  } else {
    boot(found)
  }
}
