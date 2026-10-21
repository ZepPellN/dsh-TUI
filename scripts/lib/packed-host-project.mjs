/** #6 ordinary PTY commands; uses the existing packed host launch/session/cleanup. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

export async function driveSharedProject({ state, run, session, save, requests, setResponse }) {
  const a = join(state.scratch, 'workspace')
  const b = join(state.scratch, 'linked-workspace')
  const clone = join(state.scratch, 'independent/workspace')
  mkdirSync(join(state.scratch, 'independent'))
  run('git', ['init', '-b', 'fixture'], state, 'project-git-init', a)
  run('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic fixture'], state, 'project-git-commit', a)
  run('git', ['worktree', 'add', '-b', 'fixture-b', b], state, 'project-worktree', a)
  run('git', ['clone', '--no-local', a, clone], state, 'project-clone', state.scratch)
  for (const [label, cwd] of [['a', a], ['clone', clone]]) {
    run('git', ['remote', label === 'a' ? 'add' : 'set-url', 'origin', 'https://example.invalid/synthetic-same-remote'], state, `project-remote-${label}`, cwd)
  }
  const file = join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json')
  const table = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const projects = () => Object.entries(table()).filter(([key]) => key.startsWith('project:'))
  const primary = () => projects().find(([, value]) => value.identity === realpathSync(join(a, '.git')))?.[1]
  const hints = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
  const running = []
  const stopping = []
  async function open(label, cwd, args = []) {
    const ready = deferred()
    const done = deferred()
    stopping.push(done)
    const process = session(label, args.length ? args : [cwd], async api => {
      ready.resolve(api)
      await done.promise
    }, { cwd })
    // Attach rejection immediately, including failed startup before ready.
    const started = Promise.race([ready.promise, process.then(() => { throw new Error(`${label} exited before ready`) })])
    running.push(process.catch(error => { throw error }))
    running.at(-1).catch(() => {})
    const api = await started
    return { ...api, finish: async () => { done.resolve(); await process } }
  }
  const enable = async p => {
    await p.type('/hint enable')
    await p.wait('project-consent', () => p.screen().includes('Enable Context') && p.screen().includes('Hint?'))
    p.send('\r')
    await p.wait('project-enabled', () => p.screen().includes('Pending update'))
  }
  const refresh = async (p, label) => {
    const before = hints()
    await p.type('/hint refresh')
    await p.wait(`project-suggestion-${label}`, () => hints() === before + 1 && p.screen().includes(`PROJECT_SESSION_${label}`)
      && p.screen().includes('Project suggestion pending'))
    assert.equal(hints(), before + 1, 'one manual summary contains Session/Turn and suggestion together')
  }
  const review = async (p, label) => {
    await p.type('/hint project review')
    await p.wait(`project-reviewed-${label}`, () => p.screen().includes('Project Suggestion') && p.screen().includes('Current and proposed replacement'))
    p.send('\x1b')
    await p.wait(`project-review-closed-${label}`, () => /⌸\s+❯/u.test(p.screen()))
  }
  try {
    setResponse('project')
    const pa = await open('fresh', a)
    assert.equal(hints(), 0, 'startup has no summary')
    await enable(pa)
    await pa.type('PROJECT_A: describe synthetic task A')
    await pa.wait('project-main-a', () => pa.screen().includes('PROJECT_MAIN_A_OK'))
    await refresh(pa, 'A')
    assert.equal(primary().card, undefined, 'generation does not confirm')
    assert(!JSON.stringify(table()).includes('projectSuggestion'), 'pending proposals are not archived')
    await pa.type('/hint view')
    await pa.wait('project-empty-pending', () => pa.screen().includes('No confirmed Project content') && pa.screen().includes('unconfirmed replacement'))
    assert.equal(primary().card, undefined, 'opening does not confirm')
    pa.send('\x1b')
    await pa.wait('project-close-empty', () => /⌸\s+❯/u.test(pa.screen()))
    const rejectedBase = JSON.stringify(primary())
    await pa.type('/hint project reject')
    await pa.wait('project-rejected', () => pa.screen().includes('Project Suggestion rejected'))
    assert.equal(JSON.stringify(primary()), rejectedBase, 'explicit reject leaves shared card unchanged')
    await refresh(pa, 'A')
    await review(pa, 'A')
    const pb = await open('project-b', b)
    await pb.wait('project-b-isolated', () => pb.screen().includes('Pending update') && !pb.screen().includes('PROJECT_SESSION_A'))
    await pb.type('PROJECT_B: describe synthetic task B')
    await pb.wait('project-main-b', () => pb.screen().includes('PROJECT_MAIN_B_OK'))
    await refresh(pb, 'B')
    await review(pb, 'B')
    assert.equal(primary().card, undefined, 'both processes reviewed the same unconfirmed head')
    save('project-before-race.json', table())
    // Hold the real cooperative lock to make both PTYs contend after reviewing
    // the same head. No fake storage, helper setter or timing-only race.
    const acquired = deferred()
    const release = deferred()
    const contended = withFileLock(join(state.scratch, 'home/.dsh-tui/context-hint-coordination'), async () => {
      acquired.resolve()
      await release.promise
    })
    await acquired.promise
    try {
      await Promise.all([pa.type('/hint project confirm'), pb.type('/hint project confirm')])
      await Promise.all([pa.wait('project-a-submitted', () => pa.screen().split('\n').some(line => /⌸\s+❯/u.test(line) && !line.includes('/hint project confirm'))),
        pb.wait('project-b-submitted', () => pb.screen().split('\n').some(line => /⌸\s+❯/u.test(line) && !line.includes('/hint project confirm')))])
      assert.equal(primary().card, undefined, 'both submitted confirmations wait behind the actual PID lock')
      save('project-race-lock-held.json', { pid: Number(readFileSync(join(state.scratch, 'home/.dsh-tui/context-hint-coordination.lock'), 'utf8')), table: table() })
    } finally { release.resolve(); await contended }
    await pa.wait('project-race-a', () => /Project Suggestion confirmed|Project changed: no write/.test(pa.screen()))
    await pb.wait('project-race-b', () => /Project Suggestion confirmed|Project changed: no write/.test(pb.screen()))
    const winner = pa.screen().includes('Project Suggestion confirmed') ? 'A' : 'B'
    const loser = winner === 'A' ? pb : pa
    assert.equal(Number(pa.screen().includes('Project Suggestion confirmed')) + Number(pb.screen().includes('Project Suggestion confirmed')), 1,
      'two processes cannot both claim a durable success from the same base')
    assert.deepEqual(primary().card.decisions, [`ACCEPT_${winner}`], 'winner remains durably accepted')
    save('project-after-race.json', table())
    const beforeConflictRetry = JSON.stringify(primary())
    await loser.type('/hint project confirm')
    await loser.wait('project-conflict-requires-review', () => loser.screen().includes('First /hint project review'))
    assert.equal(JSON.stringify(primary()), beforeConflictRetry, 'repeated confirm cannot silently rebase')
    await review(loser, 'conflict')
    // Reject stale full replacement; request a new explicit proposal preserving winner.
    await loser.type('/hint project reject')
    await loser.wait('project-stale-rejected', () => loser.screen().includes('Project Suggestion rejected'))
    setResponse('project-merged')
    await refresh(loser, winner === 'A' ? 'B' : 'A')
    await review(loser, 'merged')
    await loser.type('/hint project confirm')
    await loser.wait('project-merged-confirmed', () => loser.screen().includes('Project Suggestion confirmed'))
    assert.deepEqual(primary().card.decisions, ['ACCEPT_A', 'ACCEPT_B'], 'explicit resolution preserves both accepted decisions')
    const sessionCards = Object.values(table()).filter(value => value.sessionId)
    assert.equal(sessionCards.length, 2)
    assert.deepEqual(sessionCards.map(value => value.cards.session.status).sort(), ['PROJECT_SESSION_A', 'PROJECT_SESSION_B'])
    for (const [p, own, other] of [[pa, 'A', 'B'], [pb, 'B', 'A']]) {
      await p.type('/hint view')
      await p.wait(`project-shared-${own}`, () => p.screen().includes('ACCEPT_A') && p.screen().includes('ACCEPT_B') && p.screen().includes(`PROJECT_SESSION_${own}`))
      assert(!p.screen().includes(`PROJECT_SESSION_${other}`), 'sharing Project never imports another session progress')
      p.send('\x1b')
      await p.wait(`project-detail-closed-${own}`, () => /⌸\s+❯/u.test(p.screen()))
    }
    await pa.type('/lang zh')
    await pa.wait('project-language-zh', () => pa.screen().includes('缓存') && !pa.screen().split('\n').some(line => /⌸\s+❯/u.test(line) && line.includes('/lang')))
    await pa.type('/hint view')
    await pa.wait('project-chinese', () => pa.screen().includes('已确认项目卡片') && pa.screen().includes('已确认决策') && pa.screen().includes('ACCEPT_B'))
    pa.send('\x1b')
    await pa.wait('project-chinese-close', () => /⌸\s+❯/u.test(pa.screen()))
    await pa.type('/lang en')
    await pa.wait('project-language-en', () => !pa.screen().includes('缓存') && !pa.screen().split('\n').some(line => /⌸\s+❯/u.test(line) && line.includes('/lang')))
    // #5 connection: stale processes must preserve the latest confirmed content
    // and cooperate with #6's revisioned control writer, never raw-overwrite it.
    const beforeControls = hints()
    for (const [p, command, enabled, paused] of [
      [pa, 'pause', true, true], [pb, 'resume', true, false],
      [pa, 'disable', false, false], [pa, 'enable', true, false],
    ]) {
      const previous = primary()
      await p.type('/hint ' + command)
      if (command === 'enable') {
        await p.wait('project-control-consent', () => p.screen().includes('Enable Context') && p.screen().includes('Hint?'))
        p.send('\r')
      }
      await p.wait('project-control-' + command, () => primary().revision === previous.revision + 1
        && primary().enabled === enabled && primary().paused === paused)
      assert.deepEqual(primary().card, previous.card, 'controls preserve the latest confirmed content across processes')
      assert.equal(hints(), beforeControls, 'control changes do not generate or replay hints')
      save('project-control-' + command + '.json', table())
    }
    const beforeNewSession = hints()
    await pb.type('/new')
    await pb.wait('project-new-session-pending', () => pb.screen().includes('Pending update') && !pb.screen().includes('PROJECT_SESSION_B'))
    await pb.type('/hint view')
    await pb.wait('project-lifetime-independent', () => pb.screen().includes('ACCEPT_A') && pb.screen().includes('ACCEPT_B') && pb.screen().includes('Pending update'))
    assert(!pb.screen().includes('PROJECT_SESSION_A') && !pb.screen().includes('PROJECT_SESSION_B'), 'new session owns no previous progress')
    assert.equal(hints(), beforeNewSession, 'new session only loads Project, never generates')
    pb.send('\x1b')
    await pb.wait('project-new-session-close', () => /⌸\s+❯/u.test(pb.screen()))
    const pc = await open('project-clone', clone)
    assert(!pc.screen().includes('PROJECT_SESSION_') && !pc.screen().includes('PROJECT_GOAL'), 'same remote/name clone starts isolated')
    await enable(pc)
    await pc.type('/hint view')
    await pc.wait('project-clone-empty', () => pc.screen().includes('No confirmed Project content') && !pc.screen().includes('ACCEPT_A'))
    pc.send('\x1b')
    await pc.wait('project-clone-close', () => /⌸\s+❯/u.test(pc.screen()))
    assert.equal(projects().length, 2, 'one shared linked-worktree identity and one independent clone')
    const savedSessions = sessionCards.map(value => ({ id: value.sessionId, status: value.cards.session.status }))
    await pc.finish()
    await pa.finish()
    await pb.finish()
    const beforeRestart = hints()
    const restored = await open('project-restored', a, ['--resume', savedSessions.find(value => value.status === 'PROJECT_SESSION_A').id])
    await restored.wait('project-session-restored', () => restored.screen().includes('PROJECT_SESSION_A'))
    await restored.type('/hint view')
    await restored.wait('project-latest-restored', () => restored.screen().includes('ACCEPT_A') && restored.screen().includes('ACCEPT_B'))
    assert(!restored.screen().includes('unconfirmed replacement'), 'pending suggestions do not survive restart')
    assert.equal(hints(), beforeRestart, 'restore and view make no provider call')
    restored.send('\x1b')
    await restored.wait('project-restored-close', () => /⌸\s+❯/u.test(restored.screen()))
    await restored.finish()
    save('project-final.json', table())
    assert(!JSON.stringify(table()).includes('projectSuggestion') && !JSON.stringify(table()).includes('PROJECT_A:'), 'latest cards only, no proposal/raw-prompt archive')
    assert(!existsSync(join(state.scratch, 'home/.dsh-tui/context-hint-coordination.lock')), 'PID coordination lock released')
    assert(!readdirSync(join(state.scratch, 'home/.dsh-tui/plugin-storage')).some(name => name.endsWith('.tmp')), 'no staged archive remains')
    save('result.json', { passed: true, target: state.target, feature: 'context-hint-shared-project', winner,
      processes: 2, sharedDataHome: true, linkedWorktrees: true, independentClone: true, explicitConflictResolution: true,
      requests: requests.length, hintRequests: hints(), platform: process.platform })
  } finally {
    for (const done of stopping) done.resolve()
    await Promise.allSettled(running)
  }
}
