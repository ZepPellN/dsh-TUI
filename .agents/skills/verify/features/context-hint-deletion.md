# Scoped hint deletion and storage recovery (#8)

Entry: `/hint delete` (ordinary TUI, scope picker + confirmation), or
`/hint delete session` / `/hint delete project` (explicit scope, still
confirmed). Source: `src/dsh-adapter/context-hint/{host,extension,records,
shared-project}.ts`, `src/commands.ts` and `src/i18n.ts`. Scope: deleting
selected hint data and surviving storage faults; it does not delete host
sessions, project files or credentials, and does not add another store.

Run a new `roundtrip --hint-deletion --evidence /absolute/owned/evidence` using
the parent skill's Launch/Doctor/Cleanup rules. The package snapshot, exact
host, loader, two real linked Git worktrees, PTY TUI, sessions and admitted
storage are real. Only external Messages HTTP bytes, credentials and the
run-owned fault injection are synthetic.

## Drive

The journey creates one synthetic Git repository plus a linked worktree and a
project file, then drives:

- A first process creates two sessions and confirms one shared Project
  Suggestion. Hold a real summary response, then `/hint delete`: the picker must
  name both scopes and disclose that shared Project deletion affects every
  linked worktree. Choose the session scope (default), confirm, and release the
  old response. Only the current session envelope may disappear; the other
  session, Project Card, authoritative transcript, project file and grants stay
  unchanged. A later explicit `/hint refresh` must save a new latest card and
  never resurrect the released `LATE_WRONG_HINT`.
- A second process in the linked worktree sees the shared confirmed card, then
  `/hint delete` → Down → Enter: the confirm must repeat the linked-worktree
  impact and the preserved data. After confirmation the Project envelope (card
  plus opt-in/pause controls) is gone while both per-session cards remain.
- Restart the first session: deleted shared data must not return and enable
  must not be implied. Explicit `/hint enable` restores the session card but
  shows empty confirmed Project content; an explicit refresh saves normally.
- Controlled fault in the same run-owned profile: make only
  `~/.dsh-tui/plugin-storage` unwritable while the TUI runs. `/hint delete
  session` must report a visible storage write failure, keep the applicable
  card and storage bytes unchanged, and the main model turn must still work.
  Clear the fault and repeat: deletion succeeds and only that session envelope
  is removed.
- Controlled corruption: back up the run-owned namespace, overwrite it with
  synthetic invalid bytes, restart with `--resume`. The TUI must report
  unreadable optional storage, show no cards, keep the corrupt bytes untouched
  and still answer a normal main turn. Restore the run-owned bytes afterwards.

## Evidence / Cleanup

Retain scope/confirm screens, action log, ANSI, both linked-worktree processes,
`provider-requests.json`, `deletion-before-session-delete.json`,
`deletion-after-project-delete.json`, `deletion-after-fault.json`,
`deletion-corrupt-bytes.txt`, transcript hashes, grant-file comparison and
`result.json` with `passed:true` plus the scenario flags. Cleanup removes only
the owned `/tmp/dsh-packed-*` scratch; evidence and the copied session/TUI state
survive (`run.json.cleaned:true`, scratch absent).

Supplement: `node --import tsx/esm scripts/verify-context-hint-deletion.ts`
uses the real admitted namespace and real writer lock for read-time validation,
scoped deletion, invalidated-deletion fencing, coordinated Project deletion,
corruption/unwritable faults and key/byte capacity boundaries. It is not a
replacement for the packed PTY journey. Linux/macOS execution is proven only by
actual CI results; no real/paid provider behavior is claimed.
