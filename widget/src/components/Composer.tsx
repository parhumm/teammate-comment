import { useState, useRef, useEffect } from 'preact/hooks'
import { MAX_NAME, MAX_MESSAGE } from '../../../shared/contract.ts'

interface Props {
  name: string
  submitLabel: string
  placeholder: string
  onSubmit: (name: string, message: string) => void
  onCancel?: () => void
}

/**
 * The name is asked for exactly once, ever, and then remembered. After that it
 * collapses to a line of text with a way back, because re-confirming who you
 * are on every comment is the friction this product exists to avoid.
 */
export function Composer({ name, submitLabel, placeholder, onSubmit, onCancel }: Props) {
  const [message, setMessage] = useState('')
  const [draftName, setDraftName] = useState(name)
  const [editingName, setEditingName] = useState(!name)

  const nameRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // First-ever use starts on the name; every time after that, straight to the
    // thing the person actually came to write.
    if (editingName) nameRef.current?.focus()
    else messageRef.current?.focus()
  }, [])

  const ready = draftName.trim().length > 0 && message.trim().length > 0

  function submit(event?: Event) {
    event?.preventDefault()
    if (!ready) return
    onSubmit(draftName.trim(), message.trim())
    setMessage('')
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
    if (event.key === 'Escape' && onCancel) {
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <form class="composer" onSubmit={submit}>
      {editingName ? (
        <input
          ref={nameRef}
          type="text"
          name="name"
          // Asked once and then remembered, so letting the browser fill it is
          // pure benefit. Declaring it beats leaving the browser to guess from
          // the placeholder, which it will do either way and less reliably.
          autocomplete="name"
          placeholder="Your name"
          maxLength={MAX_NAME}
          value={draftName}
          onKeyDown={onKeyDown}
          onInput={(e) => setDraftName((e.target as HTMLInputElement).value)}
        />
      ) : (
        <div class="byline">
          <span>Commenting as {draftName}</span>
          <button type="button" class="link" onClick={() => setEditingName(true)}>
            Change
          </button>
        </div>
      )}

      <textarea
        ref={messageRef}
        placeholder={placeholder}
        maxLength={MAX_MESSAGE}
        value={message}
        onKeyDown={onKeyDown}
        onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
      />

      <div class="row-end">
        {onCancel && (
          <button type="button" class="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" class="btn" disabled={!ready}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
