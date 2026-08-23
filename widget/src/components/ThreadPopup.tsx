import { useState } from 'preact/hooks'
import type { Store, ThreadState } from '../store.ts'
import type { CommentDto } from '../api.ts'
import { relativeTime, readableTime, absoluteTime } from '../../../shared/time.ts'
import { MAX_MESSAGE } from '../../../shared/contract.ts'
import { Composer } from './Composer.tsx'

interface Props {
  store: Store
  thread: ThreadState
  name: string
  pending: Set<number>
  failed: Map<number, string>
}

function CommentRow({
  store,
  comment,
  isRoot,
  pending,
  failure,
}: {
  store: Store
  comment: CommentDto
  isRoot: boolean
  pending: boolean
  failure?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.message)
  const [confirming, setConfirming] = useState(false)

  function save(event: Event) {
    event.preventDefault()
    const next = draft.trim()
    if (next && next !== comment.message) store.editComment(comment.id, next)
    setEditing(false)
  }

  return (
    <div class={`comment${pending ? ' is-pending' : ''}`}>
      <div class="byline">
        <span class="who">{comment.name}</span>
        <time dateTime={absoluteTime(comment.created_at)} title={readableTime(comment.created_at)}>
          {relativeTime(comment.created_at)}
        </time>
        {comment.edited_at && <span>edited</span>}

        {!pending && !editing && (
          <span class="actions">
            <button class="link" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button class="link danger" type="button" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </span>
        )}
      </div>

      {editing ? (
        <form class="composer" onSubmit={save}>
          <textarea
            value={draft}
            maxLength={MAX_MESSAGE}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(e)
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
              }
            }}
          />
          <div class="row-end">
            <button type="button" class="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" class="btn">
              Save
            </button>
          </div>
        </form>
      ) : (
        <div class="message">{comment.message}</div>
      )}

      {/* Inline confirm rather than a modal. Deleting one comment does not
          warrant taking over the whole page. */}
      {confirming && (
        <div class="retry">
          <span>{isRoot ? 'Delete the whole thread?' : "Delete this comment? Retry isn't possible."}</span>
          <button
            class="link danger"
            type="button"
            onClick={() => {
              store.deleteComment(comment.id)
              setConfirming(false)
            }}
          >
            Delete
          </button>
          <button class="link" type="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      )}

      {failure && (
        <div class="retry">
          <span>{failure}</span>
          <button class="link" type="button" onClick={() => store.discardFailed(comment.id)}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

export function ThreadPopup({ store, thread, name, pending, failed }: Props) {
  const { dto } = thread
  const [replying, setReplying] = useState(false)

  return (
    <>
      <div class="quote">{dto.selected_text}</div>

      <div class="scroll">
        {dto.comments.map((comment, i) => (
          <CommentRow
            key={comment.id}
            store={store}
            comment={comment}
            isRoot={i === 0}
            pending={pending.has(comment.id)}
            failure={failed.get(comment.id)}
          />
        ))}

        {replying ? (
          <Composer
            name={name}
            submitLabel="Reply"
            placeholder="Reply"
            onSubmit={(who, message) => {
              store.reply(dto.id, who, message)
              setReplying(false)
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div class="row-end">
            <button
              class="btn ghost"
              type="button"
              onClick={() => store.toggleResolve(dto.id)}
            >
              {dto.resolved ? 'Reopen' : 'Resolve'}
            </button>
            <button class="btn" type="button" onClick={() => setReplying(true)}>
              Reply
            </button>
          </div>
        )}
      </div>
    </>
  )
}
