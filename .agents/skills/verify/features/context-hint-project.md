# Shared confirmed Project Card (#6)

Entry: `/hint refresh`, `/hint view` or Alt+O, then `/hint project review`,
`/hint project confirm` or `/hint project reject`. Only explicit reviewed
confirmation writes Project content. Generation/opening never approves.

Use the parent Launch/Doctor/Evidence/Cleanup contract. From a compiled checkout:

```sh
node scripts/verify-packed-host.mjs roundtrip --context-hint --hint-project --evidence /absolute/run-owned/evidence
node --import tsx/esm scripts/verify-context-hint-shared-project.ts
```

The first command reuses the real tarball/host/PTY driver, not a source host or
setter. It creates one synthetic Git repository, a linked worktree, and a local
independent clone with the same synthetic remote. Two simultaneous real TUI
processes use **the same empty isolated data HOME/profile**, not separate stores.
No private repository or real model service is used. The external native
Messages HTTP fixture returns both Session/Turn and optional Project Suggestion.

Drive observes empty confirmed content, pending suggestion, view without write,
explicit reject, two processes reviewing the same base, racing confirmations,
exactly one durable success and one visible conflict. Repeated confirm cannot
silently rebase. The loser explicitly reviews/rejects the stale replacement,
requests a new preserving proposal, reviews and confirms it. Both decisions then
appear in both linked worktrees while Session/Turn stay isolated. The clone is
empty. Restart restores latest confirmed Project and own Session without a call
or pending-suggestion archive. Every process exits normally and restores modes.

Retain `project-{before-race,after-race,final}.json`, per-process ANSI/screens,
`actions.json`, boundary requests and `result.json`. Require passed=true,
sharedDataHome=true, linkedWorktrees=true and independentClone=true; inspect the
action/result/persistence, not just these flags. Cleanup removes only run scratch
and must retain proof (`run.json` cleaned=true, scratch absent).

The supplement uses genuine admitted storage and explicit synthetic consent to
check schema bounds, conflict, unknown-control preservation, disable/re-enable
revision invalidation, cancelled commit/lock cleanup and grant revocation. It is
not a replacement for the real two-process acceptance above.

Protocol: normal storage handles own all card bytes, quotas, grants and final
commit fence. A fixed `context-hint-coordination.lock` under DATA_DIR is only a
transient PID lock around fresh read/check/write. Every Project writer must use
`updateProjectControls`, `confirmProject` or `deleteSharedProject` in
`shared-project.ts`; pause/resume/delete/migration must join it. No model/human waits inside locks.
No storage CAS/public authority is added. This is cooperative single-host
coordination, not protection from an older/uncooperative same-component writer,
network filesystem guarantees, or power-loss durability. Reopen explicitly to
reload another worktree's latest state; there is no watcher/push synchronization.
Pending suggestions are session/timeline-local memory and disappear on refresh,
switch/disable/restart; only the latest confirmed Project persists.

Linux/macOS CI must execute this mapped command; local macOS proof is not a
remote Linux/macOS CI result. No real/paid provider behavior is claimed.
