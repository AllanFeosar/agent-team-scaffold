# Changelog

Generated projects record the version they were scaffolded from in `.agent-team/scaffold-version`, so a
retrofit (SKILL.md step 8) knows which template generation it is diffing against.

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

- **Security gate, single source of truth** (merged in from a live project's installed copy of this skill):
  `.claude/security-sensitive-paths.txt` is the only list of sensitive paths; the hook templates read it,
  block when it is missing, and block when a required pattern no longer matches any tracked file (so a
  refactor that moves files can't leave them silently ungated). `assets/security-sensitive-paths.template.txt`
  is the starting point. The orchestrator now reads the same file (falling back to the roster globs), and
  `lint` flags placeholder or invalid lines.
- Model guidance for agents that choose dependency versions (start at sonnet, two architecture rules), from the
  same project.

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
