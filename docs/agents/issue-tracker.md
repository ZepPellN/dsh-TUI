# Issue tracker: GitHub

Specs and tickets live in ZepPellN/dsh-TUI GitHub Issues.
Use the gh CLI.

## Repository scope

Always specify --repo ZepPellN/dsh-TUI for issue, label,
and pull-request commands. For API calls, explicitly target
repos/ZepPellN/dsh-TUI.

Do not infer the destination from origin: it points to the
upstream fork. Do not write to upstream repositories.

## Conventions

- Publish specs as parent issues.
- Publish each implementation ticket as a separate issue.
- Apply the configured ready-for-agent label to approved,
  sufficiently specified work.
- Link tickets as native sub-issues where available;
  otherwise include Part of #<parent> in each ticket.
- Use native blocking dependencies where available;
  otherwise include Blocked by: #<number> references.
- An implementation ticket can start only when its blockers
  have been accepted.
- Record acceptance evidence and relevant commits or PRs
  on the ticket.
- Integration-branch completion is not main-branch delivery.
  Close implementation issues through the final main-targeted
  PR after acceptance; do not close them merely on worker completion.
- Review any parent specification before changing or closing it.

## Pull requests as a triage surface

PRs as a request surface: no.

## Publishing and fetching

When a skill says publish to the issue tracker, create a
GitHub issue in this repository.

When a skill says fetch a ticket, read its full body,
comments, labels, parent, and blocking relationships.
