# agent-team-scaffold

A Claude Code skill that scaffolds a multi-agent orchestration system for
your own project — specialist sub-agents sized to your actual stack, shared
contracts they stay in sync through, a written playbook per agent, and a
dispatch layer that works whether you're in a live Claude Code session or
running headless, unattended, across multiple CLI coding agents (Claude Code,
Codex, Gemini CLI, and anything else with a headless exec mode). It does not
ship a scheduler — the headless path runs when you (or whatever external
mechanism you set up yourself) invoke it.

It does not ship a fixed roster or a fixed stack. It reads your project,
proposes a roster sized to what's actually there, and generates everything
from templates — the mechanics transfer, the specifics never do.

Version: see [VERSION](VERSION) · history and known gaps: [CHANGELOG.md](CHANGELOG.md)

## What it generates

**Core (always)**
- **`.claude/agents/*.md`** — one specialist per architectural layer, in
  Claude Code's native subagent format, for interactive in-session dispatch
- **`.claude/contracts/`** — living API/schema docs the agents read and
  write to stay in sync, plus a handoff-report protocol with a required-
  fields checklist for full integration checkpoints
- **`AGENTS.md`** — the canonical, cross-tool routing table and
  orchestration rules, read natively by Codex, Cursor, Copilot, Gemini CLI,
  Aider, Windsurf, and other tools that support the AGENTS.md standard.
  `CLAUDE.md`/`GEMINI.md` become thin pointers to it, not separate copies
