import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.TC_DB ?? resolve(process.cwd(), '../data/comments.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/**
 * Four tables. `users` never joins to `comments`: owners have accounts,
 * commenters never do, and keeping the two identity systems disconnected is
 * what lets the widget stay account-free.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  domain_pattern TEXT NOT NULL,
  project_key    TEXT NOT NULL UNIQUE,
  first_seen_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS threads (
  id               INTEGER PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_url         TEXT NOT NULL,
  selected_text    TEXT NOT NULL,
  text_before      TEXT NOT NULL DEFAULT '',
  text_after       TEXT NOT NULL DEFAULT '',
  start_offset     INTEGER NOT NULL DEFAULT 0,
  end_offset       INTEGER NOT NULL DEFAULT 0,
  resolved         INTEGER NOT NULL DEFAULT 0,
  resolved_at      TEXT,
  resolved_by_name TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_threads_page ON threads(project_id, page_url);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
`)

/**
 * Additive columns are applied as guarded ALTERs so an existing database picks
 * them up on restart. Nothing here is destructive and nothing needs a version
 * table: a column is either present or added.
 */
const projectColumns = new Set(
  (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name),
)
for (const column of [
  'telegram_token',
  'telegram_chat_id',
  'telegram_chat_name',
  'telegram_bot',
  'telegram_error',
  'telegram_error_at',
  'slack_webhook',
  'slack_error',
  'slack_error_at',
]) {
  if (!projectColumns.has(column)) db.exec(`ALTER TABLE projects ADD COLUMN ${column} TEXT`)
}

export interface User {
  id: number
  email: string
  password_hash: string
  created_at: string
}

export interface Project {
  id: number
  user_id: number
  name: string
  domain_pattern: string
  project_key: string
  first_seen_at: string | null
  created_at: string
  /** Per-project Telegram delivery. Token present, chat empty means "waiting for Start". */
  telegram_token: string | null
  telegram_chat_id: string | null
  telegram_chat_name: string | null
  telegram_bot: string | null
  telegram_error: string | null
  telegram_error_at: string | null
  /** Per-project Slack delivery: one incoming webhook, already bound to its channel. */
  slack_webhook: string | null
  slack_error: string | null
  slack_error_at: string | null
}

export interface Thread {
  id: number
  project_id: number
  page_url: string
  selected_text: string
  text_before: string
  text_after: string
  start_offset: number
  end_offset: number
  resolved: number
  resolved_at: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
}

export interface Comment {
  id: number
  thread_id: number
  name: string
  message: string
  created_at: string
  updated_at: string
  edited_at: string | null
}
