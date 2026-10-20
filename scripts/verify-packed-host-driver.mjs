/** Narrow real prompt/PTY regression for remote push 39414707706.
 * node scripts/verify-packed-host-driver.mjs [cadence|teardown|errors]
 * Prompt renderer is real; local fixture owns every descendant/file it creates.
 */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import React from 'react'
import xterm from '@xterm/headless'
import { render } from '../lib/types/ui.js'
import { PromptInput } from '../lib/types/components/PromptInput.js'
import { settled, sleep, viewportLines } from './lib/term-test.mjs'
import { packedKeys, runAndCleanup, failureText, groupProcesses } from './lib/packed-host-driver.mjs'

async function cadence() {
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} })
  const term = new xterm.Terminal({ cols: 110, rows: 32, allowProposedApi: true })
  const stdout = new Writable({ write(chunk, _encoding, done) { term.write(String(chunk), done) } })
  Object.assign(stdout, { isTTY: true, columns: 110, rows: 32 })
  const commands = []
  const channel = { mode: { id: 'default', plan: false }, modeIndex: 0, cycleMode() {},
    commandList: [{ name: 'hint' }, { name: 'new' }], commandCompletions() { return [] },
    notifications: [], pending: [], working: false, notify() {}, listFiles: async () => [],
    submit() { throw new Error('local commands must not reach a provider') } }
  const app = await render(React.createElement(PromptInput, { channel, helpOpen: false, onToggleHelp() {},
    onRunCommand(name) { commands.push(name); return true }, selectionActive: false }),
  { stdin, stdout, stderr: stdout, exitOnCtrlC: false, patchConsole: false })
  const writes = []
  const keys = packedKeys(data => stdin.write(data), event => writes.push(event))
  try {
    await sleep(100) // 固定窗:pacing initial input-listener mount before the first draft.
    keys.send('/hint refresh')
    assert(await settled(() => viewportLines(term).some(line => line.includes('/hint refresh')), { stepMs: 1 }))
    await keys.enter()
    assert(await settled(() => commands.length === 1))
    keys.send('/new')
    assert(await settled(() => viewportLines(term).some(line => line.includes('/new')), { stepMs: 1 }))
    // Remote driver could see the next painted draft after a 50ms poll.
    await keys.enter()
    assert(await settled(() => commands.length === 2, { timeoutMs: 300 }),
      `second distinct command dropped; Return writes=${JSON.stringify(writes.filter(e => e.keys === '\r'))}`)
    assert.deepEqual(commands, ['hint', 'new'])
    console.log('PASS successive driver commands cross real PromptInput Return guard', JSON.stringify(writes.filter(e => e.keys === '\r')))
  } finally { app.unmount(); term.dispose() }
}

async function teardown() {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-packed-transport-'))
  const heartbeat = join(scratch, 'heartbeat')
  const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim()
  const bridge = spawn(python, [new URL('./lib/host-pty.py', import.meta.url).pathname, python,
    new URL('./fixtures/packed-host/stubborn-child.py', import.meta.url).pathname, heartbeat])
  let writer
  const events = []
  const lines = createInterface({ input: bridge.stdout })
  let text = ''
  lines.on('line', line => {
    const event = JSON.parse(line)
    events.push(event)
    if (event.data) {
      text += Buffer.from(event.data, 'base64').toString()
      const match = text.match(/\{"writer": (\d+), "group": (\d+)\}/)
      if (match) writer = { pid: Number(match[1]), group: Number(match[2]) }
    }
  })
  const exited = new Promise(resolve => bridge.on('close', code => resolve(code)))
  try {
    assert(await settled(() => writer !== undefined), 'owned fixture child must start')
    bridge.stdin.end('{"stop":true}\n')
    assert.equal(await exited, 0, 'bridge must settle even after launcher exits')
    const size = statSync(heartbeat).size
    await sleep(150) // 固定窗:探针 a surviving writer must not mutate files after bridge teardown.
    assert.equal(statSync(heartbeat).size, size, `descendant survived launcher exit: ${JSON.stringify(writer)}; events=${JSON.stringify(events.filter(e => !e.data))}`)
    assert(groupProcesses(writer.group).every(p => p.status.startsWith('Z')), 'owned group has no live descendants')
    console.log('PASS PTY teardown stops owned descendant even after launcher exit', JSON.stringify(events.filter(e => !e.data)))
    // Only after the transport settled may run-owned scratch be removed.
  } finally {
    if (writer) { try { process.kill(-writer.group, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
    bridge.stdin.end()
    await exited
    lines.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

try {
  if (!process.argv[2] || process.argv[2] === 'cadence') await cadence()
  if (!process.argv[2] || process.argv[2] === 'teardown') await teardown()
  if (!process.argv[2] || process.argv[2] === 'errors') {
    const journey = new Error('fresh/hint-new-session: original journey failure')
    const cleanup = new Error('scratch still exists: cleanup failure')
    await assert.rejects(runAndCleanup(() => { throw journey }, () => { throw cleanup }),
      error => error instanceof AggregateError && error.errors[0] === journey && error.errors[1] === cleanup
        && failureText(error).includes(journey.message) && failureText(error).includes(cleanup.message),
      'both failures must survive, with journey first')
    console.log('PASS original journey and cleanup failures both retained')
  }
} finally { rmSync(fakeHome, { recursive: true, force: true }) }
