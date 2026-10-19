/** Public bounded-input supplement; the real packed journey remains acceptance. */
import assert from 'node:assert/strict'
import { createHintPrompt, hintTurnOutcome } from '../src/dsh-adapter/context-hint/input.js'

const prompt = createHintPrompt([
  { type: 'system/message', data: { content: [{ type: 'text', text: 'PRIVATE_SYSTEM_SENTINEL' }] } },
  { type: 'user/message', data: { content: [{ type: 'text', text: 'old'.repeat(10000) }] } },
  { type: 'user/message', data: { content: [{ type: 'text', text: 'LATEST_USER' }] } },
  { type: 'tool/result', data: { message: { isError: true, content: [{ type: 'text', text: 'ACTUAL_TOOL_FAILURE' }] } } },
  { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } },
])
assert(prompt.length <= 12000, 'entire request prompt, including instructions, is bounded')
assert(!prompt.includes('PRIVATE_SYSTEM_SENTINEL'), 'no inherited system/developer/header payload')
assert(prompt.includes('LATEST_USER') && prompt.includes('ACTUAL_TOOL_FAILURE'), 'newest text and real tool failures survive')
assert(prompt.includes('aborted'), 'actual cancellation is disclosed, not inferred success')
assert.throws(() => createHintPrompt([]), 'no empty activity request')
const selected = createHintPrompt([
  { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'HUMAN_REQUEST' }] } },
  { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'INJECTED_RUNTIME' }] } },
  { type: 'user/message', data: { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'INJECTED_SKILLS' }] } },
  { type: 'user/message', data: { source: { kind: 'time-context' }, content: [{ type: 'text', text: 'INJECTED_TIME' }] } },
])
assert(selected.includes('HUMAN_REQUEST') && !selected.includes('INJECTED_'), 'select human activity, not host-injected user-role prompt instructions')
assert.equal(hintTurnOutcome([{ type: 'turn/end', data: { reason: { kind: 'completed' } } }]), 'completed')
assert.equal(hintTurnOutcome([{ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }]), 'cancelled')
assert.equal(hintTurnOutcome([{ type: 'turn/end', data: { reason: { kind: 'error' } } }]), 'failed')
assert.throws(() => hintTurnOutcome([]), 'no completed interaction to summarize')
assert.throws(() => hintTurnOutcome([{ type: 'turn/end', data: { reason: { kind: 'completed' } } }, { type: 'turn/start', data: {} }]), 'a previous completion does not settle a new live turn')
console.log('PASS Context Hint public bounded-input boundary')
