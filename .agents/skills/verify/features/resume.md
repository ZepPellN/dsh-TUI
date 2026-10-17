# Resume a saved session by ID

A user restarts the installed TUI with an explicit saved ID, sees prior
conversation and continues the same durable session.

## Sub-features

- `resume-history`: a new process renders the previous assistant reply.
- `resume-continue`: the provider receives restored history and new user input.
- `resume-identity`: the normal saved resume marker remains the same ID.

## How to get to it (user POV)

- Run `dsh-tui --resume` followed by the saved session ID. The driver obtains
  that ID from the normal resume marker produced by the first process.

## Driving it with verify-packed-host

Preconditions:

- The same Drive's new-chat journey received a real adapter reply and exited
  normally. No history is injected or copied into the test profile.

- **Restart.** Run `node scripts/verify-packed-host.mjs drive --evidence
  "$DSH_VERIFY_EVIDENCE"` after fresh Launch/Doctor. Its second PTY invokes the
  packed launcher with `--resume` and `session-id.txt`'s ID.
- **Observe history.** `restored-history.txt` must show `DSH_VERIFY_FIRST_OK`
  before the second prompt is typed.
- **Continue.** The helper submits `VERIFY_SECOND: continue our conversation`.
  `restored-answer.txt` must show `DSH_VERIFY_RESTORED_OK`.
- **Second view.** `provider-requests.json` must contain both the first
  assistant reply and the second user input in the continuation request.
  `result.json` and the retained `tui-state/resume.txt` must agree on the ID.

## Gotchas

- Restart is a separate process against actual saved files; an in-memory
  switch or direct Session setter is not equivalent proof.
- A missing first conversation is a failed precondition, not permission to
  weaken the history assertion or fabricate a resume marker.
- Bare `--resume`, `-c`/`--continue`, `/resume`, `/home`, `/agentview`, `/bg` and
  the session-list button are not exercised by this explicit-ID recipe.
