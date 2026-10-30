# Dispatch brief and report — short on purpose

A long dispatch prompt and a long report are paid for again on every later turn that carries them in context, and
long input measurably degrades answers even when the task is simple (Chroma, "Context Rot", 18 models). Aim for
**the brief under about 150 words and the report under about 200 words plus the proof block.** Point at files
instead of pasting them.

## Brief (what the orchestrating session sends)
```
Objective: <the concrete outcome, one sentence>
Scope: <the paths/layers this touches; what is explicitly out of scope>
Done when: <the check that proves it — usually "selfVerification passes" plus one specific behaviour>
Read first: <1–3 files: contract, ADR, or the failing test — by path, not pasted>
Constraints: <only the ones that are not already in your playbook or agent file>
Re-audit? <if this is a re-audit: "verify fix <id> and rerun probes <list>; do not hunt for new findings">
```
Do not restate what the agent file and playbook already say. Do not say "try for a new bypass" unless you want a
new hunt: a reviewer asked to find problems will keep finding smaller ones.

## Report (what the agent sends back)
```
Result: <done | blocked | needs <agent>: <what>>   — one line
Changed: <paths, grouped>                          — a list, not prose
Decisions and assumptions: <each choice the brief did not make, one line each>
CHECKS
1. PASS|FAIL — <check> — evidence: <what you observed>
UNVERIFIED
- <anything you could not check>   (or: none)
```
No narrative of how it was done, no pasted diffs or test output beyond the failing lines, no restating the brief.
