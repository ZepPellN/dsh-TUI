/** Package-internal host composition. Admission authority never crosses into the extension. */
import type { Context } from '@deepseek-ai/cordis'
import { adapterRuntimeFor } from '../../adapter/kernel/runtime-context.js'
import { getHostAdmission } from '../plugin-host.js'
import { t } from '../../i18n.js'
import { consentHintStorage, HINT_MANIFEST, hintStorageGranted } from './consent.js'
import { applyHintExtension, type HintDependencies } from './extension.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { TuiDialogConfirmRequest, TuiDialogSelectRequest } from '../dialogs.js'
import { logMouseDebug } from '../../utils/debug.js'
import { hintSelectionFromCommand, listHintModels, resolveHintRoute, HintSelectionError } from './selection.js'

export function createContextHintHost(ctx: Context, deps: HintDependencies) {
  if (typeof ctx.plugin !== 'function' || ctx.get('tuiPluginHost') === undefined) return { run() { deps.notify(t('hint-unavailable')) } }
  const runtime = adapterRuntimeFor(ctx)
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
      extension = applyHintExtension(candidate, deps)
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
      if (!restoringConsent) await mount()
      const captureCwd = deps.cwd()
      const capture = deps.binding.capture()
      const route = extension === undefined ? deps.route() : extension.destination()
      if (route === undefined) throw new HintSelectionError('Invalid Summary Model preference')
      const controller = new AbortController()
      consent = controller
      const signal = AbortSignal.any([controller.signal, deps.owner.signal])
      const unsubscribe = deps.subscribe(() => { if (!deps.binding.isCurrent(capture) || captureCwd !== deps.cwd()) controller.abort() })
      try {
        await control.await()
        logMouseDebug('context-hint consent activation', { ready: confirm !== undefined })
        const accepted = await confirm?.({
          title: t('hint-consent-title'), message: t('hint-consent', { route: `${route.provider}/${route.model}` }), signal,
        })
        logMouseDebug('context-hint consent answer', { accepted: accepted === true })
        if (!accepted || signal.aborted || !deps.binding.isCurrent(capture) || captureCwd !== deps.cwd()) return
        await consentHintStorage(runtime, signal)
        await mount()
        // Restored storage may also contain enabled:true. A renewed grant is
        // not consent to that saved destination; cancellation must leave the
        // feature disabled, including after restart.
        if (restoringConsent) await extension!.disable()
        // Storage consent preceded admission, so the first dialog may have
        // inherited the main route while storage already held an explicit
        // Summary Model. Enabling still requires disclosure of that actual
        // destination; cancelling it keeps the grant but not generation.
        const actual = extension!.destination()
        if (actual === undefined) throw new HintSelectionError('Invalid Summary Model preference')
        if (actual.provider !== route.provider || actual.model !== route.model) {
          const actualAccepted = await confirm?.({
            title: t('hint-consent-title'), message: t('hint-consent', { route: `${actual.provider}/${actual.model}` }), signal,
          })
          if (!actualAccepted) return
        }
        if (!signal.aborted && deps.binding.isCurrent(capture) && captureCwd === deps.cwd()) await extension!.enable()
      } finally { unsubscribe(); if (consent === controller) consent = undefined }
    } else if (action === 'disable') {
      consent?.abort()
      await extension?.disable()
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
    // The host owns asynchronous errors as well as cancellation. Returning a
    // pending UI promise would make its settlement touch an expired UI lease
    // when /exit cancels a held summary request.
    run(input: string) {
      void run(input).catch(error => { if (deps.owner.current()) deps.notify(error instanceof HintSelectionError
        ? t('hint-model-unavailable', { model: extension?.modelDescription() ?? '' }) : t('hint-unavailable')) })
    },
  }
}
