# Project Status — resume anchor for the orchestrator

This is the queue `orchestrator.mjs run-phase` reads — the authoritative,
cross-agent phase sequence. A tentacle's own `todo.md` is that one agent's
local backlog; this file is what `orchestrator.mjs` actually advances one
item at a time, whether that's triggered manually or by whatever external
mechanism you set up yourself. Only one file, at the project root,
`.agent-team/STATUS.md`.

Same checkbox parsing as every `todo.md` in this scaffold: `- [ ] text` /
`- [x] text`. Tag an item with `[agent-name]` when it isn't obvious which
agent owns it from the routing keywords alone. Add `[tier:light]`,
`[tier:default]` or `[tier:high]` after it to override that agent's usual
model tier for this one item (e.g. `- [ ] [backend-agent] [tier:high] ...`).

---

## Queue

- [ ] [<agent-name>] <first phase — concrete, scoped to what one dispatch can finish>
- [ ] <next phase — routing keywords in the text let the orchestrator infer the agent if untagged>

## Status log

<orchestrator.mjs appends nothing here automatically — this section is for
a human or the orchestrating session to leave a short dated note after a
phase lands, e.g. "2026-MM-DD: backend-agent phase done, 3rd attempt passed
self-verification.">

## Blocked

<the orchestrator marks a queue line with an inline `<!-- BLOCKED: ... -->`
comment rather than removing it — this section is for anything that needs a
human decision before it can go back in the queue (an ambiguous requirement,
a failing self-verification that isn't a code bug, a missing security audit).
Clear an item from here only once it's actually unblocked, not once it's
been looked at.>
