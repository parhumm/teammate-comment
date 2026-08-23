import { useEffect, useState } from 'preact/hooks'
import { Api, ApiError, type ThreadDto, type CommentDto } from './api.ts'
import {
  buildIndex,
  resolveAnchor,
  type Anchor,
  type Resolution,
  type TextIndex,
} from './anchor.ts'
import type { Span } from './highlights.ts'

const NAME_KEY = 'tc:name'

export interface ThreadState {
  dto: ThreadDto
  resolution: Resolution
}

export interface Draft {
  anchor: Anchor
  rect: DOMRect
}

export interface State {
  loading: boolean
  /** The page's comments could not be loaded. Retryable by re-fetching. */
  error: string | null
  /** A single write failed and was rolled back. Not a reason to re-fetch. */
  notice: string | null
  threads: ThreadState[]
  name: string
  /** A selection captured but not yet committed to a thread. */
  draft: Draft | null
  activeThreadId: number | null
  sidebarOpen: boolean
  showResolved: boolean
  /** Comment ids currently in flight, rendered at reduced opacity. */
  pending: Set<number>
  failed: Map<number, string>
}

type Listener = () => void

let tempId = -1
const nextTempId = () => tempId--

export class Store {
  state: State = {
    loading: true,
    error: null,
    notice: null,
    threads: [],
    name: readName(),
    draft: null,
    activeThreadId: null,
    sidebarOpen: false,
    showResolved: false,
    pending: new Set(),
    failed: new Map(),
  }

  private textIndex: TextIndex | null = null
  private listeners = new Set<Listener>()

  constructor(
    private readonly api: Api,
    private readonly pageUrl: string,
    private readonly excludeEl: Element,
  ) {}

