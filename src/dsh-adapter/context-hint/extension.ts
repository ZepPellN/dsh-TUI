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
import { createHintInteractions } from './interactions.js'

export interface HintDependencies {
  owner: ChannelOwner
  binding: ChannelBinding
  cwd(): string
  route(): { provider: string; model: string }
  subscribe(listener: () => void): () => void
  shortcut?: string
  notify(text: string): void
  changed?(): void
}

/** Admitted extension body; all effects belong to its real Cordis activation. */
export function applyHintExtension(ctx: Context, deps: HintDependencies) {
  const storage: TuiPluginStorage = ctx.get('tuiPluginStorage')!.open(ctx)
  let project: HintProject | undefined
  let enabled = false
  let paused = false
  let loading = true
  const interactions = createHintInteractions()
  let cards: HintResult | undefined
  let cardOffset = 0
  let failed = false
  let request: AbortController | undefined
  let revision = 0
  let snapshot: HintView = { enabled: false, paused: false, failed: false }
  const listeners = new Set<() => void>()
  const publish = () => {
    snapshot = { enabled, paused, cards, failed }
    for (const listener of listeners) listener()
    deps.changed?.()
  }
  const { Compact, Detail } = hintViews(() => snapshot,
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => ({ project: project?.id ?? '', worktree: project?.worktree ?? '', session: String(deps.binding.agent.session.id) }),
    deps.shortcut ?? 'alt+o')
  ctx.get('tuiStatus')?.registerView({ key: 'context-hint', component: Compact, maxRows: 1 }, ctx)
  ctx.get('tuiScenes')?.register({ id: 'context-hint', title: t('hint-detail-title'), component: Detail }, ctx)
  const toggle = AsyncLocalStorage.bind(() => {
    if (!enabled) { deps.notify(t('hint-help')); return }
    const scenes = ctx.get('tuiScenes')
    if (scenes === undefined) { deps.notify(t('hint-unavailable')); return }
    if (scenes.active?.id === 'context-hint') scenes.close()
    else scenes.open('context-hint')
  })
  const shortcut = deps.shortcut ?? 'alt+o'
  if (shortcut !== '') ctx.get('tuiShortcuts')?.register(shortcut, { description: t('hint-detail-title'), handler: toggle }, ctx)

  // Project-control connection surface: retain fields owned by shared Project
  // content. #6 funnels this read/check/write through its cooperative writer.
  const updateControl = async (target: HintProject, patch: { enabled?: boolean; paused?: boolean }, current: () => boolean) => {
    const { value } = await storage.get({ key: target.key })
    const previous = value !== null && typeof value === 'object' && !Array.isArray(value)
      && (value as { identity?: unknown }).identity === target.id ? value : {}
    await withStorageWriteGuard(current, () => storage.set({ key: target.key, value: { ...previous, identity: target.id, ...patch } }))
  }

  const load = async () => {
    const ticket = ++revision
    const capture = deps.binding.capture()
    const cwd = deps.cwd()
    const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
    const nextProject = await resolveHintProject(cwd)
    if (!current()) return
    const { value } = await storage.get({ key: nextProject.key })
    if (!current()) return
    const nextEnabled = value !== null && typeof value === 'object'
      && (value as { identity?: unknown }).identity === nextProject.id
      && (value as { enabled?: unknown }).enabled === true
    let nextCards: HintResult | undefined
    let nextOffset = 0
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
            nextFailed = record.failed === true
          } catch { nextFailed = true }
        }
      }
    }
    if (!current()) return
    project = nextProject
    enabled = nextEnabled
    paused = nextEnabled && (value as { paused?: unknown }).paused === true
    loading = false
    interactions.reset(liveSessionOffset(capture.agent.session), enabled, paused)
    cards = nextCards
    cardOffset = nextOffset
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
    paused = false
    loading = true
    interactions.reset(liveSessionOffset(observed.agent.session), false, false)
    cards = undefined
    failed = false
    const scenes = ctx.get('tuiScenes')
    if (scenes?.active?.id === 'context-hint') scenes.close()
    publish()
    void boundLoad().catch(() => { if (deps.owner.current()) deps.notify(t('hint-unavailable')) })
  }))
  deps.owner.own(() => { revision++; request?.abort(); unsubscribe(); listeners.clear() })
  const actions = {
    get suppressesRecap() { return loading || enabled },
    toggle,
    load: boundLoad,
    enable: AsyncLocalStorage.bind(async () => {
      request?.abort()
      const ticket = ++revision
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const target = await resolveHintProject(cwd)
      const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
      if (!current()) return
      await updateControl(target, { enabled: true, paused: false }, current)
      if (!current()) return
      await boundLoad()
    }),
    disable: AsyncLocalStorage.bind(async () => {
      request?.abort()
      const ticket = ++revision
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const target = project
      enabled = false
      paused = false
      loading = false
      interactions.reset(liveSessionOffset(deps.binding.agent.session), false, false)
      const scenes = ctx.get('tuiScenes')
      if (scenes?.active?.id === 'context-hint') scenes.close()
      publish()
      if (target !== undefined) await updateControl(target, { enabled: false, paused: false },
        () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd())
    }),
    setPaused: AsyncLocalStorage.bind(async (next: boolean) => {
      if (!enabled || project === undefined) { deps.notify(t('hint-help')); return }
      const ticket = ++revision
      const target = project
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      paused = next
      // Both controls reset observation: resume handles only future turns,
      // never the history accumulated while paused or an already-open turn.
      interactions.reset(liveSessionOffset(capture.agent.session), enabled, paused)
      publish()
      await updateControl(target, { paused: next }, () => deps.owner.current() && enabled && ticket === revision
        && deps.binding.isCurrent(capture) && cwd === deps.cwd() && project?.id === target.id)
    }),
    refresh: AsyncLocalStorage.bind(async () => {
      if (!enabled || project === undefined) { deps.notify(t('hint-help')); return }
      request?.abort()
      const controller = new AbortController()
      request = controller
      const capture = deps.binding.capture()
      const session = capture.agent.session
      const eventOffset = liveSessionOffset(session)
      const identity = project.id
      const cwd = deps.cwd()
      const route = deps.route()
      const current = () => deps.owner.current() && enabled && request === controller && !controller.signal.aborted
        && deps.binding.isCurrent(capture) && deps.cwd() === cwd && project?.id === identity
        && liveSessionOffset(session) === eventOffset
      try {
        const result = await requestHint(ctx, {
          ...route, events: snapshotLiveSessionEvents(session),
          signal: AbortSignal.any([controller.signal, deps.owner.signal]),
        })
        if (!current()) return
        await withStorageWriteGuard(current, () => storage.set({ key: `session:${session.id}`, value: { identity, sessionId: session.id, eventOffset, cards: result, ...route } }))
        if (!current()) return
        cards = result
        cardOffset = eventOffset
        failed = false
        publish()
      } catch {
        if (current()) {
          failed = true
          publish()
          deps.notify(t('hint-update-failed'))
          if (cards !== undefined) {
            try {
              await withStorageWriteGuard(current, () => storage.set({ key: `session:${session.id}`, value: { identity, sessionId: session.id, eventOffset: cardOffset, cards, failed: true, ...route } }))
            } catch { /* Last Valid remains visible even when storage itself failed. */ }
          }
        }
      } finally { if (request === controller) request = undefined }
    }),
  }
  deps.owner.own(ctx.on('session/event', (session, event) => {
    if (!deps.owner.current() || !deps.binding.isCurrent(observed) || session !== observed.agent.session) return
    if (interactions.observe(event)) void actions.refresh()
  }))
  deps.owner.own(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (deps.owner.current() && deps.binding.isCurrent(observed) && agent === observed.agent) interactions.claimed(message)
  }))
  return actions
}
