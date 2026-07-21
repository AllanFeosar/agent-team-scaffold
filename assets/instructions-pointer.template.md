<!--
Thin pointer content for a provider-specific instructions file (CLAUDE.md,
GEMINI.md) when AGENTS.md is the canonical doc. Matches the pattern already
proven in real use (Octogent's own CLAUDE.md is exactly this shape — a
one-line pointer, not a symlink, so it survives a plain git checkout on any
OS without needing symlink support enabled).

Use this file's content AS-IS for a project with no pre-existing CLAUDE.md
or GEMINI.md. If either file already exists with real project content
(common in a non-greenfield project), do NOT overwrite it — instead, add or
replace only that file's own "Agent System — Orchestration Rules" section
(if one exists from an earlier scaffold run) with the pointer line below,
leaving every other section of that file untouched. This is the same
never-blind-overwrite rule Step 8 already applies to every other file.
-->
See AGENTS.md for the full agent-system orchestration rules (routing table,
dispatch patterns, contracts, handoff protocol, security gate). This file
does not duplicate that content — AGENTS.md is the single source of truth,
read natively by this and every other supported tool.
