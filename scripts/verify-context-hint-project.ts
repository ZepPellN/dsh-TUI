/** Public canonical Project boundary; no host substitute. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveHintProject } from '../src/dsh-adapter/context-hint/project.js'

const scratch = mkdtempSync(join(tmpdir(), 'hint-project-'))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
try {
  const repo = join(scratch, 'repo')
  mkdirSync(repo)
  git(repo, 'init')
  git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'seed')
  git(repo, 'worktree', 'add', '-b', 'linked', join(scratch, 'linked'))
  git(scratch, 'clone', repo, join(scratch, 'clone'))
  symlinkSync(repo, join(scratch, 'alias'))
  const main = await resolveHintProject(repo)
  const linked = await resolveHintProject(join(scratch, 'linked'))
  assert.equal(linked.id, main.id)
  assert.equal(linked.key, main.key)
  assert.equal((await resolveHintProject(join(scratch, 'alias'))).id, main.id)
  assert.notEqual((await resolveHintProject(join(scratch, 'clone'))).id, main.id)
  assert.notEqual((await resolveHintProject(join(scratch, 'clone'))).key, main.key)
  assert.equal((await resolveHintProject(scratch)).kind, 'folder')
  assert(main.key.length <= 128)
  console.log('PASS canonical shared Git identity, linked worktree/symlink equality, clone separation')
} finally { rmSync(scratch, { recursive: true, force: true }) }
