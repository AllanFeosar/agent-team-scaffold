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

### Fixed
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
