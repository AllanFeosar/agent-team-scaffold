# Spec-first front end — optional, for new features and greenfield work

Agents given a vague request produce confident work on the wrong problem; the cheapest place to
catch that is before any code. This is a short constitution → spec → plan → tasks chain in the style
of GitHub Spec Kit and Kiro, sized to this scaffold: the output of the last step is the
`STATUS.md` queue the orchestrator already runs. Skip it for bug fixes and small changes — it is
for work with several moving parts or unclear scope. Keep each document short; a spec that restates
what the code already shows is the same bloat the lint budgets exist to prevent.

Save under `docs/specs/<feature-slug>/`. The orchestrating session writes these WITH the user — it
asks, drafts, and the user approves each step — never an agent alone and never in a subagent
(which cannot ask questions).

## 0. `constitution.md` — once per project
Non-negotiables every feature must respect: architecture rules, security boundaries, what may never
be done (e.g. "never edit an applied migration — add a new one"), the definition of "tested". Pull
from AGENTS.md and the agents' Architecture rules instead of restating them; link, don't copy.

## 1. `spec.md` — what and why, no implementation
- **Problem** (2–3 sentences, in the user's words)
- **Users and the outcome they want**
- **Requirements**, each a single testable sentence with an ID (`R1`, `R2`…)
- **Acceptance criteria** per requirement, written so two people would grade them the same way
- **Out of scope** (explicit — the thing an agent will otherwise "helpfully" add)
- **Open questions** — each must be answered or consciously deferred before step 2

## 2. `plan.md` — how
Which agents own which parts (from the routing table), the contract changes needed
(`.claude/contracts/…`), the order they must happen in, and the riskiest assumption. If this step
surfaces a conflict between agents or two plausible designs, that is a council trigger.

## 3. `tasks` — straight into the queue
One `STATUS.md` queue line per task, each tagged with its agent and each carrying its own
completion criterion (`- [ ] [backend-agent] add GET /leave-types; done when tests/leave_types
passes`). For large scope, also generate `features.json` from the acceptance criteria
(assets/features.json.template) so the end state is defined before work starts.

## Check before dispatching anything
- Every requirement maps to at least one task and one acceptance criterion
- Every task names exactly one owning agent
- No task is open-ended ("improve", "monitor", "keep going") — each has a stopping point
