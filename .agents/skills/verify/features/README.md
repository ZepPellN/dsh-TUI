# dsh-TUI verification map

This map covers #2's real packed-host user paths, #3's manual hints, #5's
settled interactions, #6's shared Project and #8's scoped deletion/storage
recovery. It is
not an assertion that all TUI features or alternate entry points are covered.

## Baseline preconditions

- Complete Launch and Doctor from `../SKILL.md` with a fresh evidence directory.
- Use only the instance in that directory's `run.json`, never the installed
  user CLI/profile. The exact host is `0.2.1-rc.2`, with no exemption.
- The first journey starts with no sessions or credentials. Only the loopback
  Messages fixture supplies a model response, with a synthetic key.

## Driving conventions

- `node scripts/verify-packed-host.mjs drive --evidence "$DSH_VERIFY_EVIDENCE"`
  executes all three journeys, in order, using real PTYs.
- Wait for parsed state (`⌸ ❯`, reply/history, actual exit), not sleeps.
- Keep submitted markers literal. Never seed history through an internal
  setter to make a missing precondition disappear.
- Use a new Launch for a rerun; always Cleanup, including after failure.

## Proof and skip reporting

- Retain the action transcript, terminal bytes, parsed screens, actual native
  provider requests and persisted side effects outside the checkout.
- A visible reply alone does not prove persistence; the second process must
  render history and send it back to the provider on continuation.
- Report missing preconditions and attempted entry points. Do not relabel a
  different route as verified. Cleanup must leave the proof intact.

## Features

- [Shared Project Card](context-hint-project.md): two packed processes, linked
  worktrees, independent clone, explicit review/confirm/reject and visible conflict.

- [New chat](new-chat.md): first-run Sessions picker, usable composer and reply.
- [Resume by ID](resume.md): saved session in a new process, history and continue.
- [Normal exit](exit.md): `/exit`, persisted marker, zero exit and terminal reset.
- [Manual Context Hint](context-hint.md): explicit consent, bounded requests,
  Session/Turn detail, Last Valid failures, remap/command-only and late results.
- [Settled Context Hint](context-hint-interactions.md): automatic counts,
  tool-rich outcomes, pause/resume, background input/scroll and recap coexistence.
- [Summary Model](context-hint-selection.md): independent selection, destination,
  restart and unavailable-model failures through ordinary commands.
- [Scoped deletion and storage recovery](context-hint-deletion.md): session vs
  shared Project deletion, linked-worktree disclosure, released old responses,
  restart, controlled unwritable/corrupt storage and retained evidence.
