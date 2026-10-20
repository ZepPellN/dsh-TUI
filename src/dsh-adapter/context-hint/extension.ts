import type { Context } from '@deepseek-ai/cordis'
import type { TuiPluginStorage } from '../plugin-storage.js'
import { withStorageWriteGuard } from '../plugin-storage.js'
import { resolveHintProject, type HintProject } from './project.js'
import { t } from '../../i18n.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ChannelOwner } from '../channel/owner.js'
import type { ChannelBinding } from '../channel/binding.js'
import { liveSessionOffset, snapshotLiveSessionEvents } from '../compat/liveSession.js'
import { requestHint } from './request.js'
import { parseHintResult, type HintResult } from './result.js'
import { hintViews, type HintView } from './views.js'
import { hintSelectionPreference, type HintSelection, type HintRoute, HintSelectionError } from './selection.js'
import { confirmProject, readSharedProject, setProjectEnabled, type SharedProject } from './shared-project.js'
import type { ProjectCard } from './result.js'

export interface HintDependencies {
  owner: ChannelOwner
  binding: ChannelBinding
  cwd(): string
  route(): { provider: string; model: string }
  subscribe(listener: () => void): () => void
  shortcut?: string
  notify(text: string): void
}

/** Admitted extension body; all effects belong to its real Cordis activation. */
export function applyHintExtension(ctx: Context, deps: HintDependencies) {
  const storage: TuiPluginStorage = ctx.get('tuiPluginStorage')!.open(ctx)
  const preference = hintSelectionPreference(storage)
  let selection: HintSelection | undefined = { mode: 'inherit' }
  const destination = () => selection?.mode === 'inherit' ? deps.route()
    : selection?.mode === 'explicit' ? { provider: selection.provider, model: selection.model } : undefined
  const modelDescription = () => {
    const route = destination()
    return t('hint-model-current', { mode: selection?.mode === 'inherit' ? t('hint-model-inherit')
      : selection?.mode === 'explicit' ? t('hint-model-explicit') : t('hint-model-invalid'),
    route: route === undefined ? '—' : `${route.provider}/${route.model}` })
  }
  let project: HintProject | undefined
  let enabled = false
  let cards: HintResult | undefined
  let projectCard: ProjectCard | undefined
  let suggestion: { card: ProjectCard; base: SharedProject; reviewed: boolean; conflict: boolean; eventOffset: number } | undefined
  let cardOffset = 0
  let cardRoute: HintRoute | undefined
  let failed = false
  let request: AbortController | undefined
  let revision = 0
  let snapshot: HintView = { enabled: false, failed: false }
  const listeners = new Set<() => void>()
  const publish = () => {
    snapshot = { enabled, cards, failed, model: modelDescription(), projectCard, suggestion }
    for (const listener of listeners) listener()
  }
  const { Compact, Detail } = hintViews(() => snapshot,
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => ({ project: project?.id ?? '', worktree: project?.worktree ?? '', session: String(deps.binding.agent.session.id) }),
    deps.shortcut ?? 'alt+o')
  ctx.get('tuiStatus')?.registerView({ key: 'context-hint', component: Compact, maxRows: 1 }, ctx)
  ctx.get('tuiScenes')?.register({ id: 'context-hint', title: t('hint-detail-title'), component: Detail }, ctx)
  const toggle = AsyncLocalStorage.bind(async () => {
    if (!enabled) { deps.notify(t('hint-help')); return }
    const scenes = ctx.get('tuiScenes')
    if (scenes === undefined) { deps.notify(t('hint-unavailable')); return }
    if (scenes.active?.id === 'context-hint') scenes.close()
    else {
      const capture = deps.binding.capture()
      const target = project
      const latest = target === undefined ? undefined : await readSharedProject(storage, target)
      if (!deps.owner.current() || !enabled || !deps.binding.isCurrent(capture) || target !== project) return
      projectCard = latest?.card
      publish()
      scenes.open('context-hint')
    }
  })
  const shortcut = deps.shortcut ?? 'alt+o'
  if (shortcut !== '') ctx.get('tuiShortcuts')?.register(shortcut, { description: t('hint-detail-title'), handler: () => {
    void toggle().catch(() => { if (deps.owner.current()) deps.notify(t('hint-unavailable')) })
  } }, ctx)

  const load = async () => {
    const ticket = ++revision
    const capture = deps.binding.capture()
    const cwd = deps.cwd()
    const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
    const nextProject = await resolveHintProject(cwd)
    if (!current()) return
    const shared = await readSharedProject(storage, nextProject)
    if (!current()) return
    let nextSelection: HintSelection | undefined
    try { nextSelection = await preference.read() } catch { /* Invalid preference fails closed on refresh. */ }
    if (!current()) return
    const nextEnabled = shared.enabled
    let nextCards: HintResult | undefined
    let nextOffset = 0
    let nextCardRoute: HintRoute | undefined
    let nextFailed = false
    if (nextEnabled) {
      const saved = (await storage.get({ key: `session:${capture.agent.session.id}` })).value
      if (!current()) return
      if (saved !== null && typeof saved === 'object') {
        const record = saved as Record<string, unknown>
        if (record.identity === nextProject.id && record.sessionId === capture.agent.session.id
          && typeof record.eventOffset === 'number' && Number.isSafeInteger(record.eventOffset)
          && record.eventOffset >= 0 && record.eventOffset <= liveSessionOffset(capture.agent.session)) {
          try {
            nextCards = parseHintResult(JSON.stringify(record.cards))
            nextOffset = record.eventOffset
            if (typeof record.provider === 'string' && typeof record.model === 'string') nextCardRoute = { provider: record.provider, model: record.model }
            nextFailed = record.failed === true
          } catch { nextFailed = true }
        }
      }
    }
    if (!current()) return
    project = nextProject
    selection = nextSelection
    projectCard = shared.card
    suggestion = undefined
    enabled = nextEnabled
    cards = nextCards
    cardOffset = nextOffset
    cardRoute = nextCardRoute
    failed = nextFailed
    publish()
  }
  const boundLoad = AsyncLocalStorage.bind(load)
  let observed = deps.binding.capture()
  let observedCwd = deps.cwd()
  const unsubscribe = deps.subscribe(AsyncLocalStorage.bind(() => {
    if (deps.binding.isCurrent(observed) && observedCwd === deps.cwd()) return
    if (!deps.owner.current()) return
    observed = deps.binding.capture()
    observedCwd = deps.cwd()
    revision++
    request?.abort()
    project = undefined
    enabled = false
    cards = undefined
    cardRoute = undefined
    projectCard = undefined
    suggestion = undefined
    failed = false
    const scenes = ctx.get('tuiScenes')
    if (scenes?.active?.id === 'context-hint') scenes.close()
    publish()
    void boundLoad().catch(() => { if (deps.owner.current()) deps.notify(t('hint-unavailable')) })
  }))
  deps.owner.own(() => { revision++; request?.abort(); unsubscribe(); listeners.clear() })
  return {
    toggle,
    load: boundLoad,
    destination,
    modelDescription,
    selectModel: AsyncLocalStorage.bind(async (next: HintSelection) => {
      request?.abort()
      const ticket = ++revision
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
      await preference.save(next, current)
      if (!current()) return
      selection = next
      publish()
      deps.notify(t('hint-model-saved', { model: modelDescription() }))
    }),
    enable: AsyncLocalStorage.bind(async () => {
      const ticket = ++revision
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const target = await resolveHintProject(cwd)
      const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
      if (!current()) return
      await setProjectEnabled(storage, target, true, current)
      if (!current()) return
      await boundLoad()
    }),
    disable: AsyncLocalStorage.bind(async () => {
      request?.abort()
      const ticket = ++revision
      const capture = deps.binding.capture()
      const target = project
      const cwd = deps.cwd()
      const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
      enabled = false
      suggestion = undefined
      const scenes = ctx.get('tuiScenes')
      if (scenes?.active?.id === 'context-hint') scenes.close()
      publish()
      if (target !== undefined) await setProjectEnabled(storage, target, false, current)
    }),
    projectAction: AsyncLocalStorage.bind(async (action: string) => {
      const pending = suggestion
      const target = project
      if (!enabled || pending === undefined || target === undefined) { deps.notify(t('hint-project-no-suggestion')); return }
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const current = () => deps.owner.current() && enabled && suggestion === pending && project === target
        && deps.binding.isCurrent(capture) && deps.cwd() === cwd
        && liveSessionOffset(capture.agent.session) === pending.eventOffset
      if (action === 'reject') {
        suggestion = undefined
        publish()
        deps.notify(t('hint-project-rejected'))
      } else if (action === 'review') {
        const latest = await readSharedProject(storage, target)
        if (!current()) return
        pending.base = latest
        pending.reviewed = true
        pending.conflict = false
        projectCard = latest.card
        publish()
        ctx.get('tuiScenes')?.open('context-hint')
      } else if (action === 'confirm') {
        if (!pending.reviewed || pending.conflict) { deps.notify(t('hint-project-review-required')); return }
        const result = await confirmProject(storage, target, pending.base, pending.card, current)
        if (!current()) return
        projectCard = result.project.card
        if (result.status === 'confirmed') suggestion = undefined
        else { pending.conflict = true; pending.reviewed = false }
        publish()
        deps.notify(t(result.status === 'confirmed' ? 'hint-project-confirmed' : 'hint-project-conflict'))
      } else deps.notify(t('hint-project-controls'))
    }),
    refresh: AsyncLocalStorage.bind(async () => {
      if (!enabled || project === undefined) { deps.notify(t('hint-help')); return }
      request?.abort()
      suggestion = undefined
      publish()
      const controller = new AbortController()
      request = controller
      const capture = deps.binding.capture()
      const session = capture.agent.session
      const eventOffset = liveSessionOffset(session)
      const identity = project.id
      const target = project
      const cwd = deps.cwd()
      const route = destination()
      const selected = selection
      const ticket = revision
      const current = () => deps.owner.current() && enabled && request === controller && !controller.signal.aborted
        && revision === ticket
        && deps.binding.isCurrent(capture) && deps.cwd() === cwd && project?.id === identity
        && liveSessionOffset(session) === eventOffset
      try {
        if (route === undefined || selected === undefined) throw new HintSelectionError('Invalid Summary Model preference')
        const base = await readSharedProject(storage, target)
        if (!current() || !base.enabled) return
        const result = await requestHint(ctx, {
          ...route, selection: selected, events: snapshotLiveSessionEvents(session),
          signal: AbortSignal.any([controller.signal, deps.owner.signal]),
        })
        if (!current()) return
        const latestCards = { session: result.session, turn: result.turn }
        await withStorageWriteGuard(current, () => storage.set({ key: `session:${session.id}`, value: { identity, sessionId: session.id, eventOffset, cards: latestCards, ...route } }))
        if (!current()) return
        cards = latestCards
        projectCard = base.card
        suggestion = result.projectSuggestion === undefined ? undefined : {
          card: result.projectSuggestion, base, reviewed: false, conflict: false, eventOffset,
        }
        cardOffset = eventOffset
        cardRoute = route
        failed = false
        publish()
      } catch (error) {
        if (current()) {
          failed = true
          publish()
          deps.notify(error instanceof HintSelectionError ? t('hint-model-unavailable', { model: modelDescription() }) : t('hint-update-failed'))
          if (cards !== undefined) {
            try {
              await withStorageWriteGuard(current, () => storage.set({ key: `session:${session.id}`, value: { identity, sessionId: session.id, eventOffset: cardOffset, cards, failed: true, ...cardRoute } }))
            } catch { /* Last Valid remains visible even when storage itself failed. */ }
          }
        }
      } finally { if (request === controller) request = undefined }
    }),
  }
}
