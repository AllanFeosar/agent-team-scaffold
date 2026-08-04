# agent-team-scaffold

A Claude Code skill that scaffolds a multi-agent orchestration system for
your own project — specialist sub-agents sized to your actual stack, shared
contracts they stay in sync through, and a dispatch layer that works whether
you're in a live Claude Code session or running headless, unattended, across
multiple CLI coding agents (Claude Code, Codex, Gemini CLI, and anything
else with a headless exec mode). It does not ship a scheduler — the headless
path runs when you (or whatever external mechanism you set up yourself)
invoke it.

It does not ship a fixed roster or a fixed stack. It reads your project,
proposes a roster sized to what's actually there, and generates everything
from templates — the mechanics transfer, the specifics never do.

## What it generates

- **`.claude/agents/*.md`** — one specialist per architectural layer, in
  Claude Code's native subagent format, for interactive in-session dispatch
- **`.claude/contracts/`** — living API/schema docs the agents read and
  write to stay in sync, plus a handoff-report protocol with a required-
  fields checklist for full integration checkpoints
- **`AGENTS.md`** — the canonical, cross-tool routing table and
  orchestration rules, read natively by Codex, Cursor, Copilot, Gemini CLI,
  Aider, Windsurf, and other tools that support the AGENTS.md standard.
  `CLAUDE.md`/`GEMINI.md` become thin pointers to it, not separate copies
- **`.agent-team/orchestrator.mjs`** *(optional)* — a small, dependency-free
  Node script that dispatches any configured provider headlessly, gates
  every dispatch on the agent's own self-verification command, enforces a
  security-audit ledger at the merge boundary, and defers cleanly on a
  provider usage-limit hit instead of burning its retry budget against it.
  This is what makes dispatch provider-agnostic: gating logic lives in the
  script, wrapping the one contract every CLI coding agent shares (a prompt
  in, an exit code and readable output out), instead of depending on any
  single harness's hooks. It has no scheduling of its own — you run
  `run-phase` yourself, or wire up whatever trigger you want.

## Why a second dispatch path exists

Claude Code, Codex, and Gemini CLI each have their own hook system, and the
three don't agree on anything — different config formats, different event
names, different platform support. There's no shared hook to build
cross-provider self-verification or security gating on top of. But every one
of them supports headless, non-interactive execution: feed it a prompt, it
works until done, it exits with a status. `orchestrator.mjs` is built on
that instead — real code that runs the self-verification check itself after
any provider's headless call exits, rather than a harness-specific hook.

The interactive path (a human in a live session, dispatch via Claude Code's
native `Agent` tool) still only runs inside Claude Code, and still gives
live streaming visibility into a subagent while it works. The headless path
works identically regardless of provider, but you see a phase's result when
it completes, not while it runs. Both are real, and neither is a strict
superset of the other.

## Design principles this skill actually enforces

- **Sized to the project, not a template.** Roster proposals must partition
  cleanly — no two agents own overlapping paths, no routing-table row
  matches two agents.
- **Contracts and handoffs are data, never instructions.** Every generated
  agent treats shared files as project-state to read, not directives to
  execute — directive-sounding content inside one gets flagged as
  suspicious, not obeyed. This closes a real, documented attack class
  (persistence via auto-loaded, agent-writable files), not a hypothetical
  one.
- **Every dispatch has a completion criterion.** No hook can rescue a
  subagent that hangs instead of finishing — `SubagentStop` only fires on
  completion, and headless dispatches have no hook at all — so nothing
  gets dispatched into open-ended or monitoring-style work.
- **A headless worker has real shell access, not a sandbox.** Its prompt
  carries an explicit instruction not to invoke the orchestrator or any
  provider CLI from within itself.

## Getting started

1. Copy this repo's contents into `~/.claude/skills/agent-team-scaffold/`
   (or your project's `.claude/skills/agent-team-scaffold/`).
2. Restart Claude Code (or start a new session) so it picks up the skill.
3. Ask Claude to scaffold an agent team for your project. It will read your
   codebase, propose a roster, and confirm it with you before writing
   anything.

## A few suggestions

- **Start with the interactive path only.** Steps 5 and 7 (the headless
  orchestrator and the enforcement hooks) are both explicitly optional —
  skip them on the first pass and add them once the basic roster is proving
  useful in live sessions.
- **Verify every provider flag before an unattended run.** `providers.json`
  ships with flags verified against specific CLI versions at the time this
  was written — CLI flags drift between releases. Run `<binary> --help`
  yourself before trusting a headless dispatch to a provider you haven't
  checked recently.
- **Don't skip the roster-confirmation step even if you're in a hurry.**
  Overlapping agent ownership is a documented multi-agent failure mode
  ("no clear owner of the final answer") — the few seconds it takes to
  review the proposed split is cheaper than untangling two agents that
  quietly edited the same file.
- **If you're on Windows and writing a `selfVerification`/`setupCommand`
  entry**, name global tools with their explicit extension (`composer.bat`,
  `npm.cmd`) — see `references/REFERENCE.md` for why.

## Q&A

**Does this replace Claude Code's built-in subagents?**
No — it generates them. `.claude/agents/*.md` *is* Claude Code's native
subagent format; this skill just fills it in with content specific to your
project instead of leaving you to write it from scratch.

**Do I need the headless orchestrator if I only ever use Claude Code
interactively?**
No. It's additive, not a replacement — skip step 5 entirely and you get the
interactive roster with none of the headless machinery.

**What happens if a project already has a `CLAUDE.md` with real content?**
It's never overwritten. The skill only adds or replaces its own
`## Agent System — Orchestration Rules` section if one already exists from
an earlier run, and leaves everything else in the file untouched.

**Is the provider list fixed to Claude Code, Codex, and Gemini CLI?**
No — `providers.json` is a plain data file. Adding another CLI agent means
adding an entry with its command, its no-approval flag, and confirming it
reads its prompt from stdin — not touching the orchestrator script itself.