  /**
   * The flattened page text, built on first use rather than at construction.
   *
   * Building it walks every text node on the page and retains a second copy of
   * all visible text. On a page with no comments, which is the common case for
   * a reader who never intends to annotate, none of that is ever needed. Paying
   * for it at boot would tax every visitor for a feature most never touch.
   */
  get index(): TextIndex {
    if (!this.textIndex) this.textIndex = buildIndex(document.body, this.excludeEl)
    return this.textIndex
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private withResolution(dto: ThreadDto): ThreadState {
    return {
      dto,
      resolution: resolveAnchor(this.index, {
        selectedText: dto.selected_text,
        textBefore: dto.text_before,
        textAfter: dto.text_after,
        startOffset: dto.start_offset,
        endOffset: dto.end_offset,
      }),
    }
  }

  async load(): Promise<void> {
    this.set({ loading: true, error: null })
    try {
      const { threads } = await this.api.list(this.pageUrl)
      // Resolution needs the text index, so it is only built once there is
      // actually something to anchor.
      const resolved = threads.length ? threads.map((dto) => this.withResolution(dto)) : []
      this.set({ loading: false, threads: resolved })
    } catch (err) {
      this.set({ loading: false, error: messageOf(err, "Couldn't load comments.") })
    }
  }

  setName(name: string): void {
    writeName(name)
    this.set({ name })
  }

  setDraft(draft: Draft | null): void {
    this.set({ draft, activeThreadId: draft ? null : this.state.activeThreadId })
  }

  /** Also clears any draft, so closing a popup is always a single update. */
  openThread(id: number | null): void {
    this.set({ activeThreadId: id, draft: null })
  }

  toggleSidebar(open?: boolean): void {
    this.set({ sidebarOpen: open ?? !this.state.sidebarOpen })
  }

  setShowResolved(showResolved: boolean): void {
    this.set({ showResolved })
  }

  dismissNotice(): void {
    this.set({ notice: null })
  }

  /**
   * A new thread appears the moment it is written, before the server has
   * confirmed it. Review is a flow state, and waiting on a round trip to see
   * your own sentence breaks it.
   */
  async createThread(anchor: Anchor, name: string, message: string): Promise<void> {
    this.setName(name)
    const optimisticId = nextTempId()
    const now = new Date().toISOString()

    const optimistic: ThreadDto = {
      id: optimisticId,
      page_url: this.pageUrl,
      selected_text: anchor.selectedText,
      text_before: anchor.textBefore,
      text_after: anchor.textAfter,
      start_offset: anchor.startOffset,
      end_offset: anchor.endOffset,
      resolved: false,
      resolved_at: null,
      resolved_by_name: null,
      created_at: now,
      updated_at: now,
      comments: [
        { id: optimisticId, thread_id: optimisticId, name, message, created_at: now, edited_at: null },
      ],
    }

    this.set({
      threads: [...this.state.threads, this.withResolution(optimistic)],
      pending: withId(this.state.pending, optimisticId),
      draft: null,
      activeThreadId: optimisticId,
    })

    try {
      const { thread } = await this.api.createThread({
        pageUrl: this.pageUrl,
        name,
        message,
        selectedText: anchor.selectedText,
        textBefore: anchor.textBefore,
        textAfter: anchor.textAfter,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
      })
      this.replaceThread(optimisticId, thread)
    } catch (err) {
      this.markFailed(optimisticId, err)
    }
  }

  async reply(threadId: number, name: string, message: string): Promise<void> {
    this.setName(name)
    const optimisticId = nextTempId()

    const optimistic: CommentDto = {
      id: optimisticId,
      thread_id: threadId,
      name,
      message,
      created_at: new Date().toISOString(),
      edited_at: null,
    }

    this.set({
      pending: withId(this.state.pending, optimisticId),
      threads: this.state.threads.map((t) =>
        t.dto.id === threadId
          ? { ...t, dto: { ...t.dto, comments: [...t.dto.comments, optimistic] } }
          : t,
      ),
    })

    try {
      const { comment } = await this.api.reply(threadId, name, message)
      this.set({
        pending: withoutId(this.state.pending, optimisticId),
        threads: mapComment(this.state.threads, optimisticId, () => comment),
      })
    } catch (err) {
      this.markFailed(optimisticId, err)
    }
  }

  /** Drops a failed optimistic write. Its text is already on screen to re-copy. */
  discardFailed(id: number): void {
    const failed = new Map(this.state.failed)
    failed.delete(id)
    this.set({
      failed,
      pending: withoutId(this.state.pending, id),
      threads: withoutComment(this.state.threads, id),
    })
  }

  async editComment(commentId: number, message: string): Promise<void> {
    const previous = this.state.threads
    this.set({
      notice: null,
      threads: mapComment(previous, commentId, (c) => ({
        ...c,
        message,
        edited_at: new Date().toISOString(),
      })),
    })
    try {
      await this.api.editComment(commentId, message)
    } catch (err) {
      this.rollback(previous, err, "Couldn't save that edit.")
    }
  }

  async deleteComment(commentId: number): Promise<void> {
    const previous = this.state.threads
    this.set({ notice: null, threads: withoutComment(previous, commentId) })
    try {
      await this.api.deleteComment(commentId)
    } catch (err) {
      this.rollback(previous, err, "Couldn't delete that comment.")
    }
  }

  async toggleResolve(threadId: number): Promise<void> {
    const target = this.state.threads.find((t) => t.dto.id === threadId)
    if (!target) return

    const resolved = !target.dto.resolved
    const previous = this.state.threads

    this.set({
      notice: null,
      threads: previous.map((t) =>
        t.dto.id === threadId ? { ...t, dto: { ...t.dto, resolved } } : t,
      ),
    })

    try {
      const { thread } = await this.api.setResolved(threadId, resolved, this.state.name)
      this.replaceThread(threadId, thread)
    } catch (err) {
      this.rollback(previous, err, resolved ? "Couldn't resolve that." : "Couldn't reopen that.")
    }
  }

  /**
   * Restores pre-write state and reports it as a notice.
   *
   * Deliberately not `state.error`: that one means the page's comments could
   * not be loaded and offers to re-fetch, which is a nonsense response to a
   * failed edit.
   */
  private rollback(previous: ThreadState[], err: unknown, fallback: string): void {
    this.set({ threads: previous, notice: messageOf(err, fallback) })
  }

  /**
   * Merges rather than overwrites. A server response is authoritative about the
   * fields it sends, not about the ones it omits, and a thread arriving without
   * its comments should not blank the conversation off the screen.
   */
  private replaceThread(id: number, dto: ThreadDto): void {
    const existing = this.state.threads.find((t) => t.dto.id === id)
    const merged: ThreadDto = { ...dto, comments: dto.comments ?? existing?.dto.comments ?? [] }

    this.set({
      pending: withoutId(this.state.pending, id),
      activeThreadId: this.state.activeThreadId === id ? merged.id : this.state.activeThreadId,
      threads: this.state.threads.map((t) => (t.dto.id === id ? this.withResolution(merged) : t)),
    })
  }

  private markFailed(id: number, err: unknown): void {
    this.set({
      failed: new Map(this.state.failed).set(id, messageOf(err, "Didn't send.")),
      pending: withoutId(this.state.pending, id),
    })
  }
}

/* ------------------------------------------------------------- helpers -- */

function withId(set: Set<number>, id: number): Set<number> {
  return new Set(set).add(id)
}

function withoutId(set: Set<number>, id: number): Set<number> {
  const next = new Set(set)
  next.delete(id)
  return next
}

function mapComment(
  threads: ThreadState[],
  commentId: number,
  fn: (c: CommentDto) => CommentDto,
): ThreadState[] {
  return threads.map((t) => ({
    ...t,
    dto: { ...t.dto, comments: t.dto.comments.map((c) => (c.id === commentId ? fn(c) : c)) },
  }))
}

/**
 * Removes a comment, and any thread left empty by its removal. A thread with
 * nothing in it is a highlight with no reason to exist.
 */
function withoutComment(threads: ThreadState[], commentId: number): ThreadState[] {
  return threads
    .map((t) => ({
      ...t,
      dto: { ...t.dto, comments: t.dto.comments.filter((c) => c.id !== commentId) },
    }))
    .filter((t) => t.dto.comments.length > 0)
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* private mode, or storage disabled: the name simply is not remembered */
  }
}

