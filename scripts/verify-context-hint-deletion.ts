/** #8 supplement: scoped deletion, read-time validation and bounded storage
 * through the real admitted component namespace. The packed PTY journey owns
 * the end-to-end acceptance; this focuses on deterministic fault/race cases. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
process.env.DSH_TUI_ADAPTER_MODE = 'new'
const { Context } = await import('@deepseek-ai/cordis')
const { withFileLock } = await import('@deepseek-ai/dsh-atomic-write')
const { defaultAdapterRuntime } = await import('../src/adapter/kernel/runtime.js')
const { consentHintStorage, HINT_MANIFEST } = await import('../src/dsh-adapter/context-hint/consent.js')
const { STORAGE_MAX_BYTES, STORAGE_MAX_KEYS } = await import('../src/dsh-adapter/plugin-storage.js')
const { mountAdmissionHost, mountAdmitted } = await import('./lib/plugin-test-utils.js')
const records = await import('../src/dsh-adapter/context-hint/records.js')
const { deleteSharedProject, confirmProject, readSharedProject, setProjectEnabled, updateProjectControls } =
  await import('../src/dsh-adapter/context-hint/shared-project.js')
const { resolveHintProject } = await import('../src/dsh-adapter/context-hint/project.js')
const { parseHintResult } = await import('../src/dsh-adapter/context-hint/result.js')
const { DATA_DIR } = await import('../src/utils/paths.js')

const projectCard = { goal: 'Stable project goal', constraints: ['Synthetic only'], decisions: ['Admitted storage'] }
const parsed = parseHintResult(JSON.stringify({
  session: { goal: 'Scoped deletion', status: 'Review', blockers: [], next: 'Delete only selected data' },
  turn: { completed: ['Read spec'], findings: [], verification: ['Synthetic fixture'], failures: [], outcome: 'completed' },
  projectSuggestion: projectCard,
}))
const cards = (status: string) => ({ ...parsed, session: { ...parsed.session, status } })

// --- Pure read-time validation: structural, identity, offset and route checks.
assert.equal(records.hintSessionKey('session-fixture'), 'session:session-fixture')
for (const bad of ['', 'x'.repeat(records.HINT_SESSION_ID_MAX_LENGTH + 1), 'bad\nid', 'bad\u001bid']) {
  assert.throws(() => records.hintSessionKey(bad), /session identity/)
}
assert(records.hintSessionKey('s'.repeat(records.HINT_SESSION_ID_MAX_LENGTH)).length <= 128, 'session key fits storage limit')
assert.deepEqual(records.parseHintSessionValue(null, 'identity', 's', 10), { status: 'empty' })
const envelope = { identity: 'identity', sessionId: 's', eventOffset: 5, cards: { session: parsed.session, turn: parsed.turn }, provider: 'p', model: 'm', failed: true }
const valid = records.parseHintSessionValue(envelope, 'identity', 's', 10)
assert.equal(valid.status, 'ok')
assert.equal(valid.status === 'ok' && valid.record.eventOffset, 5)
assert.equal(valid.status === 'ok' && valid.record.failed, true)
assert.equal(valid.status === 'ok' && valid.record.route?.model, 'm')
for (const corrupt of [
  [], 'string', { ...envelope, identity: 'other' }, { ...envelope, sessionId: 'other' },
  { ...envelope, eventOffset: -1 }, { ...envelope, eventOffset: 11 }, { ...envelope, eventOffset: 1.5 },
  { ...envelope, eventOffset: '5' }, { ...envelope, cards: { session: {} } },
  { ...envelope, model: undefined }, { ...envelope, provider: undefined }, { ...envelope, failed: 'yes' },
  { ...envelope, cards: { ...cards('X'), turn: { ...parsed.turn, outcome: 'unknown' } } },
]) {
  assert.equal(records.parseHintSessionValue(corrupt, 'identity', 's', 10).status, 'corrupt')
}
console.log('PASS Context Hint read-time validation rejects malformed, mismatched, stale and partially routed envelopes')

const host = new Context()
try {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(join(fakeHome, 'other-project'), { recursive: true })
  const runtime = defaultAdapterRuntime()
  await consentHintStorage(runtime, new AbortController().signal)
  await mountAdmissionHost(host, 'context-hint deletion')
  const admitted = await mountAdmitted(host, 'hint-deletion', HINT_MANIFEST)
  const storage = admitted.context.get('tuiPluginStorage')!.open(admitted.context)
  const file = join(DATA_DIR, 'plugin-storage', 'dsh-tui.context-hint.json')
  const table = () => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  const current = () => true
  const projectA = await resolveHintProject(fakeHome)
  const projectB = await resolveHintProject(join(fakeHome, 'other-project'))
  assert.notEqual(projectA.key, projectB.key)

  await setProjectEnabled(storage, projectA, true, current)
  const baseA = await readSharedProject(storage, projectA)
  const accepted = await confirmProject(storage, projectA, baseA, projectCard, current)
  assert.equal(accepted.status, 'confirmed')
  await setProjectEnabled(storage, projectB, true, current)
  for (const [identity, sessionId, status, offset] of [
    [projectA.id, 'session-a', 'SESSION_A', 3], [projectA.id, 'session-b', 'SESSION_B', 4],
    [projectB.id, 'session-c', 'SESSION_C', 2],
  ] as const) {
    await records.writeHintSession(storage, identity, sessionId, {
      cards: cards(status), eventOffset: offset,
      ...(sessionId === 'session-a' ? { route: { provider: 'deepseek-official', model: 'deepseek-flash' } } : {}),
    }, current)
  }
  const readA = await records.readHintSession(storage, projectA.id, 'session-a', 10)
  assert.equal(readA.status, 'ok')
  assert.equal(readA.status === 'ok' && readA.record.cards.session.status, 'SESSION_A')
  assert.equal(readA.status === 'ok' && readA.record.route?.provider, 'deepseek-official')
  assert.equal((await records.readHintSession(storage, projectB.id, 'session-a', 10)).status, 'corrupt',
    'another Project identity cannot read this session envelope')
  assert.equal((await records.readHintSession(storage, projectA.id, 'session-a', 2)).status, 'corrupt',
    'an offset beyond the live session is stale, not shown')

  // --- Session scope: only the selected session key changes.
  const sessionBBefore = (await storage.get({ key: records.hintSessionKey('session-b') })).value
  const projectABefore = (await readSharedProject(storage, projectA)).card
  assert.equal((await records.deleteHintSession(storage, 'session-a', current)).deleted, true)
  assert.equal((await storage.get({ key: records.hintSessionKey('session-a') })).value, null)
  assert.deepEqual((await storage.get({ key: records.hintSessionKey('session-b') })).value, sessionBBefore,
    'unselected session cards survive')
  assert.deepEqual((await readSharedProject(storage, projectA)).card, projectABefore, 'Project Card survives a session-scope deletion')
  assert.equal((await records.deleteHintSession(storage, 'session-a', current)).deleted, false, 'repeat deletion is a truthful no-op')
  console.log('PASS session-scope deletion removes exactly one latest-card envelope and preserves other sessions/Project')

  // --- Real lock wait: an invalidated deletion must not commit.
  await records.writeHintSession(storage, projectA.id, 'session-a', { cards: cards('SESSION_A'), eventOffset: 3 }, current)
  const beforeFence = readFileSync(file, 'utf8')
  let release!: () => void
  let acquired!: () => void
  const ready = new Promise<void>(resolve => { acquired = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const lock = withFileLock(file, async () => { acquired(); await held })
  await ready
  let active = true
  const pending = records.deleteHintSession(storage, 'session-a', () => active)
  const rejected = assert.rejects(pending, /invalidated|cancelled|closed/)
  await setImmediate()
  active = false
  release()
  await lock
  await rejected
  assert.equal(readFileSync(file, 'utf8'), beforeFence, 'invalidated deletion waits out the real writer lock without committing')
  console.log('PASS deletion honours the existing storage write fence through a real writer-lock wait')

  // --- Shared Project scope: one coordinated envelope, never other scopes.
  const baseB = await readSharedProject(storage, projectB)
  const sessionCBefore = (await storage.get({ key: records.hintSessionKey('session-c') })).value
  await records.deleteHintSession(storage, 'session-a', current)
  const deletedB = await deleteSharedProject(storage, projectB, current)
  assert.equal(deletedB.deleted, true)
  assert.equal((await readSharedProject(storage, projectB)).enabled, false, 'deleted Project reads back as unconfigured')
  assert.deepEqual((await storage.get({ key: records.hintSessionKey('session-c') })).value, sessionCBefore,
    'Project deletion leaves per-session cards untouched')
  assert.deepEqual((await readSharedProject(storage, projectA)).card, projectABefore, 'other Project identity untouched')
  const staleConfirm = await confirmProject(storage, projectB, baseB, projectCard, current)
  assert.equal(staleConfirm.status, 'conflict', 'an old confirmed base cannot recreate deleted Project data')
  await assert.rejects(updateProjectControls(storage, projectB, { paused: true }, current), /deleted/,
    'a pause racing the deletion cannot recreate a controls-only record')
  assert.equal(table()[projectB.key], undefined, 'neither stale confirmation nor pause recreated the envelope')
  await setProjectEnabled(storage, projectB, true, current)
  assert.equal((await readSharedProject(storage, projectB)).enabled, true, 'explicit enable may create a fresh Project record')
  console.log('PASS shared-Project deletion is coordinated, scope-bounded and not rebuilt by stale confirmations or controls')

  // --- Corrupt optional namespace: reported, never repaired or cleared.
  const validBytes = readFileSync(file, 'utf8')
  writeFileSync(file, '{synthetic-corrupt-namespace')
  await assert.rejects(records.readHintSession(storage, projectA.id, 'session-b', 10), /STORAGE_UNAVAILABLE|invalid|corrupt/i)
  await assert.rejects(deleteSharedProject(storage, projectA, current), /STORAGE_UNAVAILABLE|invalid|corrupt/i)
  await assert.rejects(records.deleteHintSession(storage, 'session-b', current), /STORAGE_UNAVAILABLE|invalid|corrupt/i)
  assert.equal(readFileSync(file, 'utf8'), '{synthetic-corrupt-namespace', 'corrupt hint storage is never silently repaired or cleared')
  writeFileSync(file, validBytes)
  assert.equal((await records.readHintSession(storage, projectA.id, 'session-b', 10)).status, 'ok')
  console.log('PASS corrupt hint storage fails reads/deletions loudly and remains byte-for-byte untouched')

  // --- Unwritable namespace: capacity/permission failures are visible, data retained.
  const storageDir = join(DATA_DIR, 'plugin-storage')
  const beforeUnwritable = readFileSync(file, 'utf8')
  chmodSync(storageDir, 0o500)
  try {
    const failure = await records.deleteHintSession(storage, 'session-b', current).then(() => undefined, error => error)
    assert(failure !== undefined, 'unwritable hint storage cannot report a successful deletion')
    assert.equal(records.isHintStorageFailure(failure), true, 'permission failure is classified as a storage failure')
    assert.equal(readFileSync(file, 'utf8'), beforeUnwritable, 'failed deletion leaves stored cards unchanged')
  } finally { chmodSync(storageDir, 0o700) }
  assert.equal((await records.deleteHintSession(storage, 'session-b', current)).deleted, true, 'deletion works again after the fault is cleared')
  console.log('PASS unwritable hint storage surfaces a classified failure and preserves existing data')

  // --- Capacity boundaries: quota fails loudly, unrelated keys are never pruned.
  const beforeBytes = Buffer.byteLength(readFileSync(file, 'utf8'))
  await storage.set({ key: 'bytes-fixture', value: 'x'.repeat(STORAGE_MAX_BYTES - beforeBytes - 1024) })
  const beforeByteOverflow = readFileSync(file, 'utf8')
  const byteFailure = await storage.set({ key: 'bytes-overflow', value: 'y'.repeat(4096) }).then(() => undefined, error => error)
  assert.equal(records.isHintStorageFailure(byteFailure), true, 'byte quota is a classified storage failure')
  assert.equal((byteFailure as { code?: unknown }).code, 'QUOTA_EXCEEDED')
  assert.equal(readFileSync(file, 'utf8'), beforeByteOverflow, 'a rejected write changes nothing')
  await storage.delete({ key: 'bytes-fixture' })

  let filler = 0
  while (Object.keys(table()).length < STORAGE_MAX_KEYS) {
    await storage.set({ key: `filler:${filler++}`, value: filler })
  }
  assert.equal(Object.keys(table()).length, STORAGE_MAX_KEYS)
  const beforeKeyOverflow = readFileSync(file, 'utf8')
  const keyFailure = await records.writeHintSession(storage, projectA.id, 'session-capacity',
    { cards: cards('CAPACITY'), eventOffset: 2 }, current).then(() => undefined, error => error)
  assert.equal(records.isHintStorageFailure(keyFailure), true)
  assert.equal((keyFailure as { code?: unknown }).code, 'QUOTA_EXCEEDED')
  assert.equal(readFileSync(file, 'utf8'), beforeKeyOverflow, 'key quota failure neither prunes nor changes unrelated envelopes')
  assert.equal((await records.readHintSession(storage, projectB.id, 'session-c', 10)).status, 'ok',
    'existing cards remain readable at the key boundary')
  await storage.delete({ key: `filler:${filler - 1}` })
  await records.writeHintSession(storage, projectA.id, 'session-capacity', { cards: cards('CAPACITY'), eventOffset: 2 }, current)
  assert.equal((await records.readHintSession(storage, projectA.id, 'session-capacity', 10)).status, 'ok',
    'a freed slot accepts the next bounded latest card')
  console.log('PASS storage key/byte capacity boundaries fail visibly, retain existing cards and never prune unrelated data')

  // --- Every session keeps one bounded latest envelope; no history/raw copies.
  const keys = Object.keys(table())
  assert.equal(keys.filter(key => key.startsWith('session:')).length, new Set(keys.filter(key => key.startsWith('session:'))).size,
    'one distinct key per session, never append-only history')
  assert(!JSON.stringify(table()).includes('Read spec raw prompt'), 'no raw prompt archive')
  const record = (await storage.get({ key: records.hintSessionKey('session-capacity') })).value
  assert(Buffer.byteLength(JSON.stringify(record), 'utf8') < 32 * 1024, 'one latest card envelope stays bounded')
  assert(!existsSync(join(DATA_DIR, 'context-hint-coordination.lock')), 'coordination lock released')
  assert(!readdirSync(storageDir).some(name => name.endsWith('.tmp')), 'no staged temp archive remains')
  console.log('PASS latest-only bounded storage: one envelope per session, no summary history or raw-copy archive')
} finally {
  await host.fiber.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
}
