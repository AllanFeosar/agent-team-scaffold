# Security Audit Log

> Append-only. `<security-agent-name>` adds one entry per audit, **before**
> the commit that contains the audited files — the `security-gate` hook
> requires this file to be staged in the same commit and to name every
> staged security-sensitive file, so an entry only counts if it's tied to
> the exact diff being committed. Never edit or remove a past entry;
> corrections get a new entry.

## Format
```
## <date> — <one-line feature/change description>
Files audited: <path1>, <path2>, ...
Verdict: <X Critical, X High, X Medium, X Low>
Recommendation: <ship / fix before ship / blocked>
Findings: <link to the handoff report in .claude/contracts/handoffs/, or "none">
```

---
<!-- newest entries at the bottom -->
