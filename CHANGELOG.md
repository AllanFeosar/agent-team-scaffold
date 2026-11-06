# Changelog

Generated projects record the version they were scaffolded from in `.agent-team/scaffold-version`, so a
retrofit (SKILL.md step 8) knows which template generation it is diffing against.

## 1.6.1 — 2026-11-06

### Fixed
Two `usage` flags raised false alarms on a project that was working normally (found re-reading a real project's usage
a day after they were added).
- **"Audit chain" fired on audits of different changes.** Each slice of a build gets its own audit and re-audit, so a
  chain of seven runs was a series of slices, not a fix loop. A chain now counts only when two re-audits come back to
  back (a third round on one change). A run is a re-audit when the head of its dispatch prompt says so; the body is
  ignored because it often mentions earlier rounds in passing, and a run whose dispatch cannot be read still counts, so
  older logs keep the flag.
- **"Audit entries share one shape" kept firing after the batches were done.** It now looks only at ledger entries in
  the `--days` window, or the last 14 days without one.

## 1.6.0 — 2026-11-05

Found by measuring where three days of a real project's subagent tokens went (one project, so a mechanism and not a
rate). Output was 1.5M tokens; cache reads were 249M, 164 times as much. Every turn re-reads the whole conversation, so
a run costs roughly turns times context, and the context grows with each turn. Security audits held 53% of the cache
reads, 91% of turns made a single tool call, and seven runs over 80 turns used 48% of all cache reads. Test-suite output
was only 5% of shell output; reading code (file dumps, greps, diffs) was 86%.

### Added
- **`usage` shows the context cost of runs.** Cache reads against output, how large a run's context is when it starts
  and per turn, turns per run and per agent, each agent's share of cache reads, the share of tool turns that made a
  single call, and the share of cache reads in runs over 80 turns. It flags a project whose turns are almost all single
  calls, and one whose cost sits in a few very long runs.
- **A "Working economy" note in each subagent's starting context** (the SubagentStart hook, three or four lines): put
  independent calls in one turn, read slices not whole files, and stop at a clean point and hand off past a turn budget.
  `economyHint: false` turns it off, `turnBudget` changes the 60, and the A/B switch removes it with the playbook digest.
  Whether agents follow it is something to check with `usage` afterwards.
- AGENTS.md template rule "Fewer, fuller turns".

## 1.5.0 — 2026-11-04

Found by classifying three days of a real project's subagent runs by what each was asked to do (one project, so a
mechanism and not a rate). Security audits took 53% of subagent output; five batches that wrapped about 135 route files
in the same call each got a full top-tier audit (about 390K output tokens and 90 minutes), and their findings were
two Mediums that predated the batches. The audits do find real problems in first-time sensitive code; the waste was
re-auditing a shape whose logic was already reviewed.

### Added
- **`auditPatterns`: repeated same-shape work is audited in full once, then light.** A roster entry
  `{ name, match, coverage }` declares a change shape. `risk` runs a whitespace-insensitive diff (`git diff -w`, so
  re-indentation disappears) and classes a file `pattern` when every remaining non-blank, non-comment line matches
  `match`. The first use is a full audit; once the security agent's ledger records `pattern: <name>` (only that agent can
  write the ledger), later batches are light: confirm the diff is still only the shape, run the `coverage` check, and
  do not hunt older issues in the code those files already held. Any file with another changed line is a normal full audit.
  Checked against the five batch commits that prompted this: a tight pattern qualified 121 of 135 route files, and the
  14 it rejected were the ones where error handling had also changed.
- `lint` validates `auditPatterns` (shape, regex, a `coverage` check, a regex that looks too loose); `usage` flags three
  or more audit entries of one shape and points at the fix.
- **A finding older than the change no longer blocks it** (AGENTS.md template). It goes to the backlog with a fix-before
  date or to the person as a queue item, unless it is Critical or High or exposes one tenant's or user's data to another.
  Without this a change touching many files becomes a review of the whole codebase, and each Medium it turns up starts a
  fix, a re-audit and an audit of the fix.

