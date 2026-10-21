---
name: llm-council
description: Resolve a conflict between agents, or a misunderstanding that changes what gets built, by convening a council - several members (different lenses, different Claude models, and optionally Codex or Gemini) answer independently, rank each other's anonymised answers, and a chairman turns the result into 2-4 decision options for the user to choose from. Runs when agents contradict each other, two agents claim the same work, a NEEDS request loops, a fix loop ends in disagreement, or a request has several materially different readings. Not for lookups, routine edits, or anything the contracts or playbook already answer.
---

# LLM Council (conflict resolver)

Adapted from the Fireworks-based LLM Council in
[dair-ai/dair-academy-plugins](https://github.com/dair-ai/dair-academy-plugins)
(MIT, by DAIR.AI), which implements Karpathy's idea: independent answers,
anonymous cross-ranking, a chairman's synthesis. The method is kept; the
transport is replaced. There is no Fireworks key and no third-party model
host. Members are:

- **Claude members** - subagents of the current session, dispatched with
  the native `Agent` tool (this is where different *models* - `opus`,
  `sonnet`, `haiku` - and different *lenses* come from).
- **Codex / Gemini members** - the CLIs already configured in
  `.agent-team/providers.json`, called one at a time through
  `node .agent-team/orchestrator.mjs ask <provider> [--model <id>]`. That
  command runs the provider with its read-only `adviceArgs`, never with the
  write-capable flags used to dispatch work, so a member can advise but
  cannot edit.

The council **advises; the user decides.** Its output is a short list of
options, not a verdict that gets acted on.

## When the council runs - and when it must not

The council is a conflict resolver, not a general-purpose thinking aid. Run
it when one of these has happened and the repo cannot settle it:

| # | Trigger | Example |
|---|---------|---------|
| 1 | **Contradiction** - two agents' handoff reports or contract entries disagree on a fact that matters | backend says `leave_type_id` is `int`, mobile's report says `string`; the code supports both readings |
| 2 | **Ownership clash** - a task plausibly matches two routing rows, or two agents edited or claimed the same path | "add an offline cache" fits both `mobile-agent` and `api-agent` |
| 3 | **NEEDS loop** - agent A emits `NEEDS B` and B emits `NEEDS A`, or the same NEEDS comes back after it was already satisfied | a ping-pong that no single agent can break |
| 4 | **Fix loop ends in disagreement** - an agent exhausted its 3 attempts and its diagnosis contradicts the reviewer's or security agent's, or the fix would cross into another agent's territory | the test fails, backend says "client bug", client says "server bug" |
| 5 | **Misunderstanding with tradeoffs** - the request has two or more materially different readings, the repo does not say which, and each reading leads to different work | "make reports faster" could mean query tuning, caching, or pagination |

**Do not convene it for:**
- A fact the user can answer in one line - ask the user instead. The council
  is for choices that need weighing, not for relaying a question.
- A single agent failing with a clear fix, a lookup, a routine edit, or
  anything `contracts/` or the agent's `PLAYBOOK.md` already answers.
- The same issue twice. **One council per conflict.** If the user picks an
  option and the conflict returns, escalate to the user; do not re-run it.
- A headless dispatch (`run-phase`). No human is there to choose, and the
  council needs the interactive `Agent` tool. Mark the item BLOCKED with
  the reason `needs decision: <trigger #>`; convene the council when a
  person next works interactively.

If `.agent-team/council.json` has `"autoRun": false`, announce the trigger
and wait for the user to say go. If it is `true` (the default the user chose
at scaffold time), run it, but first say which trigger fired and the cost
(see below).

## Cost

About **2N + 1** member calls (N answers, N rankings, one chairman). Say the
number when announcing. Default council is small (3 members) on purpose;
the user raises it in `council.json`, or per run by asking.

## CRITICAL RULES

1. **Dispatch from the main session only.** Subagents are one level deep: a
   Claude member cannot spawn anyone, and cannot ask the user questions.
2. **Each phase is one parallel batch.** All Phase 1 calls go in one message
   (Claude members as `Agent` calls, other providers as `Bash` calls running
   `orchestrator.mjs ask`), then all Phase 2 calls in one message, then the
   chairman.
3. **Save every raw response verbatim.** Never summarise or trim a member's
   answer before the next phase.
4. **Members get the whole brief and nothing else** - they do not see this
   conversation. Put the conflict, both sides' actual text, and the
   constraints in the brief.
5. **Members advise in text only.** The brief says: do not edit files, do
   not run state-changing commands, do not dispatch other agents.
6. **Never skip Phase 2.** Cross-ranking is where a confident wrong answer
   gets caught.
7. **The user chooses.** The council ends with options put to the user. Do
   not act on the recommended option without their pick.

## Configuration

Read `.agent-team/council.json` (shape in `assets/council.json.template`).
If it does not exist, use: `mode: multi-agent`, members = the session's own
model with three lenses (Contrarian, First principles, Executor), chairman
= the strongest Claude model available, `autoRun: true`.

- **mode** `multi-agent` - same model, different lenses. Cheapest. Uses the
  first Claude entry in `members` (or the session's own model) for every
  lens; the other `members` are ignored in this mode.
- **mode** `multi-model` - same brief to different models and/or providers,
  no lens. Disagreement comes from the models.
- **mode** `both` - each lens on each member. Most coverage, most cost; cap
  the total at `maxMembers` (default 6).
- **members** - `{ "provider": "claude", "model": "opus" }` (Claude, via the
  `Agent` tool; `model` is `opus`, `sonnet`, `haiku`, or `fable` where the
  account has it) and/or `{ "provider": "codex" }` / `{ "provider": "gemini" }`
  (via `orchestrator.mjs ask`, optional `"model"`).

Before using a non-Claude member, check it is actually usable. Run
`echo "Reply OK" | node .agent-team/orchestrator.mjs ask <provider>` once. If
it exits non-zero (not installed, outdated, no `adviceArgs`, usage limit),
drop that member, tell the user why in one line, and continue with the rest.
A council needs at least 3 valid answers; below that, stop and tell the
user, rather than ranking two voices.

## Lenses

Used in `multi-agent` and `both` modes. A lens is a stance to argue from,
not a personality. Default three; add the other two when `maxMembers` allows.

| Lens | Stance |
|------|--------|
| Contrarian | Assume the leading option is wrong. What is the strongest case against it, and what breaks first? |
| First principles | Ignore how it is usually done. What is actually being decided, and what follows from the constraints alone? |
| Executor | Assume a decision is made. What is the concrete first week of work, and where does it stall? |
| Outsider | You know nothing about this system. What is confusing, assumed but unstated, or contradicted? |
| Expansionist | What option is nobody considering? What does each current option close off? |

## Step 1 - Write the brief

Stand-alone, because members see nothing else. Include: which trigger
fired; the two (or more) positions quoted from the real files or reports,
with file paths; what each agent owns; the constraints; what is already
ruled out; and the question as a decision ("which of these should we do,
and what would you do differently?").

Create the session directory `.agent-team/council/<YYYYMMDD-HHMMSS>/` and
write `config.json` (trigger, brief, members, chairman) into it.

## Step 2 - Phase 1: independent answers

Prompt for every member (lens line only in `multi-agent`/`both`):

```
You are a member of a decision council resolving a conflict between agents.
Argue from this stance: <LENS>.

BRIEF:
<the brief>

Start with your recommendation in one sentence. Then your reasoning, the
two strongest risks you see, and what would change your mind. Commit to a
position; do not hedge across every option. Text only: do not edit files,
run commands that change anything, ask questions, or dispatch other
agents. Under 400 words.
```

- Claude member: `Agent` call, `subagent_type: general-purpose`, `model`
  set per member (omit `model` in plain multi-agent mode).
- Codex / Gemini member: `Bash` call piping the prompt on stdin:
  `node .agent-team/orchestrator.mjs ask codex` (add `--model <id>` if
  configured). Write the prompt to a file in the session directory first
  and redirect it (`< phase1/prompt.txt`) so quotes and newlines survive.
  Exit code `2` means deferred by a usage limit; treat as a failed member.

Save each answer verbatim to `phase1/<member-id>.md` with a header giving
member id, provider, model, lens. A failed member is recorded as failed.

## Step 3 - Phase 2: anonymous ranking

Shuffle (do not use dispatch order) and assign labels A, B, C...; save
`label_map.json`. Build one bundle with answers under labels only. **Strip
provider, model, lens, and any "as the Contrarian..." phrasing** from the
text (note if you removed any). Send every member the brief, the bundle, and:

```
Rank these answers from best to worst: letter, then one or two sentences
why. Then state (1) the strongest point any answer made that the others
missed, and (2) the single biggest error or unsupported claim, naming the
letter. You may rank your own answer but do not assume which it is. Text
only; do not edit files, run commands that change anything, or dispatch
other agents.
```

Save to `phase2/<member-id>.md`. Compute the sum of rank positions per
label into `tally.json`, so the aggregate is data and not impression.

## Step 4 - Phase 3: chairman produces options

One call to the chairman (default: Claude via `Agent`, strongest model)
with the brief, all answers with identities revealed, all rankings, and the
tally. It must return **2-4 distinct options**, not one blended verdict:

```
CONFLICT IN ONE LINE: <what is actually being disagreed about>
OPTION 1 (recommended): <name>
  What it means: <concretely, who does what next>
  Why: <reasoning that survived cross-ranking>
  Cost / risk: <what it gives up, what could go wrong>
  Support: <how many members ranked a matching answer first; who dissented>
OPTION 2: ...
OPTION 3: ... (optional)
ERRORS THE RANKINGS CAUGHT: <claims flagged, and whether they hold>
WHAT WOULD CHANGE THE RECOMMENDATION: <the fact that flips it>
```

Options must differ in what actually happens next, not in wording. If the
real answer is "a fact is missing", one option is "get that fact first" and
names who can supply it. A synthesis that averages everything into one
mushy compromise is a failed synthesis. Save to `phase3_options.md`.

## Step 5 - Show everything, then put the options to the user

1. Read every saved file back and show: the trigger and brief, members, every
   Phase 1 answer, the label map and rankings, the tally, the chairman's
   options. Save the combined text as `final_output.md`.
2. Put the options to the user with `AskUserQuestion` (single select, the
   recommended option first and marked "(Recommended)"; "Other" is
   always available for their own call). Include in each option's
   description the cost/risk line. This is the decision point - stop here
   until they answer.
3. **Record the decision**: append one line to
   `.agent-team/council/DECISIONS.md`:
   `<date> | trigger #<n> | conflict: <...> | chose: <option> | session: <dir>`.
4. Carry the chosen option out by dispatching the right agent(s) as normal
   - the council decides what, the roster does the work.
5. **Close the loop.** If the conflict happened because a rule was
   missing - an ownership boundary, a field type nobody wrote down - run
   the correction loop from AGENTS.md: diagnose the layer, write the rule
   into the relevant `PLAYBOOK.md` or contract, log it in `notes.md`. A
   council that keeps resolving the same kind of conflict is a sign of a
   missing rule, not a need for more councils.

## Limits to state honestly

- Claude members share training and can share a blind spot. Adding Codex
  or Gemini members gives genuinely different vendors; Claude-only
  councils give different models and stances, not independent minds. Say
  which kind this was when presenting options.
- Interactive only. It needs the in-session `Agent` tool and a person to
  choose, so it cannot run under `run-phase`. It is an advisory step, not a
  gate, which is why it sits outside the "provider-agnostic by
  construction" rule that governs gates.
- Codex and Gemini members are only as reliable as those CLIs on the
  installed version. `ask` refuses a provider that has no read-only
  `adviceArgs` rather than running it with write access.
- A thin brief produces confident answers to the wrong question, because
  members see nothing but the brief.
