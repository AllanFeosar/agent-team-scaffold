# Deliverable templates

Used at gate 5. Pick the kind (or two) agreed at gate 4. Cut any section that does not apply; add none that do not help. Length should match the goal.

## Contents
1. Front matter and the shared sections
2. Roadmap
3. Blueprint
4. Theory
5. Sources section
6. Quality checklist

## 1. Front matter and the shared sections

Every deliverable starts with this block, then the summary.

```
# <Title>
Kind: roadmap | blueprint | theory      Version: 1      Valid as of: <date facts were checked>
Goal: <one line>      Depth: <quick | standard | deep>      Confidence: <high | medium | low> — <why>

## Summary
<five to eight lines: the goal, the recommended path, the three things that matter most, the first action>
```

Every deliverable also ends with these three sections, in this order:

```
## Open questions
- <question> — <what it affects> — <how to settle it, and by when>

## Next three actions
1. <action> — <who> — <by when>
2. ...
3. ...

## Sources
(see section 5)
```

Mark every statement that is not sourced as **Assumption** (the person or you assumed it) or **Inference** (derived from sourced facts, with the reasoning shown).

## 2. Roadmap

A path over time. Outcomes before activities.

```
## Where we are, where we're going
- Starting point: <facts>
- Destination and how we'll know we're there: <measurable success criteria>

## Approach
<the chosen approach in a paragraph; the rejected alternatives and why, one line each>

## Phases
### Phase 1 — <name>   (<duration or date range>)
- Outcome: <what is true at the end>
- Work: <the main items, not every task>
- Depends on: <people, approvals, lead times, earlier phases>
- Effort / cost: <estimate and how it was estimated>
- Exit gate: <the check that decides whether to continue, change or stop>
### Phase 2 — ...

## Decision points
| When | Decision | Options | What we need to know first |

## Risks
| Risk | Likelihood | Impact | Mitigation or accepted decision | Early warning sign |

## Kill and change criteria
<results that would make us stop or change course, taken from the grilling>

## Resources and budget
<people, money, tools, with ranges and sources>

## Tracking
<the few numbers to watch, how often, who owns them>
```

Rules: phases end in an outcome you can check; at most six phases; every date has a reason (a lead time, a deadline, a dependency); the first phase is small enough to start this week.

## 3. Blueprint

The structure to build and why. Decisions are the core.

```
## What this must do
<requirements as checkable statements; non-goals listed separately>

## Overview
<a diagram in text or a table of the parts and how they connect>

## Components
### <Component>
- Responsibility: <one line>
- Interfaces: <what it takes and gives, who calls it>
- Built with: <choice> — see decision D<n>
- Risks: <one line>

## Decisions
### D1 — <title>
- Decision: <what was chosen>
- Why: <reasons, with sources>
- Rejected: <alternative> — <why not>
- Revisit if: <condition>

## Data and flows
<what is stored, where, who can see it; the main flows step by step>

## Constraints
<legal, security, performance, cost and operational limits that shaped the design, with sources>

## Build order
1. <slice> — <what it proves> — <depends on>
2. ...

## How we verify it
<tests, checks, pilots or measurements tied back to the requirements>

## Run and maintain
<who operates it, what breaks first, how to roll back>
```

Rules: every component traces to a requirement; every decision has a rejected alternative; the build order starts with the slice that proves the riskiest assumption.

## 4. Theory

An explanation, model or argument, built from evidence.

```
## The question
<exactly what is being explained or decided, and what would count as an answer>

## The short answer
<the claim in two or three sentences, with its confidence>

## The model
<the explanation in steps: the mechanism, the parts, how they interact>

## Evidence for
| Claim | Evidence | Source type | Strength |

## Evidence against and limits
<the strongest counter-arguments, what they get right, where the model does not apply>

## What is settled and what is contested
<separate lists>

## Implications
<what follows if the model holds; what the person should do or look at>

## What would change this
<observations or results that would weaken or overturn the model>
```

Rules: separate fact, inference and opinion; give the strongest opposing view fairly; state the confidence and what it rests on; no claim without evidence or a label.

## 5. Sources section

```
## Sources
Checked: <date>
| # | Source | Type | Published | Used for |
|---|--------|------|-----------|----------|
| 1 | <title, publisher> <URL> | primary | 2026-03-02 | <claim or decision it supports> |
```

Cite in the text as [1], [2]. Include sources that disagree with the recommendation; leave out sources you did not use.

## 6. Quality checklist

Run this before delivering. Fix, or say plainly why not.

- [ ] The summary tells a reader the goal, the recommended path and the first action without reading further.
- [ ] Every factual claim has a source with a date, or is marked Assumption or Inference.
- [ ] Every load-bearing claim rests on a primary source or two independent ones.
- [ ] No source, URL, number or quote was invented.
- [ ] Every Resolved decision from gate 3 appears, with its reason, and every rejected option with why.
- [ ] Every Assumed item the person acknowledged is listed as an assumption.
- [ ] Items the final sweep changed are reflected, and the person was told.
- [ ] The risks come from the pre-mortem and the sweep, not generic ones.
- [ ] Dates, prices and versions carry "valid as of".
- [ ] Open questions say how and when each gets settled.
- [ ] The next three actions can start this week.
- [ ] Length fits the goal; nothing is there only because the template has it.
- [ ] No text copied from a source beyond a short quote; claims are in your words.
