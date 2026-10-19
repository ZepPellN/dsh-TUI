/** Public selection boundary supplement; packed PTY remains acceptance. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { CredentialGatedAdapter, buildOAuthProfile } from '../src/dsh-adapter/oauth/index.js'
import { parseHintSelection, hintSelectionFromCommand, resolveHintRoute, listHintModels, hintSelectionPreference } from '../src/dsh-adapter/context-hint/selection.js'
import { mountAdmitted, mountAdmissionHost } from './lib/plugin-test-utils.js'
import { consentHintStorage, HINT_MANIFEST } from '../src/dsh-adapter/context-hint/consent.js'
import { defaultAdapterRuntime } from '../src/adapter/kernel/runtime.js'

process.env.DSH_TUI_ADAPTER_MODE = 'new'

assert.deepEqual(parseHintSelection(null), { mode: 'inherit' })
assert.deepEqual(hintSelectionFromCommand('deepseek-official/deepseek-v4-pro'), {
  mode: 'explicit', provider: 'deepseek-official', model: 'deepseek-v4-pro',
})
assert.deepEqual(hintSelectionFromCommand('inherit'), { mode: 'inherit' })
for (const bad of [{}, { mode: 'explicit', provider: '', model: 'x' }, { mode: 'inherit', apiKey: 'synthetic' }]) {
  assert.throws(() => parseHintSelection(bad), 'corrupt preference must not silently inherit')
}
assert.throws(() => hintSelectionFromCommand('missing-provider'))
console.log('PASS Context Hint selection parses only bounded route identities, never credentials')

// Real host and registered adapter catalog, not a duplicate discovery fixture.
const ctx = new Context()
const llm = new LlmRuntime(ctx)
const adapter = new CredentialGatedAdapter({
  profiles: () => new Map([['openai-codex', buildOAuthProfile('openai-codex')]]),
  resolveApiKey: async () => 'synthetic-unused-key',
  auth: { credentials: { read: async () => undefined, list: async () => [], modify: async (_p, fn) => fn(undefined), delete: async () => {} },
    authContext: { env: async () => undefined, fileExists: async () => false } },
}, async () => true)
const release = llm.registerAdapter(['openai-codex'], adapter)
try {
  const catalog = await listHintModels(llm)
  assert(catalog.length >= 2, 'real host provides choices')
  const main = { provider: catalog[0].provider, model: catalog[0].model }
  const other = { provider: catalog[1].provider, model: catalog[1].model }
  const unchanged = structuredClone(main)
  const explicit = { mode: 'explicit' as const, ...other }
  assert.deepEqual(await resolveHintRoute(llm, explicit, main), other)
  assert.deepEqual(main, unchanged, 'explicit resolution never mutates main selection')
  assert.deepEqual(await resolveHintRoute(llm, explicit, other), other)
  await consentHintStorage(defaultAdapterRuntime(), new AbortController().signal)
  await mountAdmissionHost(ctx, 'summary selection')
  const admitted = await mountAdmitted(ctx, 'summary-selection', HINT_MANIFEST)
  const storage = admitted.context.get('tuiPluginStorage')!.open(admitted.context)
  const preference = hintSelectionPreference(storage)
  assert.deepEqual(await preference.read(), { mode: 'inherit' })
  await preference.save(explicit, () => true)
  assert.deepEqual(await hintSelectionPreference(storage).read(), explicit, 'a new reader restores the explicit preference')
  await assert.rejects(preference.save({ mode: 'inherit' }, () => false), 'invalidated selection must not commit')
  assert.deepEqual(await preference.read(), explicit)
  await preference.save({ mode: 'inherit' }, () => true)
  assert.deepEqual(await preference.read(), { mode: 'inherit' }, 'switching back to inherit is also durable')
  assert.deepEqual(await resolveHintRoute(llm, { mode: 'inherit' }, main), main)
  assert.deepEqual(await resolveHintRoute(llm, { mode: 'inherit' }, other), other, 'inherit uses this request, not cached main')
  await assert.rejects(resolveHintRoute(llm, { mode: 'explicit', provider: 'openai-codex', model: 'unavailable-fixture' }, main))
  release()
  await assert.rejects(resolveHintRoute(llm, explicit, main), 'removed provider cannot fallback')
  console.log('PASS host-owned catalog, request-local inherit, explicit independence and unavailable failure')
} finally {
  release()
  await ctx.fiber.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
}
