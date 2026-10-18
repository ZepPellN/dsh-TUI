---
name: verify
description: Drive dsh-TUI's real packed plugin through the exact DSH 0.2.1-rc.2 host in an isolated PTY. Use to verify startup, synthetic-provider conversation, persistence/resume and clean terminal exit after compatibility or packaging changes.
---

# Verify dsh-TUI

This is the Codex project driver. Read [features/README.md](features/README.md)
and the matching journey first. The primary surface is the terminal, not a web
page. The host, loader, provider adapter, session lifecycle and persistence are
real. Only the external model HTTP endpoint is synthetic; no paid calls or real
credentials are needed. Do not drive an existing user profile.

## Launch

From the repository root, use Node 24 (or the supported Node range in
`package.json`), pnpm 11, npm and Python 3. Initialize the recorded submodules
if needed: `git submodule update --init --recursive`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
export DSH_VERIFY_EVIDENCE="$(cd .. && pwd)/dsh-verify-$(date -u +%Y%m%dT%H%M%SZ)"
node scripts/verify-packed-host.mjs launch --evidence "$DSH_VERIFY_EVIDENCE"
```

Use a new evidence directory per launch, outside the checkout. `launch` packs
the compiled checkout, installs exact `@deepseek-ai/dsh@0.2.1-rc.2`, and installs
the actual tarball with `dsh plugin --profile dsh-tui add`. It does not keep a
TUI running: this short-lived terminal app starts in its own PTY during Drive.
Successful setup reports `launched isolated package setup` and writes
`run.json`. This is installation readiness, not proof of usable chat.

Drive must reach the actual `⌸ ❯` composer. A first empty-profile launch opens
Sessions instead; Right then Ctrl+N creates a session in the owned workspace.
Wait for the composer, not merely a process or session-search prompt.

The helper creates a fresh `/tmp/dsh-packed-*` home/workspace. It scrubs ambient
DSH paths, credentials, npm configuration, proxy and Node options. Public npm
registry bytes may be reused in `packed-registry-cache` beside the evidence
directory; profiles, sessions and configuration are never shared. Concurrent
runs require distinct evidence directories; each has its own home, PTYs and
loopback port. Registry access is needed for setup, not model inference.

## Doctor

```sh
node scripts/verify-packed-host.mjs doctor --evidence "$DSH_VERIFY_EVIDENCE"
```

Run this before driving and whenever something looks wrong. It checks the
actual CLI version, packed launcher ownership using canonical paths (including
macOS `/private/tmp`), profile/config composition, retained telemetry privacy
default, absence of version exemptions, and the PTY dependency. It only
observes the installed test instance and writes diagnostic evidence; it does
not submit a prompt or alter session data. Require exit 0 and `doctor.json`.

## Drive

```sh
node scripts/verify-packed-host.mjs drive --evidence "$DSH_VERIFY_EVIDENCE"
```

This executes the mapped [new chat](features/new-chat.md),
[explicit resume](features/resume.md), and [normal exit](features/exit.md)
journeys together. It uses the installed package launcher, normal keys and
slash commands: session picker → Right/Ctrl+N → composer → first prompt →
provider reply → `/exit` → `--resume` with saved ID → restored history →
second prompt → second reply → `/exit`.

The loopback fixture implements the target native DeepSeek Messages protocol
(`/v1/messages`, synthetic `x-api-key`, Messages SSE). It does not replace
Cordis, the provider adapter, sessions or UI. Reply sentinels are absent from
typed prompts, so input echo cannot pass a reply assertion. A second process
must receive the first assistant message from restored history, and the next
provider request must contain that history plus the second user input.

For unattended CI or a single command with guaranteed scoped teardown:

```sh
node scripts/verify-packed-host.mjs roundtrip --evidence "$DSH_VERIFY_EVIDENCE"
```

`roundtrip` includes launch, doctor, drive and cleanup. Do not run it after a
separate launch with the same evidence directory; choose a new directory.

## Evidence

Require exit 0 and `result.json` with `passed: true`, exact target and session
ID. Inspect action **and** outcome, not just a final screen:

- `pack.log`, retained tarball, `host-install.log`, `profile-install.log` and
  `doctor*.log/json`: actual package/host/loader identity and commands.
- `actions.json`, `fresh.ansi`, `restored.ansi`, and phase `.txt` screens:
  normal keys, usable composer, rendered replies/history and exit status.
- `provider-requests.json`: real native adapter requests, synthetic traffic
  only, restored assistant history and subsequent user input.
- `session-id.txt`, `persisted-sessions/`, `tui-state/`: saved session and
  resume marker, copied out before scratch removal.
- `run.json` with `cleaned: true`: scratch removed while proof survives.

On failure retain `failure.txt`, attempted actions, logs and screens; a failed,
skipped or timed-out entry is not a pass. Never substitute a source-loader
smoke, fake channel or setter for this journey. No publishing, tags, production
profile updates, branch rules or external GitHub writes are part of the driver.

The mapped journeys cover #2, not the whole application. Report which entry
point actually ran. Other resume aliases/pickers and unrelated features need
their own journeys; a CLI-ID resume does not prove them.

## Cleanup

After Drive has returned, on success **and after every failed attempt**, run
(never remove scratch while another Drive is still using it):

```sh
node scripts/verify-packed-host.mjs cleanup --evidence "$DSH_VERIFY_EVIDENCE"
test -s "$DSH_VERIFY_EVIDENCE/run.json"
test -s "$DSH_VERIFY_EVIDENCE/fresh.ansi"
```

Cleanup is idempotent. The driver stops only its own PTY child/process group
and HTTP listener. It copies test sessions/preferences into evidence, then
removes only its guarded `/tmp/dsh-packed-*` directory. Never kill by process
name or remove an ambient home/profile. Setup failure before a PTY exists may
have no ANSI file: retain the setup error, do not manufacture that proof.
Evidence and the public registry cache are deliberately not deleted.

## Helpers

`scripts/verify-packed-host.mjs` is executable; its `launch`, `doctor`, `drive`,
`cleanup` and `roundtrip` invocations are above. It invokes the executable
`scripts/lib/host-pty.py` with the recorded Node/packed-bin argv under the same
scrubbed environment. The bridge uses Python stdlib PTYs on Linux/macOS,
forwards terminal bytes and keys, and reports the real process exit code. Use
the driver rather than invoking the bridge with ambient user credentials.

Supplementary persistence proof (not a substitute for the mapped PTY path):

```sh
pnpm verify:host-migration
node --import tsx/esm scripts/verify-migrate-sessions.ts
pnpm verify:packed-host-ci
```

These verify nonempty migrated Unicode history through official read/restore/
continue/flush/reopen, the isolated SQLite migration, and execution of the real
CI aggregate shell against failed/cancelled/skipped/missing results. Linux and
macOS remote workflow execution is only proven by actual CI runs, not YAML.
Use `/maintain-verification-skill` when application paths change.
