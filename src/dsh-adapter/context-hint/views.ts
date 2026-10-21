import type { TuiSceneProps } from '../scenes.js'
import type { TuiStatusViewProps } from '../status.js'
import type { HintResult, ProjectCard } from './result.js'
import type { ScrollBoxHandle } from '../../ui.js'
import { cleanRenderText } from '../sanitize.js'
import { parseShortcutCombo, matchShortcut } from '../shortcuts.js'
import { t } from '../../i18n.js'

export interface HintView {
  enabled: boolean
  paused: boolean
  cards?: HintResult
  failed: boolean
  model?: string
  projectCard?: ProjectCard
  suggestion?: { card: ProjectCard; reviewed: boolean; conflict: boolean }
}

/** Plain, bounded display data; host React/hooks only, never Markdown or ANSI. */
export function hintViews(read: () => HintView, subscribe: (listener: () => void) => () => void,
  identity: () => { project: string; worktree: string; session: string }, shortcut: string) {
  function Compact({ React, ui }: TuiStatusViewProps) {
    const view = React.useSyncExternalStore(subscribe, read)
    const content = view.cards === undefined ? t('hint-pending')
      : t('hint-compact', { status: view.cards.session.status, next: view.cards.session.next })
    return view.enabled ? React.createElement(ui.Text, { dimColor: true, wrap: 'truncate-end' },
      `${view.paused ? `${t('hint-paused')} · ` : ''}${view.failed ? `${t('hint-failed')} · ` : ''}${content}`
        + (view.suggestion === undefined ? '' : ` · ${t('hint-project-pending')}`)) : null
  }
  function Detail({ React, ui, close }: TuiSceneProps) {
    const view = React.useSyncExternalStore(subscribe, read)
    const { rows, columns } = ui.useTerminalSize()
    const scroll = React.useRef<ScrollBoxHandle | null>(null)
    const combo = parseShortcutCombo(shortcut)
    ui.useInput((input, key, event) => {
      event.stopImmediatePropagation()
      if (key.escape || (key.ctrl && input === 'c') || (combo !== undefined && matchShortcut(combo, input, key))) close()
      else if (key.upArrow) scroll.current?.scrollBy(-1)
      else if (key.downArrow) scroll.current?.scrollBy(1)
      else if (key.pageUp) scroll.current?.scrollBy(-Math.max(1, rows - 6))
      else if (key.pageDown) scroll.current?.scrollBy(Math.max(1, rows - 6))
      else if (key.home) scroll.current?.scrollTo(0)
      else if (key.end) scroll.current?.scrollToBottom()
    })
    const owner = identity()
    const e = React.createElement
    const line = (label: string, value: string | readonly string[]) => e(ui.Text, { key: label },
      `${label}: ${typeof value === 'string' ? value : value.length === 0 ? '—' : value.join(' · ')}`)
    const card = view.cards
    return e(ui.Box, { flexDirection: 'column', height: Math.max(3, rows), paddingX: 1,
      onWheel: event => { scroll.current?.scrollBy(event.deltaY); event.stopPropagation() } },
      e(ui.Text, { bold: true }, t('hint-detail-title')),
      e(ui.ScrollBox, { ref: scroll, flexGrow: 1, flexShrink: 1 },
        e(ui.Box, { flexDirection: 'column' },
          line(t('hint-project'), cleanRenderText(owner.project, Math.max(8, columns - 12))),
          line(t('hint-worktree'), cleanRenderText(owner.worktree, Math.max(8, columns - 12))),
          line(t('hint-session'), cleanRenderText(owner.session, 80)),
          view.model === undefined ? null : e(ui.Text, { key: 'summary-model' }, view.model),
          view.failed ? e(ui.Text, { color: 'warning' }, t('hint-failed')) : null,
          view.paused ? e(ui.Text, { dimColor: true }, t('hint-paused')) : null,
          e(ui.Text, { bold: true }, t('hint-project-card')),
          ...(view.projectCard === undefined ? [e(ui.Text, { key: 'project-empty' }, t('hint-project-empty'))] : [
            line(t('hint-project-goal'), view.projectCard.goal), line(t('hint-project-constraints'), view.projectCard.constraints),
            line(t('hint-project-decisions'), view.projectCard.decisions),
          ]),
          ...(view.suggestion === undefined ? [] : [
            e(ui.Text, { key: 'suggestion', bold: true }, t('hint-project-suggestion')),
            line(t('hint-proposed-goal'), view.suggestion.card.goal),
            line(t('hint-proposed-constraints'), view.suggestion.card.constraints), line(t('hint-proposed-decisions'), view.suggestion.card.decisions),
            e(ui.Text, { key: 'review', color: view.suggestion.conflict ? 'warning' : undefined },
              t(view.suggestion.conflict ? 'hint-project-conflict' : view.suggestion.reviewed ? 'hint-project-reviewed' : 'hint-project-review-required')),
            e(ui.Text, { key: 'project-controls', dimColor: true }, t('hint-project-controls')),
          ]),
          e(ui.Text, { bold: true }, t('hint-session-card')),
          ...(card === undefined ? [e(ui.Text, { key: 'pending' }, t('hint-pending'))] : [
            line(t('hint-goal'), card.session.goal), line(t('hint-status'), card.session.status),
            line(t('hint-blockers'), card.session.blockers), line(t('hint-next'), card.session.next),
            e(ui.Text, { key: 'turn', bold: true }, t('hint-turn-card')),
            line(t('hint-completed'), card.turn.completed), line(t('hint-findings'), card.turn.findings),
            line(t('hint-verification'), card.turn.verification), line(t('hint-failures'), card.turn.failures),
            line(t('hint-outcome'), card.turn.outcome === 'completed' ? t('hint-outcome-completed')
              : card.turn.outcome === 'failed' ? t('hint-outcome-failed') : t('hint-outcome-cancelled')),
          ]),
        )),
      e(ui.Text, { dimColor: true }, t('hint-detail-controls')),
    )
  }
  return { Compact, Detail }
}
