import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { Store, State, ThreadState } from '../store.ts'
import { spanOf } from '../store.ts'
import { relativeTime, readableTime } from '../../../shared/time.ts'
import { elementFor } from '../copy.ts'
import { threadsMarkdown } from '../../../shared/markdown.ts'
import { useCopy, CopyFallback, CopyAnnouncer } from './Copy.tsx'

/** Where readers find the service. The host rides along so we know which sites send people. */
const HOME = `https://teammate.jaan.to/?${new URLSearchParams({
  utm_source: location.hostname,
  utm_medium: 'widget',
  utm_campaign: 'sidebar',
})}`

interface Props {
  store: Store
  state: State
  onJump: (thread: ThreadState) => void
}

/**
 * One row, two modes. Normally a button that jumps to the thread; while
 * selecting, a label around a native checkbox so the whole row is the target
 * and the keyboard gets Space for free.
 */
function ThreadRow({
  thread,
  active,
  onJump,
  picked,
  onPick,
}: {
  thread: ThreadState
  active: boolean
  onJump: (t: ThreadState) => void
  picked?: boolean
  onPick?: (id: number) => void
}) {
  const { dto } = thread
  const root = dto.comments[0]
  const replies = dto.comments.length - 1
  const className = `thread${dto.resolved ? ' is-resolved' : ''}${active ? ' is-active' : ''}${
    onPick ? ' is-pick' : ''
  }`

  const body = (
    <>
      {onPick && (
        <input type="checkbox" class="pick" checked={!!picked} onChange={() => onPick(dto.id)} />
      )}
      <span class={`dot${dto.resolved ? ' is-resolved' : ''}`} aria-hidden="true" />
      <span class="head">
        <span class="who">{root?.name}</span>
        <time class="when" title={readableTime(root?.created_at)}>
          {relativeTime(root?.created_at)}
        </time>
        {/* Resolved is carried by a word as well as by the missing amber, so it
            survives greyscale and colour blindness. */}
        {dto.resolved && <span class="when">Resolved</span>}
      </span>
      <span class="excerpt">{root?.message}</span>
      {replies > 0 && (
        <span class="replies">
          {replies} {replies === 1 ? 'reply' : 'replies'}
        </span>
      )}
    </>
  )

  return onPick ? (
    <label class={className}>{body}</label>
  ) : (
    <button type="button" class={className} onClick={() => onJump(thread)}>
      {body}
    </button>
  )
}

