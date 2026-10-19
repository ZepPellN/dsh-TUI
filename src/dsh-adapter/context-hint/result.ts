import stripAnsi from 'strip-ansi'

/** Display-only, strictly validated cards. No permissive text/empty-success fallback. */
export interface HintResult {
  session: { goal: string; status: string; blockers: string[]; next: string }
  turn: { completed: string[]; findings: string[]; verification: string[]; failures: string[]; outcome: 'completed' | 'failed' | 'cancelled' }
}

export const HINT_OUTPUT_CHARS = 16_000

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid Context Hint structure')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 800) throw new Error('Invalid Context Hint text')
  // Text remains untrusted data. Drop terminal controls before it can reach a view.
  const sanitized = stripAnsi(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim()
  if (sanitized === '') throw new Error('Invalid Context Hint text')
  return sanitized
}

function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid Context Hint list')
  return value.map(text)
}

/** Exact JSON object with every required Session and Turn field, bounded at ingress. */
export function parseHintResult(source: string, expectedOutcome?: HintResult['turn']['outcome']): HintResult {
  if (source.length > HINT_OUTPUT_CHARS) throw new Error('Context Hint output limit')
  const root = record(JSON.parse(source), ['session', 'turn'])
  const session = record(root.session, ['goal', 'status', 'blockers', 'next'])
  const turn = record(root.turn, ['completed', 'findings', 'verification', 'failures', 'outcome'])
  if (turn.outcome !== 'completed' && turn.outcome !== 'failed' && turn.outcome !== 'cancelled') throw new Error('Invalid Context Hint outcome')
  if (expectedOutcome !== undefined && turn.outcome !== expectedOutcome) throw new Error('Context Hint contradicts the actual turn outcome')
  const result: HintResult = {
    session: { goal: text(session.goal), status: text(session.status), blockers: list(session.blockers), next: text(session.next) },
    turn: { completed: list(turn.completed), findings: list(turn.findings), verification: list(turn.verification), failures: list(turn.failures), outcome: turn.outcome },
  }
  if (result.turn.completed.length + result.turn.findings.length + result.turn.verification.length + result.turn.failures.length === 0) {
    throw new Error('Empty Context Hint turn')
  }
  if (result.turn.outcome !== 'completed' && result.turn.failures.length === 0) throw new Error('Context Hint omits failure or cancellation')
  return result
}
