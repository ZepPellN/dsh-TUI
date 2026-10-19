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
const { HINT_COMPONENT_ID, HINT_MANIFEST } = await import('../src/dsh-adapter/context-hint/consent.js')
const { mountAdmitted, mountAdmissionHost } = await import('./lib/plugin-test-utils.js')
const { DATA_DIR } = await import('../src/utils/paths.js')
const host = new Context()
try {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(join(DATA_DIR, 'extension-grants.json'), JSON.stringify({ grants: {
    [HINT_COMPONENT_ID]: ['storage.local.read', 'storage.local.write'].map(name => ({ name, scope: HINT_COMPONENT_ID })),
  } }))
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
