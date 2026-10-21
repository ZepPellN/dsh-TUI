import { parseHintResult, type HintResult } from './result.js'
import type { HintRoute } from './selection.js'

/**
 * Card timeline applicability.
 *
 * A persisted Session/Turn card describes one point of ONE session log. The
 * live binding may move on (another settled interaction, an open turn, a
 * rewind/fork child with a different session id), so a stored envelope is not
 * automatically a Last Valid Card for whatever is on screen now. This module
 * owns that judgment; it never generates, persists or mutates host state.
 *
 * @module @deepseek-harness-tui/dsh-tui/context-hint/timeline
 */

/** Structural event shape: timeline policy never depends on the live Session facade. */
export interface TimelineEvent {
  readonly seq: number
  readonly type: string
}

/** Events that describe conversation work. Host bookkeeping is not an interaction. */
const INTERACTION_EVENTS: ReadonlySet<string> = new Set([
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/** Exclusive offset after the last interaction-bearing event, or 0 when there is none. */
export function latestInteractionOffset(events: readonly TimelineEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event !== undefined && INTERACTION_EVENTS.has(event.type)) return event.seq + 1
  }
  return 0
}

export type CardApplicability = 'current' | 'stale'

/**
 * A card still describes the live timeline only while no interaction follows
 * the position it was generated from. Bookkeeping events appended after the
 * card (titles, markers) do not invalidate it; a newer turn does.
 */
export function cardApplicability(offset: number, events: readonly TimelineEvent[]): CardApplicability {
  return latestInteractionOffset(events) <= offset ? 'current' : 'stale'
}

/** Validated persisted envelope for one session's latest applicable card. */
export interface StoredTimelineCard {
  readonly identity: string
  readonly sessionId: string
  readonly eventOffset: number
  readonly cards: HintResult
  readonly failed: boolean
  readonly route?: HintRoute
}

/**
 * Why an envelope is not the current Last Valid Card:
 * - absent:   no record for this session yet (first use, new/rewound/forked session).
 * - foreign:  another Project/session wrote it, or its anchor is impossible here.
 * - stale:    it describes an earlier point of THIS timeline (newer work exists).
 * - corrupt:  same timeline, but its cards cannot be validated; keep the failure marker.
 */
export type RestoredTimelineCard =
  | { readonly state: 'absent' | 'foreign' | 'stale' }
  | { readonly state: 'corrupt' }
  | { readonly state: 'current'; readonly card: StoredTimelineCard }

function route(value: unknown): HintRoute | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return typeof record.provider === 'string' && typeof record.model === 'string'
    ? { provider: record.provider, model: record.model }
    : undefined
}

/**
 * Validate one persisted envelope and decide whether it is the current card.
 * The caller supplies the live session identity/offset and its full snapshot:
 * a card is never adopted through session id alone.
 */
export function restoreTimelineCard(input: {
  readonly value: unknown
  readonly identity: string
  readonly sessionId: string
  readonly liveOffset: number
  readonly events: readonly TimelineEvent[]
}): RestoredTimelineCard {
  if (input.value === null || input.value === undefined) return { state: 'absent' }
  if (typeof input.value !== 'object' || Array.isArray(input.value)) return { state: 'foreign' }
  const saved = input.value as Record<string, unknown>
  if (saved.identity !== input.identity || saved.sessionId !== input.sessionId) return { state: 'foreign' }
  const offset = saved.eventOffset
  // A position beyond the live log is impossible (truncated/foreign storage):
  // it can never be an applicable card for this timeline.
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > input.liveOffset) {
    return { state: 'foreign' }
  }
  if (cardApplicability(offset, input.events) === 'stale') return { state: 'stale' }
  try {
    const cards = parseHintResult(JSON.stringify(saved.cards))
    return {
      state: 'current',
      card: {
        identity: input.identity,
        sessionId: input.sessionId,
        eventOffset: offset,
        cards,
        failed: saved.failed === true,
        ...(route(saved) === undefined ? {} : { route: route(saved) }),
      },
    }
  } catch {
    // Same timeline but unusable payload: keep the failure marker, drop the card.
    return { state: 'corrupt' }
  }
}
