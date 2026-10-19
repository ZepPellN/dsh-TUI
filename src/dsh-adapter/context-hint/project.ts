import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export interface HintProject {
  /** Canonical common Git directory, never a remote URL or a branch. */
  id: string
  key: string
  worktree: string
  kind: 'git' | 'folder'
}

/** Linked worktrees and symlinks converge; independent clones do not. */
export async function resolveHintProject(cwd: string): Promise<HintProject> {
  const worktree = await realpath(cwd)
  let id = worktree
  let kind: HintProject['kind'] = 'folder'
  try {
    const { stdout } = await execute('git', ['rev-parse', '--git-common-dir'], { cwd: worktree, timeout: 3000, maxBuffer: 8192 })
    id = await realpath(resolve(worktree, stdout.trim()))
    kind = 'git'
  } catch {
    // No cross-directory identity is promised for non-Git folders.
  }
  const info = await stat(id, { bigint: true })
  // Filesystem primary key keeps arbitrary-length canonical paths out of
  // storage's 128-character key limit. Birth time distinguishes inode reuse;
  // the full canonical identity is also validated on every stored read.
  const key = `project:${kind}:${info.dev}:${info.ino}:${info.birthtimeNs}`
  return { id, key, worktree, kind }
}
