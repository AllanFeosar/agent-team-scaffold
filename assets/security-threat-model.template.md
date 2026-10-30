# Security threat model — what the audits are for

Save as `.claude/contracts/security-threat-model.md`. The security agent reads it before every audit and
does **not** report, or start a fix round over, anything this file puts out of scope. Without it an auditor has
no stopping point: each round closes its finding and the next round finds a narrower one, because a reviewer
asked to find problems will keep producing them (a 2026 preprint measured 62% more false positives from
multi-round review). A written boundary is what lets an audit end.

## What we protect (in scope)
- <the assets: e.g. tenant isolation, authentication and session handling, the data classes that must never leak>
- <the trust boundaries: where untrusted input enters, which component enforces which rule>

## Attackers we defend against
- <e.g. an authenticated user of one tenant trying to reach another's data; an anonymous caller; a compromised dependency>

## Out of scope — do not report, do not fix-loop
- Attacks that need a precondition outside the application's trust boundary to have happened first (for example a
  database superuser or an operating-system administrator acting first).
- Code that only runs in development or test environments, unless it can reach production data.
- <anything else the owner has consciously accepted, each with the reason and the date>

## Severity policy
| Severity | What it means here | What happens |
|----------|--------------------|--------------|
| Critical / High | exploitable by an in-scope attacker, with real impact | blocks the merge; fix now |
| Medium | in-scope weakness with limited impact or needing unusual conditions | blocks the merge; fix now |
| Low / Info | hardening, defence in depth, or out-of-scope-adjacent | goes to `security-backlog.md`; **never** starts a fix round or blocks a merge unless it blocks a release |

## Audit rules
1. **A first audit** reviews the change against this model and the sensitive-path list.
2. **A re-audit** verifies the claimed fix and reruns the original probes. It does not hunt for new problems. New
   hunting happens only when a person asks for it.
3. **At most two audit rounds per change.** A third needs a person's decision, not another dispatch.
4. **Depth follows the diff** (`orchestrator.mjs risk`): mechanical and import-only changes get a light audit on a
   cheaper model; logic in authentication, authorization, tenancy or data-exposure paths gets the full audit.
5. **Evidence is reused.** Do not rerun a suite whose result is already stamped for this exact tree
   (`orchestrator.mjs stamp check`); run only your own targeted probes.
6. **Audit at the merge, not at every commit.** One audit of the branch (the gate's `range` mode) covers the
   commits in it.
