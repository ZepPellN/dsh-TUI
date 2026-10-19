/** Supplement: real admitted storage, real file-lock contention, no UI stand-in. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
process.env.DSH_TUI_ADAPTER_MODE = 'new'
const { Context } = await import('@deepseek-ai/cordis')
const { withFileLock } = await import('@deepseek-ai/dsh-atomic-write')
const storageModule = await import('../src/dsh-adapter/plugin-storage.js')
const { consentHintStorage, hintStorageGranted, HINT_COMPONENT_ID, HINT_MANIFEST } = await import('../src/dsh-adapter/context-hint/consent.js')
const { defaultAdapterRuntime } = await import('../src/adapter/kernel/runtime.js')
const { readGrantStore } = await import('../src/adapter/standard/grants.js')
const { mountAdmitted, mountAdmissionHost } = await import('./lib/plugin-test-utils.js')
const { DATA_DIR } = await import('../src/utils/paths.js')
const host = new Context()
try {
  mkdirSync(DATA_DIR, { recursive: true })
  const grantsFile = join(DATA_DIR, 'extension-grants.json')
  const runtime = defaultAdapterRuntime()
  const untouched = JSON.stringify({ grants: { 'fixture.other': [{ name: 'storage.local.read', scope: 'fixture.other' }] } })
  writeFileSync(grantsFile, untouched)
  assert.equal(hintStorageGranted(runtime), false, 'own storage is default-deny')
  let releaseConsent!: () => void
  let consentLocked!: () => void
  const consentReady = new Promise<void>(resolve => { consentLocked = resolve })
  const consentHeld = new Promise<void>(resolve => { releaseConsent = resolve })
  const consentLock = withFileLock(grantsFile, async () => { consentLocked(); await consentHeld })
  await consentReady
  const controller = new AbortController()
  const consentPending = consentHintStorage(runtime, controller.signal)
  const consentRejected = assert.rejects(consentPending, /cancelled|abort/i, 'cancelled consent cannot grant after the writer lock becomes available')
  try {
    await setImmediate()
    assert.equal(readFileSync(grantsFile, 'utf8'), untouched, 'held writer lock prevents consent from committing')
    controller.abort()
  } finally {
    releaseConsent()
    await consentLock
  }
  await consentRejected
  assert.equal(readFileSync(grantsFile, 'utf8'), untouched, 'cancelled waiter leaves all grants byte-for-byte unchanged')
  assert.equal(hintStorageGranted(runtime), false, 'no late own-storage grant')
  assert(!existsSync(`${grantsFile}.lock`), 'cancelled consent releases its writer lock')
  console.log('PASS cancelled Context Hint consent cannot grant late through a real writer-lock wait')

  writeFileSync(grantsFile, '{corrupt')
  await assert.rejects(consentHintStorage(runtime, new AbortController().signal), /corrupt/)
  assert.equal(readFileSync(grantsFile, 'utf8'), '{corrupt', 'consent never repairs or replaces a corrupt grant store')
  const denied = JSON.stringify({ denies: { [HINT_COMPONENT_ID]: ['storage.local.write'] } })
  writeFileSync(grantsFile, denied)
  await assert.rejects(consentHintStorage(runtime, new AbortController().signal), /explicitly denied/)
  assert.equal(readFileSync(grantsFile, 'utf8'), denied, 'consent never weakens an explicit denial')
  writeFileSync(grantsFile, untouched)
  await consentHintStorage(runtime, new AbortController().signal)
  assert.deepEqual(JSON.parse(readFileSync(grantsFile, 'utf8')), { grants: {
    'fixture.other': [{ name: 'storage.local.read', scope: 'fixture.other' }],
    [HINT_COMPONENT_ID]: [
      { name: 'storage.local.read', scope: HINT_COMPONENT_ID },
      { name: 'storage.local.write', scope: HINT_COMPONENT_ID },
    ],
  } }, 'confirmation preserves other grants and adds only the two own-scoped permissions')
  assert.equal(hintStorageGranted(runtime), true)
  assert.equal(readGrantStore(undefined, undefined, runtime).allows(HINT_COMPONENT_ID, 'storage.local.write', 'fixture.other'), false, 'confirmation cannot grant another namespace')
  console.log('PASS Context Hint consent preserves default-deny, explicit denial, corrupt store and exact-component grants')
  await mountAdmissionHost(host, 'context-hint storage')
  const admitted = await mountAdmitted(host, 'hint-storage', HINT_MANIFEST)
  const storage = admitted.context.get('tuiPluginStorage')!.open(admitted.context)
  const dir = join(DATA_DIR, 'plugin-storage')
  const file = join(dir, `${HINT_COMPONENT_ID}.json`)
  await storage.set({ key: 'session:fixture', value: { cards: 'LAST_VALID' } })
  const before = readFileSync(file, 'utf8')
  let release!: () => void
  let acquired!: () => void
  const ready = new Promise<void>(resolve => { acquired = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const lock = withFileLock(file, async () => { acquired(); await held })
  await ready
  let current = true
  const guarded = storageModule.withStorageWriteGuard
  const pending = guarded(() => current, () => storage.set({ key: 'session:fixture', value: { cards: 'LATE_RESULT' } }))
  const rejected = assert.rejects(pending, /invalidated|cancelled|closed/, 'invalidated queued persistence cannot commit')
  await setImmediate()
  current = false
  release()
  await lock
  await rejected
  assert.equal(readFileSync(file, 'utf8'), before, 'the actual namespace remains Last Valid')
  await assert.rejects(guarded(() => false, () => storage.set({ key: 'session:fixture', value: { failed: true } })))
  assert.equal(readFileSync(file, 'utf8'), before, 'late failure marker cannot write either')
  await guarded(() => true, () => storage.set({ key: 'session:fixture', value: { cards: 'CURRENT_RESULT' } }))
  assert.deepEqual((await storage.get({ key: 'session:fixture' })).value, { cards: 'CURRENT_RESULT' })
  assert(!readdirSync(dir).some(name => name.endsWith('.tmp')), 'no guarded staging archive remains')
  assert(!existsSync(`${file}.lock`), 'writer lock released')
  console.log('PASS Context Hint invalidation fences real queued/locked storage commits and preserves normal writes')
} finally {
  await host.fiber.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
}
