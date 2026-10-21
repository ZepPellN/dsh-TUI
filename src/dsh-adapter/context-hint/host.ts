/** Package-internal host composition. Admission authority never crosses into the extension. */
import type { Context } from '@deepseek-ai/cordis'
import { adapterRuntimeFor } from '../../adapter/kernel/runtime-context.js'
import { getHostAdmission } from '../plugin-host.js'
import { t } from '../../i18n.js'
import { consentHintStorage, HINT_MANIFEST, HINT_READ_MANIFEST, hintStorageGranted } from './consent.js'
import { applyHintExtension, type HintDependencies } from './extension.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { TuiDialogConfirmRequest, TuiDialogSelectRequest } from '../dialogs.js'
import { logMouseDebug } from '../../utils/debug.js'
import { hintSelectionFromCommand, hintSelectionPreference, listHintModels, resolveHintRoute, HintSelectionError, type HintSelection } from './selection.js'

export function createContextHintHost(ctx: Context, deps: HintDependencies) {
  if (typeof ctx.plugin !== 'function' || ctx.get('tuiPluginHost') === undefined) return { suppressesRecap: false, run() { deps.notify(t('hint-unavailable')) } }
  const runtime = adapterRuntimeFor(ctx)
  let restoring = hintStorageGranted(runtime)
  let extension: ReturnType<typeof applyHintExtension> | undefined
  let mounting: Promise<void> | undefined
  let consent: AbortController | undefined
  let confirm: ((request: TuiDialogConfirmRequest) => Promise<boolean>) | undefined
  let select: ((request: TuiDialogSelectRequest) => Promise<string | undefined>) | undefined
  // A real activation may ask for consent without possessing storage grants.
  // Bind only this private callback to its activation's async context; no
  // context, admission capability or grant editor is published to plugins.
  const control = ctx.plugin({ name: 'dsh-tui-context-hint-consent', apply(candidate: Context) {
    confirm = AsyncLocalStorage.bind((request: TuiDialogConfirmRequest) => {
      deps.owner.assertActive()
      const dialogs = candidate.get('tuiDialogs')
      if (dialogs === undefined) throw new Error('Context Hint dialogs unavailable')
      return dialogs.confirm(request)
    })
    select = AsyncLocalStorage.bind((request: TuiDialogSelectRequest) => {
      deps.owner.assertActive()
      const dialogs = candidate.get('tuiDialogs')
      if (dialogs === undefined) throw new Error('Context Hint dialogs unavailable')
      return dialogs.select(request)
    })
  } })
  deps.owner.own(() => { confirm = undefined; select = undefined; consent?.abort(); void control.dispose() })
  const mount = (): Promise<void> => {
    if (extension !== undefined) return Promise.resolve()
    if (mounting !== undefined) return mounting
    const fiber = ctx.plugin({ name: 'dsh-tui-context-hint', apply(candidate: Context) {
      deps.owner.assertActive()
      const admission = getHostAdmission(candidate.get('tuiPluginHost'))
      if (admission === undefined) throw new Error('Context Hint admission unavailable')
      admission.admit(candidate, HINT_MANIFEST, { source: 'packaged:context-hint' })
      extension = applyHintExtension(candidate, deps, () => hintStorageGranted(runtime))
    } })
    deps.owner.own(() => { extension = undefined; void fiber.dispose() })
    mounting = fiber.await().then(async () => { await extension!.load() }).finally(() => { mounting = undefined })
    return mounting
  }
  if (ctx.get('tuiPluginHost') !== undefined && hintStorageGranted(runtime)) {
    void mount().catch(() => { if (deps.owner.current()) deps.notify(t('hint-unavailable')) })
  }
  const run = async (input: string) => {
    const action = input.trim()
    logMouseDebug('context-hint command', { action: action === 'enable' || action === 'disable' ? action : 'other' })
    if (action === 'model' || action.startsWith('model ')) {
      if (mounting !== undefined) await mounting
      if (extension === undefined) { deps.notify(t('hint-help')); return }
      let chosen = action.slice('model'.length).trim()
      if (consent !== undefined) return
      const capture = deps.binding.capture()
      const cwd = deps.cwd()
      const controller = new AbortController()
      consent = controller
      const signal = AbortSignal.any([controller.signal, deps.owner.signal])
      const unsubscribe = deps.subscribe(() => { if (!deps.binding.isCurrent(capture) || cwd !== deps.cwd()) controller.abort() })
      try {
        await control.await()
        if (chosen === '') {
          const models = await listHintModels(ctx.get('llm'))
          if (signal.aborted) return
          chosen = await select?.({ title: extension.modelDescription(), signal,
            options: [{ id: 'inherit', label: t('hint-model-inherit'), description: t('hint-model-available') },
              ...models.slice(0, 99).map(route => ({ id: `${route.provider}/${route.model}`, label: `${route.provider}/${route.model}` }))],
          }) ?? ''
          if (chosen === '' || signal.aborted) return
        }
        const next = hintSelectionFromCommand(chosen)
        const route = await resolveHintRoute(ctx.get('llm'), next, deps.route())
        if (signal.aborted) return
        const accepted = await confirm?.({ title: t('hint-model-consent-title'),
          message: t('hint-consent', { route: `${route.provider}/${route.model}` }), signal })
        if (accepted && !signal.aborted && deps.binding.isCurrent(capture) && cwd === deps.cwd()) await extension.selectModel(next)
      } finally { unsubscribe(); if (consent === controller) consent = undefined }
    } else if (action === 'enable') {
      if (consent !== undefined) return
      const restoringConsent = !hintStorageGranted(runtime)
      const captureCwd = deps.cwd()
      const capture = deps.binding.capture()
      const controller = new AbortController()
      consent = controller
      const signal = AbortSignal.any([controller.signal, deps.owner.signal])
      const current = () => !signal.aborted && deps.owner.current() && deps.binding.isCurrent(capture) && captureCwd === deps.cwd()
      const unsubscribe = deps.subscribe(() => { if (!deps.binding.isCurrent(capture) || captureCwd !== deps.cwd()) controller.abort() })
      try {
        if (!restoringConsent) await mount()
        if (!current()) return
        const route = extension === undefined ? deps.route() : extension.destination()
        if (route === undefined) throw new HintSelectionError('Invalid Summary Model preference')
        await control.await()
        logMouseDebug('context-hint consent activation', { ready: confirm !== undefined })
        const accepted = await confirm?.({
          title: t('hint-consent-title'), message: t('hint-consent', { route: `${route.provider}/${route.model}` }), signal,
        })
        logMouseDebug('context-hint consent answer', { accepted: accepted === true })
        if (!accepted || !current()) return
        if (restoringConsent) {
          // Persist only read access until the actual saved destination is
          // accepted. Old enabled:true can never auto-mount with this grant,
          // even if storage is unwritable or this process is interrupted.
          await consentHintStorage(runtime, signal, 'read-only')
          if (!current()) return
          await extension?.load()
          if (!current()) return
          let read: (() => Promise<HintSelection>) | undefined
          const reader = ctx.plugin({ name: 'dsh-tui-context-hint-consent-reader', apply(candidate: Context) {
            deps.owner.assertActive()
            const admission = getHostAdmission(candidate.get('tuiPluginHost'))
            if (admission === undefined) throw new Error('Context Hint admission unavailable')
            admission.admit(candidate, HINT_READ_MANIFEST, { source: 'packaged:context-hint' })
            const preference = hintSelectionPreference(candidate.get('tuiPluginStorage')!.open(candidate))
            read = AsyncLocalStorage.bind(() => preference.read())
          } })
          let saved: HintSelection
          try { await reader.await(); saved = await read!() } finally { await reader.dispose() }
          if (!current()) return
          const actual = await resolveHintRoute(ctx.get('llm'), saved, deps.route())
          if (!current()) return
          if (actual.provider !== route.provider || actual.model !== route.model) {
            const actualAccepted = await confirm?.({
              title: t('hint-consent-title'), message: t('hint-consent', { route: `${actual.provider}/${actual.model}` }), signal,
            })
            if (!actualAccepted || !current()) return
          }
          await consentHintStorage(runtime, signal)
        }
        if (!current()) return
        await mount()
        if (current()) await extension!.enable(current)
      } finally { unsubscribe(); if (consent === controller) consent = undefined }
    } else if (action === 'disable') {
      consent?.abort()
      restoring = false
      await extension?.disable()
      deps.changed?.()
    } else if (action === 'pause' || action === 'resume') {
      if (extension === undefined) { deps.notify(t('hint-help')); return }
      await extension.setPaused(action === 'pause')
    } else if (action.startsWith('project ')) {
      if (extension === undefined) { deps.notify(t('hint-help')); return }
      await extension.projectAction(action.slice('project '.length))
    } else if (action === 'refresh' || action === 'retry') {
      if (extension === undefined) { deps.notify(t('hint-help')); return }
      await extension.refresh()
    } else if (action === '' || action === 'view' || action === 'toggle') {
      if (extension === undefined) deps.notify(t('hint-help'))
      else await extension.toggle()
    } else {
      deps.notify(t('hint-help'))
    }
  }
  return {
    // Resolve opt-in before allowing the old on-open recap. Restore itself
    // must not race a duplicate automatic call on the same session.
    get suppressesRecap() { return extension?.suppressesRecap ?? restoring },
    // The host owns asynchronous errors as well as cancellation. Returning a
    // pending UI promise would make its settlement touch an expired UI lease
    // when /exit cancels a held summary request.
    run(input: string) {
      void run(input).catch(error => { if (deps.owner.current()) deps.notify(error instanceof HintSelectionError
        ? t('hint-model-unavailable', { model: extension?.modelDescription() ?? '' }) : t('hint-unavailable')) })
    },
  }
}
