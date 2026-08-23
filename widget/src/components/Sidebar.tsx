import { useMemo } from 'preact/hooks'
import type { Store, State, ThreadState } from '../store.ts'
import { spanOf } from '../store.ts'
import { relativeTime, readableTime } from '../../../shared/time.ts'

interface Props {
  store: Store
  state: State
  onJump: (thread: ThreadState) => void
}

function ThreadRow({
  thread,
  active,
  onJump,
}: {
  thread: ThreadState
  active: boolean
  onJump: (t: ThreadState) => void
}) {
  const { dto } = thread
  const root = dto.comments[0]
  const replies = dto.comments.length - 1

  return (
    <button
      type="button"
      class={`thread${dto.resolved ? ' is-resolved' : ''}${active ? ' is-active' : ''}`}
      onClick={() => onJump(thread)}
    >
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
    </button>
  )
}

export function Sidebar({ store, state, onJump }: Props) {
  const { threads, showResolved, activeThreadId } = state

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

  return (
    <aside class="sidebar" role="dialog" aria-label="Comments on this page">
      <div class="sidebar-top">
        <h2>Comments ({total})</h2>
        <button class="link" type="button" onClick={() => store.toggleSidebar(false)}>
          Close
        </button>
      </div>

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
              />
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
