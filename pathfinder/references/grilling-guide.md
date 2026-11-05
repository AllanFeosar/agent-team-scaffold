# Grilling guide

Used at gate 3. The aim is not to collect answers; it is to find what is vague, contradictory or too optimistic before it becomes a plan.

## Contents
1. How a round works
2. Techniques
3. Push-back patterns
4. Question bank by domain
5. The decision ledger
6. Exit criteria and stopping
7. Mistakes to avoid

## 1. How a round works

- **One topic per round**, at most three questions. If an answer would change the next question, ask only that one.
- **Order by dependency.** Ask first what the other questions depend on (the goal's success measure, the budget, the deadline, who decides).
- **Each question has three parts**:
  1. the question,
  2. why it matters, in a clause,
  3. your recommended default.

  > **Q:** What does "done" look like at the first milestone? *(It sets how much of the plan has to be built first.)* **I'd suggest:** one team using it daily for two weeks. Keep, change or replace?
- **Offer quick replies** when there are few sensible answers. Put the recommended option first.
- **Look it up instead of asking.** If search or the person's own files can answer it, answer it yourself and ask only for confirmation: "I found X in your repo, so I'm assuming Y. Right?"
- **After each answer**, update the ledger. Every second round, show it: "Here is what I have so far."

## 2. Techniques

| Technique | Use it when | How |
|---|---|---|
| Pre-mortem | The plan sounds smooth | "It is a year from now and this failed. What is the most likely reason?" Ask for two or three; each becomes a risk with a mitigation or an accepted decision |
| Five whys | A goal is stated as a solution ("we need a dashboard") | Ask why until you reach the outcome they want. Plan for the outcome, not the solution |
| Constraint probe | Numbers are missing | Ask for the hard limit, the comfortable level and the dream: "What is the most you can spend? What would feel comfortable?" |
| Trade-off forcing | Two wishes conflict | Make them choose: "If speed and cost collide, which wins?" Record the ranking |
| Devil's advocate | The person is sure | Give the strongest case against their choice, from your research, and ask what they would say to it |
| Kill criteria | The path is long or expensive | "What result in the first month would make you stop or change course?" |
| Smallest slice | The scope is large | "What is the smallest version that would still prove this works?" |
| Reversal | Hidden scope | "What are you deliberately not doing?" |

## 3. Push-back patterns

- **Vague** ("fast", "cheap", "soon", "scalable"): "How fast, as a number? By what date? For how many users?"
- **Contradictory**: "Earlier you said A. Now B. These pull apart because C. Which one wins?"
- **Optimistic**: "You've planned for the plan going well. What happens at week six when it doesn't?"
- **Borrowed** (a preference that sounds copied): "Is that because of your situation, or because that is what the article said? Here is what the research says about situations like yours."
- **Unowned** (nobody named): "Who decides? Who does the work? Who is affected if it fails?"
- **Missing the money or time**: ask early; most plans fail on these.

Be direct and kind. The job is to improve the plan, not to win. If the person disagrees with a challenge, record their decision and move on.

## 4. Question bank by domain

Pick the questions the situation needs; do not run the list. Skip anything already known.

### Software and product
- Who uses it, and what do they do today instead?
- What is the single outcome that proves it worked, and by when?
- Which platforms, languages, hosting and tools are fixed, and which are open?
- What data does it hold, and what rules apply to it (privacy, retention, sector)?
- What must it integrate with, and who controls those systems?
- Expected load now and in a year? What breaks first?
- Who maintains it after launch? What is their skill level?
- Build, buy or assemble: what is the stated preference and why?
- What is the cost of being down, wrong or hacked?
- What is the smallest release you would be willing to show real users?

### Business, launch and operations
- Who is the customer, and how do you know they have the problem?
- What do they pay now to solve it?
- What does one customer cost to get and to serve? What do they pay?
- What are the legal, licensing or tax requirements where you operate?
- Cash on hand, runway and the point at which you stop?
- Who is on the team, and what are they not able to do?
- What does the closest competitor do well that you won't match?
- What is the first sale, and how does it happen?

### Learning, career and personal goals
- What does success look like in an observable form (a thing you can do, a job, a score)?
- Hours per week available, honestly, for how many months?
- What is your starting point? What have you already tried?
- What is the deadline, and what is driving it?
- What would make you quit? What has made you quit similar things before?
- Which resources can you pay for, and which must be free?
- Who can give you feedback along the way?

### Research, theory and explanation
- What exactly is the question, and what would count as an answer?
- Who is the audience, and what do they already know?
- What would change your mind?
- What is already established, and what is contested?
- What level of certainty do you need (a working model or a defensible claim)?
- What evidence is acceptable, and what would you reject?
- What format is the result for (talk, paper, decision memo, personal understanding)?

### Migration, change and projects inside an organisation
- What is the reason now, and what happens if you wait six months?
- Who must approve, who must adopt, and who can block?
- What cannot be interrupted during the change?
- How will you roll back?
- What is the real deadline, and what is the soft one?
- What do people do today that nobody wrote down?

## 5. The decision ledger

Keep it in the notes and show it every second round.

```
RESOLVED
- <decision> — <reason> — <who decided, round n>
ASSUMED  (needs the person's acknowledgement)
- <assumption> — <why you assumed it>
OPEN
- <question> — <what it blocks>
REJECTED
- <option> — <reason>
```

## 6. Exit criteria and stopping

Stop grilling only when all of these hold:
- Success is stated in a form someone could check.
- Scope is stated both ways: in and out.
- Constraints are known: time, money, skills, tools, legal.
- The top risks each have a mitigation or an accepted decision.
- The chosen approach is on record, with the rejected alternatives and reasons.
- The first milestone is defined.
- No Open item could change the shape of the output.
- Every Assumed item has been acknowledged.

Caps and exits:
- After **four rounds** with items still open, summarise them and ask the person to decide or defer each one.
- If the person says "enough" or "just go", stop. Record every remaining item as an assumption, show the list once, and continue.
- Quick depth: one round. Standard: two to three. Deep: as many as the exit criteria need, within the cap above.

## 7. Mistakes to avoid

- Asking a question you could have answered by searching or reading their files.
- Asking more than three questions in a turn.
- Asking without a recommended answer.
- Treating every answer as final: if later evidence contradicts it, say so and reopen it.
- Interrogating for its own sake. Each question must change something in the output.
- Letting politeness pass a vague answer: "soon" is not a date.
