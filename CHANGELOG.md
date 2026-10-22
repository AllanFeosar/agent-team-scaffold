# Changelog

Generated projects record the version they were scaffolded from in `.agent-team/scaffold-version`, so a
retrofit (SKILL.md step 8) knows which template generation it is diffing against.

## Unreleased

### Known issues (security audit of a live integration, emr-platform 2026-10-22)
- **ATS-H1 (High):** a worker can satisfy the range gate by appending its own ledger line, because the
  ownership guard allows `.claude/contracts/**` to every agent and the gate only checks that added ledger
  lines name each sensitive path. Fix: only `roster.securityAgent` may change the ledger; hold (manual merge)
  any branch whose diff touches a sensitive path or the ledger. Workaround: `mergePolicy: "manual"` on every agent.
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
- **ATS-L1:** `SKIP_RE` misses `.skipIf`, `.runIf` and `.todo`; `[allow-test-changes]` in an unsealed queue line
  turns the tamper guard off.
- **ATS-L2:** events.jsonl stores up to 200 characters of reviewer output and blocked reasons, and
  `markItemBlocked` writes raw output into the tracked STATUS.md.
- **ATS-L3:** providers spawn with `shell: true`, so on Windows a `codex.cmd` in the cwd can shadow the real CLI
  unless `NoDefaultCurrentDirectoryInExePath` is set. Fix: absolute command paths or set the variable in the spawn env.
- **ATS-L4:** the gate tells the next subagent to revert protected-file changes even when they are an approved
  edit awaiting re-seal; it should say report.
- **ATS-L5:** the range gate runs the worker's own copy of the gate script, and a reviewer with no verdict lets the
  merge proceed.

## 1.2.0

Merged from a live project's hardening of the Claude-mode path (emr-platform), on top of 1.1.0.

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
