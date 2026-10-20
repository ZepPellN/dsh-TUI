/** #5: only provider bytes are synthetic; session(), commands and PTY are the shared real host driver. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function createHintInteractionProvider() {
  let hintNumber = 0
  const heldHints = []
  const heldRecaps = []
  const heldMain = []
  const send = (res, json, blocks, stop = 'end_turn') => {
    if (res.destroyed) return
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = item => res.write(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`)
    event({ type: 'message_start', message: { id: 'synthetic-interaction', type: 'message', role: 'assistant', model: json.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    blocks.forEach((block, index) => {
      event({ type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } })
      event({ type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      event({ type: 'content_block_stop', index })
    })
    event({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 8 } })
    event({ type: 'message_stop' })
    res.end()
  }
  return {
    hint: 'valid', recap: 'valid',
    get pendingHints() { return heldHints.length },
    get pendingRecaps() { return heldRecaps.length },
    get pendingMain() { return heldMain.length },
    releaseHints() { heldHints.splice(0).forEach(release => release()) },
    releaseRecaps() { heldRecaps.splice(0).forEach(release => release()) },
    handle(json, res) {
      const text = JSON.stringify(json.messages)
      if (text.includes('CONTEXT_HINT_V1')) {
        const mode = this.hint
        const number = ++hintNumber
        if (mode === '503') {
          res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' })
          res.end(JSON.stringify({ error: { type: 'fixture_failure', message: 'synthetic summary unavailable' } }))
          return true
        }
        if (mode === 'timeout') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); return true }
        const endings = [...text.matchAll(/turn outcome: (\w+)/g)]
        const reason = endings.at(-1)?.[1]
        const outcome = reason === 'completed' ? 'completed' : reason === 'aborted' ? 'cancelled' : 'failed'
        const answer = mode === 'malformed' ? '{"session":{}}' : JSON.stringify({
          session: { goal: 'Synthetic settled interaction', status: mode === 'hold-late' ? 'AUTO_LATE_RESULT' : 'BOUNDARY_SUMMARY_OK', blockers: [], next: `AUTO_NEXT_${number}` },
          turn: { completed: outcome === 'completed' ? ['Synthetic interaction settled'] : [], findings: ['Two tool results observed'], verification: ['Loopback fixture only'], failures: outcome === 'completed' ? [] : [`Synthetic interaction ${outcome}`], outcome },
        })
        const reply = () => send(res, json, [{ type: 'text', text: answer }])
        if (mode.startsWith('hold')) heldHints.push(reply)
        else reply()
        return true
      }
      if (text.includes('Create a compact session recap')) {
        const answer = JSON.stringify({ title: 'Synthetic recap', summary: this.recap === 'hold' ? 'LATE_AUTO_RECAP' : 'DSH_VERIFY_RECAP_OK' })
        const reply = () => send(res, json, [{ type: 'text', text: answer }])
        if (this.recap === 'hold') heldRecaps.push(reply)
        else reply()
        return true
      }
      const lastHuman = json.messages.flatMap(message => message.role === 'user' && Array.isArray(message.content)
        ? message.content.filter(block => block.type === 'text' && block.text.startsWith('VERIFY_')) : []).at(-1)?.text
      if (lastHuman?.startsWith('VERIFY_SIMPLE_')) {
        send(res, json, [{ type: 'text', text: `SIMPLE_REPLY_${lastHuman.slice('VERIFY_SIMPLE_'.length)}` }])
        return true
      }
      let humanIndex = -1
      let marker
      json.messages.forEach((message, index) => {
        const block = message.role === 'user' && Array.isArray(message.content)
          ? message.content.find(block => block.type === 'text' && block.text.startsWith('VERIFY_AUTO_')) : undefined
        if (block !== undefined) { humanIndex = index; marker = block.text }
      })
      if (marker === undefined) return false
      const hasResults = json.messages.slice(humanIndex + 1).some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'))
      if (!hasResults) {
        assert(json.tools.some(tool => tool.name === 'glob'), 'actual host exposes the read-only fixture tool')
        send(res, json, [
          { type: 'text', text: 'Synthetic tool-rich step. ' },
          { type: 'tool_use', id: 'fixture-glob-one', name: 'glob', input: { pattern: '*' } },
          { type: 'tool_use', id: 'fixture-glob-two', name: 'glob', input: { pattern: 'synthetic-no-file-*' } },
        ], 'tool_use')
      } else if (marker.includes('FAIL')) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'fixture_failure', message: 'synthetic interaction failed after tools' } }))
      } else if (marker.includes('CANCEL')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.flushHeaders()
        heldMain.push(res)
      } else {
        send(res, json, [{ type: 'text', text: Array.from({ length: 45 }, (_, index) => `AUTO_SCROLL_${String(index).padStart(2, '0')}`).join('\n') + '\nAUTO_MAIN_DONE' }])
      }
      return true
    },
  }
}

export async function driveHintInteractions({ session, requests, save, fixture, state }) {
  const count = () => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).length
  const recaps = () => requests.filter(request => JSON.stringify(request.body.messages).includes('Create a compact session recap')).length
  const storagePath = join(state.scratch, 'home/.dsh-tui/plugin-storage/dsh-tui.context-hint.json')
  const stored = () => JSON.parse(readFileSync(storagePath, 'utf8'))
  const cards = () => Object.values(stored()).filter(value => value.cards)
  await session('fresh', [], async ({ type, wait, screen, send }) => {
    await type('VERIFY_FIRST: before opt in')
    await wait('no-opt-in', () => screen().includes('DSH_VERIFY_FIRST_OK'))
    assert.equal(count(), 0, 'no opt-in means zero summary calls')
    await type('/hint enable')
    await wait('consent', () => screen().includes('Enable Context') && screen().includes('Hint?'))
    send('\r')
    await wait('enabled', () => screen().includes('Pending update'))
    assert.equal(count(), 0, 'enable does not summarize existing history')
    await type('VERIFY_SECOND: actual new interaction')
    await wait('automatic-card', () => screen().includes('BOUNDARY_SUMMARY_OK'))
    assert.equal(count(), 1, 'one new interaction makes one automatic request')
    const recapsWhileEnabled = recaps()
    await type('/hint pause')
    await wait('paused', () => screen().includes('Context Hint') && screen().includes('Paused'))
    await type('VERIFY_SIMPLE_PAUSED')
    await wait('paused-answer', () => screen().includes('SIMPLE_REPLY_PAUSED'))
    assert.equal(count(), 1, 'pause prevents new automatic work')
    await type('/hint refresh')
    await wait('paused-explicit', () => screen().includes('AUTO_NEXT_2'))
    await type('/hint resume')
    await wait('resumed', () => !screen().includes('Paused') && screen().includes('BOUNDARY_SUMMARY_OK'))
    assert.equal(count(), 2, 'resume does not replay paused work')
    await type('VERIFY_SECOND: future work after resume')
    await wait('future-automatic', () => screen().includes('AUTO_NEXT_3'))
    assert.equal(count(), 3, 'only future work after resume generates automatically')

    fixture.hint = 'hold-valid'
    await type('VERIFY_AUTO_SUCCESS: two read-only tool calls and streamed text')
    await wait('tool-rich-auto-held', () => fixture.pendingHints === 1 && screen().includes('AUTO_MAIN_DONE'))
    assert.equal(count(), 4, 'multiple real tools and streamed deltas permit only one automatic request')
    const latest = requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1')).at(-1).body
    assert.equal((JSON.stringify(latest.messages).match(/tool \(returned\)/g) ?? []).length, 2, 'summary sees both actual tool results')
    assert.equal(latest.max_tokens, 2048)
    assert(!latest.tools?.length, 'summary never runs tools')
    assert(JSON.stringify(latest.messages).length < 13000, 'finite summary input envelope')
    send('\x1b[5~')
    await wait('auto-scrolled', () => screen().includes('AUTO_SCROLL_') && !screen().includes('AUTO_MAIN_DONE'))
    send('AUTO_UNSENT_DRAFT')
    await wait('auto-focused-draft', () => screen().split('\n').some(line => /⌸\s+❯/u.test(line) && line.includes('AUTO_UNSENT_DRAFT')))
    const anchors = () => screen().split('\n').filter(line => line.includes('AUTO_SCROLL_'))
    const before = anchors()
    assert(before.length > 0)
    fixture.releaseHints()
    await wait('auto-background-complete', () => screen().includes('AUTO_NEXT_4'))
    assert.deepEqual(anchors(), before, 'automatic completion does not move the real transcript viewport')
    assert(screen().split('\n').some(line => /⌸\s+❯/u.test(line) && line.includes('AUTO_UNSENT_DRAFT')), 'automatic completion retains focused unsent input')
    send('\x15')
    send('\x1b[F')
    await wait('auto-bottom', () => screen().includes('AUTO_MAIN_DONE') && !screen().includes('AUTO_UNSENT_DRAFT'))
    assert.equal(cards().at(-1).cards.turn.outcome, 'completed')

    fixture.hint = 'valid'
    await type('VERIFY_AUTO_FAIL: fail only after both real tools return')
    await wait('failed-interaction-card', () => screen().includes('AUTO_NEXT_5'))
    assert.equal(count(), 5)
    assert.equal(cards().at(-1).cards.turn.outcome, 'failed')
    await type('/hint view')
    await wait('failed-detail', () => screen().includes('Synthetic interaction failed') && screen().includes('Turn Card'))
    send('\x1b')
    await wait('failed-detail-closed', () => /⌸\s+❯/u.test(screen()))
    await type('VERIFY_AUTO_CANCEL: cancel after tools while provider is streaming')
    await wait('cancel-main-held', () => fixture.pendingMain === 1)
    send('\x1b')
    await wait('cancelled-interaction-card', () => screen().includes('AUTO_NEXT_6'))
    assert.equal(count(), 6)
    assert.equal(cards().at(-1).cards.turn.outcome, 'cancelled')
    await type('/hint view')
    await wait('cancelled-detail', () => screen().includes('Synthetic interaction cancelled') && screen().includes('Turn Card'))
    send('\x1b')
    await wait('cancelled-detail-closed', () => /⌸\s+❯/u.test(screen()))

    for (const failure of ['malformed', '503', 'timeout']) {
      const beforeCount = count()
      const lastValid = cards()
      fixture.hint = failure
      await type(`VERIFY_AUTO_SUCCESS: summary ${failure} after real tool work`)
      await wait(`automatic-failure-${failure}`, () => screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
      assert.equal(count(), beforeCount + 1, `${failure}: no underlying automatic repair/retry`)
      assert.deepEqual(cards().map(record => record.cards), lastValid.map(record => record.cards), 'applicable Last Valid retained on disk')
      fixture.hint = 'valid'
      await type('/hint retry')
      await wait(`explicit-retry-${failure}`, () => screen().includes(`AUTO_NEXT_${beforeCount + 2}`) && !screen().includes('Update failed'))
      assert.equal(count(), beforeCount + 2, 'manual retry is one observable additional provider request')
    }
    assert.equal(recaps(), recapsWhileEnabled, 'enabled hint suppresses every automatic recap')

    // Disable fences a held automatic completion; nothing late reaches disk.
    fixture.hint = 'hold-late'
    await type('VERIFY_AUTO_SUCCESS: held automatic result then disable')
    await wait('disable-held', () => fixture.pendingHints === 1)
    assert.equal(count(), 13, 'held automatic request is the thirteenth')
    fixture.recap = 'hold'
    const recapBeforeDisable = recaps()
    await type('/hint disable')
    await wait('disabled', () => !screen().includes('BOUNDARY_SUMMARY_OK') && !screen().includes('Pending update'))
    await wait('prior-recap-preference-restored', () => fixture.pendingRecaps === 1)
    assert.equal(recaps(), recapBeforeDisable + 1, 'unchanged legacy on-open recap preference returns on disable')
    const beforeDisableRelease = readFileSync(storagePath, 'utf8')
    fixture.releaseHints()

    // Same binding/session: re-enable cancels the already pending old recap.
    await type('/hint enable')
    await wait('re-enable-consent', () => screen().includes('Enable Context') && screen().includes('Hint?'))
    send('\r')
    await wait('re-enabled', () => screen().includes('BOUNDARY_SUMMARY_OK'))
    fixture.releaseRecaps()
    assert(!readFileSync(storagePath, 'utf8').includes('AUTO_LATE_RESULT'), 'disable fences the late automatic completion')
    assert.deepEqual(cards(), Object.values(JSON.parse(beforeDisableRelease)).filter(value => value.cards), 'no late disk commit after disable')
    assert.equal(count(), 13, 're-enable restores retained cards without a new hint request')
    fixture.hint = 'valid'
    fixture.recap = 'valid'
    const beforeManual = recaps()
    await type('/recap')
    await wait('manual-recap-preserved', () => screen().includes('DSH_VERIFY_RECAP_OK') && recaps() === beforeManual + 1)
    assert(!screen().includes('LATE_AUTO_RECAP'), 'pending automatic recap is cancelled on same-session enable')
    send('\x1b')
    await wait('manual-recap-closed', () => /⌸\s+❯/u.test(screen()) && !screen().includes('DSH_VERIFY_RECAP_OK'))
    const recapsBeforeEnabledTurn = recaps()
    await type('VERIFY_SIMPLE_REENABLED')
    await wait('re-enabled-auto', () => screen().includes('AUTO_NEXT_14'))
    assert.equal(count(), 14, 'one fresh interaction after re-enable generates once')
    assert.equal(recaps(), recapsBeforeEnabledTurn, 're-enabled hint suppresses the automatic recap again')
    await type('/hint pause')
    await wait('paused-before-restart', () => screen().includes('Paused automatic updates'))
  })
  const resume = readFileSync(join(state.scratch, 'home/.dsh-tui/resume.txt'), 'utf8').trim()
  const beforeRestore = count()
  const recapsBeforeRestore = recaps()
  await session('restored', ['--resume', resume], async ({ type, wait, screen }) => {
    await wait('restored-last-valid', () => screen().includes('BOUNDARY_SUMMARY_OK') && screen().includes('AUTO_NEXT_14') && screen().includes('Paused automatic updates'))
    assert.equal(count(), beforeRestore, 'restore makes no new hint request and replays no backlog')
    assert.equal(recaps(), recapsBeforeRestore, 'restore makes no automatic recap while enabled')
    await type('VERIFY_SIMPLE_RESTORED_PAUSED')
    await wait('restored-paused-work', () => screen().includes('SIMPLE_REPLY_RESTORED_PAUSED'))
    assert.equal(count(), beforeRestore, 'paused state persists across processes')
    await type('/hint resume')
    await wait('restored-resume-no-backlog', () => !screen().includes('Paused automatic updates') && screen().includes('AUTO_NEXT_14'))
    assert.equal(count(), beforeRestore, 'resume does not replay restored or paused work')
    await type('VERIFY_AUTO_SUCCESS: first fresh interaction after restore')
    await wait('restored-fresh-auto', () => screen().includes('AUTO_NEXT_15'))
    assert.equal(count(), beforeRestore + 1, 'only fresh post-restore work generates')
    await type('/new')
    await wait('new-session-no-generation', () => screen().includes('Pending update') && !screen().includes('BOUNDARY_SUMMARY_OK'))
    assert.equal(count(), beforeRestore + 1, 'navigation never triggers summary generation')
    assert.equal(recaps(), recapsBeforeRestore, 'navigation with enabled hint never starts old recap')
  })
  save('result.json', { passed: true, feature: 'context-hint-interactions', hints: count(), recaps: recaps(), requests: requests.length })
}