export function useStore(store: Store): State {
  const [, force] = useState(0)
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
  return store.state
}

/* ------------------------------------------------------------ queries -- */

export function isOrphan(t: ThreadState): boolean {
  return t.resolution.status === 'orphan'
}

/**
 * The one place the `Resolution` union is narrowed.
 *
 * Without it every consumer pairs its own orphan check with its own cast, so
 * the compiler never connects the two and the invariant is upheld by
 * convention at each site instead of once here.
 */
export function spanOf(t: ThreadState): Span | null {
  return t.resolution.status === 'orphan'
    ? null
    : { start: t.resolution.start, end: t.resolution.end }
}

/** Open, anchored threads. These and only these drive the highlights. */
export function openSpans(threads: ThreadState[]): Span[] {
  const spans: Span[] = []
  for (const t of threads) {
    if (t.dto.resolved) continue
    const span = spanOf(t)
    if (span) spans.push(span)
  }
  return spans
}

/**
 * Which thread covers a character offset, smallest range first.
 *
 * Smallest wins because with overlapping highlights it is the most specific
 * thing the reader could have been pointing at. This is a query over thread
 * data rather than a rendering concern, so it lives here where hover or
 * keyboard navigation can reach it too.
 */
export function threadAt(threads: ThreadState[], offset: number): ThreadState | null {
  let best: ThreadState | null = null
  let bestWidth = Infinity

  for (const t of threads) {
    const span = spanOf(t)
    if (!span || offset < span.start || offset >= span.end) continue
    const width = span.end - span.start
    if (width < bestWidth) {
      best = t
      bestWidth = width
    }
  }
  return best
}

/**
 * A cheap identity for the current highlight geometry.
 *
 * Repainting is keyed on this rather than on the `threads` array, whose
 * identity changes on every mutation. Editing a comment's text would otherwise
 * re-segment and re-register every highlight on the page for no visual change.
 */
export function spansKey(threads: ThreadState[]): string {
  return openSpans(threads)
    .map((s) => `${s.start}-${s.end}`)
    .join(',')
}
