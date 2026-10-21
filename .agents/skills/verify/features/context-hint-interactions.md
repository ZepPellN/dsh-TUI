# Settled Context Hint and recap coexistence (#5)

Own entry points: `/hint enable`, `pause`, `resume`, `disable`, `refresh`,
`retry`, `view`, and manual `/recap`. Source: `context-hint/interactions.ts`
plus small extension/host/channel and `use-side-panels` connections.
No independent model selection or shared Project editing is part of this map.

## Launch / Doctor / Drive

Use the parent skill with an empty run-owned profile, exact packed host,
synthetic loopback credentials and a new external evidence directory:

```sh
node scripts/verify-packed-host.mjs roundtrip --hint-automatic --evidence "$DSH_VERIFY_EVIDENCE"
```

Do not compile while Launch snapshots the package. This reuses the existing
real PTY/loader/session driver; only external Messages HTTP bytes are fixtures.
Read-only `glob` calls run through the real host in its owned empty workspace.

## Observe

- Before opt-in, complete human work: zero hint requests. Enable disclosure
  and opening/restoring controls do not summarize history.
- One live human turn, multiple actual tool calls and streamed chunks: one
  automatic request, with actual tool results in bounded selected input.
- Hold that automatic response, page away from bottom and type an unsent
  draft; release it. Compare real viewport anchors and composer focus/input.
- Pause prevents new automatic work, while explicit refresh/retry still work.
  Resume observes only future turns; paused/restored backlog is not replayed.
- Fail/cancel after tool work: actual Turn Card outcome and failures match
  the durable host outcome. Invalid JSON, 503 and deadline retain Last Valid
  and mark failure; explicit retries alone add requests, with boundary counts.
- Disable with a held automatic result: no late card or disk commit. Old
  automatic recap returns under the unchanged preference; re-enable on the
  same session suppresses/cancels it. Manual recap remains available.
- Restart/restore applicable cards and paused state without new hint/recap
  work, then resume and complete fresh work. Navigation is never a trigger.
- With hints disabled and grants retained, corrupt only the run-owned optional
  storage namespace. Repeated real restarts must still show automatic recap,
  without hint generation, storage repair or recap-preference changes.

## Evidence / Cleanup

Require successful assertions, `result.json`, actual `provider-requests.json`,
action/key/exit log, phase screens and ANSI, copied admitted latest-card
storage and original sessions. Require normal exit/terminal restoration and
`run.json.cleaned:true` with scratch absent and evidence retained. Failures
remain failures; setup success alone does not satisfy this journey.

The public observation supplement is
`node --import tsx/esm scripts/verify-context-hint-interactions.ts`;
`verify-auto-recap.tsx` supplements same-session cancellation/manual behavior
through real Chat/xterm, not as a substitute for the packed provider counts.
Remote Linux/macOS runs are proven only by actual CI results.

After integrating #6, also run its [Shared Project journey](context-hint-project.md).
Its connection checks use pause/resume/disable/enable from two real processes:
each control change advances the current revision, preserves confirmed content,
and makes no hint request. Core shared coordination remains owned by #6.
