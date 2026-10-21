/** #7 timeline validity journey: session switch, restore, rewind and fork.
 * Ordinary PTY commands against the packed host; only the HTTP provider is synthetic.
 * Used by scripts/verify-packed-host.mjs --hint-timeline.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u

export async function driveHintTimeline({ state, session, requests, save, setResponse, heldHints, releaseHints }) {
  const storagePath = join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json')
  const hintCalls = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1'))
  const hints = () => hintCalls().length
  const table = () => existsSync(storagePath) ? JSON.parse(readFileSync(storagePath, 'utf8')) : {}
  const sessionRecords = () => Object.values(table()).filter(value =>
    value !== null && typeof value === 'object' && typeof value.sessionId === 'string' && value.cards !== undefined)
  const projectRecord = () => Object.entries(table()).find(([key]) => key.startsWith('project:'))?.[1]
  const recordByStatus = status => sessionRecords().find(value => value.cards.session.status === status)
  const consentVisible = screen => screen.includes('Enable Context') && screen.includes('Hint?')

  const enable = async ({ type, wait, screen, send }) => {
    await type('/hint enable')
    await wait('timeline-consent', () => consentVisible(screen()))
    send('\r')
    await wait('timeline-enabled', () => screen().includes('Pending update'))
  }
  const say = async ({ type, wait, screen }, text, answer, label) => {
    await type(text)
    await wait(`${label}-answer`, () => screen().includes(answer))
  }

  assert.equal(hints(), 0, 'startup makes no summary request')
  let detachedForkId = ''
  let forkSessionId = ''
  await session('fresh', [], async api => {
    const { type, wait, screen, send } = api
    await enable(api)
    assert.equal(hints(), 0, 'enabling makes no summary request')

    // Two settled interactions own two cards on the original timeline.
    setResponse('tl-one')
    await say(api, 'VERIFY_TL_ONE: first interaction', 'DSH_VERIFY_TL_ONE_OK', 'tl-one')
    await wait('tl-one-card', () => screen().includes('TL_STATUS_ONE') && screen().includes('TL_NEXT'))
    assert.equal(hints(), 1, 'one settled human interaction makes exactly one automatic request')

    setResponse('tl-two')
    await say(api, 'VERIFY_TL_TWO: second interaction', 'DSH_VERIFY_TL_TWO_OK', 'tl-two')
    await wait('tl-two-card', () => screen().includes('TL_STATUS_TWO'))
    assert.equal(hints(), 2, 'the second settled interaction adds exactly one more request')

    // A confirmed shared Project Card must survive local navigation.
    setResponse('project')
    const beforeProject = hints()
    await type('/hint refresh')
    await wait('tl-project-generated', () => hints() === beforeProject + 1 && screen().includes('Project suggestion pending'))
    await type('/hint project review')
    await wait('tl-project-reviewed', () => screen().includes('Project Suggestion') && screen().includes('Current and proposed replacement'))
    send('\x1b')
    await wait('tl-project-review-closed', () => /⌸\s+❯/u.test(screen()))
    await type('/hint project confirm')
    await wait('tl-project-confirmed', () => screen().includes('Project Suggestion confirmed'))
    const confirmed = projectRecord()
    assert(confirmed?.card !== undefined, 'explicit confirmation persists the shared Project Card')
    assert.deepEqual(confirmed.card.decisions, ['ACCEPT_B'], 'the confirmed replacement is the shared card')

    // Detached /fork copies the settled turns without adopting it; the live
    // original keeps its own card and no summary work starts.
    const beforeFork = hints()
    await type('/fork')
    await wait('tl-fork-created', () => /Forked \([0-9a-f-]{36}\)/u.test(screen()))
    detachedForkId = screen().match(/Forked \(([0-9a-f-]{36})\)/u)?.[1] ?? ''
    assert.match(detachedForkId, UUID, 'a real detached fork session id is reported')
    await wait('tl-fork-current-card', () => screen().includes('PROJECT_SESSION_B') && !screen().includes('Pending update'))
    assert.equal(hints(), beforeFork, 'forking makes no summary request')
    assert(!sessionRecords().some(value => value.sessionId === detachedForkId),
      'the detached fork copy owns no summary card of its own yet')

    // Session-tree fork: ordinary Ctrl+F adopts a NEW child session. It must
    // start pending, never with the parent's completed state, and create no
    // summary request by itself.
    const beforeTreeFork = hints()
    await type('/tree')
    await wait('tl-tree-open', () => screen().includes('Session tree') && /VERIFY_TL_/u.test(screen()))
    // Ctrl+F forks at the focused entry; the initial focus is the live tip,
    // which would be a no-op (nothing after it). Step up to the second user
    // message so the branch keeps that message and drops its reply.
    await delay(400)
    send('k')
    await wait('tl-tree-user-focus', () => screen().includes('user message'))
    await delay(200)
    send('\x06')
    await wait('tl-tree-forked', () => screen().includes('Forked from this point') && /⌸\s+❯/u.test(screen()))
    await wait('tl-tree-fork-pending', () => screen().includes('Pending update') && !screen().includes('PROJECT_SESSION_B'))
    assert.equal(hints(), beforeTreeFork, 'a session-tree fork makes no summary request')
    await type('/hint view')
    await wait('tl-tree-fork-detail', () => screen().includes('Session Card') && screen().includes('Pending update')
      && screen().includes('PROJECT_GOAL') && screen().includes('ACCEPT_B'))
    forkSessionId = screen().match(UUID)?.[0] ?? ''
    assert.match(forkSessionId, UUID, 'the forked session reports its own identity')
    assert.notEqual(forkSessionId, detachedForkId, 'the adopted fork is a distinct session, not the detached copy')
    assert(!screen().includes('PROJECT_SESSION_B') && !screen().includes('TL_STATUS_'),
      'the forked session detail shows the shared Project Card and no inherited Session/Turn conclusion')
    send('\x1b')
    await wait('tl-tree-fork-detail-closed', () => /⌸\s+❯/u.test(screen()))

    // /rewind inside that fork drops the second turn and adopts ANOTHER child:
    // pending, never the abandoned timeline's completed card.
    const beforeRewind = hints()
    await type('/rewind')
    await wait('tl-rewind-picker', () => screen().includes('Pick a message to rewind'))
    // The command palette and picker paint before the overlay's input handler
    // is committed; pace both confirmations like a human would.
    await delay(400)
    send('\r')
    await wait('tl-rewind-confirm', () => screen().includes('Rewind conversation to this message?'))
    await delay(400)
    send('\r')
    await wait('tl-rewind-pending', () => screen().includes('Pending update') && screen().includes('VERIFY_TL_TWO'))
    assert.equal(hints(), beforeRewind, 'rewind alone makes no summary request')
    const recordsAfterRewind = sessionRecords()
    assert.equal(recordsAfterRewind.length, 1, 'original session keeps its card; the rewound child starts without one')
    assert.equal(recordsAfterRewind[0].cards.session.status, 'PROJECT_SESSION_B', 'the original session card is untouched')

    // The rewind put the re-editable message back in the composer with the
    // cursor at its start; move to the end before Ctrl+U so the next command
    // is not submitted as appended user text.
    send('\x1b[F')
    await delay(150)
    send('\x15')
    await wait('tl-rewind-draft-cleared', () => !screen().includes('VERIFY_TL_TWO'))

    // View still shows the shared Project Card; only the session scope is pending.
    await type('/hint view')
    await wait('tl-rewind-detail', () => screen().includes('Session Card') && screen().includes('Pending update')
      && screen().includes('PROJECT_GOAL') && screen().includes('ACCEPT_B'))
    assert(!screen().includes('PROJECT_SESSION_B'), 'detail does not resurrect the abandoned Session/Turn card')
    send('\x1b')
    await wait('tl-rewind-detail-closed', () => /⌸\s+❯/u.test(screen()))

    // Failure retention only applies to the current timeline: on the rewound
    // child a failed automatic update shows pending + failure, never the
    // abandoned conclusion as Last Valid.
    setResponse('malformed')
    const beforeFailure = hints()
    await say(api, 'VERIFY_TL_THREE: after rewind', 'DSH_VERIFY_TL_THREE_OK', 'tl-three')
    await wait('tl-three-failed', () => screen().includes('Update failed') && screen().includes('Pending update'))
    assert(!screen().includes('PROJECT_SESSION_B') && !screen().includes('TL_STATUS_TWO'),
      'a failed update on the current timeline never re-shows the abandoned card')
    assert.equal(hints(), beforeFailure + 1, 'one settled interaction, one failed request, no repair')
    assert.equal(sessionRecords().length, 1, 'a failure on the child timeline writes no abandoned card')

    // An explicit retry is the only way to regenerate after that failure.
    setResponse('tl-r')
    await type('/hint retry')
    await wait('tl-r-card', () => screen().includes('TL_STATUS_R') && !screen().includes('Update failed'))
    assert.equal(hints(), beforeFailure + 2, 'the explicit retry is one additional request')
    assert(recordByStatus('TL_STATUS_R') !== undefined, 'the rewound child now owns its own current card')

    // Rapid switch while a response is held: the late result must never reach
    // the new sessions or rewrite an abandoned timeline.
    setResponse('hold')
    const beforeHold = hints()
    await type('/hint refresh')
    await wait('tl-held', () => heldHints.length === 1)
    const frozen = JSON.stringify(table())
    await type('/new')
    await wait('tl-new-b', () => screen().includes('Pending update') && !screen().includes('TL_STATUS_R'))
    await type('/new')
    await wait('tl-new-c', () => screen().includes('Pending update') && !screen().includes('TL_STATUS_R'))
    releaseHints()
    await delay(1500)
    save('timeline-after-late-release.json', { table: table(), screen: screen() })
    assert(!screen().includes('LATE_WRONG_HINT'), 'a late result never appears after rapid successive switches')
    assert.equal(JSON.stringify(table()), frozen, 'late results and navigation write no Session/Turn cards')
    assert.equal(hints(), beforeHold + 1, 'navigation itself never makes another request')
    assert.equal(sessionRecords().length, 2, 'the two new sessions own no stored progress')
    assert.equal(recordByStatus('TL_STATUS_R')?.cards.session.status, 'TL_STATUS_R',
      'the rewound session card is neither overwritten nor deleted by the switch')

    // The shared Project Card still belongs to the newest session's view.
    await type('/hint view')
    await wait('tl-new-detail', () => screen().includes('Session Card') && screen().includes('Pending update')
      && screen().includes('PROJECT_GOAL') && screen().includes('ACCEPT_B'))
    assert(!screen().includes('PROJECT_SESSION_B') && !screen().includes('TL_STATUS_R'),
      'a new session loads Project context only, never another session progress')
    send('\x1b')
    await wait('tl-new-detail-closed', () => /⌸\s+❯/u.test(screen()))

    save('timeline-original.json', {
      detachedForkId,
      forkSessionId,
      requests: hints(),
      records: sessionRecords().map(value => ({ sessionId: value.sessionId, status: value.cards.session.status })),
      project: projectRecord()?.card,
    })
  })

  assert.match(forkSessionId, UUID, 'the adopted fork id survives its normal original-session exit')
  const beforeForkSession = hints()
  await session('timeline-fork', ['--resume', forkSessionId], async api => {
    const { type, wait, screen, send } = api
    await wait('tl-fork-restored', () => /⌸\s+❯/u.test(screen()) && screen().includes('Pending update'))
    assert(!screen().includes('PROJECT_SESSION_B') && !screen().includes('TL_STATUS_ONE') && !screen().includes('TL_STATUS_TWO'),
      'a resumed fork never presents the parent completed state')
    assert.equal(hints(), beforeForkSession, 'restoring a fork makes no summary request')

    await type('/hint view')
    await wait('tl-fork-detail', () => screen().includes('Session Card') && screen().includes('Pending update')
      && screen().includes('PROJECT_GOAL') && screen().includes('ACCEPT_B'))
    assert(!screen().includes('PROJECT_SESSION_') && !screen().includes('TL_STATUS_'),
      'fork detail shows the shared Project Card and no inherited Session/Turn conclusion')
    send('\x1b')
    await wait('tl-fork-detail-closed', () => /⌸\s+❯/u.test(screen()))

    // The fork seeded an inherited UNANSWERED user message, which the host
    // restores as pending input; the provider therefore sees it together with
    // the new text. The card, not a particular main reply, proves the settled
    // interaction and its single automatic summary.
    setResponse('tl-fork')
    const beforeForkInteraction = hints()
    await type('VERIFY_FORK_ONE: fork starts fresh')
    await wait('tl-fork-own-card', () => screen().includes('TL_FORK_STATUS'))
    assert.equal(hints(), beforeForkInteraction + 1, 'the first real interaction in the fork makes exactly one request')
    assert.equal(sessionRecords().length, 3, 'the fork owns its own session card')
    const keys = sessionRecords().map(value => value.sessionId)
    assert.equal(new Set(keys).size, 3, 'recovered timelines keep distinct session keys')
    assert.deepEqual(sessionRecords().map(value => value.cards.session.status).sort(),
      ['PROJECT_SESSION_B', 'TL_FORK_STATUS', 'TL_STATUS_R'], 'no session card cross-contaminates another timeline')
    assert.deepEqual(projectRecord()?.card, { goal: 'PROJECT_GOAL', constraints: ['Synthetic only'], decisions: ['ACCEPT_B'] },
      'fork and rewind never roll the shared Project Card back')

    // Work completed while paused is NOT summarized. Its newer timeline makes
    // the stored card stale, so the next restore must show the timeline-changed
    // pending state rather than the old completed status as Last Valid.
    const beforePausedWork = hints()
    await type('/hint pause')
    await wait('tl-paused', () => screen().includes('Paused automatic updates'))
    await say(api, 'VERIFY_TL_PAUSED: work while paused', 'DSH_VERIFY_TL_PAUSED_OK', 'tl-paused')
    assert.equal(hints(), beforePausedWork, 'work while paused makes no automatic summary request')

    save('timeline-fork.json', {
      records: sessionRecords().map(value => ({ sessionId: value.sessionId, status: value.cards.session.status })),
      project: projectRecord()?.card,
      requests: hints(),
    })
  })

  const beforeStaleRestore = hints()
  await session('timeline-stale', ['--resume', forkSessionId], async api => {
    const { type, wait, screen, send } = api
    await wait('tl-stale-restored', () => /⌸\s+❯/u.test(screen()) && screen().includes('timeline changed'))
    assert(!screen().includes('TL_FORK_STATUS') && !screen().includes('PROJECT_SESSION_B'),
      'a stale saved card is not re-shown as the current Last Valid Card')
    assert(!screen().includes('Update failed'), 'stale is a timeline change, not a current-timeline failure')
    assert.equal(hints(), beforeStaleRestore, 'restoring a stale timeline makes no summary request')
    await type('/hint view')
    await wait('tl-stale-detail', () => screen().includes('Session Card') && screen().includes('Saved card belongs to an earlier timeline')
      && screen().includes('PROJECT_GOAL') && screen().includes('ACCEPT_B'))
    assert(!screen().includes('TL_FORK_STATUS'), 'detail keeps the expired card out of the current session scope')
    send('\x1b')
    await wait('tl-stale-detail-closed', () => /⌸\s+❯/u.test(screen()))
    save('timeline-stale.json', {
      records: sessionRecords().map(value => ({ sessionId: value.sessionId, status: value.cards.session.status })),
      requests: hints(),
    })
  })
}
