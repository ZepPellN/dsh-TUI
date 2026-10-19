/** Supplementary public result boundary. Run: node --import tsx/esm scripts/verify-context-hint-result.ts */
import assert from 'node:assert/strict'
import { parseHintResult } from '../src/dsh-adapter/context-hint/result.js'

const valid = {
  session: { goal: 'Fix startup', status: 'Loader fixed; tests remain', blockers: [], next: 'Run packed startup' },
  turn: { completed: ['Updated loader'], findings: [], verification: ['Import passed'], failures: [], outcome: 'completed' },
}
assert.deepEqual(parseHintResult(JSON.stringify(valid)), valid)
assert.throws(() => parseHintResult('{bad json'))
assert.throws(() => parseHintResult('```json\n' + JSON.stringify(valid) + '\n```'))
assert.throws(() => parseHintResult(JSON.stringify({ session: valid.session })))
for (const key of Object.keys(valid.turn)) {
  const turn = { ...valid.turn }
  delete turn[key as keyof typeof turn]
  assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn })), `required Turn.${key}`)
}
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, session: { ...valid.session, goal: '' } })))
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn: { ...valid.turn, verification: 'passed' } })))
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn: { ...valid.turn, outcome: 'success' } })))
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn: { completed: [], findings: [], verification: [], failures: [], outcome: 'completed' } })))
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, session: { ...valid.session, status: 'x'.repeat(801) } })))
assert.throws(() => parseHintResult(' '.repeat(16001)))
for (const unsafe of ['\u001b', '\u009b', '\u0000\u0007', '\u001b[31m\u001b[0m', '\u009b31m\u009b0m', '\u001b]0;title\u0007']) {
  assert.throws(() => parseHintResult(JSON.stringify({ ...valid, session: { ...valid.session, goal: unsafe } })), 'control-only required string')
  assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn: { ...valid.turn, completed: [unsafe] } })), 'control-only list entry')
}
assert.equal(parseHintResult(JSON.stringify({ ...valid, session: { ...valid.session, goal: '\u001b[31mSafe\u001b[0m' } })).session.goal, 'Safe')
assert.throws(() => parseHintResult(JSON.stringify(valid), 'failed'), 'known failed interaction cannot become a completed Turn')
assert.throws(() => parseHintResult(JSON.stringify(valid), 'cancelled'), 'known cancelled interaction cannot become a completed Turn')
assert.throws(() => parseHintResult(JSON.stringify({ ...valid, turn: { ...valid.turn, outcome: 'failed' } })), 'failed Turn requires a failure description')
assert.equal(parseHintResult(JSON.stringify({ ...valid, turn: { ...valid.turn, failures: ['User cancelled'], outcome: 'cancelled' } }), 'cancelled').turn.outcome, 'cancelled')
console.log('PASS Context Hint strict Session/Turn result boundary')
