# Domain Docs

## Layout

Use a single domain context:

- GLOSSARY.md at the repository root
- docs/adr/ for architectural decisions

Vendored workspaces retain their own upstream documentation
and governance; they are not new application-domain contexts.

## Before exploring

Read GLOSSARY.md when present, then ADRs relevant to the task.
If GLOSSARY-MAP.md is introduced later, follow its references.

If these documents do not exist, proceed silently.
Do not create placeholder glossaries or ADRs during setup.

Continue following AGENTS.md, docs/contributing.md,
and ADAPTER.md. This configuration does not replace them.

## Vocabulary and decisions

Use the glossary's domain terms consistently.
Flag conflicts with existing ADRs rather than silently
overriding their decisions.
