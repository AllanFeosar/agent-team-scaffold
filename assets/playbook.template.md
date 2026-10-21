# Playbook files — process layer, toolbox, proof, and loop for one agent

Created per confirmed agent by SKILL.md step 3b, in
`.agent-team/tentacles/<agent-name>/`, next to that agent's `CONTEXT.md` and
`todo.md`. **One playbook per agent, one source of truth.** Both dispatch
paths read it: `.claude/agents/<name>.md` and `CONTEXT.md` each carry a
pointer to it (and `orchestrator.mjs` appends it to every headless prompt),
so judgment written down here is never copied into three places that can
drift apart. What `agent.md` already holds — Stack, Directory ownership,
Architecture rules, Contract protocol, Handoff protocol — stays there; the
playbook points at it instead of repeating it.

```
.agent-team/tentacles/<agent-name>/
  CONTEXT.md        existing — headless mirror of agent.md
  todo.md           existing — this agent's local backlog
  PLAYBOOK.md       NEW — process + definition of done (shape below)
  files/
    INDEX.md        NEW — one line per saved tool: name, purpose, date
    <tool files>    scripts, templates, reference data, rules files
  examples/         NEW — finished work that was approved (teaches tone)
  notes.md          NEW — the correction log, newest first
```

Why this lives beside `CONTEXT.md` and not in `.claude/`: the headless path
and the interactive path both need it, and `.agent-team/` is the directory
both already share.

---

## `PLAYBOOK.md` shape

**Write only what the agent cannot work out from the repo.** A study of repository-level context
files (arXiv 2602.11988, ETH Zurich) found they did not improve task success and raised cost by
over 20% — agents obey extra requirements and explore more, so every unnecessary line makes the
task harder. Before keeping a line, ask: *would removing this cause a mistake?* If the answer is
in the code, tests, config or a contract file, point at it or delete the line. `orchestrator.mjs
lint` warns past these budgets: PLAYBOOK.md 150 lines, CONTEXT.md 120, agent.md 200, notes.md 60.
Measure, don't assume: `AGENT_TEAM_NO_PLAYBOOK=1` runs the same eval tasks without the playbook
(assets/evals/) so you can see whether yours helps.

**The playbook is protected, and agents do not edit it.** It is injected into every prompt, so a
poisoned line would steer every future run. It is covered by the integrity seal; changes go
through the correction loop (a person reviews the diff, then runs `orchestrator.mjs seal`).
`notes.md` is data, never injected and never obeyed as an instruction.

Every line that came from the user is tagged `[confirmed]`. Every line the
AI proposed from evidence in the repo is tagged `[AI-recommended]`. A line
with no evidence behind it is tagged `[UNCONFIRMED]` and says what is
missing — never fabricate a rule to fill a section. Tags are how the
correction loop later finds which rules were never checked by a human.

