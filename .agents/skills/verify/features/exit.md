# Exit normally and restore the terminal

A user exits with `/exit`, keeping resumable conversation while getting a
normal terminal back. Verification then removes only its own scratch instance.

## Sub-features

- `exit-command`: `/exit` returns process status zero in both PTYs.
- `exit-terminal`: cursor, normal buffer and input/output modes are restored.
- `exit-durable`: the resume marker and session files survive process exit.
- `exit-proof`: proof survives scoped verification teardown.

## How to get to it (user POV)

- Submit `/exit` from the idle chat composer after receiving a reply.

## Driving it with verify-packed-host

Preconditions:

- Fresh Launch/Doctor and the preceding mapped conversation are usable.

- **Exit.** `node scripts/verify-packed-host.mjs drive --evidence
  "$DSH_VERIFY_EVIDENCE"` types `/exit` then Enter in each chat. The actual PTY
  child must exit zero; `actions.json` records the keys and status.
- **Observe terminal.** The helper checks cursor show after hide, alternate
  screen exit after entry, the parser's normal buffer, and disabled mouse,
  bracketed-paste and synchronized-output modes at exit.
- **Observe persistence.** The first exit produces the normal resume marker;
  the resumed process must keep that same ID and history.
- **Teardown.** Run `node scripts/verify-packed-host.mjs cleanup --evidence
  "$DSH_VERIFY_EVIDENCE"`. Require `run.json` with `cleaned: true` and retained
  ANSI/actions/screens, `persisted-sessions/`, `tui-state/`, and `result.json`.

## Gotchas

- A harness SIGTERM is cleanup after failure, never a normal-exit pass.
- Cursor bytes somewhere near startup are insufficient; the last mode
  transition must be restoration and the parsed buffer must be normal.
- Ctrl+D, `/quit`, `/restart`, interrupt and crash recovery are not proved by
  this `/exit` recipe. Cleanup never removes evidence or the user's profile.
