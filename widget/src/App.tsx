import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Store, ThreadState, Draft } from './store.ts'
import { useStore, openSpans, spanOf, spansKey, threadAt } from './store.ts'
import { anchorFromRange, rangeFromOffsets, offsetFromPoint } from './anchor.ts'
import { paintHighlights, pulseRange } from './highlights.ts'
import { Composer } from './components/Composer.tsx'
import { ThreadPopup } from './components/ThreadPopup.tsx'
import { Sidebar } from './components/Sidebar.tsx'

const GAP = 8
const EDGE = 8

/** Keeps a floating element inside the viewport, flipping above when it must. */
function useAnchoredPosition(rect: DOMRect | null, ref: { current: HTMLElement | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!rect || !ref.current) return setPos(null)

    const { offsetWidth: w, offsetHeight: h } = ref.current
    const left = Math.min(Math.max(EDGE, rect.left), innerWidth - w - EDGE)

    let top = rect.bottom + GAP
    if (top + h > innerHeight - EDGE) {
      const above = rect.top - h - GAP
      top = above >= EDGE ? above : Math.max(EDGE, innerHeight - h - EDGE)
    }

    setPos({ top, left })
  }, [rect?.top, rect?.left, rect?.bottom, rect?.width, ref.current])

  return pos
}

interface Props {
  store: Store
  pulseLayer: HTMLElement
  reducedMotion: boolean
  /** Selection-anchored creation is desktop-only in V1. */
  canCreate: boolean
}

