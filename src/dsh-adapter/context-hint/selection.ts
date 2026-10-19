import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { TuiPluginStorage } from '../plugin-storage.js'
import { withStorageWriteGuard } from '../plugin-storage.js'

export type HintSelection = { mode: 'inherit' } | { mode: 'explicit'; provider: string; model: string }
export interface HintRoute { provider: string; model: string }

export class HintSelectionError extends Error {}

/** One profile-wide preference in the component namespace, never host settings. */
export function hintSelectionPreference(storage: TuiPluginStorage) {
  return {
    async read() { return parseHintSelection((await storage.get({ key: 'summary-model' })).value) },
    save(selection: HintSelection, current: () => boolean) {
      const value = parseHintSelection(selection)
      return withStorageWriteGuard(current, () => storage.set({ key: 'summary-model', value }))
    },
  }
}

function routePart(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f-\x9f]/u.test(value)
}

/** Only route identities persist, through the existing admitted storage handle. */
export function parseHintSelection(value: unknown): HintSelection {
  if (value === null) return { mode: 'inherit' }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (record.mode === 'inherit' && Object.keys(record).length === 1) return { mode: 'inherit' }
    if (record.mode === 'explicit' && Object.keys(record).length === 3 && routePart(record.provider) && routePart(record.model)) {
      return { mode: 'explicit', provider: record.provider, model: record.model }
    }
  }
  throw new HintSelectionError('Invalid Summary Model preference')
}

export function hintSelectionFromCommand(input: string): HintSelection {
  if (input === 'inherit') return { mode: 'inherit' }
  const slash = input.indexOf('/')
  return parseHintSelection({ mode: 'explicit', provider: input.slice(0, slash), model: slash < 0 ? '' : input.slice(slash + 1) })
}

/** Host registry/adapter discovery only; no keys, provider configuration or cache. */
export async function listHintModels(llm: LlmRuntime | undefined): Promise<HintRoute[]> {
  if (llm === undefined) throw new HintSelectionError('Summary Model service unavailable')
  const lists = await Promise.all(llm.listProviders().map(async provider => {
    try {
      return (await llm.listModels(provider.id)).map(model => ({ provider: provider.id, model: model.id }))
    } catch { return [] }
  }))
  return lists.flat()
}

/** Validate one exact destination immediately before the normal host preparation. */
export async function resolveHintRoute(llm: LlmRuntime | undefined, selection: HintSelection | undefined, main: HintRoute): Promise<HintRoute> {
  if (selection === undefined || llm === undefined) throw new HintSelectionError('Invalid Summary Model preference or host')
  const route = selection.mode === 'inherit' ? { ...main } : { provider: selection.provider, model: selection.model }
  try {
    if (!llm.listProviders().some(provider => provider.id === route.provider)
      || !(await llm.listModels(route.provider)).some(model => model.id === route.model)) {
      throw new Error('not catalogued')
    }
  } catch { throw new HintSelectionError('Selected Summary Model unavailable') }
  return route
}
