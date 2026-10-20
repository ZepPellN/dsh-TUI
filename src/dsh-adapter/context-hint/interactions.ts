/** Live, post-activation human turns only. No backlog, timers or request queue. */
export function createHintInteractions() {
  let last = -1
  let turn: unknown
  let human = false
  let active = false
  return {
    reset(offset: number, enabled: boolean, paused: boolean) {
      last = offset - 1
      turn = undefined
      human = false
      active = enabled && !paused
    },
    claimed(message: { source?: { kind?: unknown } }) {
      // Claim precedes pre-step/model preparation, which can fail before
      // user/message is committed. Do not synthesize transcript content.
      if (turn !== undefined && message.source?.kind === 'user') human = true
    },
    observe(event: { seq: number; type: string; data: unknown }): boolean {
      if (event.seq <= last) return false
      last = event.seq
      const data = event.data as { turn?: unknown; source?: { kind?: unknown } }
      if (event.type === 'turn/start') { turn = data.turn; human = false }
      if (event.type === 'user/message' && turn !== undefined && data.source?.kind === 'user') human = true
      if (event.type !== 'turn/end') return false
      const applicable = active && turn !== undefined && turn === data.turn && human
      turn = undefined
      human = false
      return applicable
    },
  }
}
