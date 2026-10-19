import { AsyncLocalStorage } from 'node:async_hooks'
import type { LlmCallConfig, LlmRuntime, PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { concreteService } from '../host-access.js'

type HintLlm = Pick<LlmRuntime, 'prepareCall'>

/** One adapter's dynamic-profiles hook; no shared mutation or copied auth. */
export function createSummaryProfiles(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>) {
  const local = new AsyncLocalStorage<{ profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>; consumed: boolean }>()
  return {
    read: () => {
      const scope = local.getStore()
      if (scope === undefined) return profiles
      scope.consumed = true
      return scope.profiles
    },
    async prepare(provider: string, prepare: () => Promise<PreparedLlmCall>) {
      const original = profiles.get(provider)
      if (original === undefined) throw new Error('Context Hint transport owner is unavailable')
      const derived = new Map(profiles)
      derived.set(provider, { ...original, transport: 'sse' })
      const scope = { profiles: derived, consumed: false }
      const call = await local.run(scope, prepare)
      // The actual registered adapter must have captured this scope. A
      // conflicting registration/HMR cannot silently bypass the transport.
      if (!scope.consumed) throw new Error('Context Hint transport owner changed')
      return call
    },
  }
}

const owners = new WeakMap<object, Map<string, ReturnType<typeof createSummaryProfiles>>>()

/** Host-internal registration, released with the existing OAuth activation. */
export function registerSummaryPreparation(llm: object, provider: string, scope: ReturnType<typeof createSummaryProfiles>) {
  const key = concreteService(llm)
  let routes = owners.get(key)
  if (routes === undefined) { routes = new Map(); owners.set(key, routes) }
  if (routes.has(provider)) throw new Error('Context Hint transport already registered')
  routes.set(provider, scope)
  return () => { if (routes.get(provider) === scope) routes.delete(provider) }
}

/** Normal host preparation/dispatch; only owned Codex summary calls force SSE. */
export function prepareHintCall(llm: HintLlm, config: LlmCallConfig, signal: AbortSignal): Promise<PreparedLlmCall> {
  if (config.provider !== 'openai-codex') return llm.prepareCall(config, signal)
  const scope = owners.get(concreteService(llm))?.get(config.provider)
  if (scope === undefined) return Promise.reject(new Error('Context Hint single-attempt transport unavailable for this Codex owner'))
  return scope.prepare(config.provider, () => llm.prepareCall(config, signal))
}
