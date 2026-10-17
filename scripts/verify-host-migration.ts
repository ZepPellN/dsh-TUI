/** Nonempty migration at the public importSessions seam, with real host storage.
 * Run: node --import tsx/esm scripts/verify-host-migration.ts
 * No private stores, credentials or mocked lifecycle. Supplements the existing
 * full migration suite with the exact host's exported plugin shape.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { Session, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { importSessions, migrationSessionId } from '../src/dsh-adapter/migrate/index.js'
import { fromRoleTurns, emptyStats } from '../src/dsh-adapter/migrate/parse/role-turns.js'
import { settled } from './lib/term-test.mjs'

const root = mkdtempSync(join(tmpdir(), 'host-migration-'))
const adapter = { id: 'fixture', label: 'Fixture', roots: () => [], discover: () => ({ roots: [], sessions: [] }) }
const fixture = {
  sourceId: 'host-compatibility', cwd: root, startedAt: 1790000000000,
  stats: emptyStats(), turns: fromRoleTurns([
    { role: 'user' as const, text: '兼容性测试 🎏', time: 1790000000000 },
    { role: 'assistant' as const, text: '迁移后仍可恢复 ✓', time: 1790000001000 },
  ]),
}
try {
  assert.deepEqual(await importSessions(adapter, root, [fixture]), { imported: 1, existing: 0, failed: 0, failures: [] })
  assert.deepEqual(await importSessions(adapter, root, [fixture]), { imported: 0, existing: 1, failed: 0, failures: [] })
  const ctx = new Context()
  const plugin = ctx.plugin(('default' in Jsonl ? Jsonl.default : Jsonl) as Parameters<Context['plugin']>[0], { root })
  try {
    assert(await settled(() => ctx.get('sessionPersistence') !== undefined))
    const id = migrationSessionId(adapter, fixture)
    assert((await ctx.sessionPersistence.list()).some(row => row.header.id === id))
    const handle = await ctx.sessionPersistence.open(id, 'write')
    try {
      const { events, eventState } = await handle.read()
      const restored = Session.fromRestore(id, events, handle.header, SessionLogOffset(0), eventState)
      assert.deepEqual(restored.deriveMessages().map(m => m.content.map(b => 'text' in b ? b.text : '').join('')), [
        '兼容性测试 🎏', '迁移后仍可恢复 ✓',
      ])
      restored.append('user/message', createUserMessage({
        content: [{ type: 'text', text: '继续迁移的会话' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      await handle.append(restored.snapshotEvents().slice(events.length))
      await handle.flush()
    } finally { await handle.close() }
    const reopened = await ctx.sessionPersistence.open(id, 'read')
    try {
      const { events, eventState } = await reopened.read()
      const continued = Session.fromRestore(id, events, reopened.header, reopened.inheritedEventCount, eventState)
      assert.deepEqual(continued.deriveMessages().map(m => m.content.map(b => 'text' in b ? b.text : '').join('')), [
        '兼容性测试 🎏', '迁移后仍可恢复 ✓', '继续迁移的会话',
      ])
    } finally { await reopened.close() }
  } finally { await plugin.dispose() }
  console.log('PASS real import → nonempty write → list/read/restore → continue/flush/reopen → duplicate import')
} finally { rmSync(root, { recursive: true, force: true }) }
