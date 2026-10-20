import { spawnSync } from 'node:child_process'

/** Input sent through the real PTY; paint readiness is separate from Return cadence. */
export function packedKeys(write, record = () => {}) {
  let lastReturn = -Infinity
  const send = data => {
    const sentAt = performance.now()
    if (data.includes('\r')) lastReturn = sentAt
    record({ keys: data, sentAt })
    write(data)
  }
  return { send, enter: async () => {
    // 固定窗:墙钟 real PromptInput suppresses duplicate Return within 80ms;
    // use human key cadence, not slower journey deadlines or a second Enter.
    while (performance.now() - lastReturn < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - (performance.now() - lastReturn)))
    }
    send('\r')
  } }
}

/** Preserve the journey failure even when teardown itself also fails. */
export async function runAndCleanup(run, cleanup) {
  let value
  let failed = false
  let primary
  try { value = await run() } catch (error) { failed = true; primary = error }
  try { await cleanup() } catch (error) {
    if (failed) throw new AggregateError([primary, error], 'Journey failed; teardown also failed', { cause: primary })
    throw error
  }
  if (failed) throw primary
  return value
}
/** Retain nested journey/teardown stacks rather than only AggregateError's label. */
export function failureText(error) {
  return (error?.stack ?? String(error)) + (error instanceof AggregateError
    ? '\n' + error.errors.map((cause, index) => `Cause ${index + 1}:\n${failureText(cause)}`).join('\n') : '')
}

/** Read only the bridge-owned POSIX group, never ambient environment or profiles. */
export function groupProcesses(group) {
  if (group === undefined) return []
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`ps failed: ${result.stderr}`)
  return result.stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u)
    return match && Number(match[3]) === group ? [{ pid: Number(match[1]), parent: Number(match[2]),
      group, status: match[4], command: match[5] }] : []
  })
}