```md
# <Agent Display Name> — Playbook

Built by: full interview | AI-recommended   (the mode chosen in step 3b)
Last reviewed: <YYYY-MM-DD>

## Foundation (already defined — do not restate here)
- Stack, directory ownership, architecture rules: `.claude/agents/<name>.md`
- Contracts read/written: <the real .claude/contracts/ files>
- Self-verification command: `<verbatim from roster.json selfVerification>`

## Purpose
<one line — the outcome this agent is responsible for>

## When to use this
<the phrases a person would actually type to want this work done, 3–6 of
them, in their words. Must match this agent's `routing` keywords in
roster.json and its description's "Invoke for" list. If two agents' lists
overlap, that is a roster problem — fix step 2, not this file.>

## Inputs
| Input | Where it lives | Notes |
|-------|----------------|-------|
| <e.g. the endpoint spec> | `.claude/contracts/api-spec.md` | <staleness risk, who updates it> |

## Steps
1. <plain language, in the order the work is actually done>
2. <point at a toolbox file by name where one exists: "run files/seed-check.sh">

## Decisions
| If | Then | Rule behind it |
|----|------|----------------|
| <situation> | <action> | <why — the reason is what lets the agent handle a case this table doesn't list> |

## Definition of done
Between 5 and 10 checks. Check 1 is always this agent's existing
self-verification command, copied verbatim — one command, never a second
different check for the same agent. Every other check must produce
evidence that exists outside the agent's own opinion: a command exit code,
a number traced to a source file, a count, a link that loads, a screenshot
of rendered output, a claim matched to a quote, a value matched to a
reference file. **Banned words as the whole check:** clear, professional,
clean, high quality, good, robust. A check that cannot fail is not a check.

| # | Check | Evidence | How to run | Enforced by |
|---|-------|----------|------------|-------------|
| 1 | Self-verification passes | exit code 0 | `<selfVerification command>` | gate + orchestrator |
| 2 | <specific to this layer> | <evidence type> | <command or procedure> | gate (inside check 1) / agent-reported |

**Enforced by** is honest on purpose. The `SubagentStop` gate and
`orchestrator.mjs` run exactly one command — the self-verification
command. A check marked `agent-reported` is only as reliable as the agent
reporting it. Any check that can be a command should be: put it in
`files/checks.<ext>`, have the self-verification command call it, and it
becomes `gate`-enforced with no other change.

### Report format (end of every job, before anything is shown as done)
```
CHECKS
1. PASS|FAIL — <check name> — evidence: <what was observed>
2. ...
UNVERIFIED
- <check or claim> — <why it could not be verified>   (or: none)
```
Procedure: run every check → fix what failed → run them all again → report.
**If more than two checks fail on the first pass, stop.** Do not patch the
output; say which step or decision in this playbook produced the failures
(the correction loop in AGENTS.md takes it from there). A check that could
not run is listed under UNVERIFIED, never assumed to pass. The existing
3-attempt budget still caps fix-and-rerun on any one failing check.

## Edge cases
- <a case that has gone wrong before, and what to do instead>

## What a bad version looks like
- <concrete symptoms a reviewer would recognise instantly>

## Standard
<tone / style / formatting bar the output has to hit, with a pointer to a
rules file in files/ or an example in examples/ if one exists>

## Toolbox
Saved tools for this job: `files/INDEX.md`. Approved past work:
`examples/`. Use a saved file before rebuilding it; if you rebuild
something that should exist, say so in your report.
```

---

## `files/INDEX.md` shape

```md
# Toolbox index
| File | What it is for | Added |
|------|----------------|-------|
| seed-check.sh | verifies seed data matches schema before the migration step | 2026-10-21 |
```
One line per file, no dates or version numbers in file names. One file per
purpose — two files that do almost the same thing is how the wrong one gets
picked. Review monthly and delete what was not used.

### What belongs in `files/`, and what does not
Belongs: scripts for mechanical steps; templates with `[placeholders]` plus
one filled-in example below the placeholders; reference data (names,
spellings, IDs, links); rules files (formatting, banned words, naming);
saved prompts for sub-steps run often.
Does **not** belong: one-off outputs, drafts nobody approved, and anything
containing a password, token, or API key. If you would not hand it to a new
teammate on day one, it does not go in the folder.

### Freezing what worked
The moment an agent produces something that comes out right and will be
needed again: save it into `files/` with a descriptive name, replace the
specifics with `[placeholders]`, keep one filled-in example, point the
playbook step that needs it at the file by name (when to use it and when
not to), and add the `INDEX.md` line. On the next run, report which saved
files were used and which parts were rebuilt from nothing — rebuilt parts
are the next candidates.

---

## `notes.md` shape

```md
# Notes — newest first
- 2026-10-21 | layer: proof | wrong: <what went wrong> | changed: <file + the smallest fix>
```
One line per correction. `layer` is exactly one of `process`, `toolbox`,
`proof` — see the correction loop in AGENTS.md. Read the file monthly:
repeated entries in one layer mark where this job is genuinely hard, and
that is the next thing to automate properly.