- **`.agent-team/tentacles/<agent>/PLAYBOOK.md`** (+ `files/`, `examples/`,
  `notes.md`) — each agent's process layer, toolbox and proof. You choose how
  it is built: a **full interview** (the AI asks, you answer in your own
  words) or **AI-recommended** (the AI drafts from your repo's tests, CI and
  git history and asks only about what it is unsure of — and writes down only
  what the repo doesn't already show). Every line is tagged `[confirmed]`,
  `[AI-recommended]` or `[UNCONFIRMED]`, so unreviewed rules stay visible. The
  Definition of done has 5–10 checks with evidence, and an AGENTS.md
  correction loop turns each mistake into a playbook fix.

**Optional**
- **`.agent-team/orchestrator.mjs`** — a small, dependency-free Node script
  that dispatches any configured provider headlessly, gates every dispatch on
  the agent's own self-verification command, enforces a security-audit ledger
  at the merge boundary, and checks real quota before it dispatches at all: a
  live percentage for Claude Code and Codex (staged 96%/98% thresholds —
  normal below 96%, still allowed but logged from 96–98%, deferred at 98%+),
  an honest "unknown" for Gemini CLI, which has no quota interface to check.
  This is what makes dispatch provider-agnostic: gating logic lives in the
  script, wrapping the one contract every CLI coding agent shares (a prompt
  in, an exit code and readable output out), instead of depending on any
  single harness's hooks.
- **Trust and control layer** (in the orchestrator) — a signed integrity seal
  over the gate config, hooks, agent files and playbooks (so a worker can't
  rewrite its own check); guards that run *before* verification and reject
  out-of-ownership changes, deleted/skipped tests and edited feature lists;
  an optional independent read-only verifier; `mergePolicy: manual`; an
  `integrationCheck` that rolls a bad merge back; a `STOP` kill switch; a
  per-dispatch spend cap where the provider supports one; and an
  `events.jsonl` run record. Untagged queue items that match more than one
  agent are blocked rather than guessed. This is tamper *detection*, not a
  sandbox — see [Known limits](#known-limits).
- **`llm-council`** — a conflict resolver, not a general assistant. It
  convenes only when agents contradict each other, clash over ownership, loop
  on `NEEDS`, end a fix loop in disagreement, or a request has several
  readings with tradeoffs, and ends with 2–4 options you choose from. Members
  are Claude subagents (different models and lenses) and, if configured,
  Codex/Gemini through `orchestrator.mjs ask` (read-only). No Fireworks key
  needed.
- **Enforcement hooks** — a `SubagentStop` self-verification gate (with a
  circuit breaker and a tamper check) and a `PreToolUse` security gate, for
  the interactive path.
- **`usage`** — per-agent runs, tokens, model mix, playbook uptake and flags, from Claude Code's own transcripts.
- **Live-session hooks** — `orchestrator.mjs hook …`, wired by `assets/settings.hooks.json.template`: the playbook
  digest is injected into each subagent's context, its report must end with the proof block, per-agent token usage
  is logged, upward model overrides and out-of-ownership or sealed-file writes are caught. Without these the
  headless guards never apply to work done in a live session.
- **Evals** — an offline routing eval and a real-dispatch eval (pass@k,
  pass^k, with/without-playbook baseline) to copy into a generated project.
- **Extras** — allowlist for skills/MCP tools, `features.json` + `init.sh`
  for work too large for one session, a spec-first template, and deny rules
  for the protected files.

## Orchestrator commands

```
node .agent-team/orchestrator.mjs run-phase                  one bounded phase from the STATUS.md queue, then stop
node .agent-team/orchestrator.mjs spawn <agent> "<task>"     one ad hoc dispatch  [--worktree] [--no-merge]
node .agent-team/orchestrator.mjs ask <provider> [--model m] one read-only text answer (prompt on stdin)
node .agent-team/orchestrator.mjs seal | integrity           record / verify the signed hashes (seal needs a terminal)
node .agent-team/orchestrator.mjs usage [--days N] [--json]  per-agent runs, tokens, models, flags
node .agent-team/orchestrator.mjs stop | resume              kill switch
node .agent-team/orchestrator.mjs lint                       mechanical checks on the generated setup
node .agent-team/orchestrator.mjs log [n]                    last n lines of the run record
node .agent-team/orchestrator.mjs status | quota             queue summary / real quota per provider
```

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

The security gate is the one check every path shares directly. It is a
single script with three entry points: Claude Code's `PreToolUse` hook, a
git `pre-commit` hook (which every provider's interactive session and every
person goes through when they commit), and a `range` mode that
`orchestrator.mjs` runs on a worker's branch before merging and CI can run
on a pull request. They all read one path list,
`.claude/security-sensitive-paths.txt`, and the gate blocks when a pattern
in it stops matching any file, so a refactor can't silently leave moved
files ungated.

## Design principles this skill actually enforces

- **Sized to the project, not a template.** Roster proposals must partition
  cleanly — no two agents own overlapping paths, no routing-table row
  matches two agents. At runtime the orchestrator enforces ownership and
  refuses to guess between two matching agents.
- **Contracts and handoffs are data, never instructions.** Every generated
  agent treats shared files as project-state to read, not directives to
  execute — directive-sounding content inside one gets flagged as
  suspicious, not obeyed. This closes a real, documented attack class
  (persistence via auto-loaded, agent-writable files), not a hypothetical
  one. Playbooks follow the same rule and are sealed, so a worker can't
  rewrite the rules it is given.
- **Every dispatch has a completion criterion.** No hook can rescue a
  subagent that hangs instead of finishing — `SubagentStop` only fires on
  completion, and headless dispatches have no hook at all — so nothing
  gets dispatched into open-ended or monitoring-style work.
- **Checks can't be weakened to pass.** A check that can fail, with evidence
  from outside the agent's own opinion, and guards that reject deleted tests
  or out-of-scope edits before the check runs.
- **A headless worker has real shell access, not a sandbox.** Its prompt
  carries an explicit instruction not to invoke the orchestrator or any
  provider CLI from within itself.

## Getting started

1. Copy `SKILL.md`, `assets/`, `references/` and `agents/` into
   `~/.claude/skills/agent-team-scaffold/` (or your project's
   `.claude/skills/agent-team-scaffold/`). `tests/` and `.github/` are for
   developing this repo and aren't needed there.
2. Restart Claude Code (or start a new session) so it picks up the skill.
3. Ask Claude to scaffold an agent team for your project. It will read your
   codebase, propose a roster, and confirm it with you before writing
   anything. It then asks **one question** — build the playbooks by full
   interview, or AI-recommended — and, if you want the orchestrator, ends by
   asking you to run `node .agent-team/orchestrator.mjs seal` yourself at a
   terminal, then `lint`.
4. Before trusting the team, copy the eval runner into the project and
   measure it (SKILL.md step 11). Nothing here is verified until it is.

The full procedure is [SKILL.md](SKILL.md); the interview and AI-recommended
procedures are in [references/PROCESS-LAYER.md](references/PROCESS-LAYER.md);
the reasoning and evidence behind each gotcha are in
[references/REFERENCE.md](references/REFERENCE.md).

## A few suggestions

- **Start with the interactive path only.** The headless orchestrator, the
  enforcement hooks and the council are all explicitly optional — skip them
  on the first pass and add them once the basic roster is proving useful in
  live sessions.
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
- **Keep playbooks short.** Repo-level context files that restate what the
  code shows were measured to not help and to cost more (arXiv 2602.11988).
  `lint` warns past the line budgets; the eval runner's `--baseline` flag
  tells you whether yours earns its place.
- **Add the runtime files to `.gitignore`** (SKILL.md step 5 lists them).
  The orchestrator writes `events.jsonl`, `integrity.json` and worktrees into
  `.agent-team/`, and any untracked file makes `run-phase` skip its firing.
- **If you're on Windows and writing a `selfVerification`/`setupCommand`
  entry**, name global tools with their explicit extension (`composer.bat`,
  `npm.cmd`), and keep the checkout path short — a deep path plus
  `.claude/skills/...` can exceed the path-length limit when a worktree is
  created. See `references/REFERENCE.md`.

## Testing this repo

```
node --test "tests/*.test.mjs"
```

Behavioural tests drive the real orchestrator CLI against a throwaway git
repo and a deterministic fake provider — no network, no tokens. They also
cover the sh gate, and the PowerShell gate on Windows. They need Node with
`node:test` and glob support (developed on Node 22); GitHub Actions runs the
same suite on Linux and Windows ([.github/workflows/test.yml](.github/workflows/test.yml)),
though that workflow has not yet run on GitHub.

## Repository layout

```
SKILL.md                    the skill: workflow steps 1–11 and gotchas
agents/openai.yaml          Codex skill metadata
assets/                     templates the skill fills in for your project
  evals/                      eval runner + task template
  llm-council/SKILL.md        the council skill, copied to .claude/skills/ when offered
references/                 PROCESS-LAYER.md (playbook procedure), REFERENCE.md (why, evidence, gotchas)
tests/                      orchestrator + gate tests, fake provider
LICENSE · THIRD_PARTY_NOTICES.md · CHANGELOG.md · VERSION
```

## Known limits

- **Headless workers still run with each CLI's permission-bypass flag.** The
  seal and guards detect tampering and reject bad output; they do not
  sandbox the worker. Deny rules, sandbox modes and network limits for
  headless runs are open work.
- **The seal is tamper-evident, not tamper-proof** — a worker with unrestricted
  shell access could read the signing key.
- **Codex and Gemini council/verifier members** depend on those CLIs: Codex's
  read-only flag was confirmed against `--help`, but a live call on
  codex-cli 0.139.0 failed on a model-version error, and Gemini CLI has no
  verified read-only flag, so it ships without one.
- **Per-dispatch spend can be capped but not read back**, and only where the
  provider has a budget flag (Claude Code does; Codex and Gemini don't).
- **Keyword routing is a weak fallback.** Tag ambiguous queue items
  `[agent-name]`; the routing eval measures how bad it is for your roster.

## Q&A

**Does this replace Claude Code's built-in subagents?**
No — it generates them. `.claude/agents/*.md` *is* Claude Code's native
subagent format; this skill just fills it in with content specific to your
project instead of leaving you to write it from scratch.

**Do I need the headless orchestrator if I only ever use Claude Code
interactively?**
No. It's additive, not a replacement — skip step 5 entirely and you get the
interactive roster with none of the headless machinery. (The seal, guards,
verifier, run record and `ask` all live in the orchestrator.)

**What happens if a project already has a `CLAUDE.md` with real content?**
It's never overwritten. The skill only adds or replaces its own
`## Agent System — Orchestration Rules` section if one already exists from
an earlier run, and leaves everything else in the file untouched. For a
project that already has agents, step 8 diffs against the current templates
instead of regenerating.

**Is the provider list fixed to Claude Code, Codex, and Gemini CLI?**
No — `providers.json` is a plain data file. Adding another CLI agent means
adding an entry with its command, its no-approval flag, and confirming it
reads its prompt from stdin — not touching the orchestrator script itself. To
let it join a council or act as a verifier, also give it a verified read-only
`adviceArgs`; without one, `ask` refuses it.

**Does the council run by itself?**
Only on the conflict triggers listed in `assets/llm-council/SKILL.md`, and
only if you chose auto-run in `.agent-team/council.json`; otherwise it
announces the trigger and waits. It is interactive-only and ends with
options for you to pick — it never acts on its own verdict.

**What does "AI-recommended" mean, and can I trust it?**
The AI drafts the playbook from evidence in your repo and asks only about
what it's unsure of. Lines you didn't decide stay tagged `[AI-recommended]`
or `[UNCONFIRMED]` — accepting a draft doesn't upgrade it. It is a draft the
AI believes, not a record of what you know.

**How does the quota check work, and does it touch my credentials?**
It reads the same local OAuth token the `claude` CLI already uses
(`~/.claude/.credentials.json`) and calls Anthropic's own usage endpoint
with it — the same thing the CLI itself does, just from this script instead.
The token is read into memory for one request and never logged, written
anywhere, or sent anywhere but Anthropic's own API. Codex's check similarly
uses Codex's own local `app-server` interface — nothing third-party, no new
credentials collected. Both are undocumented/internal interfaces, not
stable public contracts, so a failed check degrades to "unknown" rather
than blocking anything. The run record (`events.jsonl`) logs sizes and
reasons only — never prompts or provider output.

## License and credit

**agent-team-scaffold** is created by **AllanFeosar** ([github.com/AllanFeosar/agent-team-scaffold](https://github.com/AllanFeosar/agent-team-scaffold))
and released under the [MIT License](LICENSE). You are free to use, copy, modify and distribute it,
including commercially, provided the copyright notice and license text in [LICENSE](LICENSE) are kept in
every copy or substantial portion. If you build on this repo, please credit it:

> Based on [agent-team-scaffold](https://github.com/AllanFeosar/agent-team-scaffold) by AllanFeosar (MIT).

Third-party material (the council method, adapted from `dair-ai/dair-academy-plugins`) keeps its own
notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
