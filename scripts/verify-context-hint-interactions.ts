/** Settled-interaction public seam supplement; final acceptance uses the packed host. */
import assert from 'node:assert/strict'
import { createHintInteractions } from '../src/dsh-adapter/context-hint/interactions.js'

const interactions = createHintInteractions()
interactions.reset(10, true, false)
assert.equal(interactions.observe({ seq: 9, type: 'turn/end', data: { turn: 1 } }), false, 'restored work is not new work')
assert.equal(interactions.observe({ seq: 10, type: 'turn/start', data: { turn: 2 } }), false)
assert.equal(interactions.observe({ seq: 11, type: 'user/message', data: { source: { kind: 'user' } } }), false)
assert.equal(interactions.observe({ seq: 12, type: 'tool/result', data: {} }), false, 'tool steps do not settle the interaction')
assert.equal(interactions.observe({ seq: 13, type: 'assistant/chunk', data: {} }), false, 'tokens do not settle the interaction')
assert.equal(interactions.observe({ seq: 14, type: 'turn/end', data: { turn: 2 } }), true, 'one human interaction permits one summary')
assert.equal(interactions.observe({ seq: 14, type: 'turn/end', data: { turn: 2 } }), false, 'duplicate end cannot generate twice')
console.log('PASS one settled human interaction, not history/tool/token/repaint')

interactions.reset(15, true, false)
interactions.observe({ seq: 15, type: 'turn/start', data: { turn: 3 } })
interactions.claimed({ source: { kind: 'user' } })
assert.equal(interactions.observe({ seq: 16, type: 'turn/end', data: { turn: 3, reason: { kind: 'error' } } }), true,
  'a claimed human interaction can fail before the host appends its user message')
console.log('PASS failed claimed interaction remains eligible without inventing a user log entry')

for (const [enabled, paused] of [[false, false], [true, true]]) {
  interactions.reset(20, enabled, paused)
  interactions.observe({ seq: 20, type: 'turn/start', data: { turn: 4 } })
  interactions.claimed({ source: { kind: 'user' } })
  assert.equal(interactions.observe({ seq: 21, type: 'turn/end', data: { turn: 4 } }), false)
}
interactions.reset(22, true, false)
assert.equal(interactions.observe({ seq: 21, type: 'turn/end', data: { turn: 4 } }), false, 'resume never replays paused backlog')
interactions.observe({ seq: 22, type: 'turn/start', data: { turn: 5 } })
interactions.claimed({ source: { kind: 'runtime-context' } })
assert.equal(interactions.observe({ seq: 23, type: 'turn/end', data: { turn: 5 } }), false, 'runtime context is not human input')
interactions.observe({ seq: 24, type: 'turn/start', data: { turn: 6 } })
interactions.claimed({ source: { kind: 'user' } })
interactions.reset(25, true, false)
assert.equal(interactions.observe({ seq: 25, type: 'turn/end', data: { turn: 6 } }), false, 'enable/resume halfway through an old turn is not future work')
console.log('PASS disabled, paused, resumed and restored boundaries stay silent')
