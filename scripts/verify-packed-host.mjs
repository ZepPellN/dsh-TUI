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
import { workspacePickerReady, newSessionActionReady } from './lib/packed-host-screen.mjs'
import { createHintInteractionProvider, driveHintInteractions } from './lib/packed-hint-interactions.mjs'

const root = resolve(import.meta.dirname, '..')
const { Terminal } = xterm
const target = '0.2.1-rc.2'
const hintJourney = process.argv.includes('--context-hint')
const hintRefresh = process.argv.includes('--hint-refresh')
const hintFailures = process.argv.includes('--hint-failures')
const hintUi = process.argv.includes('--hint-ui')
const hintLifecycle = process.argv.includes('--hint-lifecycle')
const hintFences = process.argv.includes('--hint-fences')
const hintAutomatic = process.argv.includes('--hint-automatic')
const hintShortcut = process.argv.find(arg => arg.startsWith('--hint-shortcut='))?.slice('--hint-shortcut='.length)
assert(hintShortcut === undefined || ['alt+p', ''].includes(hintShortcut), 'shortcut journey accepts alt+p or empty (command only)')
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
    npm_config_store_dir: join(dirname(evidence), 'packed-registry-cache/pnpm-store'),
    npm_config_cache_dir: join(dirname(evidence), 'packed-registry-cache/pnpm-cache'),
    npm_config_prefer_offline: 'true',
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
  if (hintShortcut !== undefined) {
    state.hintPatch = join(scratch, 'hint.patch.yml')
    // Patches replace the whole config: retain every shipped front-door value.
    writeFileSync(state.hintPatch, '- id: dsh-tui\n  config:\n    provider: deepseek-official\n    fullscreen: true\n    terminalImages: true\n    effort: max\n    sessionId: !!js process.env.DSH_TUI_RESUME_SESSION ?? undefined\n    workspace: !!js process.env.DSH_TUI_WORKSPACE_TARGET ?? undefined\n    contextHintShortcut: ' + JSON.stringify(hintShortcut) + '\n')
  }
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
  const interactionProvider = hintAutomatic ? createHintInteractionProvider() : undefined
  let hintResponse = 'valid'
  const heldHints = []
  const releaseHints = () => { for (const release of heldHints.splice(0)) release() }
  const provider = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/messages', 'exact target uses native DeepSeek Messages')
      let body = ''
      for await (const chunk of req) body += chunk
      const json = JSON.parse(body)
      assert.equal(req.headers['x-api-key'], 'dsh-verify-synthetic-not-a-real-key')
      requests.push({ path: req.url, body: json })
      save('provider-requests.json', requests)
      if (interactionProvider?.handle(json, res)) return
      const last = [...json.messages].reverse().find(m => m.role === 'user')
      const text = JSON.stringify(last?.content)
      const primaryFirst = Array.isArray(last?.content) && last.content.some(block => block.type === 'text' && block.text.startsWith('VERIFY_FIRST:'))
      const hint = text.includes('CONTEXT_HINT_V1')
      if (hint && hintResponse === 'transport') { res.destroy(); return }
      if (hint && (hintResponse === '429' || hintResponse === '503')) {
        res.writeHead(Number(hintResponse), { 'content-type': 'application/json', 'retry-after': '0' })
        res.end(JSON.stringify({ error: { type: 'fixture_failure', message: 'synthetic failure' } }))
        return
      }
      if (hint && hintResponse === 'timeout') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); return }
      const answer = hint && hintResponse === 'malformed' ? '{"session":{}}'
        : hint && hintResponse === 'overflow' ? 'x'.repeat(16001) : hint ? JSON.stringify({
        session: { goal: 'Summarize this interaction', status: hintResponse === 'hold' ? 'LATE_WRONG_HINT' : 'BOUNDARY_SUMMARY_OK', blockers: [], next: hintResponse === 'hold-valid' ? 'BACKGROUND_NEXT_CHECK' : 'NEXT_CHECK' },
        turn: { completed: ['Reply acknowledged'], findings: [], verification: ['Synthetic provider fixture only'], failures: [], outcome: 'completed' },
      }) : text.includes('Create a compact session recap') ? JSON.stringify({ title: 'Synthetic recap', summary: 'DSH_VERIFY_RECAP_OK' })
        : text.includes('VERIFY_SECOND') ? 'DSH_VERIFY_RESTORED_OK'
        : text.includes('VERIFY_FIRST') ? (hintUi && primaryFirst ? 'DSH_VERIFY_FIRST_OK\n' + Array.from({ length: 45 }, (_, i) => `HINT_SCROLL_${String(i).padStart(2, '0')}`).join('\n') + '\n' : '') + 'DSH_VERIFY_FIRST_OK' : 'DSH_VERIFY_RECAP_OK'
      const respond = () => {
        if (res.destroyed) return
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
      }
      if (hint && (hintResponse === 'hold' || hintResponse === 'hold-valid')) heldHints.push(respond)
      else respond()
    } catch (error) {
      save('provider-error.txt', error.stack)
      res.writeHead(500).end('fixture rejected unexpected request')
    }
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const env = { ...isolatedEnv(state.scratch), DEEPSEEK_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
    ...(hintShortcut === undefined ? {} : { DSH_TUI_HINT_SHORTCUT: 'alt+k' }),
  }
  const active = new Set()
  const actions = []
  const record = action => { actions.push({ at: new Date().toISOString(), ...action }); save('actions.json', actions) }
  async function session(label, args, journey) {
    const term = new Terminal({ cols: 110, rows: 32, scrollback: 2000, allowProposedApi: true })
    const argv = [...(state.hintPatch === undefined ? [] : ['--patch', state.hintPatch]), ...args]
    const child = spawn('python3', [join(root, 'scripts/lib/host-pty.py'), process.execPath, state.bin, ...argv], {
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
      await wait('typed-' + actions.length, () => viewportLines(term).some(line => /⌸\s+❯/u.test(line) && line.includes(text)))
      send('\r')
    }
    try {
      record({ session: label, argv: [state.bin, ...argv], cwd: join(state.scratch, 'workspace') })
      await wait('startup', () => /Type to search sessions|⌸\s+❯/u.test(screen()) && exitCode === undefined)
      if (screen().includes('Type to search sessions')) {
        await wait('workspace-ready', () => workspacePickerReady(screen(), 'workspace') && exitCode === undefined)
        record({ session: label, state: 'workspace-ready', screen: `${label}-workspace-ready.txt` })
        record({ session: label, keys: 'Right', action: 'Focus sessions pane' })
        send('\x1b[C')
        await wait('sessions-pane', () => newSessionActionReady(screen(), 'workspace') && exitCode === undefined)
        record({ session: label, state: 'new-session-action-ready', screen: `${label}-sessions-pane.txt` })
        record({ session: label, keys: 'Ctrl+N', action: 'New session from workspace picker' })
        send('\x0e')
      }
      await wait('ready', () => /⌸\s+❯/u.test(screen()) && exitCode === undefined)
      await journey({ wait, type, screen, send })
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
    if (hintAutomatic) {
      await driveHintInteractions({ session, requests, save, fixture: interactionProvider, state })
      return
    }
    if (hintJourney) {
      const grantsPath = join(state.scratch, 'home/.dsh-tui/extension-grants.json')
      // ConfirmPanel's title column wraps independently from its message.
      const consentVisible = screen => screen.includes('Enable Context') && screen.includes('Hint?')
      await session('fresh', [], async ({ type, wait, screen, send }) => {
        assert.equal(requests.length, 0, 'no model request on empty-profile startup')
        await type('/hint enable')
        await wait('hint-consent', () => consentVisible(screen()))
        assert(screen().includes('storage.local.read') && screen().includes('storage.local.write'), 'own-storage disclosure')
        assert(screen().includes('Destination deepseek-official/deepseek-flash.'), 'actual inherited destination disclosed')
        assert(screen().replace(/\s+/g, ' ').includes('No tools or main-context writes.'), 'selected content is display-only and tool-less')
        assert(screen().replace(/\s+/g, ' ').includes('12000 input characters total'), 'finite selected input disclosed')
        assert.equal(requests.length, 0, 'consent does not call provider')
        send('\x1b')
        await wait('hint-consent-cancelled', () => !consentVisible(screen()))
        assert(!existsSync(grantsPath), 'cancel is no grant')
        const denied = JSON.stringify({ denies: { 'dsh-tui.context-hint': [{ name: 'storage.local.write', scope: 'dsh-tui.context-hint' }] } })
        mkdirSync(dirname(grantsPath), { recursive: true })
        writeFileSync(grantsPath, denied)
        await type('/hint enable')
        await wait('hint-consent-with-deny', () => consentVisible(screen()))
        send('\r')
        await wait('hint-denied', () => screen().includes('Context Hint unavailable') && !consentVisible(screen()))
        assert.equal(readFileSync(grantsPath, 'utf8'), denied, 'consent never weakens an existing explicit denial')
        assert.equal(requests.length, 0, 'denied activation never calls a model')
        rmSync(grantsPath) // only the exact synthetic denial fixture created above
        await type('/hint enable')
        await wait('hint-consent-again', () => consentVisible(screen()))
        send('\r')
        await wait('hint-enabled', () => screen().includes('Context Hint') && screen().includes('Pending update'))
        const grants = JSON.parse(readFileSync(grantsPath, 'utf8'))
        assert.deepEqual(grants.grants['dsh-tui.context-hint'], [
          { name: 'storage.local.read', scope: 'dsh-tui.context-hint' },
          { name: 'storage.local.write', scope: 'dsh-tui.context-hint' },
        ], 'exact component and storage permissions only')
        assert.equal(requests.length, 0, 'enable alone never generates')
        // These existing #3 journeys isolate explicit refresh from #5's
        // automatic trigger. The automatic journey tests resume separately.
        await type('/hint pause')
        await wait('manual-mode-paused', () => screen().includes('Paused automatic updates'))
        if (hintRefresh) {
          await type('VERIFY_FIRST: say hello')
          await wait('main-answer', () => screen().includes('DSH_VERIFY_FIRST_OK'))
          assert(!requests.some(request => JSON.stringify(request.body).includes('CONTEXT_HINT_V1')), 'paused manual journey makes no automatic generation')
          await type('/hint refresh')
          await wait('hint-request', () => requests.some(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')))
          const calls = requests.filter(request => JSON.stringify(request.body).includes('CONTEXT_HINT_V1'))
          assert.equal(calls.length, 1, 'one explicit refresh = one provider HTTP request')
          assert.equal(calls[0].body.model, 'deepseek-flash', 'inherits the live main route')
          assert(!calls[0].body.tools?.length, 'tool-less summary request')
          assert.equal(calls[0].body.max_tokens, 2048, 'finite output token bound')
          assert(JSON.stringify(calls[0].body.messages).length < 12500, 'entire selected input stays bounded')
          assert.equal(calls[0].body.system, undefined, 'no main system prompt copied')
          assert.equal(calls[0].body.messages.length, 1, 'only the bounded selected activity message')
          assert(!JSON.stringify(calls[0].body).includes('Current runtime context.'), 'host-injected user-role instructions are not selected activity')
          assert(!JSON.stringify(calls[0].body).includes('<available_skills>'), 'skill catalog is not selected activity')
          assert.equal(calls[0].body.dsh_session_log, undefined, 'no canonical session events/header in the full native envelope')
          assert.equal(calls[0].body.dsh_plugin_packages, undefined, 'no package inventory in the summary envelope')
          assert(JSON.stringify(calls[0].body).length < 14000, 'whole wire body, not only messages, remains bounded')
          assert(Object.keys(calls[0].body).every(key => ['model', 'stream', 'messages', 'max_tokens', 'thinking', 'output_config'].includes(key)), 'no unreviewed native envelope contributors')
          await wait('hint-generated', () => screen().includes('BOUNDARY_SUMMARY_OK') && screen().includes('NEXT_CHECK'))
          let stored = readFileSync(join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json'), 'utf8')
          assert(stored.includes('BOUNDARY_SUMMARY_OK'), 'actual latest card persisted by admitted component')
          assert(!stored.includes('VERIFY_FIRST'), 'no new raw prompt archive')
          if (hintUi) {
            hintResponse = 'hold-valid'
            await type('/hint refresh')
            await wait('background-held', () => heldHints.length === 1)
            send('\x1b[5~')
            await wait('background-scrolled', () => screen().includes('HINT_SCROLL_') && !screen().includes('DSH_VERIFY_FIRST_OK'))
            send('BACKGROUND_UNSENT_DRAFT')
            await wait('background-draft', () => /⌸\s+❯/u.test(screen()) && screen().includes('BACKGROUND_UNSENT_DRAFT'))
            const anchors = () => screen().split('\n').filter(line => line.includes('HINT_SCROLL_'))
            const beforeCompletion = anchors()
            assert(beforeCompletion.length > 0, 'observe a real non-bottom transcript viewport')
            releaseHints()
            await wait('background-completed', () => screen().includes('BACKGROUND_NEXT_CHECK'))
            assert.deepEqual(anchors(), beforeCompletion, 'summary completion preserves the selected transcript scroll position')
            assert(screen().split('\n').some(line => /⌸\s+❯/u.test(line) && line.includes('BACKGROUND_UNSENT_DRAFT')), 'summary completion preserves focused unsent input')
            send('\x15')
            send('\x1b[F')
            await wait('background-return-bottom', () => screen().includes('DSH_VERIFY_FIRST_OK') && !screen().includes('BACKGROUND_UNSENT_DRAFT'))
            stored = readFileSync(join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json'), 'utf8')
            hintResponse = 'valid'
            await type('/hint enable')
            await wait('hint-modal-priority', () => consentVisible(screen()))
            send(hintShortcut === 'alt+p' ? '\x1bp' : '\x1bo')
            await wait('hint-modal-still-owns-input', () => consentVisible(screen()) && !screen().includes('Session Card'))
            send('\x1b')
            await wait('hint-modal-dismissed', () => !consentVisible(screen()) && /⌸\s+❯/u.test(screen()))
            await type('/hint view')
            await wait('hint-detail', () => screen().includes('Session Card') && screen().includes('Turn Card'))
            assert(screen().includes('Reply acknowledged') && screen().includes('Synthetic provider fixture only'), 'Turn details, not only compact Session status')
            send('\x1b')
            await wait('hint-detail-closed', () => /⌸\s+❯/u.test(screen()))
            if (hintShortcut === '') {
              send('\x1bo')
              send('COMMAND_ONLY_DRAFT')
              await wait('hint-no-shortcut', () => /⌸\s+❯/u.test(screen()) && screen().includes('COMMAND_ONLY_DRAFT') && !screen().includes('Session Card'))
              send('\x15')
              await wait('command-only-draft-cleared', () => !screen().includes('COMMAND_ONLY_DRAFT'))
              await type('/hint view')
              await wait('hint-command-only', () => screen().includes('Session Card') && screen().includes('Turn Card'))
              send('\x1b')
            } else {
              send('UNSENT_HINT_DRAFT')
              await wait('draft-ready', () => screen().includes('UNSENT_HINT_DRAFT'))
              const keys = hintShortcut === 'alt+p' ? '\x1bp' : '\x1bo'
              send(keys)
              await wait('hint-shortcut', () => screen().includes('Session Card') && screen().includes('Turn Card'))
              send(keys)
            }
            await wait('hint-draft-restored', () => /⌸\s+❯/u.test(screen()) && (hintShortcut === '' || screen().includes('UNSENT_HINT_DRAFT')))
            send('\x15')
            await wait('draft-cleared', () => !screen().includes('UNSENT_HINT_DRAFT'))
            await type('/lang zh')
            await wait('language-changed-zh', () => screen().includes('缓存') && screen().split('\n').some(line => /⌸\s+❯/u.test(line) && !line.includes('/lang')))
            await type('/hint view')
            await wait('hint-chinese-detail', () => screen().includes('会话卡片') && screen().includes('轮次卡片'))
            assert(screen().includes('实际验证') && screen().includes('下一步'), 'basic Chinese field labels')
            send('\x1b')
            await wait('hint-chinese-closed', () => /⌸\s+❯/u.test(screen()))
            await type('/lang en')
            await wait('language-changed-en', () => !screen().includes('缓存') && screen().split('\n').some(line => /⌸\s+❯/u.test(line) && !line.includes('/lang')))
          }
          if (hintLifecycle) {
            const countHints = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
            const storagePath = join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json')
            const sessionA = Object.values(JSON.parse(stored)).find(value => value.cards).sessionId
            const beforeLifecycle = countHints()
            if (hintFences) {
              hintResponse = 'hold'
              await type('/hint refresh')
              await wait('hint-a-held', () => heldHints.length === 1)
            }
            await type('/new')
            await wait('hint-new-session', () => screen().includes('Pending update') && !screen().includes('BOUNDARY_SUMMARY_OK') && /⌸\s+❯/u.test(screen()))
            assert.equal(countHints(), beforeLifecycle + (hintFences ? 1 : 0), 'session switching never generates a hint')
            if (hintFences) {
              await type('VERIFY_SECOND: continue our conversation')
              await wait('main-b-answer', () => screen().includes('DSH_VERIFY_RESTORED_OK'))
              await type('/home')
              await wait('home-a-listed', () => screen().includes('Sessions') && screen().includes('DSH_VERIFY_FIRST_OK'))
              send('\x1b[C')
              await wait('home-b-focused', () => screen().split('\n').some(line => line.includes('❯') && line.includes('DSH_VERIFY_RESTORED_OK')))
              send('DSH_VERIFY_FIRST_OK')
              await wait('home-a-focused', () => screen().includes('/ DSH_VERIFY_FIRST_OK') && screen().split('\n').some(line => line.includes('❯') && line.includes('DSH_VERIFY_FIRST_OK')))
              send('\r')
              await wait('hint-return-a', () => /⌸\s+❯/u.test(screen()) && screen().includes('BOUNDARY_SUMMARY_OK'))
              releaseHints()
              await type('/hint view')
              await wait('hint-a-identity', () => screen().includes(sessionA) && screen().includes('Session Card'))
              assert(!screen().includes('LATE_WRONG_HINT'), 'A→B→A rejects the old binding generation')
              assert(!readFileSync(storagePath, 'utf8').includes('LATE_WRONG_HINT'), 'late A result never persists')
              send('\x1b')
              await wait('a-detail-closed', () => /⌸\s+❯/u.test(screen()))
              hintResponse = 'valid'
              await type('/model deepseek-official/deepseek-v4-pro')
              await wait('model-rebound', () => screen().includes('deepseek-v4-pro') && screen().includes('Pending update'))
              await type('/hint refresh')
              await wait('model-inherited', () => screen().includes('BOUNDARY_SUMMARY_OK'))
              assert.equal(requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).at(-1).body.model, 'deepseek-v4-pro', 'each refresh inherits the live route, not the old header')
              const beforeDisable = readFileSync(storagePath, 'utf8')
              hintResponse = 'hold'
              await type('/hint refresh')
              await wait('disable-held', () => heldHints.length === 1)
              await type('/hint disable')
              await wait('hint-disabled', () => !screen().includes('BOUNDARY_SUMMARY_OK') && !screen().includes('Pending update'))
              releaseHints()
              await type('/hint enable')
              await wait('hint-reenable-consent', () => consentVisible(screen()))
              send('\r')
              await wait('hint-reenabled', () => screen().includes('BOUNDARY_SUMMARY_OK'))
              const cards = text => Object.values(JSON.parse(text)).filter(value => value.cards)
              assert.deepEqual(cards(readFileSync(storagePath, 'utf8')), cards(beforeDisable), 'disable prevents held completion writes')
              await type('/hint refresh')
              await wait('shutdown-held', () => heldHints.length === 1)
              // Session helper now exits normally while the request is held.
            }
          }
          if (hintFailures) {
            const card = text => Object.values(JSON.parse(text)).find(value => value.cards)?.cards
            for (const failure of ['malformed', '429', '503', 'transport', 'overflow', 'timeout']) {
              const before = requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
              const beforeFailure = readFileSync(join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json'), 'utf8')
              hintResponse = failure
              await type('/hint refresh')
              await wait(`hint-last-valid-${failure}`, () => screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
              const after = readFileSync(join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json'), 'utf8')
              assert.deepEqual(card(after), card(beforeFailure), `${failure}: actual Last Valid retained`)
              assert.equal(requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length, before + 1, `${failure}: no repair or retry`)
              if (failure !== 'timeout') {
                hintResponse = 'valid'
                await type('/hint retry')
                await wait(`hint-recovered-${failure}`, () => !screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
                assert.equal(requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length, before + 2, 'manual retry is exactly one explicit additional request')
              }
            }
          }
          if (hintShortcut === '') {
            await type('/hint disable')
            await wait('hint-disabled-before-restart', () => !screen().includes('BOUNDARY_SUMMARY_OK') && !screen().includes('Pending update'))
          }
        }
      })
      if (hintFences) {
        releaseHints()
        assert(!readFileSync(join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json'), 'utf8').includes('LATE_WRONG_HINT'), 'shutdown prevents late persistence')
      }
      if (hintFailures) {
        const resume = readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim()
        const count = requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
        await session('hint-restored', ['--resume', resume], async ({ wait, screen }) => {
          await wait('last-valid-restored', () => screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
          assert.equal(requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length, count, 'restore makes no new hint request')
        })
      }
      if (hintShortcut === '') {
        const resume = readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim()
        const countHints = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
        const beforeEnable = countHints()
        await session('hint-reenabled', ['--resume', resume], async ({ type, wait, screen, send }) => {
          assert(!screen().includes('BOUNDARY_SUMMARY_OK'), 'disabled state persists across restart')
          await type('/hint enable')
          await wait('consent', () => consentVisible(screen()))
          send('\r')
          await wait('retained-cards', () => screen().includes('BOUNDARY_SUMMARY_OK'))
          assert.equal(countHints(), beforeEnable, 're-enable restores retained cards without a new hint request')
          hintResponse = 'malformed'
          await type('/hint refresh')
          await wait('retained-last-valid', () => screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
          assert.equal(countHints(), beforeEnable + 1, 'failed refresh retains the restored Last Valid without repair')
        })
      }
      save('result.json', { passed: true, target, feature: hintRefresh ? 'context-hint-refresh' : 'context-hint-consent',
        scenarios: { hintFailures, hintUi, hintLifecycle, hintFences, hintShortcut }, requests: requests.length, platform: process.platform })
      return
    }
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
    provider.closeAllConnections()
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
