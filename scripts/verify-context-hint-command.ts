/** Public command-boundary supplement, not a substitute for packed PTY acceptance. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { filterCommands, isLocalCommandName, parseCommandName, localizedDescription } from '../src/commands.js'
import { getLang, setLang, t } from '../src/i18n.js'
import { Config } from '../src/dsh-adapter/index.js'
import { configValues } from '../src/dsh-adapter/compat/settings.js'
try {
  assert(isLocalCommandName('/hint'), 'hint must dispatch locally, not to the main model')
  assert(filterCommands('/hin').some(command => command.name === 'hint'), 'user can discover hint in slash completion')
  assert.deepEqual(parseCommandName('/hint enable'), { name: 'hint', rawInput: ' enable' })
  assert.deepEqual(parseCommandName('/hint model inherit'), { name: 'hint', rawInput: ' model inherit' })
  const hint = filterCommands('/hin').find(command => command.name === 'hint')!
  assert(hint.description.includes('Summary Model'), 'slash declaration discovers independent selection')
  const language = getLang()
  try {
    for (const lang of ['en', 'zh'] as const) {
      setLang(lang)
      assert(localizedDescription(hint).includes('Summary Model'), `${lang}: localized help discovers selection`)
      assert(t('hint-help').includes('model [inherit|provider/model]'), `${lang}: help names the exact input surface`)
    }
  } finally { setLang(language) }
  assert(Config.dict.contextHintShortcut, 'shortcut must be declared in the public config schema, not accepted as an unknown passthrough')
  assert.equal(configValues(Config({ contextHintShortcut: 'alt+p' })).contextHintShortcut, 'alt+p', 'deployment can remap the shortcut')
  assert.equal(configValues(Config({ contextHintShortcut: '' })).contextHintShortcut, '', 'empty shortcut preserves command-only use')
  console.log('PASS Context Hint public local-command boundary')
} finally { rmSync(fakeHome, { recursive: true, force: true }) }
