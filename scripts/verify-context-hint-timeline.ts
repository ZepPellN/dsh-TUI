/** Timeline applicability seam for #7; final acceptance uses the packed host.
 * Run: node --import tsx/esm scripts/verify-context-hint-timeline.ts
 */
import assert from 'node:assert/strict'
import { cardApplicability, latestInteractionOffset, restoreTimelineCard, type TimelineEvent } from '../src/dsh-adapter/context-hint/timeline.js'
import { parseHintResult } from '../src/dsh-adapter/context-hint/result.js'

const event = (seq: number, type: string): TimelineEvent => ({ seq, type })
const events = (...items: TimelineEvent[]) => items

assert.equal(latestInteractionOffset(events()), 0, 'empty log has no interaction')
assert.equal(latestInteractionOffset(events(event(0, 'turn/start'), event(1, 'user/message'), event(2, 'turn/end'))), 3)
assert.equal(latestInteractionOffset(events(event(0, 'turn/start'), event(1, 'turn/end'), event(2, 'session/title'))), 2,
  'host bookkeeping does not move the interaction anchor')
assert.equal(latestInteractionOffset(events(event(0, 'session/title'), event(1, 'session/end-seed'))), 0)

const settled = events(event(0, 'turn/start'), event(1, 'user/message'), event(2, 'assistant/message'), event(3, 'turn/end'))
assert.equal(cardApplicability(4, settled), 'current', 'a card at the settled tip describes the timeline')
assert.equal(cardApplicability(4, [...settled, event(4, 'session/title')]), 'current', 'bookkeeping after the card does not stale it')
assert.equal(cardApplicability(4, [...settled, event(4, 'turn/start')]), 'stale', 'a newer open turn is not described by the card')
assert.equal(cardApplicability(4, [...settled, event(4, 'user/message'), event(5, 'turn/start')]), 'stale',
  'work started while paused/offline makes the saved card stale')
assert.equal(cardApplicability(4, [...settled, event(4, 'turn/start'), event(5, 'turn/end')]), 'stale',
  'a newer settled interaction is not described by the card')
assert.equal(cardApplicability(2, settled), 'stale', 'an anchor inside an existing turn is stale')
assert.equal(cardApplicability(0, events()), 'current', 'an empty timeline is described by a zero anchor')
console.log('PASS card applicability distinguishes newer interactions from host bookkeeping')

const result = parseHintResult(JSON.stringify({
  session: { goal: 'TIMELINE_GOAL', status: 'TIMELINE_STATUS', blockers: [], next: 'TIMELINE_NEXT' },
  turn: { completed: ['TIMELINE_DONE'], findings: [], verification: ['TIMELINE_VERIFY'], failures: [], outcome: 'completed' },
}))
const envelope = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  identity: 'project:/repo/.git', sessionId: 'session-a', eventOffset: 4, cards: result, provider: 'fixture', model: 'summary', ...overrides,
})
const input = (value: unknown, extra: Partial<Parameters<typeof restoreTimelineCard>[0]> = {}) => restoreTimelineCard({
  value, identity: 'project:/repo/.git', sessionId: 'session-a', liveOffset: 4, events: settled, ...extra,
})

assert.deepEqual(input(null), { state: 'absent' }, 'no record is not a card')
assert.deepEqual(input('garbage'), { state: 'foreign' }, 'non-object storage value is never adopted')
assert.deepEqual(input(envelope({ identity: 'project:/other/.git' })), { state: 'foreign' }, 'another Project cannot supply a card')
assert.deepEqual(input(envelope({ sessionId: 'session-b' })), { state: 'foreign' }, 'another session cannot supply a card')
assert.deepEqual(input(envelope({ eventOffset: 5 })), { state: 'foreign' }, 'an anchor beyond the live log is impossible')
assert.deepEqual(input(envelope({ eventOffset: -1 })), { state: 'foreign' }, 'a negative anchor is impossible')
assert.deepEqual(input(envelope({ eventOffset: 1.5 })), { state: 'foreign' }, 'a fractional anchor is impossible')
console.log('PASS stored envelopes require the same Project, session and a possible anchor')

const current = input(envelope({ failed: true }))
assert.equal(current.state, 'current')
if (current.state === 'current') {
  assert.deepEqual(current.card.cards.session.goal, 'TIMELINE_GOAL')
  assert.equal(current.card.eventOffset, 4)
  assert.equal(current.card.failed, true, 'a failure marker on the same timeline is retained for the Last Valid display')
  assert.deepEqual(current.card.route, { provider: 'fixture', model: 'summary' })
}
const withoutRoute = input(envelope({ provider: undefined, model: undefined }))
assert.equal(withoutRoute.state, 'current')
if (withoutRoute.state === 'current') assert.equal(withoutRoute.card.route, undefined)
console.log('PASS current card keeps Last Valid content, failure marker and persisted route')

const stale = input(envelope({ failed: true }), { events: [...settled, event(4, 'turn/start')], liveOffset: 5 })
assert.deepEqual(stale, { state: 'stale' },
  'a card from an earlier point of this timeline is pending, and its failure marker does not leak into the current timeline')
assert.deepEqual(input(envelope(), { events: [...settled, event(4, 'turn/start')], liveOffset: 5 }), { state: 'stale' })
assert.deepEqual(input(envelope({ cards: { session: {} } })), { state: 'corrupt' }, 'unusable payload on the same timeline keeps a failure marker')
console.log('PASS stale and corrupt records never become the current Last Valid Card')

// A rewind/fork child copies the parent's event prefix (seed) but owns a new
// session id: replaying that prefix must not revive the parent's conclusion.
const childEvents = events(event(0, 'turn/start'), event(1, 'user/message'), event(2, 'turn/end'), event(3, 'session/end-seed'))
assert.deepEqual(input(envelope({ eventOffset: 3 }), { sessionId: 'rewind-child', liveOffset: 4, events: childEvents }),
  { state: 'foreign' }, 'a rewind/fork child does not inherit the parent card through its seeded prefix')
const childOwn = input(envelope({ sessionId: 'rewind-child', eventOffset: 3 }), { sessionId: 'rewind-child', liveOffset: 4, events: childEvents })
assert.equal(childOwn.state, 'current', 'its own card at the inherited cut is applicable when no new interaction follows')
console.log('PASS forbidding the parent card inside a seeded child; the child owns only its own anchor')

// A saved child card anchored before the branch point is abandoned by that
// rewind: the child log's own prefix ends before the card's capture point.
assert.deepEqual(input(envelope({ sessionId: 'rewind-child', eventOffset: 2 }), { sessionId: 'rewind-child', liveOffset: 4, events: childEvents }),
  { state: 'stale' }, 'an anchor cut away by a rewind is stale, not reusable')
console.log('PASS abandoned timeline anchors do not become the current card')
