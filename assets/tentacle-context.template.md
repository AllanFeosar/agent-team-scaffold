# Tentacle files — one per agent, filled per project

Convention borrowed directly from Octogent (github.com/hesamsheikh/octogent), which
already proved this exact shape works as durable, file-based agent context. Not
reinvented here — reused because it's the right size for the job.

Create `.agent-team/tentacles/<agent-name>/CONTEXT.md` and `.agent-team/tentacles/<agent-name>/todo.md`
for every confirmed agent — this is the same content as that agent's `agent.md`
Stack/Directory ownership/Architecture rules sections, reshaped for a headless
worker that has no access to this project's `.claude/agents/<name>.md` file
(that file is Claude Code's own subagent format; a Codex or Gemini CLI worker
spawned by the orchestrator never reads it — CONTEXT.md is what it gets instead).

Keep both in sync by hand: when `agent.md`'s Architecture rules change, update
this file too. They describe the same agent through two different mechanisms
(Claude Code's native subagent frontmatter vs. a plain file any provider can
read), not two different agents.

---

## `CONTEXT.md` shape

```md
# <Agent Display Name>

<one-sentence remit — same as agent.md's opening line>

## Owns
```
<the real subtree(s) — same paths as agent.md's Directory ownership section
and roster.json's "ownership" array; all three must agree>
```

## Stack
<same as agent.md's Stack section>

## Architecture rules
<same numbered list as agent.md's Architecture rules section>

## Self-verification
`<the exact command from roster.json's "selfVerification" for this agent>`

## Playbook
`PLAYBOOK.md` in this directory holds the steps, decision rules, edge cases
and Definition of done for this job; `files/INDEX.md` lists saved tools to
use before rebuilding anything. `orchestrator.mjs` appends the playbook to
your prompt. Finish with one `PASS|FAIL — <check> — evidence: <...>` line per
Definition-of-done check and an `UNVERIFIED` list; more than two first-pass
failures means stop and name the playbook step responsible.

## Hard constraint
Do not invoke this orchestrator, any other agent CLI, or any provider binary
from within this session. No recursive dispatch. If the task needs another
agent's work, stop and report "NEEDS <agent-name>: <what's needed>" instead of
trying to invoke it yourself.
```

The first `# Heading` and the first non-empty paragraph after it are the only
lines any tooling treats as significant (matching Octogent's own Deck parser,
in case this project also runs Octogent) — keep them accurate and stable.

## Playbook files

Each tentacle directory also holds `PLAYBOOK.md`, `files/INDEX.md`,
`examples/`, and `notes.md` — shapes and rules in
[playbook.template.md](playbook.template.md). The playbook is the single
source for the process layer; do not copy its content into `CONTEXT.md` or
`agent.md`, which only point at it.

## `todo.md` shape

```md
# Todo

- [ ] <task, plain description>
- [ ] [<other-agent-name>] <task explicitly routed to a different agent — only
      use this when this tentacle's queue genuinely needs cross-agent work>
- [x] <completed task, left for history>
```

Only `- [ ] text` / `- [x] text` lines are parsed. `orchestrator.mjs` reads
this file exactly like it reads the project-root `STATUS.md` queue — a
tentacle's own `todo.md` is for that agent's local backlog; `STATUS.md` is
for cross-agent phase sequencing. Use `STATUS.md` for anything
`orchestrator.mjs run-phase` should pick up; use a tentacle's `todo.md` for
that agent's own scratch list.
