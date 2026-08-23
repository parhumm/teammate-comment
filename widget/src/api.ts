export interface CommentDto {
  id: number
  thread_id: number
  name: string
  message: string
  created_at: string
  edited_at: string | null
}

export interface ThreadDto {
  id: number
  page_url: string
  selected_text: string
  text_before: string
  text_after: string
  start_offset: number
  end_offset: number
  resolved: boolean
  resolved_at: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
  comments: CommentDto[]
}

export class ApiError extends Error {}

/**
 * The widget always talks cross-origin, so any response can legitimately be a
 * domain rejection. Errors carry the server's own sentence rather than a
 * generic failure string, because the server is the only thing that knows
 * whether this was a bad key, a wrong domain, or a genuine outage.
 */
export class Api {
  constructor(
    private readonly origin: string,
    private readonly key: string,
  ) {}

  /**
   * The project key travels in the query string on every request, including
   * writes.
   *
   * It is a per-request credential, which is transport rather than payload.
   * Carrying it in the body would force the server's gate to read and parse the
   * body before routing, and would reserve `key` as a field name in every
   * application payload alongside `name` and `message`.
   */
  private url(path: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams({ key: this.key, ...params })
    return `${this.origin}/api${path}?${query}`
  }

  private async send<T>(path: string, init?: RequestInit & { params?: Record<string, string> }): Promise<T> {
    const { params, ...rest } = init ?? {}

    let response: Response
    try {
      response = await fetch(this.url(path, params), {
        ...rest,
        // Content-Type is only set when there is a body to describe. Adding it
        // to a GET would turn every read into a preflighted request for no
        // reason, doubling the round trips on the most common call.
        headers: rest.body ? { 'Content-Type': 'application/json' } : {},
      })
    } catch {
      throw new ApiError("Couldn't reach the comment server.")
    }

    const body = await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(body?.error ?? "Couldn't load comments.")
    return body as T
  }

  list(pageUrl: string): Promise<{ threads: ThreadDto[] }> {
    return this.send('/threads', { params: { url: pageUrl } })
  }

  createThread(payload: {
    pageUrl: string
    name: string
    message: string
    selectedText: string
    textBefore: string
    textAfter: string
    startOffset: number
    endOffset: number
  }): Promise<{ thread: ThreadDto }> {
    return this.send('/threads', { method: 'POST', body: JSON.stringify(payload) })
  }

  reply(threadId: number, name: string, message: string): Promise<{ comment: CommentDto }> {
    return this.send(`/threads/${threadId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ name, message }),
    })
  }

  editComment(commentId: number, message: string): Promise<{ comment: CommentDto }> {
    return this.send(`/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ message }),
    })
  }

  deleteComment(commentId: number): Promise<{ ok: true; threadDeleted: boolean }> {
    return this.send(`/comments/${commentId}`, { method: 'DELETE' })
  }

  setResolved(threadId: number, resolved: boolean, name: string): Promise<{ thread: ThreadDto }> {
    return this.send(`/threads/${threadId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolved, name }),
    })
  }
}
