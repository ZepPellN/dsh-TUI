/** #8 scoped-deletion journey: only provider bytes are synthetic; real packed
 * host, real PTY commands, real admitted storage, run-owned fault injection. */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const flat = text => text.replace(/\s+/gu, ' ')

export async function driveHintDeletion({ state, run, session, save, requests, fixture, setResponse }) {
  const repo = join(state.scratch, 'workspace')
  const linked = join(state.scratch, 'linked-workspace')
  run('git', ['init', '-b', 'fixture'], state, 'deletion-git-init', repo)
  run('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic fixture'], state, 'deletion-git-commit', repo)
  run('git', ['worktree', 'add', '-b', 'fixture-b', linked], state, 'deletion-worktree', repo)
  const projectFile = join(repo, 'synthetic-project-file.txt')
  writeFileSync(projectFile, 'SYNTHETIC_PROJECT_FILE_UNCHANGED\n')
  const storagePath = join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json')
  const grantsPath = join(state.scratch, 'home/.dsh-tui/extension-grants.json')
  const sessionsDir = join(state.scratch, 'home/.dsh/sessions')
  const storageDir = join(state.scratch, 'home/.dsh-tui/plugin-storage')
  const table = () => JSON.parse(readFileSync(storagePath, 'utf8'))
  const sessionRecords = () => Object.entries(table()).filter(([key]) => key.startsWith('session:'))
  const projectRecords = () => Object.entries(table()).filter(([key]) => key.startsWith('project:'))
  const projectFileBytes = () => readFileSync(projectFile, 'utf8')
  const grantsBytes = () => readFileSync(grantsPath, 'utf8')
  const transcriptFiles = () => existsSync(sessionsDir)
    ? readdirSync(sessionsDir, { recursive: true }).filter(name => typeof name === 'string' && statSync(join(sessionsDir, name)).isFile()).sort()
    : []
  const transcriptBytes = () => JSON.stringify(transcriptFiles().map(name => [name, readFileSync(join(sessionsDir, name)).toString('base64')]))
  const hints = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
  const enable = async p => {
    await p.type('/hint enable')
    await p.wait('deletion-consent', () => p.screen().includes('Enable Context') && p.screen().includes('Hint?'))
    p.send('\r')
    await p.wait('deletion-enabled', () => p.screen().includes('Pending update'))
  }
  const pause = async p => {
    await p.type('/hint pause')
    await p.wait('deletion-paused', () => p.screen().includes('Paused automatic updates'))
  }
  /** Paused automatic updates keep this journey's request counts explicit;
   * one manual refresh carries both the Session/Turn card and the Suggestion. */
  const explicitSuggestion = async (p, label, prompt) => {
    setResponse('project')
    await p.type(prompt)
    await p.wait(`deletion-main-${label}`, () => p.screen().includes('PROJECT_MAIN_A_OK'))
    const before = hints()
    await p.type('/hint refresh')
    await p.wait(`deletion-suggestion-${label}`, () => hints() === before + 1
      && p.screen().includes('PROJECT_SESSION_A') && /Project suggestion/u.test(p.screen()))
  }
  const confirmSuggestion = async (p, label) => {
    await p.type('/hint project review')
    await p.wait(`deletion-reviewed-${label}`, () => p.screen().includes('Current and proposed replacement'))
    p.send('\x1b')
    await p.wait(`deletion-review-closed-${label}`, () => /⌸\s+❯/u.test(p.screen()))
    await p.type('/hint project confirm')
    await p.wait(`deletion-confirmed-${label}`, () => p.screen().includes('Project Suggestion confirmed'))
  }
  await session('deletion-a', [repo], async ({ type, wait, screen, send }) => {
    await enable({ type, wait, screen, send })
    // Pause first: every summary request in this journey is then explicit and
    // countable, independent of the host's automatic settled-update trigger.
    await pause({ type, wait, screen, send })
    await explicitSuggestion({ type, wait, screen, send }, 'one', 'PROJECT_A: first synthetic task')
    // Confirmation is intentionally rejected while paused; resume, confirm,
    // then pause again for the second-session explicit request.
    await type('/hint resume')
    await wait('deletion-resumed', () => !screen().includes('Paused automatic updates'))
    await confirmSuggestion({ type, wait, screen, send }, 'one')
    await pause({ type, wait, screen, send })
    const grantsBefore = grantsBytes()
    const projectFileBefore = projectFileBytes()
    // A second session proves scoped deletion does not touch other session cards.
    await type('/new')
    await wait('deletion-new-session', () => screen().includes('Pending update'))
    const beforeSecond = hints()
    setResponse('project')
    await type('PROJECT_A: second synthetic task')
    await wait('deletion-main-two', () => screen().includes('PROJECT_MAIN_A_OK'))
    await type('/hint refresh')
    await wait('deletion-card-two', () => hints() === beforeSecond + 1 && screen().includes('PROJECT_SESSION_A'))
    const beforeDelete = table()
    const beforeTranscripts = transcriptBytes()
    const projectKey = projectRecords()[0][0]
    assert.equal(sessionRecords().length, 2, 'two independent session envelopes')
    assert.equal(projectRecords().length, 1, 'one shared linked-worktree Project envelope')
    save('deletion-before-session-delete.json', beforeDelete)
    save('deletion-before-session-delete-transcript-hashes.json', JSON.parse(beforeTranscripts))
    // Hold a real provider response for the current session, then delete the
    // session scope and release it: the late result must never reappear.
    setResponse('hold')
    await type('/hint refresh')
    await wait('deletion-held-response', () => fixture.heldHints.length === 1)
    await type('/hint delete')
    await wait('deletion-scope-dialog', () => flat(screen()).includes('Delete Context Hint data')
      && screen().includes('This session') && screen().includes('Shared Project'))
    assert(flat(screen()).includes('Deletes only this session'), 'session scope discloses its exact target')
    assert(flat(screen()).includes('Project Card, other sessions'), 'session scope discloses unaffected data')
    assert(flat(screen()).includes('shared by linked worktrees'), 'shared Project scope discloses linked worktree impact before deletion')
    save('deletion-scope-dialog.txt', screen())
    send('\r')
    // Confirmation renders title (wrapped) beside the message column, so check
    // the title's words and the message's disclosure separately.
    await wait('deletion-session-confirm', () => flat(screen()).includes('Delete this session')
      && flat(screen()).includes('hint cards?') && flat(screen()).includes('other sessions'))
    save('deletion-session-confirm.txt', screen())
    send('\r')
    await wait('deletion-session-done', () => flat(screen()).includes("Deleted this session's latest hint cards")
      && flat(screen()).includes('other data untouched'))
    // Explicit new generation after deletion; the released old response is late.
    setResponse('valid-fresh')
    await type('/hint refresh')
    await wait('deletion-fresh-card', () => screen().includes('FRESH_AFTER_DELETE_OK'))
    fixture.releaseHints()
    await wait('deletion-late-release', () => fixture.heldHints.length === 0
      && !screen().includes('LATE_WRONG_HINT') && !screen().includes('BOUNDARY_SUMMARY_OK'))
    const after = table()
    assert.equal(sessionRecords().length, 2, 'selected scope removed then explicitly regenerated; no third history key')
    assert.equal(sessionRecords().filter(([, value]) => value.cards.session.status === 'FRESH_AFTER_DELETE_OK').length, 1,
      'only a later explicit request saves the new latest card')
    assert(!JSON.stringify(after).includes('LATE_WRONG_HINT'), 'released pre-deletion response cannot rebuild deleted data')
    assert.deepEqual(after[projectKey], beforeDelete[projectKey], 'session-scope deletion preserves the shared Project card')
    const unchangedSessions = Object.entries(beforeDelete).filter(([key, value]) => key.startsWith('session:')
      && JSON.stringify(after[key]) === JSON.stringify(value))
    assert.equal(unchangedSessions.length, 1, 'the unselected session envelope is byte-for-byte unchanged')
    assert.equal(transcriptBytes(), beforeTranscripts, 'deletion and hint generation never append to the authoritative session transcript')
    assert.equal(projectFileBytes(), projectFileBefore, 'project files are not touched')
    assert.equal(grantsBytes(), grantsBefore, 'credentials/grants are not touched')
  }, { cwd: repo })
  assert.equal(projectFileBytes(), 'SYNTHETIC_PROJECT_FILE_UNCHANGED\n')
  const savedSessions = sessionRecords().map(([, value]) => ({ id: value.sessionId, status: value.cards.session.status }))
  save('deletion-session-ids.json', savedSessions)
  const resume = readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim()
  assert(savedSessions.some(value => value.id === resume), 'last session is one of the persisted current sessions')
  const grantsAfterSession = grantsBytes()
  const transcriptsAfterSession = transcriptBytes()
  const projectFileAfterSession = projectFileBytes()
  let transcriptsBeforeProjectDelete = ''

  await session('deletion-b', [linked], async ({ type, wait, screen, send }) => {
    await enable({ type, wait, screen, send })
    await type('/hint view')
    await wait('deletion-shared-visible', () => screen().includes('ACCEPT_A') && screen().includes('Project Card'))
    send('\x1b')
    await wait('deletion-shared-closed', () => /⌸\s+❯/u.test(screen()))
    const beforeHints = hints()
    transcriptsBeforeProjectDelete = transcriptBytes()
    await type('/hint delete')
    await wait('deletion-project-scope', () => flat(screen()).includes('Delete Context Hint data')
      && screen().includes('Shared Project hint data') && screen().includes('This session'))
    assert(flat(screen()).includes('shared by linked worktrees') || flat(screen()).includes('affects every linked worktree'),
      'linked-worktree impact is disclosed in the ordinary scope picker')
    send('\x1b[B')
    await wait('deletion-project-focused', () => screen().split('\n').some(line => line.includes('❯') && line.includes('Shared Project hint data')))
    save('deletion-project-scope.txt', screen())
    send('\r')
    await wait('deletion-project-confirm', () => flat(screen()).includes('Delete shared Project')
      && flat(screen()).includes('hint data?')
      && flat(screen()).includes('affecting every linked worktree of this repository')
      && flat(screen()).includes('old in-flight work cannot rebuild deleted data'))
    assert(flat(screen()).includes('Session cards, original transcripts, project files and credentials stay'), 'confirm names preserved data')
    save('deletion-project-confirm.txt', screen())
    send('\r')
    await wait('deletion-project-done', () => flat(screen()).includes('Deleted shared Project hint data')
      && flat(screen()).includes('opt-in/pause state'))
    assert.equal(hints(), beforeHints, 'deletion itself makes no summary request')
    assert.equal(transcriptBytes(), transcriptsBeforeProjectDelete, 'Project deletion does not append to the authoritative session transcript')
  }, { cwd: linked })
  const afterProjectDelete = table()
  assert.equal(projectRecords().length, 0, 'shared Project envelope (card + controls) is gone')
  assert.equal(sessionRecords().length, 2, 'per-session latest cards in the other worktree survive Project deletion')
  assert.equal(transcriptBytes(), transcriptsBeforeProjectDelete, 'project deletion leaves authoritative transcripts untouched')
  assert.equal(projectFileBytes(), projectFileAfterSession, 'project deletion leaves repository files untouched')
  assert.equal(grantsBytes(), grantsAfterSession, 'project deletion leaves credentials/grants untouched')
  save('deletion-after-project-delete.json', afterProjectDelete)
  save('deletion-check.json', { projectEnvelopeRemoved: projectRecords().length === 0, sessionCardsRetained: sessionRecords().length,
    transcriptsUnchanged: transcriptBytes() === transcriptsBeforeProjectDelete, projectFileUnchanged: projectFileBytes() === projectFileAfterSession,
    grantsUnchanged: grantsBytes() === grantsAfterSession })

  // Restart: deleted shared data is not rebuilt; the session card still restores.
  const restartHints = hints()
  let restartedRecords = 0
  await session('deletion-restart', ['--resume', resume], async ({ type, wait, screen, send }) => {
    await wait('deletion-restart-transcript', () => screen().includes('PROJECT_MAIN_A_OK'))
    assert(!screen().includes('ACCEPT_A') && !screen().includes('FRESH_AFTER_DELETE_OK'), 'deleted shared Project and opt-in are not restored')
    assert.equal(hints(), restartHints, 'restart without explicit enable makes no hint request')
    await type('/hint enable')
    await wait('deletion-restart-consent', () => screen().includes('Enable Context') && screen().includes('Hint?'))
    send('\r')
    await wait('deletion-restart-fresh', () => screen().includes('FRESH_AFTER_DELETE_OK'))
    await type('/hint pause')
    await wait('deletion-restart-paused', () => screen().includes('Paused automatic updates'))
    await type('/hint view')
    await wait('deletion-restart-empty-project', () => screen().includes('No confirmed Project content') && !screen().includes('ACCEPT_A'))
    send('\x1b')
    await wait('deletion-restart-detail-closed', () => /⌸\s+❯/u.test(screen()))
    const before = hints()
    setResponse('valid-fresh')
    await type('/hint refresh')
    await wait('deletion-restart-explicit', () => hints() === before + 1 && screen().includes('FRESH_AFTER_DELETE_OK'))
    restartedRecords = sessionRecords().length
    assert.equal(restartedRecords, 2, 'explicit regeneration replaces the session latest card, never appends history')
    assert(!JSON.stringify(table()).includes('PROJECT_A:') && !JSON.stringify(table()).includes('CONTEXT_HINT_V1'),
      'stored hint data holds bounded cards only, no prompt/tool copy')
  }, { cwd: repo })
  assert.equal(restartedRecords, 2)

  // Controlled fault: unwritable run-owned hint namespace while the TUI runs.
  const beforeFault = readFileSync(storagePath, 'utf8')
  const projectRecordsBeforeFault = projectRecords().length
  await session('deletion-fault', ['--resume', resume], async ({ type, wait, screen, send }) => {
    await wait('deletion-fault-restored', () => screen().includes('FRESH_AFTER_DELETE_OK'))
    chmodSync(storageDir, 0o500)
    try {
      await type('/hint delete session')
      await wait('deletion-fault-confirm', () => flat(screen()).includes('Delete this session'))
      send('\r')
      await wait('deletion-fault-failed', () => flat(screen()).includes('storage write failed'))
      assert(screen().includes('FRESH_AFTER_DELETE_OK'), 'failed deletion retains the applicable card instead of clearing it')
      assert.equal(readFileSync(storagePath, 'utf8'), beforeFault, 'failed deletion leaves hint storage unchanged')
      // The main session and provider path keep working during the fault.
      await type('VERIFY_SECOND: fault survived')
      await wait('deletion-fault-main', () => screen().includes('DSH_VERIFY_RESTORED_OK'))
    } finally { chmodSync(storageDir, 0o700) }
    await type('/hint delete session')
    await wait('deletion-recovered-confirm', () => flat(screen()).includes('Delete this session'))
    send('\r')
    await wait('deletion-recovered', () => flat(screen()).includes("Deleted this session's latest hint cards"))
  }, { cwd: repo })
  const afterFaultDelete = table()
  assert.equal(sessionRecords().length, 1, 'only the selected session envelope was removed after recovery')
  assert.equal(projectRecords().length, projectRecordsBeforeFault, 'the failed deletion path never recreated or removed the Project envelope')
  save('deletion-after-fault.json', afterFaultDelete)

  // Controlled corruption: the optional namespace stays byte-for-byte intact
  // and the main session still opens and continues.
  const validAfterFault = readFileSync(storagePath, 'utf8')
  const corrupt = '{synthetic-corrupt-hint-namespace'
  writeFileSync(storagePath, corrupt)
  save('deletion-corrupt-bytes.txt', corrupt)
  await session('deletion-corrupt', ['--resume', resume], async ({ type, wait, screen }) => {
    await wait('deletion-corrupt-notice', () => flat(screen()).includes('storage is currently unreadable'))
    assert(!screen().includes('FRESH_AFTER_DELETE_OK'), 'corrupt contents are not shown as cards')
    assert.equal(readFileSync(storagePath, 'utf8'), corrupt, 'corrupt optional storage is never repaired or cleared')
    await type('VERIFY_FIRST: corrupt survived')
    await wait('deletion-corrupt-main', () => screen().includes('DSH_VERIFY_FIRST_OK'))
  }, { cwd: repo })
  writeFileSync(storagePath, validAfterFault)
  assert(transcriptBytes().length > transcriptsAfterSession.length, 'authoritative transcripts exist independently of deleted hint data')
  save('result.json', { passed: true, target: state.target, feature: 'context-hint-deletion', scopes: ['session', 'project'],
    linkedWorktreeDisclosure: true, inFlightOldResponseFenced: true, restartNoRebuild: true, explicitNewResultSaved: true,
    storageFaultVisible: true, corruptUnchanged: true, projectFilesUntouched: true, transcriptsUntouched: true,
    credentialsUntouched: true, latestOnly: true, requests: requests.length, hintRequests: hints(), platform: process.platform })
}
