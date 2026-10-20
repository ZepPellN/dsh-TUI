/** #6 supplement through public parsing and admitted storage; packed PTYs remain acceptance. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
const { parseHintResult } = await import('../src/dsh-adapter/context-hint/result.js')

try {
  const summary = {
    session: { goal: 'Session A only', status: 'Review', blockers: [], next: 'Confirm manually' },
    turn: { completed: ['Read spec'], findings: [], verification: [], failures: [], outcome: 'completed' },
    projectSuggestion: { goal: 'Stable project goal', constraints: ['No paid calls'], decisions: ['Use admitted storage'] },
  }
  assert.deepEqual(parseHintResult(JSON.stringify(summary)).projectSuggestion, summary.projectSuggestion,
    'a single summary may propose stable Project context without confirming it')
  assert.throws(() => parseHintResult(JSON.stringify({ ...summary, projectSuggestion: { goal: '', constraints: [], decisions: [] } })))
  assert.equal(parseHintResult(JSON.stringify({ session: summary.session, turn: summary.turn })).projectSuggestion, undefined,
    'existing Session/Turn-only responses remain valid')
  console.log('PASS optional bounded Project Suggestion is unconfirmed structured data')
  process.env.DSH_TUI_ADAPTER_MODE = 'new'
  const { Context } = await import('@deepseek-ai/cordis')
  const { mountAdmissionHost, mountAdmitted } = await import('./lib/plugin-test-utils.js')
  const { HINT_MANIFEST, consentHintStorage } = await import('../src/dsh-adapter/context-hint/consent.js')
  const { defaultAdapterRuntime } = await import('../src/adapter/kernel/runtime.js')
  const { resolveHintProject } = await import('../src/dsh-adapter/context-hint/project.js')
  const { readSharedProject, setProjectEnabled, confirmProject, updateProjectControls } = await import('../src/dsh-adapter/context-hint/shared-project.js')
  const host = new Context()
  try {
    await consentHintStorage(defaultAdapterRuntime(), new AbortController().signal)
    await mountAdmissionHost(host, 'shared Project')
    const admitted = await mountAdmitted(host, 'shared-project', HINT_MANIFEST)
    const storage = admitted.context.get('tuiPluginStorage')!.open(admitted.context)
    const project = await resolveHintProject(fakeHome)
    const current = () => true
    assert.equal((await readSharedProject(storage, project)).card, undefined, 'first Project has no invented confirmed content')
    await setProjectEnabled(storage, project, true, current)
    const reviewed = await readSharedProject(storage, project)
    assert.equal(reviewed.card, undefined, 'enable is not confirmation')
    const accepted = await confirmProject(storage, project, reviewed, summary.projectSuggestion, current)
    assert.equal(accepted.status, 'confirmed')
    const other = { goal: 'Other worktree proposal', constraints: [], decisions: ['Independent decision'] }
    const stale = await confirmProject(storage, project, reviewed, other, current)
    assert.equal(stale.status, 'conflict', 'stale reviewed base cannot overwrite an accepted update')
    assert.deepEqual((await readSharedProject(storage, project)).card, summary.projectSuggestion)
    console.log('PASS admitted Project confirmation detects intervening accepted updates')
    const latest = await readSharedProject(storage, project)
    await storage.set({ key: project.key, value: { ...latest, siblingControl: { retained: true } } })
    await updateProjectControls(storage, project, { paused: true }, current)
    const paused = await readSharedProject(storage, project)
    assert.deepEqual(paused.siblingControl, { retained: true })
    assert.deepEqual(paused.card, summary.projectSuggestion)
    assert.equal((await confirmProject(storage, project, latest, other, current)).status, 'conflict')
    await updateProjectControls(storage, project, { paused: false }, current)
    await setProjectEnabled(storage, project, false, current)
    await setProjectEnabled(storage, project, true, current)
    assert.equal((await confirmProject(storage, project, latest, other, current)).status, 'conflict', 'disable/re-enable cannot revive the reviewed base')
    const finalBase = await readSharedProject(storage, project)
    assert.deepEqual(finalBase.card, summary.projectSuggestion, 'Project lifetime independent of session/control lifetime')
    const { withFileLock } = await import('@deepseek-ai/dsh-atomic-write')
    const { DATA_DIR } = await import('../src/utils/paths.js')
    const file = join(DATA_DIR, 'plugin-storage/dsh-tui.context-hint.json')
    const before = readFileSync(file, 'utf8')
    let release!: () => void
    let locked!: () => void
    const ready = new Promise<void>(resolve => { locked = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const lock = withFileLock(file, async () => { locked(); await held })
    await ready
    let active = true
    const pending = confirmProject(storage, project, finalBase, other, () => active)
    const rejected = assert.rejects(pending, /invalidated|cancelled|closed/)
    await setImmediate()
    active = false
    release()
    await lock
    await rejected
    assert.equal(readFileSync(file, 'utf8'), before, 'final storage fence prevents a late confirmation through lock wait')
    assert(!existsSync(join(DATA_DIR, 'context-hint-coordination.lock')), 'coordination released on failure')
    const denied = join(DATA_DIR, 'extension-grants.json')
    const grants = readFileSync(denied, 'utf8')
    writeFileSync(denied, JSON.stringify({ denies: { 'dsh-tui.context-hint': ['storage.local.write'] } }))
    await assert.rejects(confirmProject(storage, project, finalBase, other, current))
    assert.equal(readFileSync(file, 'utf8'), before, 'revoked grants cannot be bypassed by coordination')
    writeFileSync(denied, grants)
    await storage.set({ key: project.key, value: { ...finalBase, revision: null } })
    await assert.rejects(readSharedProject(storage, project), /Invalid Project/, 'malformed revision is not a legacy revision')
    const { revision: omitted, ...withoutRevision } = finalBase
    await storage.set({ key: project.key, value: withoutRevision })
    await assert.rejects(readSharedProject(storage, project), /Invalid Project/, 'only #3 control-only envelopes may omit revision')
    await storage.set({ key: project.key, value: finalBase })
    console.log('PASS control preservation, ABA rejection, grant/cancellation fences and corrupt envelope refusal')
  } finally { await host.fiber.dispose() }
} finally {
  rmSync(fakeHome, { recursive: true, force: true })
}
