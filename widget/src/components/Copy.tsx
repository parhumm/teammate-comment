import { useEffect, useRef, useState } from 'preact/hooks'
import { copyText } from '../copy.ts'

export type CopyStatus = 'idle' | 'copied' | 'failed'

/**
 * Copy state for one button: a short-lived "Copied" label, or a visible
 * fallback when the clipboard is out of reach (an http: host page, a denied
 * permission). The fallback is the text itself, already selected.
 */
export function useCopy() {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const [text, setText] = useState('')

  useEffect(() => {
    if (status !== 'copied') return
    const id = setTimeout(() => setStatus('idle'), 1500)
    return () => clearTimeout(id)
  }, [status])

  async function copy(value: string): Promise<void> {
    setText(value)
    setStatus((await copyText(value)) ? 'copied' : 'failed')
  }

  return { status, text, copy, dismiss: () => setStatus('idle') }
}

export function CopyFallback({ text, onDone }: { text: string; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    // select() parks the caret at the end; the reader should see the top.
    el.scrollTop = 0
  }, [])

  const shortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C'

  return (
    <div class="composer">
      <div class="byline">
        <span>Clipboard unavailable. Press {shortcut} to copy.</span>
        <button class="link end" type="button" onClick={onDone}>
          Done
        </button>
      </div>
      <textarea
        ref={ref}
        readOnly
        value={text}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onDone()
          }
        }}
      />
    </div>
  )
}

/** Screen readers get the confirmation sighted users get from the label change. */
export function CopyAnnouncer({ status }: { status: CopyStatus }) {
  return (
    <span class="sr-only" aria-live="polite">
      {status === 'copied' ? 'Copied to clipboard' : ''}
    </span>
  )
}