export function App({ store, pulseLayer, reducedMotion, canCreate }: Props) {
  const state = useStore(store)
  const [selection, setSelection] = useState<Draft | null>(null)

  const pillRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const active = state.threads.find((t) => t.dto.id === state.activeThreadId) ?? null
  const anchorRect = state.draft?.rect ?? activeRect(store, active)

  const pillPos = useAnchoredPosition(selection && !state.draft ? selection.rect : null, pillRef)
  const popupPos = useAnchoredPosition(anchorRect, popupRef)

  /* ------------------------------------------------------ selection --- */

  useEffect(() => {
    if (!canCreate) return

    let timer: number
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(read, 120) as unknown as number
    }

    function read() {
      const sel = getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null)

      const range = sel.getRangeAt(0)
      // Never annotate our own UI, or anything the page marked uneditable-safe.
      if (!document.body.contains(range.commonAncestorContainer)) return setSelection(null)

      const anchor = anchorFromRange(store.index, range)
      if (!anchor || !anchor.selectedText.trim()) return setSelection(null)

      const rects = range.getClientRects()
      const last = rects[rects.length - 1]
      if (!last) return setSelection(null)

      setSelection({ anchor, rect: last })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [store, canCreate])

  /* ----------------------------------------------------- highlights --- */

  const geometry = spansKey(state.threads)

  useEffect(() => {
    const spans = openSpans(state.threads)
    // Nothing anchored means nothing to paint, and no reason to have touched
    // the text index at all.
    if (spans.length) paintHighlights(store.index, spans)
  }, [geometry, store])

  /* ------------------------------------------- clicking a highlight --- */

  /**
   * Highlighted text is the most obvious thing to click, so it opens its
   * thread. Painted highlights have no element behind them, so the character
   * under the pointer is resolved and matched against the anchors.
   *
   * When highlights overlap, the smallest range wins: it is the most specific
   * thing the reader could have been pointing at.
   */
  useEffect(() => {
    // No anchored threads means no highlight can be under any click, so the
    // listener is never installed and comment-free pages pay nothing.
    if (!geometry) return

    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.defaultPrevented) return

      // Never intercept the host page's own interactive elements.
      const target = event.target as HTMLElement | null
      if (target?.closest('a, button, input, textarea, select, [contenteditable], label')) return

      // A click that ends a drag-selection is not a click on a highlight.
      const sel = getSelection()
      if (sel && !sel.isCollapsed) return

      // Only now the expensive part: caret hit-testing can force a synchronous
      // layout on the host page, so it runs last, once everything cheap passed.
      const offset = offsetFromPoint(store.index, event.clientX, event.clientY)
      if (offset == null) return

      const hit = threadAt(state.threads, offset)
      if (hit) {
        event.preventDefault()
        store.openThread(hit.dto.id)
      }
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [store, state.threads, geometry])

  /* ----------------------------------------------- dismiss on outside --- */

  /**
   * `composedPath` rather than `event.target`: a click inside a shadow root is
   * retargeted to the host element by the time it reaches the document, so the
   * target alone cannot tell inside from outside.
   */
  useEffect(() => {
    if (!state.draft && state.activeThreadId == null) return

    function onPointerDown(event: PointerEvent) {
      const path = event.composedPath()
      const insidePopup = path.some(
        (n) => n instanceof HTMLElement && (n.classList?.contains('popup') || n.classList?.contains('pill')),
      )
      if (insidePopup) return
      store.openThread(null)
    }

    // Deferred so the click that opened the popup does not immediately close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [store, state.draft, state.activeThreadId])

  /* ------------------------------------------------------- keyboard --- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (state.draft || state.activeThreadId != null) {
          store.openThread(null)
        } else if (state.sidebarOpen) {
          store.toggleSidebar(false)
        }
        return
      }

      // A shortcut into the composer, but never while someone is typing.
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')

      if (!typing && event.key === 'c' && !event.metaKey && !event.ctrlKey && selection) {
        event.preventDefault()
        store.setDraft(selection)
        setSelection(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [store, state.draft, state.activeThreadId, state.sidebarOpen, selection])

  /* ------------------------------------------------------ deep link --- */

  useEffect(() => {
    const match = /^#tc-(\d+)$/.exec(location.hash)
    if (!match || state.loading) return
    const thread = state.threads.find((t) => String(t.dto.id) === match[1])
    if (thread) jump(thread)
  }, [state.loading])

  /* ----------------------------------------------------------- jump --- */

  function jump(thread: ThreadState) {
    store.openThread(thread.dto.id)

    const span = spanOf(thread)
    if (!span) return

    const { start, end } = span
    const range = rangeFromOffsets(store.index, start, end)
    if (!range) return

    const rect = range.getBoundingClientRect()
    const targetY = scrollY + rect.top - innerHeight / 3

    scrollTo({ top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' })

    // Pulse once the scroll has settled, so the marks land where the eye is.
    const delay = reducedMotion ? 0 : 320
    setTimeout(() => {
      const settled = rangeFromOffsets(store.index, start, end)
      if (settled) pulseRange(settled, pulseLayer, reducedMotion)
    }, delay)
  }

  /* ---------------------------------------------------------- render --- */

  const openCount = state.threads.filter((t) => !t.dto.resolved).length

  return (
    <>
      {selection && !state.draft && (
        <button
          ref={pillRef}
          class="pill"
          style={pillPos ? { top: `${pillPos.top}px`, left: `${pillPos.left}px` } : { opacity: 0 }}
          // mousedown would collapse the selection before click fires; the
          // anchor is already captured, but keeping the selection visible while
          // the composer opens is less jarring.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            store.setDraft(selection)
            setSelection(null)
          }}
        >
          Comment
        </button>
      )}

      {(state.draft || active) && (
        <div
          ref={popupRef}
          class="popup"
          style={popupPos ? { top: `${popupPos.top}px`, left: `${popupPos.left}px` } : { opacity: 0 }}
        >
          {state.draft ? (
            <>
              <div class="quote">{state.draft.anchor.selectedText}</div>
              <div class="scroll">
                <Composer
                  name={state.name}
                  submitLabel="Comment"
                  placeholder="What's on your mind?"
                  onSubmit={(who, message) =>
                    store.createThread(state.draft!.anchor, who, message)
                  }
                  onCancel={() => store.setDraft(null)}
                />
              </div>
            </>
          ) : (
            <ThreadPopup
              store={store}
              thread={active!}
              name={state.name}
              pending={state.pending}
              failed={state.failed}
            />
          )}
        </div>
      )}

      {state.sidebarOpen && <Sidebar store={store} state={state} onJump={jump} />}

      {/* Presence tracks activity: nothing to say, nothing to look at. */}
      <button
        class={`launcher${state.error ? ' is-error' : ''}`}
        type="button"
        aria-label={`Comments (${state.threads.length})`}
        onClick={() => store.toggleSidebar()}
      >
        <span aria-hidden="true">💬</span>
        {openCount > 0 && <span class="count">{openCount}</span>}
      </button>
    </>
  )
}

function activeRect(store: Store, thread: ThreadState | null): DOMRect | null {
  if (!thread) return null
  const span = spanOf(thread)
  if (!span) return null
  const range = rangeFromOffsets(store.index, span.start, span.end)
  return range ? range.getBoundingClientRect() : null
}
