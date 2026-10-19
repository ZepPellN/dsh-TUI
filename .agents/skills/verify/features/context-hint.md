# Manual Context Hint

Source entry points: `src/commands.ts`, `src/screens/chat/run-command.tsx`,
`src/dsh-adapter/context-hint/`, `src/dsh-adapter/oauth/summary-call.ts`.
This is #3 only, not automatic generation, Project editing or deletion.

## Launch and Doctor

Follow the parent skill with a fresh evidence directory. Every journey starts
with an empty isolated HOME and exact packed target, never a production grant
store. Only the external provider HTTP boundary is synthetic.

## Drive

Use the three `roundtrip` variants in the parent skill. All drive the normal
composer after the hydrated Sessions picker:

- `/hint enable` → read destination/content/storage disclosure → Esc: no grant,
  no request. A preexisting explicit deny is not weakened by confirmation.
  Repeat with no deny and confirm: exactly own read/write grants and Pending.
- Complete the synthetic main interaction, then `/hint refresh`: one hint HTTP
  request using the live route, bounded whole body without session log/system/
  tools/inventory. Actual storage contains latest cards, not raw prompt copies.
- `/hint view`: Session and Turn fields plus actual session/worktree identity.
  Esc returns; default/remapped shortcut toggles without losing unsent input.
  Empty configured shortcut leaves the command usable.
- Hold a second valid response while entering a draft and paging away from
  the transcript bottom: release it and compare the real visible row anchors
  and draft. Switch `/lang zh` and inspect the localized detail fields, then
  return to English before lifecycle actions.
- Failure variant: malformed JSON, 429, 503, connection loss, output overflow
  and deadline each make one attempt, retain Last Valid and show failure.
  Explicit retries each make one new attempt. A new process restores cards and
  failure with no new hint call.
- Fence variant: hold A, `/new` B, ordinary `/home` return to A, release old A.
  No late card is displayed or stored. Normal `/model` change is inherited by
  the next refresh; held responses across disable and `/exit` cannot write.
- Every process exits normally with terminal restoration, not forced cleanup
  masquerading as success.
- Command-only variant additionally disables, restarts the same session and
  enables again: retained applicable cards return without a new hint call;
  a failed explicit refresh still retains them as Last Valid.

## Evidence and Cleanup

Require `result.json`, matching `scenarios` flags for new runs, boundary bodies,
parsed phase screens/actions, actual stored cards, normal exit codes and
`run.json` with `cleaned:true`. Do not call failed historical slices accepted.
The retained synthetic source/prompt bodies are test evidence, not a product
archive. Cleanup removes only the named owned scratch; evidence survives.

Supplementary parser/identity/config/transport tests are in the parent skill.
`node --import tsx/esm scripts/verify-context-hint-storage.ts` also holds the
real grant-file writer lock, cancels pending consent, releases the lock and
checks that no late grant appears. It checks corrupt/explicit-deny stores and
subsequent exact-component confirmation without weakening global default-deny.
Remote Linux/macOS acceptance requires observed CI, not merely these recipes.
