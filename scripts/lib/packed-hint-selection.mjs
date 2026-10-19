/** #4 journey: ordinary commands only. Used by the existing real packed host. */
import assert from 'node:assert/strict'

export async function driveHintSelection(ui, fixture) {
  const { type, wait, screen, send } = ui
  const { record, requests, setResponse, heldHints, releaseHints, readStorage } = fixture
  await type('/hint model')
  await wait('summary-model-catalog', () => screen().includes('Summary Model: inherit') && screen().includes('deepseek-official/deepseek-flash'))
  record({ scenario: 'summary-model-catalog', source: 'host registry', screen: screen() })
  const choose = async (choice, confirm = true) => {
    const before = countHints(requests)
    await type(`/hint model ${choice}`)
    await wait('summary-model-disclosure', () => screen().includes('Save Summary') && screen().includes('Model?'))
    assert(screen().includes('12000 input characters total') && screen().includes('No tools or main-context writes.'))
    if (choice !== 'inherit') assert(screen().includes(`Destination ${choice}.`))
    send(confirm ? '\r' : '\x1b')
    await wait('summary-model-choice', () => !screen().includes('Model?') && (confirm ? screen().includes('Saved Summary Model') : /⌸\s+❯/u.test(screen())))
    assert.equal(countHints(requests), before, 'saving/cancelling never generates')
  }
  const generate = async (main, destination) => {
    await probeMain(ui, fixture, main, 'before')
    const before = countHints(requests)
    const previous = JSON.stringify(cardRecords(readStorage()))
    setResponse('valid')
    await type('/hint refresh')
    await wait('summary-destination', () => countHints(requests) === before + 1 && screen().includes('BOUNDARY_SUMMARY_OK') && !screen().includes('Update failed') && JSON.stringify(cardRecords(readStorage())) !== previous)
    checkHint(hints(requests).at(-1), destination)
    await probeMain(ui, fixture, main, 'after')
    record({ scenario: 'summary-destination', main, destination, hintRequests: countHints(requests), screen: screen() })
  }
  const explicit = { provider: 'hint-fixture', model: 'summary-fixture', path: '/summary/v1/messages' }
  const flash = { provider: 'deepseek-official', model: 'deepseek-flash', path: '/v1/messages' }
  const pro = { provider: 'deepseek-official', model: 'deepseek-v4-pro', path: '/v1/messages' }
  const saved = readStorage()['summary-model']
  await choose('hint-fixture/summary-fixture', false)
  assert.deepEqual(readStorage()['summary-model'], saved, 'Esc leaves preference untouched')
  await choose('hint-fixture/summary-fixture')
  assert.deepEqual(readStorage()['summary-model'], { mode: 'explicit', provider: 'hint-fixture', model: 'summary-fixture' })
  await generate(flash, explicit)
  const selected = readStorage()['summary-model']
  const beforeUnknown = requests.length
  await type('/hint model hint-fixture/missing-model')
  await wait('unknown-summary-model', () => screen().includes('Summary destination or preference unavailable'))
  assert.deepEqual(readStorage()['summary-model'], selected, 'unavailable choice cannot silently replace saved choice')
  assert.equal(requests.length, beforeUnknown, 'unavailable choice has no HTTP attempt')

  await type('/model deepseek-official/deepseek-v4-pro')
  await wait('main-model-pro', () => screen().includes('deepseek-v4-pro') && screen().includes('Pending update'))
  await generate(pro, explicit)
  await choose('inherit')
  await generate(pro, pro)
  await type('/model deepseek-official/deepseek-flash')
  await wait('main-model-flash', () => screen().includes('deepseek-flash') && screen().includes('Pending update'))
  await generate(flash, flash)

  // Every failure uses the existing bounded request path in both modes.
  for (const mode of ['inherit', 'hint-fixture/summary-fixture']) {
    await choose(mode)
    await generate(flash, mode === 'inherit' ? flash : explicit)
    for (const failure of ['malformed', '429', '503', 'transport', 'overflow', 'timeout']) {
      const before = countHints(requests)
      const cards = cardContents(readStorage())
      setResponse(failure)
      await type('/hint refresh')
      await wait(`selection-last-valid-${failure}`, () => screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
      assert.deepEqual(cardContents(readStorage()), cards, `${mode}/${failure}: applicable Last Valid retained`)
      assert.equal(countHints(requests), before + 1, `${mode}/${failure}: exactly one attempt, no repair/retry`)
      checkHint(hints(requests).at(-1), mode === 'inherit' ? flash : explicit)
      setResponse('valid')
      await type('/hint retry')
      await wait(`selection-recovered-${failure}`, () => !screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
      assert.equal(countHints(requests), before + 2, 'explicit retry adds exactly one request')
    }
    await probeMain(ui, fixture, flash, 'after-failures')
  }
  const beforeHeld = cardRecords(readStorage())
  setResponse('hold')
  await type('/hint refresh')
  await wait('selection-old-held', () => heldHints.length === 1)
  await choose('inherit')
  releaseHints()
  await type('/hint view')
  await wait('selection-old-fenced', () => screen().includes('Session Card') && screen().includes('Summary Model: inherit'))
  assert(!screen().includes('LATE_WRONG_HINT'))
  assert.deepEqual(cardRecords(readStorage()), beforeHeld, 'changing selection fences held response from disk as well as UI')
  send('\x1b')
  await wait('selection-detail-closed', () => /⌸\s+❯/u.test(screen()))
  await choose('hint-fixture/summary-fixture')
  setResponse('valid')
  await generate(flash, explicit)
}

export async function restoreHintSelection(ui, fixture, unavailable = false) {
  const { type, wait, screen } = ui
  const before = countHints(fixture.requests)
  const cards = cardContents(fixture.readStorage())
  await wait('selection-restored-cards', () => screen().includes('BOUNDARY_SUMMARY_OK'))
  await type('/hint model')
  await wait('selection-restored-choice', () => unavailable === 'invalid' ? screen().includes('Summary Model: invalid')
    : screen().includes('Summary Model: explicit') && screen().includes('hint-fixture/summary-fixture'))
  assert.equal(countHints(fixture.requests), before, 'restart restores preference/cards without a summary call')
  await probeMain(ui, fixture, { model: 'deepseek-flash', path: '/v1/messages' }, 'restart-before')
  await type('/hint refresh')
  if (unavailable) {
    await wait('selection-unavailable', () => screen().includes('Summary destination or preference unavailable') && screen().includes('Update failed') && screen().includes('BOUNDARY_SUMMARY_OK'))
    assert.equal(countHints(fixture.requests), before, 'removed real host provider fails before HTTP with no fallback')
    assert.deepEqual(cardContents(fixture.readStorage()), cards)
  } else {
    await wait('selection-restored-generated', () => countHints(fixture.requests) === before + 1 && screen().includes('BOUNDARY_SUMMARY_OK'))
    checkHint(hints(fixture.requests).at(-1), { model: 'summary-fixture', path: '/summary/v1/messages' })
  }
  await probeMain(ui, fixture, { model: 'deepseek-flash', path: '/v1/messages' }, 'restart-after')
  fixture.record({ scenario: unavailable === 'invalid' ? 'summary-preference-invalid' : unavailable ? 'summary-provider-removed' : 'summary-restart', summaryRequests: countHints(fixture.requests), screen: screen() })
}

const hints = requests => requests.filter(request => JSON.stringify(request.body.messages).includes('CONTEXT_HINT_V1'))
export const countHints = requests => hints(requests).length
const cardRecords = storage => Object.fromEntries(Object.entries(storage).filter(([, value]) => value.cards))
const cardContents = storage => Object.fromEntries(Object.entries(cardRecords(storage)).map(([key, value]) => [key, value.cards]))

function checkHint(request, destination) {
  assert.equal(request.path, destination.path, 'actual external provider destination')
  assert.equal(request.body.model, destination.model, 'actual selected model')
  assert.equal(request.body.max_tokens, 2048)
  assert(!request.body.tools?.length && !request.body.system, 'no tools or original system prompt')
  assert.equal(request.body.messages.length, 1)
  assert(JSON.stringify(request.body.messages).length < 12500, 'bounded input for either mode')
  assert(JSON.stringify(request.body).length < 14000, 'whole wire body bounded')
  assert.equal(request.body.dsh_session_log, undefined)
  assert.equal(request.body.dsh_plugin_packages, undefined)
}

async function probeMain({ type, wait, screen }, fixture, expected, label) {
  const marker = `VERIFY_MODEL_PROBE_${label}_${fixture.requests.length}`
  await type(marker)
  await wait('main-selection-' + label, () => fixture.requests.some(request => JSON.stringify(request.body.messages.at(-1)).includes(marker)) && screen().includes(`MAIN_SELECTION_PROBE_OK:${marker}`))
  const request = fixture.requests.find(request => JSON.stringify(request.body.messages.at(-1)).includes(marker))
  assert.equal(request.path, expected.path)
  assert.equal(request.body.model, expected.model, 'real main request selection before/after summary')
  fixture.record({ scenario: 'real-main-selection', phase: label, providerPath: request.path, model: request.body.model, screen: screen() })
}
