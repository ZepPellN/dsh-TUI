import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { DATA_DIR } from '../../utils/paths.js'
import { withStorageWriteGuard, type TuiPluginStorage } from '../plugin-storage.js'
import type { HintProject } from './project.js'
import { parseProjectCard, type ProjectCard } from './result.js'

export interface SharedProject extends Record<string, unknown> {
  identity: string
  enabled: boolean
  revision: number
  card?: ProjectCard
}

/** One latest envelope, including current controls. Unknown controls survive updates. */
export async function readSharedProject(storage: TuiPluginStorage, project: HintProject): Promise<SharedProject> {
  const { value } = await storage.get({ key: project.key })
  if (value === null) return { identity: project.id, enabled: false, revision: 0 }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Project envelope')
  const saved = value as Record<string, unknown>
  const revision = Object.hasOwn(saved, 'revision') ? saved.revision : 0 // #3 opt-in had no revision.
  if (saved.identity !== project.id || typeof saved.enabled !== 'boolean'
    || (saved.card !== undefined && !Object.hasOwn(saved, 'revision'))
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid Project envelope')
  return { ...saved, identity: project.id, enabled: saved.enabled, revision,
    ...(saved.card === undefined ? {} : { card: parseProjectCard(saved.card) }) }
}

/** Cooperative feature transaction, NOT a new storage capability. Every Project
 * writer must enter here before normal admitted reads/writes. Only the utility's
 * transient PID .lock exists outside storage; no card bytes use this path.
 * Never hold this lock over a provider request or human review. */
async function coordinate<T>(current: () => boolean, operation: () => Promise<T>): Promise<T> {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  return withFileLock(join(DATA_DIR, 'context-hint-coordination'), async () => {
    if (!current()) throw new Error('Project update invalidated')
    return operation()
  })
}

/** Shared control writers (including future pause/resume) use this helper,
 * preserving card/revision/unknown controls. No arbitrary async callback. */
export async function updateProjectControls(storage: TuiPluginStorage, project: HintProject,
  controls: { enabled?: boolean; paused?: boolean }, current: () => boolean): Promise<SharedProject> {
  return coordinate(current, async () => {
    const latest = await readSharedProject(storage, project)
    const next = { ...latest, ...controls, revision: latest.revision + 1 }
    if (!Number.isSafeInteger(next.revision)) throw new Error('Project revision exhausted')
    await withStorageWriteGuard(current, () => storage.set({ key: project.key, value: next }))
    return next
  })
}

export function setProjectEnabled(storage: TuiPluginStorage, project: HintProject, enabled: boolean, current: () => boolean) {
  return updateProjectControls(storage, project, { enabled }, current)
}

/** Reviewed base is captured before generation/review, not read at confirmation.
 * An intervening confirmation or control change requires visible human re-review. */
export async function confirmProject(storage: TuiPluginStorage, project: HintProject, reviewed: SharedProject,
  candidate: ProjectCard, current: () => boolean): Promise<{ status: 'confirmed' | 'conflict'; project: SharedProject }> {
  const card = parseProjectCard(candidate)
  return coordinate(current, async () => {
    const latest = await readSharedProject(storage, project)
    if (!latest.enabled || latest.paused === true || latest.identity !== reviewed.identity
      || latest.revision !== reviewed.revision || JSON.stringify(latest.card) !== JSON.stringify(reviewed.card)) {
      return { status: 'conflict', project: latest }
    }
    const next = { ...latest, card, revision: latest.revision + 1 }
    if (!Number.isSafeInteger(next.revision)) throw new Error('Project revision exhausted')
    await withStorageWriteGuard(current, () => storage.set({ key: project.key, value: next }))
    return { status: 'confirmed', project: next }
  })
}
