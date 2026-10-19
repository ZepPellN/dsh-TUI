/** Public command-boundary supplement, not a substitute for packed PTY acceptance. */
import fakeHome from './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { filterCommands, isLocalCommandName, parseCommandName } from '../src/commands.js'
import { Config } from '../src/dsh-adapter/index.js'
import { configValues } from '../src/dsh-adapter/compat/settings.js'
try {
  assert(isLocalCommandName('/hint'), 'hint must dispatch locally, not to the main model')
  assert(filterCommands('/hin').some(command => command.name === 'hint'), 'user can discover hint in slash completion')
  assert.deepEqual(parseCommandName('/hint enable'), { name: 'hint', rawInput: ' enable' })
  assert(Config.dict.contextHintShortcut, 'shortcut must be declared in the public config schema, not accepted as an unknown passthrough')
  assert.equal(configValues(Config({ contextHintShortcut: 'alt+p' })).contextHintShortcut, 'alt+p', 'deployment can remap the shortcut')
  assert.equal(configValues(Config({ contextHintShortcut: '' })).contextHintShortcut, '', 'empty shortcut preserves command-only use')
  console.log('PASS Context Hint public local-command boundary')
} finally { rmSync(fakeHome, { recursive: true, force: true }) }
