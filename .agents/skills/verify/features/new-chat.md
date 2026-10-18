# Start a new chat from an empty profile

A user opens the installed TUI, creates a session in the workspace and receives
an assistant response through the real host's provider adapter.

## Sub-features

- `chat-picker`: empty first launch opens Sessions with a New session card.
- `chat-compose`: Right/Ctrl+N reaches the actual `⌸ ❯` input.
- `chat-reply`: a submitted prompt gets a rendered assistant response.

## How to get to it (user POV)

- Start `dsh-tui` without a prompt or resume flag in the workspace, then use
  Right and Ctrl+N in Sessions. This map covers that first-run entry only.

## Driving it with verify-packed-host

Preconditions:

- Launch and Doctor succeeded; the owned profile and workspace started empty.

- **Open and create.** Run `node scripts/verify-packed-host.mjs drive --evidence
  "$DSH_VERIFY_EVIDENCE"`. The fresh PTY records startup, Right/Ctrl+N, then a
  composer screen in `fresh-ready.txt`.
- **Submit.** The helper types `VERIFY_FIRST: say hello`, waits for its echo,
  then sends Enter as a separate key event.
- **Observe.** `fresh-answer.txt` must show `DSH_VERIFY_FIRST_OK`; the input did
  not contain that sentinel. `provider-requests.json` must show the actual
  native Messages request at the synthetic loopback boundary.
- **Proof.** Keep `actions.json`, `fresh.ansi`, the phase screens and provider
  request. Drive continues into the other mapped journeys before returning.

## Gotchas

- Session-search text is not the chat composer. Typing there filters sessions
  and must fail this journey, not count as a prompt submission.
- New profiles must not require real credentials. A provider error is a
  failure; do not swap in a fake agent/channel or silently skip the response.
- Initial-prompt CLI arguments and `/new` are other entry points not exercised
  by this seed recipe; do not claim them from this proof.
