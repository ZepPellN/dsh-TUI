# Summary Model selection (#4)

Entry: `/hint model` after explicit `/hint enable`. Use the existing packed host,
not an installed user profile. Scope: independent preference/destination, not
automatic updates, shared Project confirmation or deletion.

Run a new `roundtrip --context-hint --hint-refresh --hint-selection --evidence
/absolute/owned/evidence` using the parent skill's Launch/Doctor/Cleanup rules.
The package snapshot, host, loader, model registry, adapter, session and TUI are
real; only HTTP provider replies/credentials are synthetic and loopback-only.

Observe the current Summary Model in the host-owned catalog dialog; use ordinary
arrows/Enter to choose explicit and inherit entries, or choose directly with
`/hint model provider/model` or `/hint model inherit`. Read the destination and
content disclosure and confirm (Esc cancels). Saving must not generate or switch
the main session model. The route-only preference lives in the admitted component
namespace, not host settings or a second credential store.

Retain normal command actions/screens, actual main selection before/after,
provider request paths/models/counts/bounds and latest card/preference state.
Restart must restore the saved choice with no summary call. Revoking only the
component's storage grants while retaining an explicit preference must disclose
the retained actual destination before enabling; cancelling it leaves
generation disabled and does not call a model. A configured target
that becomes unavailable must fail visibly with applicable Last Valid, without
fallback, repair or automatic retry. Old held results must not commit after a
selection change. These are acceptance requirements, not a claim from this map
alone: inspect result.json/scenarios and the executed actions.

Supplement: `node --import tsx/esm scripts/verify-context-hint-selection.ts` uses
real host discovery and admitted storage. It is not a replacement for the PTY
journey. Remote Linux/macOS execution still requires actual workflow evidence.
