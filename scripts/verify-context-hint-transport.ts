/** Public host + real registered pi-ai adapter; replace only external transports. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CredentialGatedAdapter, buildOAuthProfile } from '../src/dsh-adapter/oauth/index.js'
import * as oauthPlugin from '../src/dsh-adapter/oauth/index.js'
import { createSummaryProfiles, registerSummaryPreparation, prepareHintCall } from '../src/dsh-adapter/oauth/summary-call.js'

const ctx = new Context()
const llm = new LlmRuntime(ctx)
const profiles = new Map([['openai-codex', buildOAuthProfile('openai-codex')]])
const scoped = createSummaryProfiles(profiles)
// A synthetic JWT only; never resolved through an installed credential store.
const key = 'fixture.' + Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic' } })).toString('base64url') + '.fixture'
const adapter = new CredentialGatedAdapter({
  profiles: scoped.read,
  resolveApiKey: async () => key,
  auth: { credentials: { read: async () => ({ type: 'oauth' as const, access: key, refresh: 'synthetic', expires: Date.now() + 3600000 }), list: async () => [], modify: async (_p, fn) => fn(undefined), delete: async () => {} },
    authContext: { env: async () => undefined, fileExists: async () => false } },
}, async () => true)
const models = await adapter.listModels('openai-codex')
assert(models.length > 0)
const controls = { provider: 'openai-codex', model: models[0].id, maxTokens: 2048 }
let http = 0
let ws = 0
let status = 503
const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket
globalThis.fetch = async () => {
  http++
  if (status === -1) throw new TypeError('synthetic network loss')
  if (status === 200) {
    const item = { type: 'message', id: 'message-fixture', role: 'assistant',
      content: [{ type: 'output_text', text: 'SUMMARY_FIXTURE_OK', annotations: [] }] }
    const events = [
      { type: 'response.created', response: { id: 'fixture' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'SUMMARY_FIXTURE_OK' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'fixture', status: 'completed', output: [item],
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } } },
    ]
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response('{"error":{"message":"synthetic failure"}}', { status })
}
globalThis.WebSocket = class { constructor() { ws++; throw new Error('Unexpected WebSocket attempt') } } as unknown as typeof WebSocket
const releaseAdapter = llm.registerAdapter(['openai-codex'], adapter)
const releaseSummary = registerSummaryPreparation(llm, 'openai-codex', scoped)
try {
  for (status of [200, 429, 503, -1]) {
    http = 0; ws = 0
    const call = await prepareHintCall(llm, controls, new AbortController().signal)
    let text = ''
    let stopped = false
    try {
      for await (const chunk of call.stream({ ...call.config, messages: [createUserMessage({ content: [{ type: 'text', text: 'fixture summary' }], source: { kind: 'user' } })] })) {
        if (http === 0 && chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(JSON.stringify(chunk.reason))
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'finish') stopped = chunk.reason.kind === 'stop'
      }
    } catch (error) {
      // All input/credentials in this fixture are synthetic. Keep diagnosis
      // when preparation/conversion fails before the HTTP boundary.
      if (http === 0) throw error
    }
    assert.equal(http, 1, `${status}: exactly one HTTP attempt`)
    assert.equal(ws, 0, `${status}: no WebSocket retry/fallback`)
    if (status === 200) {
      assert.equal(text, 'SUMMARY_FIXTURE_OK')
      assert(stopped, 'normal success finishes, not merely one request')
    } else assert(!stopped, 'provider failure is not an empty success')
    assert.equal(profiles.get('openai-codex')?.transport, undefined, 'shared main profile is unchanged')
  }
  // Independent public host preparations interleave without sharing the local
  // transport scope. Main retains its ordinary auto WS→SSE behavior.
  status = 503
  const [summary, main] = await Promise.all([
    prepareHintCall(llm, controls, new AbortController().signal), llm.prepareCall(controls),
  ])
  const drain = async (call: typeof main) => {
    for await (const _chunk of call.stream({ ...call.config, messages: [createUserMessage({ content: [{ type: 'text', text: 'fixture' }], source: { kind: 'user' } })] })) { /* drain */ }
  }
  http = 0; ws = 0
  await drain(main)
  assert.equal(ws, 1, 'concurrent main preparation retains default auto transport')
  assert.equal(http, 1, 'main fallback reaches only the synthetic boundary')
  http = 0; ws = 0
  await drain(summary)
  assert.equal(ws, 0, 'summary snapshot remains SSE after another preparation')
  assert.equal(http, 1)
  releaseAdapter()
  const replacement = new CredentialGatedAdapter({ profiles: () => profiles, resolveApiKey: async () => key,
    auth: { credentials: { read: async () => undefined, list: async () => [], modify: async (_p, fn) => fn(undefined), delete: async () => {} },
      authContext: { env: async () => undefined, fileExists: async () => false } } }, async () => true)
  const releaseReplacement = llm.registerAdapter(['openai-codex'], replacement)
  try {
    await assert.rejects(prepareHintCall(llm, controls, new AbortController().signal), /owner changed/, 'mismatched registered owner cannot acknowledge the old scope')
  } finally { releaseReplacement() }
  releaseSummary()
  await assert.rejects(prepareHintCall(llm, controls, new AbortController().signal), 'no retrying fallback after owner disposal')
  // Exercise the actual plugin's register/dispose wiring, not only the
  // separately constructed adapter above. Both credentials and transports
  // still belong entirely to this synthetic fixture.
  const mounted = new Context()
  const mountedLlm = new LlmRuntime(mounted)
  const credentialsFile = join(fakeHome, 'mounted-credentials.json')
  await new oauthPlugin.CredentialFile(credentialsFile).modify('openai-codex', async () => ({
    type: 'oauth', access: key, refresh: 'synthetic', expires: Date.now() + 3600000,
  }))
  try {
    const fiber = mounted.plugin(oauthPlugin, { providers: ['openai-codex'], credentialsFile })
    await fiber.await()
    for (status of [200, 429, 503, -1]) {
      http = 0; ws = 0
      // Read through the real Cordis service proxy, as requestHint does.
      const call = await prepareHintCall(mounted.get('llm')!, controls, new AbortController().signal)
      await drain(call)
      assert.equal(http, 1, `mounted ${status}: one HTTP attempt`)
      assert.equal(ws, 0, `mounted ${status}: no hidden WS attempt`)
    }
    await fiber.dispose()
    await assert.rejects(prepareHintCall(mountedLlm, controls, new AbortController().signal), /unavailable/, 'real plugin disposal releases its summary capability')
  } finally { await mounted.fiber.dispose() }
  console.log('PASS Context Hint uses the registered OAuth adapter with request-local SSE; no HTTP/WS retries')
} finally {
  releaseSummary(); releaseAdapter()
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  await ctx.fiber.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
}
