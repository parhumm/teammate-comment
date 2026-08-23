import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { db, type User } from './db.ts'

const SECRET_PATH = process.env.TC_SECRET_FILE ?? resolve(process.cwd(), '../data/.secret')
const COOKIE = 'tc_session'
const MAX_AGE = 60 * 60 * 24 * 30

/**
 * scrypt from node core rather than argon2id. argon2 is the stronger modern
 * choice, but it is a native module, and scrypt is a well-regarded KDF that
 * ships in the standard library. For a private V1 that trade buys a
 * dependency-free install; revisit before opening signups to strangers.
 */
const N = 16384
const KEYLEN = 32

function loadSecret(): Buffer {
  if (process.env.TC_SECRET) return Buffer.from(process.env.TC_SECRET, 'utf8')
  mkdirSync(dirname(SECRET_PATH), { recursive: true })
  if (!existsSync(SECRET_PATH)) {
    writeFileSync(SECRET_PATH, randomBytes(32).toString('hex'), { mode: 0o600 })
  }
  return Buffer.from(readFileSync(SECRET_PATH, 'utf8').trim(), 'utf8')
}

const SECRET = loadSecret()

/** Compiled once: this runs on every authenticated panel request. */
const userById = db.prepare('SELECT * FROM users WHERE id = ?')

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEYLEN, { N })
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt') return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(password, salt, expected.length, { N: Number(n) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export function startSession(c: Context, userId: number): void {
  const payload = `${userId}.${Date.now()}`
  setCookie(c, COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  })
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/' })
}

/**
 * Returns the signed-in user, or null. The signature is verified before the id
 * is trusted, and an expired issue time is rejected even though the cookie
 * Max-Age should already have removed it.
 */
export function currentUser(c: Context): User | null {
  const raw = getCookie(c, COOKIE)
  if (!raw) return null

  const idx = raw.lastIndexOf('.')
  if (idx < 0) return null

  const payload = raw.slice(0, idx)
  const provided = raw.slice(idx + 1)
  const expected = sign(payload)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [idStr, issuedStr] = payload.split('.')
  if (Date.now() - Number(issuedStr) > MAX_AGE * 1000) return null

  return (userById.get(Number(idStr)) as User | undefined) ?? null
}

export function newProjectKey(): string {
  return randomBytes(9).toString('base64url')
}
