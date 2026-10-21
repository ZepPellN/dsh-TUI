import type { Context } from '@deepseek-ai/cordis'
import type { TuiPluginStorage } from '../plugin-storage.js'
import { resolveHintProject, type HintProject } from './project.js'
import { t } from '../../i18n.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ChannelOwner } from '../channel/owner.js'
import type { ChannelBinding } from '../channel/binding.js'
import { liveSessionOffset, snapshotLiveSessionEvents } from '../compat/liveSession.js'
import { requestHint } from './request.js'
import type { HintResult } from './result.js'
import { cardApplicability, latestInteractionOffset } from './timeline.js'
import { hintViews, type HintView } from './views.js'
import { hintSelectionPreference, type HintSelection, type HintRoute, HintSelectionError } from './selection.js'
import { createHintInteractions } from './interactions.js'
import { confirmProject, deleteSharedProject, readSharedProject, updateProjectControls, type SharedProject } from './shared-project.js'
import type { ProjectCard } from './result.js'
import { deleteHintSession, isHintStorageFailure, readHintSession, writeHintSession } from './records.js'

export type HintDeleteScope = 'session' | 'project'

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
export function applyHintExtension(ctx: Context, deps: HintDependencies, storageConsented: () => boolean) {
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
  let paused = false
  let loading = true
  const interactions = createHintInteractions()
  let cards: HintResult | undefined
  let cardRoute: HintRoute | undefined
  let projectCard: ProjectCard | undefined
  let suggestion: { card: ProjectCard; base: SharedProject; reviewed: boolean; conflict: boolean; eventOffset: number } | undefined
  let cardOffset = 0
  let failed = false
  let stale = false
  let request: AbortController | undefined
  let revision = 0
  let snapshot: HintView = { enabled: false, paused: false, failed: false, stale: false }
  const listeners = new Set<() => void>()
  const publish = () => {
    snapshot = { enabled, paused, cards, failed, stale, model: modelDescription(), projectCard, suggestion }
    for (const listener of listeners) listener()
    deps.changed?.()
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
    try {
      const nextProject = await resolveHintProject(cwd)
      if (!current()) return
      let shared: SharedProject
      try {
        shared = await readSharedProject(storage, nextProject)
      } catch (error) {
        if (!current()) return
        // Unreadable optional data never blocks the main session and is never
        // repaired or cleared here; the user can still explicitly delete the
        // selected hint scope (which fails loudly if storage stays unreadable).
        project = nextProject
        enabled = false
        paused = false
        failed = true
        loading = false
        interactions.reset(liveSessionOffset(capture.agent.session), false, false)
        publish()
        deps.notify(t(isHintStorageFailure(error) ? 'hint-storage-read-failed' : 'hint-storage-invalid'))
        return
      }
      if (!current()) return
      let nextSelection: HintSelection | undefined
      try { nextSelection = await preference.read() } catch { /* Invalid preference fails closed on refresh. */ }
      if (!current()) return
      const nextEnabled = shared.enabled && storageConsented()
      let nextCards: HintResult | undefined
      let nextOffset = 0
      let nextCardRoute: HintRoute | undefined
      let nextFailed = false
      let nextStale = false
      if (nextEnabled) {
        const session = capture.agent.session
        try {
          const read = await readHintSession(storage, nextProject.id, session.id, liveSessionOffset(session))
          if (!current()) return
          if (read.status === 'ok') {
            if (cardApplicability(read.record.eventOffset, snapshotLiveSessionEvents(session)) === 'stale') {
              // A saved card from an earlier point of this timeline (work done
              // while paused/offline) is not the Last Valid Card for what is on
              // screen now; show a pending update instead of an outdated success.
              nextStale = true
            } else {
              nextCards = read.record.cards
              nextOffset = read.record.eventOffset
              nextCardRoute = read.record.route
              nextFailed = read.record.failed === true
            }
          } else if (read.status === 'corrupt') {
            nextFailed = true
            deps.notify(t('hint-storage-invalid'))
          }
        } catch (error) {
          if (!current()) return
          nextFailed = true
          deps.notify(t(isHintStorageFailure(error) ? 'hint-storage-read-failed' : 'hint-storage-invalid'))
        }
      }
      if (!current()) return
      project = nextProject
      selection = nextSelection
      projectCard = shared.card
      suggestion = undefined
      enabled = nextEnabled
      paused = nextEnabled && shared.paused === true
      loading = false
      interactions.reset(liveSessionOffset(capture.agent.session), enabled, paused)
      cards = nextCards
      cardOffset = nextOffset
      cardRoute = nextCardRoute
      failed = nextFailed
      stale = nextStale
      publish()
    } finally {
      // Failed optional restoration must not suppress the user's old recap.
      // A stale load must never settle a newer binding's restoration barrier.
      if (current() && loading) {
        loading = false
        publish()
      }
    }
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
    cardRoute = undefined
    projectCard = undefined
    suggestion = undefined
    failed = false
    stale = false
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
    enable: AsyncLocalStorage.bind(async (confirmedCurrent: () => boolean) => {
      request?.abort()
      const ticket = ++revision
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const target = await resolveHintProject(cwd)
      const current = () => confirmedCurrent() && deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture) && cwd === deps.cwd()
      if (!current()) return
      await updateProjectControls(storage, target, { enabled: true, paused: false }, current)
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
      suggestion = undefined
      stale = false
      const scenes = ctx.get('tuiScenes')
      if (scenes?.active?.id === 'context-hint') scenes.close()
      publish()
      if (target !== undefined) await updateProjectControls(storage, target, { enabled: false, paused: false },
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
      await updateProjectControls(storage, target, { paused: next }, () => deps.owner.current() && enabled && ticket === revision
        && deps.binding.isCurrent(capture) && cwd === deps.cwd() && project?.id === target.id)
    }),
    projectAction: AsyncLocalStorage.bind(async (action: string) => {
      const pending = suggestion
      const target = project
      if (!enabled || pending === undefined || target === undefined) { deps.notify(t('hint-project-no-suggestion')); return }
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const current = () => deps.owner.current() && enabled && suggestion === pending && project === target
        && deps.binding.isCurrent(capture) && deps.cwd() === cwd
        && latestInteractionOffset(snapshotLiveSessionEvents(capture.agent.session)) === pending.eventOffset
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
      if (!enabled || !storageConsented() || project === undefined) { deps.notify(t('hint-help')); return }
      request?.abort()
      suggestion = undefined
      stale = false
      publish()
      const controller = new AbortController()
      request = controller
      const capture = deps.binding.capture()
      const session = capture.agent.session
      // Anchor to the SETTLED INTERACTION, not the raw log length: the host can
      // append bookkeeping (e.g. a generated session/title) while this request
      // is in flight, which does not make the summarized interaction stale.
      const events = snapshotLiveSessionEvents(session)
      const eventOffset = latestInteractionOffset(events)
      const identity = project.id
      const target = project
      const cwd = deps.cwd()
      const route = destination()
      const selected = selection
      const ticket = revision
      const current = () => deps.owner.current() && enabled && storageConsented() && request === controller && !controller.signal.aborted
        && revision === ticket
        && deps.binding.isCurrent(capture) && deps.cwd() === cwd && project?.id === identity
        && latestInteractionOffset(snapshotLiveSessionEvents(session)) === eventOffset
      try {
        if (route === undefined || selected === undefined) throw new HintSelectionError('Invalid Summary Model preference')
        const base = await readSharedProject(storage, target)
        if (!current() || !base.enabled) return
        const result = await requestHint(ctx, {
          ...route, selection: selected, events,
          signal: AbortSignal.any([controller.signal, deps.owner.signal]),
        })
        if (!current()) return
        const latestCards = { session: result.session, turn: result.turn }
        await writeHintSession(storage, identity, session.id, { cards: latestCards, eventOffset, route }, current)
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
          deps.notify(error instanceof HintSelectionError ? t('hint-model-unavailable', { model: modelDescription() })
            : isHintStorageFailure(error) ? t('hint-storage-write-failed') : t('hint-update-failed'))
          if (cards !== undefined) {
            try {
              await writeHintSession(storage, identity, session.id, { cards, eventOffset: cardOffset, route: cardRoute, failed: true }, current)
            } catch { /* Last Valid remains visible even when storage itself failed. */ }
          }
        }
      } finally { if (request === controller) request = undefined }
    }),
    /** Identity shown to the host's deletion dialog before any write. */
    scopeDescription: () => ({
      project: project?.id ?? '',
      worktree: project?.worktree ?? '',
      session: String(deps.binding.agent.session.id),
    }),
    /** Scoped deletion with the same invalidation fence as every other writer.
     * Aborting and bumping the revision first means a held summary, failure
     * marker or late project confirmation can never recreate what was removed. */
    deleteScope: AsyncLocalStorage.bind(async (scope: HintDeleteScope) => {
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const sessionId = capture.agent.session.id
      const target = project
      request?.abort()
      const ticket = ++revision
      const current = () => deps.owner.current() && ticket === revision && deps.binding.isCurrent(capture)
        && cwd === deps.cwd() && (scope === 'session' || project === target)
      const scenes = ctx.get('tuiScenes')
      if (scenes?.active?.id === 'context-hint') scenes.close()
      try {
        if (scope === 'session') {
          await deleteHintSession(storage, sessionId, current)
          if (!current()) return
          cards = undefined
          cardOffset = 0
          cardRoute = undefined
          failed = false
          suggestion = undefined
          publish()
          deps.notify(t('hint-delete-session-done'))
          return
        }
        if (target === undefined) { deps.notify(t('hint-help')); return }
        const result = await deleteSharedProject(storage, target, current)
        if (!current()) return
        enabled = false
        paused = false
        loading = false
        interactions.reset(liveSessionOffset(capture.agent.session), false, false)
        projectCard = undefined
        suggestion = undefined
        publish()
        deps.notify(t(result.deleted ? 'hint-delete-project-done' : 'hint-delete-empty'))
      } catch (error) {
        if (!current()) return
        deps.notify(t(isHintStorageFailure(error) ? 'hint-storage-write-failed' : 'hint-delete-failed'))
      }
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
