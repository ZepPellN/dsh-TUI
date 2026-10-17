#!/usr/bin/env node
/** Real packed-plugin acceptance, Linux/macOS. No source host or UI stand-in.
 * node scripts/verify-packed-host.mjs [roundtrip|launch|doctor|drive|cleanup] --evidence /absolute/path
 * Requires compiled lib/, npm, pnpm 11 and python3 (stdlib PTY only).
 * Every run owns an empty /tmp home. Package setup may use the registry;
 * model traffic uses a loopback HTTP fixture and a synthetic credential only.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import xterm from '@xterm/headless'
import { settled, viewportLines, writeParsed } from './lib/term-test.mjs'

const root = resolve(import.meta.dirname, '..')
const { Terminal } = xterm
const target = '0.2.1-rc.2'
const command = process.argv[2]?.startsWith('--') ? 'roundtrip' : process.argv[2] ?? 'roundtrip'
const evidenceArg = process.argv[process.argv.indexOf('--evidence') + 1]
assert(process.argv.includes('--evidence') && isAbsolute(evidenceArg), 'pass --evidence /absolute/path outside the checkout')
const evidence = resolve(evidenceArg)
assert(relative(root, evidence).startsWith('..'), 'evidence must survive worktree removal')
mkdirSync(evidence, { recursive: true })
const statePath = join(evidence, 'run.json')
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
const save = (name, value) => writeFileSync(join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')

function isolatedEnv(scratch) {
  // Deliberately no spread of process.env: no real keys, NODE_OPTIONS,
  // credential helpers, DSH paths, proxy, npmrc, shell startup or user prefs.
  return {
    PATH: `${join(scratch, 'host/node_modules/.bin')}:${process.env.PATH}`,
    HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'),
    DSH_HOME: join(scratch, 'home/.dsh'),
    XDG_CONFIG_HOME: join(scratch, 'home/.config'),
    XDG_CACHE_HOME: join(scratch, 'home/.cache'),
    TMPDIR: scratch, TERM: 'xterm-256color', COLORTERM: 'truecolor',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    DSH_TUI_LANG: 'en', DSH_TELEMETRY_MODE: 'DISABLED',
    npm_config_userconfig: join(scratch, 'user.npmrc'), npm_config_globalconfig: join(scratch, 'global.npmrc'),
    // Public registry cache only; profiles/config/credentials remain per-run.
    npm_config_cache: join(dirname(evidence), 'packed-registry-cache'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_fetch_timeout: '600000',
    // No ambient provider discovery can supply a real credential.
    DEEPSEEK_API_KEY: 'dsh-verify-synthetic-not-a-real-key',
  }
}

function run(program, args, state, label, cwd = root) {
  const result = spawnSync(program, args, {
    cwd, env: isolatedEnv(state.scratch), encoding: 'utf8', timeout: 900000,
    maxBuffer: 32 * 1024 * 1024,
  })
  save(`${label}.log`, `$ ${program} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}\nexit=${result.status}\n`)
  assert.equal(result.error, undefined, label)
  assert.equal(result.status, 0, `${label}: see ${join(evidence, label + '.log')}`)
  return result.stdout
}

function launch() {
  assert(!existsSync(statePath), 'use a new evidence directory for each launch')
  assert(existsSync(join(root, 'lib/types/index.js')), 'run pnpm build first')
  const scratch = mkdtempSync('/tmp/dsh-packed-')
  const state = { scratch, target, node: process.execPath, platform: process.platform, createdAt: new Date().toISOString() }
  save('run.json', state) // cleanup is possible even when setup fails
  mkdirSync(join(scratch, 'home'), { recursive: true })
  mkdirSync(join(scratch, 'workspace'))
  assert(!existsSync(join(scratch, 'home/.dsh')), 'profile starts empty')
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', evidence], state, 'pack'))
  state.tarball = join(evidence, packed[0].filename)
  save('run.json', state)
  run('npm', ['install', '--prefix', join(scratch, 'host'), '--ignore-scripts', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${target}`], state, 'host-install', scratch)
  state.cli = join(scratch, 'host/node_modules/@deepseek-ai/dsh/lib/bin.js')
  save('run.json', state)
  run(process.execPath, [state.cli, 'plugin', '--profile', 'dsh-tui', 'add', '--ignore-scripts', state.tarball], state, 'profile-install', scratch)
  state.profile = join(scratch, 'home/.dsh/profiles/dsh-tui')
  state.bin = join(state.profile, 'node_modules/@deepseek-harness-tui/dsh-tui/bin/dsh-tui.js')
  save('run.json', state)
  console.log(`launched isolated package setup: ${scratch}`)
}

function doctor() {
  const state = readState()
  assert(!state.cleaned, 'instance already cleaned; start a new run')
  assert.equal(state.node, process.execPath, 'drive using the same Node binary')
  assert.equal(run(process.execPath, [state.cli, '--version'], state, 'doctor-version').trim(), target)
  const manifest = JSON.parse(readFileSync(join(state.profile, 'package.json'), 'utf8'))
  assert(!JSON.stringify(manifest).includes('exemption'), 'no version exemption')
  assert(existsSync(state.bin), 'packed plugin launcher installed')
  assert(realpathSync(state.bin).startsWith(realpathSync(state.scratch) + '/'), 'never drive the installed user TUI')
  const config = run(process.execPath, [state.cli, '--profile', 'dsh-tui', '--dump-config'], state, 'doctor-config')
  assert(config.includes('@deepseek-harness-tui/dsh-tui'), 'real host composes packed TUI')
  assert(config.includes('DISABLED'), 'TUI telemetry privacy default retained')
  const python = run('python3', ['--version'], state, 'doctor-pty')
  save('doctor.json', { target, node: process.version, python: python.trim(), profile: state.profile, tarball: state.tarball, versionExemptions: false })
  console.log('doctor: exact host, packed plugin, no exemption, isolated profile')
}

async function drive() {
  const state = readState()
  doctor()
  const requests = []
  const provider = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/messages', 'exact target uses native DeepSeek Messages')
      let body = ''
      for await (const chunk of req) body += chunk
      const json = JSON.parse(body)
      assert.equal(req.headers['x-api-key'], 'dsh-verify-synthetic-not-a-real-key')
      requests.push({ path: req.url, body: json })
      save('provider-requests.json', requests)
      const last = [...json.messages].reverse().find(m => m.role === 'user')
      const text = JSON.stringify(last?.content)
      const answer = text.includes('VERIFY_SECOND') ? 'DSH_VERIFY_RESTORED_OK'
        : text.includes('VERIFY_FIRST') ? 'DSH_VERIFY_FIRST_OK' : 'DSH_VERIFY_RECAP_OK'
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      for (const event of [
        { type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    } catch (error) {
      save('provider-error.txt', error.stack)
      res.writeHead(500).end('fixture rejected unexpected request')
    }
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const env = { ...isolatedEnv(state.scratch), DEEPSEEK_BASE_URL: `http://127.0.0.1:${provider.address().port}` }
  const active = new Set()
  const actions = []
  const record = action => { actions.push({ at: new Date().toISOString(), ...action }); save('actions.json', actions) }
  async function session(label, args, journey) {
    const term = new Terminal({ cols: 110, rows: 32, scrollback: 2000, allowProposedApi: true })
    const child = spawn('python3', [join(root, 'scripts/lib/host-pty.py'), process.execPath, state.bin, ...args], {
      cwd: join(state.scratch, 'workspace'), env, stdio: ['pipe', 'pipe', 'pipe'],
    })
    active.add(child)
    let exitCode
    let transportError
    let raw = ''
    const decoder = new StringDecoder('utf8')
    let parsing = Promise.resolve()
    const send = data => child.stdin.write(JSON.stringify({ write: data }) + '\n')
    term.onData(data => send(data)) // real terminal query replies
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      const event = JSON.parse(line)
      if ('exitCode' in event) exitCode = event.exitCode
      if (event.data) {
        const data = decoder.write(Buffer.from(event.data, 'base64'))
        raw += data
        appendFileSync(join(evidence, `${label}.ansi`), data)
        parsing = parsing.then(() => writeParsed(term, data))
      }
    })
    child.stderr.on('data', data => appendFileSync(join(evidence, `${label}-transport.log`), data))
    child.on('error', error => { transportError = error })
    const screen = () => viewportLines(term).join('\n')
    const wait = async (name, predicate) => {
      const ok = await settled(() => !transportError && predicate(), { timeoutMs: 45000, stepMs: 50 })
      await parsing
      save(`${label}-${name}.txt`, screen())
      assert(ok, `${label}/${name}: real PTY did not reach expected state (exit=${exitCode}); see evidence`)
    }
    const type = async text => {
      record({ session: label, keys: text })
      send(text)
      // A command and Enter are separate input events, just like normal typing.
      await wait('typed-' + actions.length, () => screen().includes(text))
      send('\r')
    }
    try {
      record({ session: label, argv: [state.bin, ...args], cwd: join(state.scratch, 'workspace') })
      await wait('startup', () => /Type to search sessions|⌸\s+❯/u.test(screen()) && exitCode === undefined)
      if (screen().includes('Type to search sessions')) {
        record({ session: label, keys: 'Right', action: 'Focus sessions pane' })
        send('\x1b[C')
        await wait('sessions-pane', () => screen().includes('+ New session'))
        record({ session: label, keys: 'Ctrl+N', action: 'New session from workspace picker' })
        send('\x0e')
      }
      await wait('ready', () => /⌸\s+❯/u.test(screen()) && exitCode === undefined)
      await journey({ wait, type, screen })
      await type('/exit')
      await wait('exit', () => exitCode !== undefined)
      assert.equal(exitCode, 0, 'normal user exit must be zero')
      assert(raw.lastIndexOf('\x1b[?25h') > raw.lastIndexOf('\x1b[?25l'), 'cursor restored after last hide')
      assert(raw.lastIndexOf('\x1b[?1049l') > raw.lastIndexOf('\x1b[?1049h'), 'fullscreen terminal restored after entry')
      assert.equal(term.buffer.active.type, 'normal', 'terminal parser returned to normal buffer')
      for (const mode of ['1000', '1002', '1003', '1006', '2004', '2026']) {
        assert(raw.lastIndexOf(`\x1b[?${mode}l`) > raw.lastIndexOf(`\x1b[?${mode}h`), `terminal mode ${mode} disabled at exit`)
      }
      record({ session: label, exitCode, terminalRestored: true })
    } finally {
      if (exitCode === undefined) child.stdin.write('{"stop":true}\n')
      child.stdin.end()
      await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve))
      active.delete(child)
      lines.close()
      term.dispose()
    }
  }
  try {
    await session('fresh', [], async ({ type, wait, screen }) => {
      await type('VERIFY_FIRST: say hello')
      await wait('answer', () => screen().includes('DSH_VERIFY_FIRST_OK') && requests.length > 0)
    })
    const resume = readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim()
    assert(resume, 'normal exit saves a resumable session')
    save('session-id.txt', resume + '\n')
    await session('restored', ['--resume', resume], async ({ type, wait, screen }) => {
      await wait('history', () => screen().includes('DSH_VERIFY_FIRST_OK'))
      await type('VERIFY_SECOND: continue our conversation')
      await wait('answer', () => screen().includes('DSH_VERIFY_RESTORED_OK'))
    })
    const continuation = requests.find(r => JSON.stringify(r.body.messages.at(-1)).includes('VERIFY_SECOND'))
    assert(continuation, 'provider receives continued user input')
    assert(continuation.body.messages.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('DSH_VERIFY_FIRST_OK')), 'real restored history reaches provider')
    assert.equal(readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim(), resume, 'continue the same persisted session')
    save('result.json', { passed: true, target, sessionId: resume, requests: requests.length, provider: env.DEEPSEEK_BASE_URL, credentials: 'synthetic only', platform: process.platform })
    console.log('PASS packed host PTY: prompt → provider → save → restart/resume → continue → normal exit')
  } finally {
    for (const child of active) child.stdin.end('{"stop":true}\n')
    await new Promise(resolve => provider.close(resolve))
  }
}

function cleanup() {
  if (!existsSync(statePath)) return
  const state = readState()
  if (state.cleaned) return
  assert(dirname(state.scratch) === '/tmp' && /^dsh-packed-[\w-]+$/.test(state.scratch.split('/').at(-1)), 'cleanup only owns its mkdtemp directory')
  for (const [from, to] of [['home/.dsh/sessions', 'persisted-sessions'], ['home/.dsh-tui', 'tui-state']]) {
    if (existsSync(join(state.scratch, from))) cpSync(join(state.scratch, from), join(evidence, to), { recursive: true })
  }
  rmSync(state.scratch, { recursive: true, force: true })
  save('run.json', { ...state, cleaned: true })
  assert(existsSync(statePath) && !existsSync(state.scratch), 'proof survives scratch cleanup')
  console.log(`cleanup: owned scratch removed; evidence retained at ${evidence}`)
}

try {
  if (command === 'roundtrip') {
    try { launch(); doctor(); await drive() } finally { cleanup() }
    assert(existsSync(join(evidence, 'result.json')) && existsSync(join(evidence, 'fresh.ansi')), 'proof remains after teardown')
  } else if (command === 'launch') launch()
  else if (command === 'doctor') doctor()
  else if (command === 'drive') await drive()
  else if (command === 'cleanup') cleanup()
  else throw new Error(`unknown command: ${command}`)
} catch (error) {
  save('failure.txt', error.stack)
  console.error(error.stack)
  process.exitCode = 1
}
