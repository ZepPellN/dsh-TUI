/**
 * Bounded latest-card records in the admitted component namespace.
 *
 * A session owns exactly one `session:<id>` key, always replaced in place: no
 * generation history, raw prompt or tool-output copy is kept here. Reads
 * validate the full envelope before any card can reach the UI, and every
 * mutation carries the caller's invalidation fence so a late request cannot
 * recreate data that was deleted, disabled or rebound.
 */
import type { TuiPluginStorage } from '../plugin-storage.js'
import { withStorageWriteGuard } from '../plugin-storage.js'
import { parseHintResult, type HintResult } from './result.js'
import type { HintRoute } from './selection.js'

export const HINT_SESSION_KEY_PREFIX = 'session:'
/** Admitted session ids stay far below storage's 128-character key limit. */
export const HINT_SESSION_ID_MAX_LENGTH = 100

export interface HintSessionRecord {
  cards: HintResult
  eventOffset: number
  route?: HintRoute
  failed?: boolean
}

export type HintSessionRead =
  | { status: 'empty' }
  | { status: 'ok'; record: HintSessionRecord }
  | { status: 'corrupt' }

/** Storage and OS error codes that make an optional write fail loudly. */
const STORAGE_FAILURE_CODES = new Set(['QUOTA_EXCEEDED', 'STORAGE_UNAVAILABLE', 'ENOSPC', 'EACCES', 'EPERM', 'EROFS'])

/** Capacity, corruption, permission and unwritable-device failures are storage
 * problems, not summary results: the TUI must report them separately so the
 * user knows retained cards were not replaced by a failed write. */
export function isHintStorageFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && STORAGE_FAILURE_CODES.has(code)
}

export function hintSessionKey(sessionId: string): string {
  if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > HINT_SESSION_ID_MAX_LENGTH
    || /[\x00-\x1f\x7f-\x9f]/u.test(sessionId)) {
    throw new Error('Invalid Context Hint session identity')
  }
  return `${HINT_SESSION_KEY_PREFIX}${sessionId}`
}

function routePart(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f-\x9f]/u.test(value)
}

/** Strict read-time validation: mismatched identity, stale/garbage offsets,
 * partial routes, non-boolean failure markers or invalid cards are corrupt,
 * never silently shown, repaired or treated as empty success. */
export function parseHintSessionValue(value: unknown, identity: string, sessionId: string, liveOffset: number): HintSessionRead {
  if (value === null) return { status: 'empty' }
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' }
  const saved = value as Record<string, unknown>
  if (saved.identity !== identity || saved.sessionId !== sessionId) return { status: 'corrupt' }
  if (typeof saved.eventOffset !== 'number' || !Number.isSafeInteger(saved.eventOffset)
    || saved.eventOffset < 0 || saved.eventOffset > liveOffset) return { status: 'corrupt' }
  let route: HintRoute | undefined
  if (saved.provider !== undefined || saved.model !== undefined) {
    if (!routePart(saved.provider) || !routePart(saved.model)) return { status: 'corrupt' }
    route = { provider: saved.provider, model: saved.model }
  }
  if (saved.failed !== undefined && typeof saved.failed !== 'boolean') return { status: 'corrupt' }
  try {
    const cards = parseHintResult(JSON.stringify(saved.cards))
    return {
      status: 'ok',
      record: {
        cards,
        eventOffset: saved.eventOffset,
        ...(route === undefined ? {} : { route }),
        ...(saved.failed === true ? { failed: true } : {}),
      },
    }
  } catch {
    return { status: 'corrupt' }
  }
}

export async function readHintSession(storage: TuiPluginStorage, identity: string, sessionId: string,
  liveOffset: number): Promise<HintSessionRead> {
  const { value } = await storage.get({ key: hintSessionKey(sessionId) })
  return parseHintSessionValue(value, identity, sessionId, liveOffset)
}

/** One latest envelope per session; bounds come from the result parser. */
export function writeHintSession(storage: TuiPluginStorage, identity: string, sessionId: string,
  record: HintSessionRecord, current: () => boolean): Promise<{ stored: true }> {
  const value = {
    identity,
    sessionId,
    eventOffset: record.eventOffset,
    cards: record.cards,
    ...(record.route === undefined ? {} : { provider: record.route.provider, model: record.route.model }),
    ...(record.failed === true ? { failed: true } : {}),
  }
  return withStorageWriteGuard(current, () => storage.set({ key: hintSessionKey(sessionId), value }))
}

/** Delete only this session's card envelope. The fence is rechecked inside
 * storage's own lock, so a deletion invalidated by a rebind does not commit. */
export function deleteHintSession(storage: TuiPluginStorage, sessionId: string,
  current: () => boolean): Promise<{ deleted: boolean }> {
  return withStorageWriteGuard(current, () => storage.delete({ key: hintSessionKey(sessionId) }))
}