### Fixed
- `usage --days N` reported the main session's output over all history next to subagent totals for the last N days.

## 1.4.0 — 2026-10-31

Found by reading twelve hours of a real project's transcripts (one project, so the numbers are a mechanism, not a rate).
In that window the work was stalled by session limits for about a third of the time, and the guards added friction of
their own.

### Added
- **`usage` reports session-limit stalls.** Claude Code records "You've hit your session limit" as a synthetic
  `rate_limit` message. `usage` now treats it as a limit, not work, and reports each stall (hits that end at the same
  moment are one stall; counted up to the 5-hour window, since the person may return after the reset), the share of the
  period spent waiting, and for each stretch between stalls the output tokens, top-tier share and commits, so "how far
  does one window go" is a number. It flags a project that keeps hitting the limit with a heavy top-tier share.
- **`usage` flags files that keep being refused.** Repeated ownership blocks on one file are reported with whether the
  file has an owner (give it one, or add it to `sharedPaths`) or belongs to another agent (the task was cut across agents).
- **`lint` checks the ownership map against the tree**: tracked files nobody owns (every guarded agent is blocked from
  them), files two agents own, ownership globs that match no file, and test files that match no `testPaths` (so the
  tamper guard cannot see them).

### Fixed
- **The test-tamper guard counted conditional skips.** `if (!db) return ctx.skip()` is how an integration test says it
  needs a service; counting each such line as a skip marker reported one guard as "17 skip markers" and repeated it at
  five different agents. A skip now counts only when it removes a check: `it.skip("x")`, `xit`, `@Disabled`, `it.todo`,
  `skipIf(true)`, or an unconditional `ctx.skip()`; a skip that depends on a condition does not. This reverses the
  1.3.0 change that made `.skipIf` and `.runIf` markers.
- **In a live session an agent was blamed for another agent's uncommitted change.** The check diffed the shared tree
  against the commit recorded at the agent's start, so a skip or deletion left in the tree by someone else showed up at
  every later agent's stop. It now subtracts the state recorded at start.
- **The live ownership check misjudged files in a linked worktree.** A subagent in `.claude/worktrees/<id>/` can report
  the main root as its working directory, so an owned file read as `.claude/worktrees/<id>/src/...` and was refused. A
  path is now judged against the checkout of this repository that actually contains it.
- **`**/` did not match zero directories.** `**/*.test.*` did not match a root-level `a.test.ts`, so such a file was
  neither guarded by the tamper check nor owned by a `**/` ownership glob. It now follows `.gitignore` semantics.

## 1.3.0 — 2026-10-30

### Added
- **Interactive-path hooks** (`orchestrator.mjs hook <event>`, wired by `assets/settings.hooks.json.template`).
  Everything the orchestrator enforced applied only to headless dispatch; in a live session none of it ran.
  Measured on a real project's transcripts, only about a quarter of specialist runs ever opened their
  PLAYBOOK, about a quarter followed its report format, and 27% of dispatches asked for a costlier model than
  the agent file declares. The hooks put the rules in context and enforce them where they matter:
  - `SubagentStart` injects a capped digest of the playbook (Definition of done, decisions, edge cases) into the
    subagent's context. This is the fix for "the playbook is not working": a rule in a file the agent must go
    and open was mostly skipped, a rule already in its context is followed.
  - `SubagentStop` sends an agent back once if its report lacks the playbook's CHECKS / UNVERIFIED block, and
    records per-agent usage (turns, tokens, models) from its transcript.
  - `PreToolUse(Agent)` logs every dispatch and flags (or, with `modelPolicy: "enforce"`, refuses) an upward
    model override unless the prompt says `[escalate: <reason>]`.
  - `PreToolUse(Write|Edit|…)` inside a subagent refuses writes to sealed files and outside its ownership,
    resolving paths against the checkout the call came from (isolated worktrees included).
  - Policies in `roster.json`: `modelPolicy` (warn), `reportPolicy` / `ownershipPolicy` / `protectedPolicy`
    (enforce), `tamperPolicy` (warn), `playbookDigestLines` (80). Every internal error fails open.