export function Sidebar({ store, state, onJump }: Props) {
  const { threads, showResolved, activeThreadId, selecting, selected } = state

  // Document order, not chronological. The sidebar is a map of the page, and a
  // map sorted by time stops being a map.
  //
  // Memoised on the thread list because App re-renders on every selection
  // change, and re-sorting the whole page's threads while someone drags across
  // text is work nobody asked for.
  const { anchored, open, resolved, orphans } = useMemo(() => {
    const withSpan: { thread: ThreadState; start: number }[] = []
    const withoutSpan: ThreadState[] = []

    for (const t of threads) {
      const span = spanOf(t)
      if (span) withSpan.push({ thread: t, start: span.start })
      else withoutSpan.push(t)
    }

    withSpan.sort((a, b) => a.start - b.start)
    const ordered = withSpan.map((e) => e.thread)

    return {
      anchored: ordered,
      open: ordered.filter((t) => !t.dto.resolved),
      resolved: ordered.filter((t) => t.dto.resolved),
      orphans: withoutSpan,
    }
  }, [threads])

  const total = threads.length
  const visible = showResolved ? anchored : open

  /* ------------------------------------------------------------ copy --- */

  // What "all" means: what is on screen, in the order it is on screen.
  // Resolved threads come along only when they are shown.
  const copyable = [...visible, ...orphans]
  const picked = copyable.filter((t) => selected.has(t.dto.id))
  const allPicked = copyable.length > 0 && picked.length === copyable.length

  const clip = useCopy()
  const allRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = picked.length > 0 && !allPicked
  }, [picked.length, allPicked])

  function copyThreads(list: ThreadState[]) {
    clip.copy(
      threadsMarkdown(
        store.pageUrl,
        list.map((t) => ({ dto: t.dto, element: elementFor(store.index, spanOf(t)) })),
      ),
    )
  }

  const onPick = selecting ? (id: number) => store.toggleSelected(id) : undefined

  return (
    <aside class="sidebar" role="dialog" aria-label="Comments on this page">
      <div class="sidebar-top">
        <h2>Comments ({total})</h2>
        <button class="link" type="button" onClick={() => store.toggleSidebar(false)}>
          Close
        </button>
      </div>

      {!state.error && copyable.length > 0 && (
        <div class="sidebar-tools">
          {selecting ? (
            <>
              <label class="check">
                <input
                  ref={allRef}
                  type="checkbox"
                  class="pick"
                  checked={allPicked}
                  onChange={() => store.setSelected(allPicked ? [] : copyable.map((t) => t.dto.id))}
                />
                Select all
              </label>
              <button
                class="link"
                type="button"
                disabled={picked.length === 0}
                onClick={() => copyThreads(picked)}
              >
                {clip.status === 'copied' ? 'Copied' : `Copy (${picked.length})`}
              </button>
              <button class="link" type="button" onClick={() => store.setSelecting(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              <button class="link" type="button" onClick={() => store.setSelecting(true)}>
                Select
              </button>
              <button class="link" type="button" onClick={() => copyThreads(copyable)}>
                {clip.status === 'copied' ? 'Copied' : `Copy all (${copyable.length})`}
              </button>
            </>
          )}
        </div>
      )}

      {clip.status === 'failed' && (
        <div class="sidebar-fallback">
          <CopyFallback text={clip.text} onDone={clip.dismiss} />
        </div>
      )}
      <CopyAnnouncer status={clip.status} />

      <div class="sidebar-scroll">
        {state.error && (
          <div class="state">
            <div>{state.error}</div>
            <button class="btn" type="button" onClick={() => store.load()}>
              Retry
            </button>
          </div>
        )}

        {/* A write that failed and rolled back. Re-fetching would not help, so
            this one only offers to be dismissed. */}
        {state.notice && (
          <div class="state">
            <div>{state.notice}</div>
            <button class="btn ghost" type="button" onClick={() => store.dismissNotice()}>
              Dismiss
            </button>
          </div>
        )}

        {!state.error && total === 0 && !state.loading && (
          <div class="state">Select any text on this page to start a thread.</div>
        )}

        {/* All-resolved is its own state, not the empty state. "Nothing here"
            and "everything dealt with" mean opposite things. */}
        {!state.error && total > 0 && open.length === 0 && !showResolved && orphans.length === 0 && (
          <div class="state">
            <div>
              All {resolved.length} thread{resolved.length === 1 ? '' : 's'} resolved.
            </div>
            <button class="btn ghost" type="button" onClick={() => store.setShowResolved(true)}>
              Show resolved
            </button>
          </div>
        )}

        {visible.map((thread) => (
          <ThreadRow
            key={thread.dto.id}
            thread={thread}
            active={thread.dto.id === activeThreadId}
            onJump={onJump}
            picked={selected.has(thread.dto.id)}
            onPick={onPick}
          />
        ))}

        {resolved.length > 0 && (open.length > 0 || showResolved) && (
          <div class="group">
            <button
              class="link"
              type="button"
              onClick={() => store.setShowResolved(!showResolved)}
            >
              {showResolved ? 'Hide resolved' : `Show ${resolved.length} resolved`}
            </button>
          </div>
        )}

        {/* Threads whose text no longer exists. They are not deleted and not
            hidden: the conversation still happened, and someone has to be able
            to see it and close it out. */}
        {orphans.length > 0 && (
          <>
            <div class="group">
              {orphans.length} thread{orphans.length === 1 ? '' : 's'} no longer match text on this
              page
            </div>
            <div class="group-note">The text these were attached to has changed.</div>
            {orphans.map((thread) => (
              <ThreadRow
                key={thread.dto.id}
                thread={thread}
                active={thread.dto.id === activeThreadId}
                onJump={onJump}
                picked={selected.has(thread.dto.id)}
                onPick={onPick}
              />
            ))}
          </>
        )}
      </div>

      <div class="sidebar-foot">
        Powered by{' '}
        <a href={HOME} target="_blank" rel="noreferrer">
          Teammate comments
        </a>
      </div>
    </aside>
  )
}
