import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { createHintPrompt, hintTurnOutcome } from './input.js'
import { HINT_OUTPUT_CHARS, parseHintResult } from './result.js'
import { prepareHintCall } from '../oauth/summary-call.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'dsh-tui-context-hint': { kind: 'dsh-tui-context-hint' } }
}

export const HINT_TIMEOUT_MS = 15_000
export const HINT_MAX_TOKENS = 2048

/** Exactly one direct stream. No agent loop, inherited prompt, tools or repair. */
export async function requestHint(ctx: Context, request: {
  provider: string
  model: string
  events: readonly { type: string; data: unknown }[]
  signal: AbortSignal
}) {
  const llm = ctx.get('llm')
  if (typeof llm?.prepareCall !== 'function') throw new Error('Context Hint model unavailable')
  const prompt = createHintPrompt(request.events)
  const outcome = hintTurnOutcome(request.events)
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), HINT_TIMEOUT_MS)
  const signal = AbortSignal.any([request.signal, timeout.signal])
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Context Hint cancelled or timed out'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  const collect = async () => {
    signal.throwIfAborted()
    const call = await prepareHintCall(llm, { provider: request.provider, model: request.model, maxTokens: HINT_MAX_TOKENS }, signal)
    signal.throwIfAborted()
    let source = ''
    let produced = 0
    let stopped = false
    // No sessionId: native session-log contributors otherwise copy canonical
    // events/header and append delivery acceptance to the main session.
    for await (const chunk of call.stream({
      ...call.config,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'dsh-tui-context-hint' } })],
      signal,
    })) {
      signal.throwIfAborted()
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        produced += chunk.text.length
        if (produced > HINT_OUTPUT_CHARS) { timeout.abort(); throw new Error('Context Hint output limit') }
        if (chunk.type === 'text-delta') source += chunk.text
      } else if (chunk.type === 'tool-call-delta') {
        timeout.abort()
        throw new Error('Context Hint returned a tool call')
      } else if (chunk.type === 'finish') {
        if (chunk.reason.kind !== 'stop') throw new Error('Context Hint stream did not complete')
        stopped = true
      }
    }
    if (!stopped) throw new Error('Context Hint incomplete stream')
    return parseHintResult(source, outcome)
  }
  try { return await Promise.race([collect(), aborted]) }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
}
