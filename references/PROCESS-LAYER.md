# Process layer — how step 3b builds each agent's PLAYBOOK.md

Read this when running SKILL.md step 3b. The output shape is
[assets/playbook.template.md](../assets/playbook.template.md); this file is
only the procedure that fills it.

**Runs in the main session, never in a subagent.** A subagent cannot call
`AskUserQuestion`, so the question below and every interview question must
be asked by the orchestrating session itself.

## The one question that picks the mode

Ask once, before any agent's playbook is started, with `AskUserQuestion`
(single select, two options):

> How should the process layer be built for the confirmed agents?
> - **Full interview (Recommended when the work has house rules).** I ask you
>   questions one at a time and write down your answers. Slower, but it pulls
>   out the rules that only exist in your head.
> - **AI-recommended.** I read the codebase, docs, tests and git history,
>   draft every section myself, and ask you only about what I'm unsure of.
>   Fast, but anything I couldn't find evidence for stays marked unconfirmed.

Record the answer in each PLAYBOOK.md's `Built by:` line. If the user wants
a different mode for one agent (interview for the security agent,
AI-recommended for config ops), honour it per agent — the question can be
re-asked per agent on request, but do not ask it per agent by default.

## Mode A — Full interview

Goal: get the judgment out of the user's head. The user is not writing the
playbook; they are being interviewed, and the parts they would never think
to write down are the parts that matter.

Rules:
- **One question at a time.** Wait for the answer before the next. Prefer
  plain questions over `AskUserQuestion` option lists here — answers need
  to be in the user's own words, with real examples. Use option lists only
  for genuine either/or forks.
- **At least 8 questions for the first agent, at least 4 for each later
  agent** (answers about shared standards carry over; say "same as
  <agent>?" instead of re-asking). The user can say "done" at any point;
  topics not covered are written as `[UNCONFIRMED]`, not guessed.
- **Do not write the file until the user says it's done or the minimum is
  met and every topic below has been asked about.** Do not write a
  half-finished playbook as a placeholder.
- A question the user finds annoying is usually the one that matters. Ask
  it anyway, once.

Topics to cover (order is flexible; coverage is not):
1. What triggers this agent's work — in the words the user would type
2. Inputs, and exactly where each lives (file, table, dashboard, person)
3. The steps in the order the user really does them
4. Every decision the user makes and the rule behind it
5. What the user checks before calling it finished — this becomes the
   Definition of done; push for evidence ("how would you *know*?")
6. Edge cases that have gone wrong before — ask for the specific incident
7. The tone or standard the finished work must hit
8. What a bad version looks like — ask for a concrete example if they have
   one, and offer to save it under `examples/` as a *bad* example

After the interview: draft the PLAYBOOK.md, show the **whole file**, and
ask two questions: *what did I get wrong*, and *what did you forget to
tell me*. Fix in the file, not in chat. Expect the first version to be
about 80% right — that is normal, and the correction loop closes the rest.

Every line from the interview is tagged `[confirmed]`.

## Mode B — AI-recommended

Goal: the AI does the drafting from evidence; the human spends attention
only where the AI is genuinely unsure.

Procedure:
1. **Gather evidence, per agent**, from what is actually in the repo: the
   directory the agent owns; existing tests and what they assert; CI and
   lint config; README/CONTRIBUTING; the contract files; `git log` for how
   changes to that layer are usually made and what got reverted or fixed
   afterwards; TODO/FIXME comments; error-handling patterns. Name the file
   behind each claim.
2. **Draft only what the repo does not already say.** This mode generates a
   context file, and LLM-generated context files that restate the codebase
   were measured to hurt: no improvement in task success, 20%+ higher cost
   (arXiv 2602.11988). So a high-confidence fact that is visible in the code,
   tests, CI or a contract file does **not** get its own line — at most a
   pointer to where it lives. The playbook keeps the judgment the repo cannot
   show: *why* a rule exists, what has gone wrong before (from `git log` and
   reverts), what "bad" looks like, and the checks. Stay inside the line
   budgets in playbook.template.md. For each Decision, Edge case and
   Definition-of-done check you do keep, attach a confidence:
   - *high* — directly visible in code/tests/config (cite the file)
   - *low* — inferred, or a convention that could have two readings
   - *none* — no evidence. Do not invent. Write the line as
     `[UNCONFIRMED] <what's missing>` and let the human fill it.
3. **Ask the human only about low-confidence items and the none-evidence
   gaps**, batched into as few `AskUserQuestion` calls as possible (max 4
   questions per call, 2–4 options each, the AI's best guess first and
   marked "(Recommended)"). Do not ask about high-confidence items.
4. Present one "accept the rest" confirmation showing the high-confidence
   draft. Accepting it does **not** upgrade those lines to `[confirmed]` —
   they stay `[AI-recommended]`, because the human skimmed rather than
   decided. Only lines the human answered directly become `[confirmed]`.
5. If a decision is a real fork with stakes (it changes what the agent owns,
   or how it verifies) and the human is unsure too, and the `llm-council`
   skill is installed (SKILL.md step 10), offer to run the council on that
   one decision rather than guessing.

The honesty rule: the AI-recommended mode produces a *draft the AI
believes*, not a record of what the user knows. The tags are what keep
those two things distinguishable six weeks from now.

## What goes in the Definition of done (both modes)

Between 5 and 10 checks. Check 1 is the agent's existing self-verification
command, verbatim from step 3 — never a second competing check. The rest
come from: Mode A's topic 5; Mode B's tests/CI/lint evidence; and the
layer's own failure history in `git log`. Each needs evidence outside the
agent's opinion. When a candidate check is vague ("code is clean"), keep
asking "what number or exit code would show that?" until it is concrete or
drop it. Prefer checks that can run as a command and fold them into
`files/checks.<ext>` called by the self-verification command, so the gate
enforces them — see the "Enforced by" column in the template.

## Turn the checkable rows into a script

A Definition-of-done row marked `agent-reported` is only as good as the agent's word. For every row that a command can
verify (a count, an exit code, a file that must exist, a name pattern, "no skip added"), write it as a check in
`files/checks.sh` (start from [assets/checks.sh.template](../assets/checks.sh.template)) and make `selfVerification`
run it first. Mark the row `gate (inside check 1)`. What remains `agent-reported` should be only what truly needs
judgment. `lint` warns when more than half the rows are still agent-reported, and when a `checks.sh` exists that
`selfVerification` never runs.

## After either mode

- **Seal**: tell the user to review the generated files, then run
  `node .agent-team/orchestrator.mjs seal` at a terminal. Playbooks, agent
  files, hooks and the gate config are protected; until sealed, a worker's
  edit to them goes undetected. A worker cannot seal (it has no TTY).
- Create the empty `files/INDEX.md` (header row only), `examples/`, and
  `notes.md` (title line only) from the template shapes.
- Add the playbook pointer to `agent.md` and `CONTEXT.md` (their templates
  already contain it).
- Run the roster-overlap check once more against each playbook's "When to
  use this" list: two agents whose phrases overlap is a step 2 problem.
- Tell the user which lines are `[confirmed]`, `[AI-recommended]` and
  `[UNCONFIRMED]`, with counts per agent, so they know how much of the
  process layer is still unreviewed.
