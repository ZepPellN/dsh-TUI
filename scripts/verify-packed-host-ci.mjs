/** Public parsed-screen readiness and packed workflow/fail-closed regression.
 * Runs the actual ci-gate shell step with success/failure/cancel/missing results.
 * node scripts/verify-packed-host-ci.mjs (no GitHub writes or runner claims).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { workspacePickerReady, newSessionActionReady } from './lib/packed-host-screen.mjs'

// Public parsed screens retained from push run 39100161698 on macOS. The
// failed startup had the card before hydration; its later timeout screen had
// the hydrated workspace and focused card, but the earlier Ctrl+N was lost.
const loading = readFileSync(new URL('./fixtures/packed-host/loading-picker.txt', import.meta.url), 'utf8')
const ready = readFileSync(new URL('./fixtures/packed-host/ready-picker.txt', import.meta.url), 'utf8')
const unfocusedCard = ready.replace('❯ + New session', '  + New session')
const cases = [
  ['cold loading screen is not a workspace or key-action precondition', loading, false, false],
  ['hydrated picker without list cursor still needs Right acknowledgement', unfocusedCard, true, false],
  ['hydrated picker with focused card can accept Ctrl+N', ready, true, true],
  ['workspace identity must match the owned launch workspace', ready.replaceAll('workspace', 'other-project'), false, false],
  ['a visible cursor during refresh is not ready', ready + '\nLoading sessions… · refreshing', false, false],
]
assert.deepEqual(cases.map(([name, screen]) => [name,
  workspacePickerReady(screen, 'workspace'), newSessionActionReady(screen, 'workspace'),
]), cases.map(([name, , workspaceReady, actionReady]) => [name, workspaceReady, actionReady]))
console.log('PASS parsed picker screens: hydration, owned workspace and acknowledged list focus precede keys')

const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'))
assert(ci.on.pull_request !== undefined || Object.hasOwn(ci.on, 'pull_request'))
assert(ci.on.push.branches.includes('main'))
assert(ci.on.push.branches.includes('codex/context-hint-integration'), 'integration pushes must run CI')
const packed = ci.jobs['packed-host']
assert(packed, 'required real packed startup job')
assert.deepEqual(packed.strategy.matrix.os, ['ubuntu-latest', 'macos-latest'])
assert.equal(packed.strategy['fail-fast'], false)
assert.equal(packed['continue-on-error'], undefined)
assert(packed.steps.some(s => s.run?.includes('verify-packed-host.mjs')))
assert(packed.steps.some(s => s.uses?.startsWith('actions/upload-artifact@') && s.if === 'always()'))
const gate = ci.jobs['ci-gate']
assert(gate.needs.includes('packed-host'))
assert.equal(gate.if, 'always()')
const step = gate.steps.find(s => s.run)
assert.equal(step.env.PACKED_HOST, '${{ needs.packed-host.result }}')
const success = Object.fromEntries(Object.keys(step.env).map(key => [key, key === 'CODE' ? 'true' : 'success']))
const check = env => spawnSync('bash', ['-c', step.run], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
assert.equal(check(success).status, 0, 'all required checks pass')
for (const result of ['failure', 'cancelled', 'skipped', '']) {
  assert.notEqual(check({ ...success, PACKED_HOST: result }).status, 0, `packed host ${result || 'missing'} must fail`)
}
for (const name of Object.keys(success).filter(k => !['CODE', 'CHANGES'].includes(k))) {
  assert.notEqual(check({ ...success, [name]: 'failure' }).status, 0, `retain existing required ${name}`)
}
const docs = Object.fromEntries(Object.keys(step.env).map(key => [key,
  key === 'CODE' ? 'false' : ['CHANGES', 'PACKED_HOST'].includes(key) ? 'success' : 'skipped',
]))
assert.equal(check(docs).status, 0, 'docs exemption does not skip real startup')
assert.notEqual(check({ ...docs, PACKED_HOST: 'skipped' }).status, 0)
console.log('PASS Linux/macOS packed startup workflow; failed/cancelled/skipped/missing results fail ci-gate')
