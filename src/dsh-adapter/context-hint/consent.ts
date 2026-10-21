/** Trusted composition only: fixed identity/manifest and own-storage consent. */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseGrantStore, readGrantStore, EXTENSION_GRANTS_FILE } from '../../adapter/standard/grants.js'
import type { AdapterRuntimeOptions } from '../../adapter/kernel/runtime.js'
import { assertCapabilityShadowPolicy } from '../../adapter/kernel/runtime.js'
import { DATA_DIR } from '../../utils/paths.js'

export const HINT_COMPONENT_ID = 'dsh-tui.context-hint'
const permissions = ['storage.local.read', 'storage.local.write'] as const

// This selection belongs to the trusted packaged host, never to plugin input.
const manifest = (requested: readonly (typeof permissions)[number][]) => JSON.stringify({
  $schema: 'urn:dsh-std:community-draft:dsh-plugin:0.15',
  manifestVersion: '0.15',
  id: HINT_COMPONENT_ID,
  name: 'Context Hint',
  version: '0.12.0',
  facets: { host: { entry: 'lib/types/dsh-adapter/context-hint/extension.js', apiVersion: 'v1alpha1' } },
  requires: { contracts: [{ apiVersion: 'storage.dsh/v1alpha1', kind: 'LocalStorage' }] },
  permissions: requested.map(name => ({ name, scope: HINT_COMPONENT_ID, reason: 'Persist project opt-in, Summary Model choice and latest Session/Turn cards' })),
  contributes: { commands: [] },
  subscriptions: [],
  license: 'MIT',
})
export const HINT_MANIFEST = manifest(permissions)
/** Inspection-only activation: the same fixed component/namespace reaches the
 * retained choice with `storage.local.read` but cannot generate or write. */
export const HINT_READ_MANIFEST = manifest(['storage.local.read'])

export function hintStorageGranted(runtime: AdapterRuntimeOptions): boolean {
  const store = readGrantStore(undefined, undefined, runtime)
  return permissions.every(permission => store.allows(HINT_COMPONENT_ID, permission, HINT_COMPONENT_ID))
}

/** Fixed-component consent: read-only inspection cannot restore generation on restart. */
export async function consentHintStorage(runtime: AdapterRuntimeOptions, signal: AbortSignal, phase: 'read-only' | 'complete' = 'complete'): Promise<void> {
  assertCapabilityShadowPolicy('host.admission', runtime.mode, runtime.slices)
  const file = join(DATA_DIR, EXTENSION_GRANTS_FILE)
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  await withFileLock(file, async () => {
    let source = '{}'
    try { source = readFileSync(file, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (parseGrantStore(source, undefined, runtime).corrupt) throw new Error('Context Hint grant store is corrupt')
    const table = JSON.parse(source) as { grants?: Record<string, unknown[]>; denies?: Record<string, unknown[]> }
    // Conservatively preserve even activation-specific explicit denies. Consent
    // is not a grant editor, and cannot revoke or weaken a denial.
    const denied = table.denies?.[HINT_COMPONENT_ID] ?? []
    if (denied.some(rule => typeof rule === 'string' ? permissions.includes(rule as typeof permissions[number])
      : rule !== null && typeof rule === 'object' && permissions.includes((rule as { name: typeof permissions[number] }).name))) {
      throw new Error('Context Hint storage explicitly denied')
    }
    const grants = { ...table.grants }
    const existing = (grants[HINT_COMPONENT_ID] ?? []).filter(rule => phase !== 'read-only'
      || (typeof rule === 'string' ? rule !== 'storage.local.write'
        : rule === null || typeof rule !== 'object' || (rule as { name?: unknown }).name !== 'storage.local.write'))
    grants[HINT_COMPONENT_ID] = [...existing]
    for (const name of phase === 'read-only' ? ['storage.local.read'] as const : permissions) {
      if (!existing.some(rule => rule !== null && typeof rule === 'object'
        && (rule as { name?: unknown }).name === name && (rule as { scope?: unknown }).scope === HINT_COMPONENT_ID
        && (rule as { activationId?: unknown }).activationId === undefined)) {
        grants[HINT_COMPONENT_ID].push({ name, scope: HINT_COMPONENT_ID })
      }
    }
    // Legacy locks cannot cancel acquisition; recheck after waiting, before granting.
    if (signal.aborted) throw new Error('Context Hint consent cancelled')
    await writeFileAtomic(file, JSON.stringify({ ...table, grants }), { mode: 0o600, dirMode: 0o700 })
  }, { waitMs: 3000 })
}