- **`orchestrator.mjs usage [--days N] [--json]`**: per-agent runs, share of dispatches, output tokens, model mix,
  playbook-read rate, report-block rate, and upward model overrides, read from Claude Code's own transcripts
  (counts only, never message content). It answers "is the team effective and efficient?" for work done in a live
  session, where the headless run record is empty, and it flags: agents that do almost no work (candidates for
  `"dormant": true`), agents whose playbook is never opened, unexplained model upgrades, and a top-tier model
  that dominates despite the declared tiers.
- **`"dormant": true`** on a roster agent: it is not routed to (queue items and routing evals) until the flag is
  removed. Lets a roster be sized to the work done so far rather than the work imagined.

- **`orchestrator.mjs risk [base [head]] [--staged] [--json]`**: classifies each sensitive file's diff as
  `mechanical` (pure rename, whitespace, comments), `import-only` (imports re-pointed with identical bindings) or
  `logic` (everything else, including new/deleted files and added or removed bindings), and recommends audit
  depth: none / light / full. A real audit ledger showed import-only slices audited at full depth and finding
  nothing. Advisory: the gate still requires a ledger entry for every sensitive path, and anything the classifier
  is unsure about is `logic`.

- **`assets/checks.sh.template`**: the mechanical half of a Definition of done as a script of named checks that
  print the playbook's `PASS|FAIL — check — evidence` lines; call it from `selfVerification` and the gate enforces it
  instead of trusting a sentence in a report.
- **New `lint` rules**: a playbook whose Definition of done is mostly "agent-reported" (move what can be a command
  into `files/checks.sh`), a `files/checks.sh` that `selfVerification` never runs, evals configured but never run (and
  no `--baseline` run, so the playbook's effect is unmeasured), and corrections logged in two places (a project
  lessons file and empty per-agent `notes.md`). New roster key `lessonsFile` makes one file the single correction log.

