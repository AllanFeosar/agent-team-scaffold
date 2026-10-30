# Working on agent-team-scaffold

This repository is the **scaffold**: generic templates, one orchestrator, and docs about the mechanics.
It is used by other projects, in any field. Those projects are *consumers*. Nothing about a consumer
belongs here.

## The rule: no consuming-project details in this repo

Never write any of these into a file, a test, a changelog entry or a commit message:
- a consuming project's **name** or repo name
- its **paths, package names, ticket/audit/ADR IDs, or database/role names**
- its **client, vendor or regulator names**, or any **domain terms** that identify its field
  (medical, financial, and so on)
- real data, credentials, or hostnames of any kind

When a bug is found while running the scaffold inside a consumer, record the **mechanism**, not the
place it was found:

| Don't write | Write |
|---|---|
| "found in <project>, audit finding X-12" | "found in a live run" / "reported by a consuming project" |
| "<project>'s auth modules moved from `a/b/c` to `d/e/f`" | "a refactor moved every auth module to a different directory" |
| a consumer's real test-file suffix as an example | a neutral one, e.g. `\.(test\|spec)\.[jt]sx?$` |

Reproduce the bug with a **generic fixture** (the test suite already builds throwaway repos with a fake
provider) and keep the fixture generic. Don't paste a consumer's config, roster or playbook here.

## Why this rule exists

Fixes are discovered inside consumer projects, and the session that finds them edits this repo while its
head is full of that project. Without a rule the project name, paths and audit IDs slide into the
changelog and docs as "evidence", and the scaffold slowly turns into one project's notebook. This
repository is public.

## How it is enforced

`tests/no-project-references.test.mjs` scans every tracked file and fails CI if it finds a known
consumer name or domain term. To protect a name that must not even appear in this repo's tests,
add it to a local, gitignored file called `.private-terms` (one regular expression per line). Run it
before pushing:

```
node --test "tests/*.test.mjs"
```

Commit messages can't be checked by a file scan: apply the same rule to them by hand.

## Everything else

- Tests: `node --test "tests/*.test.mjs"` (fake provider, no network, no tokens).
- Keep `VERSION`, `CHANGELOG.md` and the SKILL.md step numbers in step with any change.
- Don't commit or push another project's `.agent-team/` runtime files (`events.jsonl`, `integrity.json`).
