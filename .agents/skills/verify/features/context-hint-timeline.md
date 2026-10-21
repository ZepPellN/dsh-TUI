# Timeline-valid Context Hint (#7)

Own entry points: ordinary `/new`, `/home`, `/resume`, `/rewind`, `/fork`,
`/hint view`, `/hint refresh`, `/hint retry` plus the packed host's real session
lifecycle. Source: `src/dsh-adapter/context-hint/timeline.ts` plus the restore
decision in `extension.ts`. No new session/Project truth store and no second
generator: the accepted #3/#5/#6 modules still own generation, interaction
counting and shared Project confirmation.

## Launch / Doctor / Drive

Use the parent skill with an empty run-owned profile, exact packed host,
synthetic loopback credentials and a new external evidence directory:

```sh
node scripts/verify-packed-host.mjs roundtrip --hint-timeline --evidence "$DSH_VERIFY_EVIDENCE"
```

Do not compile while Launch snapshots the package. This reuses the existing
real PTY/loader/session driver; only external Messages HTTP bytes are fixtures.
The journey drives two real processes in the same run-owned workspace: the
original session, then a `--resume` of the fork created by ordinary `/fork`.

## Observe

- Enable, then complete two settled human interactions: one automatic summary
  each. Generate and explicitly confirm a Project Suggestion so a shared card
  exists before navigation.
- `/fork` reports a real new session id, leaves the original card visible,
  makes no request and stores no Session/Turn card for the detached copy.
- `/tree` + Ctrl+F at the previous user message adopts a real child session
  (ordinary session-tree fork): it starts Pending, never with the parent's
  completed card, keeps the confirmed Project Card, and makes no request. The
  child's own session id is read from `/hint view`. (The detached `/fork` copy
  is not resumed here: this target host's v4 persistence validator rejects its
  seed log — "current-generation delivery marker names the wrong Session",
  because `/fork` deliberately omits `parentSession` — a pre-existing
  host/product limitation outside card-timeline validity, not something this
  journey may mask.)
- `/rewind` through the picker adopts a new child session: the abandoned
  timeline's Session/Turn card disappears (Pending update) while the confirmed
  Project Card stays visible; no request is made.
- On the rewound child, a failed automatic update shows Pending + Update failed
  and never the abandoned card as Last Valid; only the explicit `/hint retry`
  adds one request and owns a new session card.
- Hold one manual response, then `/new` twice in quick succession and release:
  no late status appears, no Session/Turn record is written for either new
  session, the original records are byte-unchanged, and the request count grows
  only for the explicit refresh.
- Inspect `/hint view` in the newest session: shared Project Card present, no
  other session's progress.
- Resume that adopted fork in a second real process: Pending update (never the
  parent's completed status), zero hint requests during restore/view, Project
  context visible, and exactly one automatic summary after its first real
  interaction.
- Pause the fork, complete one more real interaction (no summary request), then
  restart that session in a third real process: the saved card predates newer
  work, so it is shown as `Pending update (timeline changed)` — never the old
  completed status as Last Valid, and not as a same-timeline failure. Detail
  keeps the shared Project Card. No hint request is made.
- Stored admitted state ends with three distinct session records (original,
  rewound child, fork) and one confirmed Project card whose decisions are
  unchanged by rewind/fork.

The applicability/restore seam is also asserted directly by
`node --import tsx/esm scripts/verify-context-hint-timeline.ts` (pure module
checks; not a substitute for the packed journey).

## Evidence / Cleanup

Require `result.json` with `feature: context-hint-timeline`, actual
`provider-requests.json`, action/key/exit log, phase screens and ANSI,
`timeline-original.json` / `timeline-fork.json` (session records and confirmed
Project card), normal exit codes with terminal restoration for both PTYs, and
`run.json.cleaned:true` with scratch absent and evidence retained. Failures
remain failures; setup success does not satisfy this journey.

Remote Linux/macOS acceptance requires observed CI, not only this recipe.