- **Models**: a `max` tier mapped to `fable` (opt-in only: it draws on a separate credit pool and fails on an account
  without credits), `fable` ranked above `opus` so an unexplained upgrade to it is caught by the dispatch hook, the
  agent template documents `effort` (an agent with none inherits the session's, usually high), and `lint` checks each
  agent's `model` and `effort` values and warns on fable or xhigh/max as an agent default.

- **`stamp write|check|show [label]`**: remembers that a check passed for THIS exact tree (HEAD + uncommitted diff +
  new files), so the next role reuses it instead of rerunning. In a real project the same ~1,000-test suite ran three
  times per change (the agent, the person, the auditor). Write the stamp as the last step of `selfVerification`;
  `check` exits 0 only if the tree is unchanged (`--max-age-min N` adds an age limit).
- **`plan [--json]`**: groups open queue items into batches that can run side by side in separate worktrees.
  Items conflict if they go to the same agent, to agents whose ownership overlaps, or are tagged `[after:N]`; an
  unroutable item is never parallelised. `roster.maxParallel` caps a batch (default 3).
- **`usage` now measures time**: active minutes per agent and for the team, peak concurrency, and the share of busy
  time that overlapped. A gap of more than 20 minutes between a run's messages counts as idle, because first-to-last
  overstates a run that was resumed hours later. It flags work that ran almost entirely one agent at a time.

- **Lean profile and audit policy** (from a real project's measurements plus online research; evidence and sources in
  REFERENCE.md): start with 2–4 agents; an audit policy with a written threat model, re-audits that verify the fix only,
  at most two rounds, severity deciding what blocks (Low/Info to a backlog), depth by `risk`, audit at the merge not at
  every commit, and roadmap before hardening; short dispatch briefs and reports; templates for the threat model, the
  security backlog and the brief/report. `usage` flags a chain of three or more back-to-back audit runs. `lint` notes a
  roster of more than five agents.

- **Using the cheap model as the cheap model.** In a real project the small model produced 0.4% of subagent output:
  a tier only applied if a person tagged the item or set the agent's tier, and nothing recognised mechanical work.
  `orchestrator.mjs tier "<task>"` suggests a starting tier (light only for clearly mechanical work, never near
  auth/tenancy/secrets/migrations/schema/audit, never up); `plan` marks items a cheap model could start; an agent with
  `"autoTier": true` starts such queue items on light in `run-phase` (a failed check still escalates). `spawn` gained
  `--tier` and `--no-escalate`, and the eval runner `--tiers light,default`, which runs every task on each tier with
  escalation off and reports pass rate, time and output tokens per tier. A first pilot is in REFERENCE.md.

### Fixed (found in the 1.3.0 review)
- **A worker could approve its own security-sensitive change (ATS-H1).** The ownership guard allowed
  `.claude/contracts/**` to every agent and the security gate only checks that added ledger lines name each sensitive
  path, so a worker could append its own audit line and pass. When the roster names a `securityAgent`, only that agent
  may change `.claude/contracts/security-audit-log.md`; the headless ownership check and the live `PreToolUse` hook
  both refuse anyone else, and `ownershipGuard: false` does not lift it.
- **The shell security gate had fallen behind the PowerShell one.** `security-gate.sh` did not understand `!` lines
  (a test file that is itself a security control), did not enforce the append-only ledger, did not tolerate an invalid
  pattern that exists only in the previous list, and did not print the "checked N changed file(s)" line CI uses to tell a
  real check from a gate that ignores its arguments. It now matches the PowerShell script (its pretooluse command
  parsing is still simpler; the header says so).
- Test-tamper guard: `.skipIf`, `.runIf` and `.todo` are now skip/disable markers (ATS-L1).
- A tier's model id in `providers.json` is checked against `[A-Za-z0-9._:/-]` at dispatch and by `lint`, as the
  council path already did; the command runs through a shell.

### Tests and CI
- `tests/eval-runner.test.mjs`: the eval runner (graders, `--yes` and clean-tree refusals, `--tiers` with escalation off,
  route evals, `compare`) had no behavioural test, only a syntax check.
- `tests/security-gate.test.mjs`: the same scenarios run against `security-gate.sh` and `security-gate.ps1` (PowerShell
  on Windows, `pwsh` elsewhere), so the two cannot drift apart again; the shell tests were shown to fail against the old script.
- CI parses every `assets/*.json.template` (the hooks template was missing from the list) and `bash -n`-checks the shell templates.

### Fixed (found while building the above)
- A hook command written as one string with `$CLAUDE_PROJECT_DIR` was not expanded and no hook fired; the template
  uses the `args` form with `${CLAUDE_PROJECT_DIR}`.
- Hook stdin is read as a stream: `readFileSync(0)` returned an empty payload on a Windows pipe from some shells,
  which made every guard allow everything.
- Token accounting counts an assistant message once, at its maximum usage. A message is logged on one line per
  content block and its usage grows while streaming, so summing every line overstates and keeping the first line
  understates.

### Changed
- **This repo is now generic.** References to the project the 1.2.0 hardening came from (its name, paths,
  audit IDs and domain vocabulary) were removed from the changelog, docs, templates, comments and tests;
  evidence is now described as "a live run" or "a consuming project". New `AGENTS.md`/`CLAUDE.md` state the
  rule for any session that opens this repo, and `tests/no-project-references.test.mjs` fails CI if a
  consumer's identifiers come back (add names to a local, gitignored `.private-terms` to extend it).
  The security-gate templates' example test-file pattern is now neutral.

### Fixed
- **The integrity seal flagged the SubagentStop gate's own state file.** `.claude/hooks/` is sealed, but the gate
  rewrites `.subagent-gate-state.json` (PowerShell) or `.subagent-gate-state/` (sh) there while it runs, so
  every sealed project reported tampering after the gate's first run. Those exact paths are now excluded by
  default (a consuming project had worked around it with a per-project `integrityExclude`). Look-alike
  names and any other new file in `.claude/hooks/` are still flagged.

### Known issues (found by a security audit of the orchestrator, 2026-10-22; H1 and most of L1 are fixed above)
- **ATS-M1:** child processes inherit the full environment, and `adviseOnce` runs in the project root, so a
  read-only Codex call can still read and send any file it can reach. Fix: allowlisted env for children; run
  advice calls from an empty temp directory.
- **ATS-M2:** `finishMerge` runs `git reset --hard` in the main tree on a failed integration check, trusting a
  clean-tree test taken up to the whole run earlier. Fix: re-check status right before merging and reverting,
  and revert the merge commit instead of resetting.
- **ATS-M3:** `integrity.json` is gitignored, so deleting it silently returns a project to "not sealed";
  `AGENT_TEAM_ALLOW_NONINTERACTIVE_SEAL` lets a non-interactive process seal. Fix: keep the manifest next to the
  key outside the repo or fail when a key exists without a manifest; gate the env override behind the test runner.
  The SubagentStop tamper check runs the working-tree orchestrator from a relative path and shares the 3-strike
  breaker; it should run the HEAD copy from the project dir and not fail open.
- **ATS-L1 (partly fixed):** `[allow-test-changes]` in an unsealed queue line turns the tamper guard off.
- **ATS-L2:** events.jsonl stores up to 200 characters of reviewer output and blocked reasons, and
  `markItemBlocked` writes raw output into the tracked STATUS.md.
- **ATS-L3:** providers spawn with `shell: true`, so on Windows a `codex.cmd` in the cwd can shadow the real CLI
  unless `NoDefaultCurrentDirectoryInExePath` is set. Fix: absolute command paths or set the variable in the spawn env.
- **ATS-L4:** the gate tells the next subagent to revert protected-file changes even when they are an approved
  edit awaiting re-seal; it should say report.
- **ATS-L5:** the range gate runs the worker's own copy of the gate script, and a reviewer with no verdict lets the
  merge proceed.

## 1.2.0

Hardening of the Claude-mode path, driven by running the scaffold in a real project, on top of 1.1.0.

### Added
- **One security gate script, three entry points**: the Claude Code `PreToolUse` hook, the git
  `pre-commit` hook (`assets/githooks-pre-commit.template`, for Codex, Gemini CLI and people), and
  `range <base> <head>` mode, which `orchestrator.mjs` runs on a worker's branch before merging and CI
  runs on pull requests. The orchestrator no longer has its own ledger check, so the headless and
  interactive rules can't drift.
- **`reference-transaction` hook template**: runs the gate in range mode on every local branch update,
  so merges, cherry-picks, rebases, force-moved and new branches are checked too.
- Gate hardening: the path list is read from git (before and after the change, never the working
  tree) and classified with the union of both; the ledger is append-only and only added lines count;
  `!` lines gate a test file that is itself a control; hidden commit forms (`-a`, paths, hook skips,
  `core.hooksPath`, config and alias tricks, plumbing) are refused; a pass prints a summary line.
- **Model tiers per task**: `tier` per agent and `[tier:x]` per queue item, mapped to each provider's
  model through `providers.json` `tiers` + `modelFlag`; a failed check escalates one tier
  (`escalateOnFail: false` turns it off); each dispatch ends with a `dispatch_end` event in
  `events.jsonl` recording the tiers tried.
- AGENTS.md / agent.md rules from live failures: reports are evidence, not proof; a skipped test is
  not a pass (including skips caused by a task runner dropping an env var); parallel agents get
  isolated databases and worktrees and never run tree-wide git commands; a worktree's base commit is
  named and checked; every report ends with "Decisions and assumptions"; the last message is the
  whole report, also after a resume.

### Fixed
- A ledger path followed by a sentence-ending full stop now counts (`a/b.ts.` names `a/b.ts`;
  `a/b.ts.bak` and `a/b.tsx` still don't).
- Merging 1.1.0: `globToRegex` is kept for the ownership and test-tamper guards.

## 1.1.0

### Added
- **Playbooks** (SKILL.md step 3b): per-agent `PLAYBOOK.md`, toolbox (`files/`, `examples/`) and
  correction log (`notes.md`), built by a full interview or by AI-recommended drafting; every line
  tagged `[confirmed]` / `[AI-recommended]` / `[UNCONFIRMED]`. Definition of done with evidence checks.
- **Correction loop** in the AGENTS.md template: diagnose the failing layer, smallest durable fix, log it.
- **`llm-council`** (step 10): conflict resolver that ends in options for the user; Claude subagents
  plus read-only Codex/Gemini members through `orchestrator.mjs ask`.
- **Integrity seal**: signed hashes of the gate config, hooks, agent files and playbooks, checked before
  and after every dispatch and by the SubagentStop gate; `seal` requires a TTY.
- **Test-tamper and feature-list guards**: deleted tests, added skips and net-removed assertions are
  rejected before self-verification runs.
- **Independent verifier**, **mergePolicy**, **integrationCheck** (with rollback), **maxBudgetUsd**,
  **STOP kill switch**, **events.jsonl run record**, and `lint`.
- **Eval harness** (step 11): offline routing evals, real dispatch evals with pass@k / pass^k and a
  with/without-playbook baseline.
- Templates: allowlist, features.json, init.sh, spec-first, settings deny rules.
- A behavioural test suite (`node --test "tests/*.test.mjs"`) driven by a fake provider, and CI.

- **Ownership guard**: files changed outside an agent's `ownership` (plus `sharedPaths`, and contracts) send the
  worker back before verification. Previously the roster's partition was not enforced at dispatch time.
- **Routing**: an untagged queue item matching more than one agent is now BLOCKED (it used to go to the first
  agent in roster order); hyphens/underscores and spaces match each other.

- **Security gate, single source of truth** (first made in a project's own copy of this skill, then upstreamed):
  `.claude/security-sensitive-paths.txt` is the only list of sensitive paths; the hook templates read it,
  block when it is missing, and block when a required pattern no longer matches any tracked file (so a
  refactor that moves files can't leave them silently ungated). `assets/security-sensitive-paths.template.txt`
  is the starting point. The orchestrator now reads the same file (falling back to the roster globs), and
  `lint` flags placeholder or invalid lines.
- Model guidance for agents that choose dependency versions (start at sonnet, two architecture rules).

### Fixed
- In shared-workspace mode (no worktree) the orchestrator's own `events.jsonl` / `integrity.json` / `STOP` counted as
  an out-of-ownership change, and could be swept into the worker's commit. They are now excluded from both.
- Found by the first GitHub Actions run (both jobs were red): **STOP / timeouts did not kill the worker on
  Linux/macOS** (only the shell wrapper died; the CLI kept running) — workers are now spawned as their own
  process group and the group is killed. **The seal key was looked up by the raw working-directory string**, so
  a project sealed from a Windows 8.3 short path (`C:\Users\RUNNER~1\…`) and checked from the long path found no
  key; the lookup now uses the canonical path. `.gitattributes` keeps scripts and templates LF.
- The merge-boundary security check missed a new file inside a new directory: `git status --porcelain`
  reports it as `?? src/`, which never matched `src/auth/…`. It now uses `--untracked-files=all`.
- The orchestrator never committed a worker's edits in its worktree, so `git merge` carried nothing and
  the work was discarded with the worktree. It now commits on pass.
- An integration-check failure with empty output was reported as success.
- Lint flagged a legitimate command containing `> /dev/null` as a template placeholder.
- A worktree that could not be created (e.g. Windows path-length limit) crashed with a stack trace and no queue
  update; it is now reported with the fix and cleaned up.
- The verifier ignored a verdict wrapped in markdown (`**VERDICT: PASS**`).

### Known open
- Headless workers still run with each CLI's permission-bypass flag (no deny rules, sandbox mode or
  network scoping). Tracked, deliberately not changed in this release.
- Gemini CLI has no verified read-only `adviceArgs`; Codex's was confirmed against `--help` but a live
  call on codex-cli 0.139.0 failed on a model-version error.

## 1.0.0
Initial public shape: roster proposal, contracts, handoff reports, AGENTS.md routing, provider-agnostic
orchestrator with self-verification and security gates, quota checks.
