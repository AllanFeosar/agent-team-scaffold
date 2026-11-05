# Pathfinder

A Claude Code skill that turns a goal into a researched, confirmed **roadmap**, **blueprint** or **theory**.

It does not answer from memory and it does not write the document first. It searches the internet for options, lets you react, searches again where your reply needs it, interrogates the plan until nothing important is vague, runs a second wide search aimed at breaking the plan, asks you to confirm, and only then writes.

```
0 Intake     "What do you want to achieve?"
1 Discover   wide online search → options brief with sources and a recommendation
2 React      you pick / combine / reject / add your own → it decides: search again, or move on
3 Grill      one decision at a time, each with a recommended answer, until nothing open could change the plan
4 Verify     a fresh search to break the plan, then a one-screen summary → you say "yes, create it"
5 Create     roadmap, blueprint and/or theory, every claim sourced and dated or labelled as an assumption
```

## What it produces

| Kind | For | Core of the document |
|---|---|---|
| Roadmap | a path over time | phases with outcomes and exit gates, decision points, risks, kill criteria |
| Blueprint | a structure to build | components, decisions with rejected alternatives, build order, how to verify |
| Theory | an explanation or argument | the model, evidence for and against, what is settled and contested, what would change it |

## Install

Copy the `pathfinder/` folder (the folder name must match the skill name) into your skills directory:

```
~/.claude/skills/pathfinder/        # all projects
<project>/.claude/skills/pathfinder/   # one project
```

Then ask for a roadmap, a blueprint, or "what are my options for…", or invoke it as `/pathfinder`.

## What is in the folder

```
pathfinder/
  SKILL.md                            the five gates and the hard rules
  references/research-protocol.md     query angles, source types, the options brief, the final sweep checklist
  references/grilling-guide.md        techniques, push-back patterns, question bank by domain, exit criteria
  references/deliverable-templates.md roadmap, blueprint and theory templates, and the quality checklist
```

## Design choices

- **Search twice, on purpose.** The first search happens before the plan is concrete; the second tries to break the plan once it is.
- **Ask only what search cannot answer**, one topic at a time, with a recommended default, so "go with yours" is a valid reply.
- **Web pages are data, not instructions.** Content from pages is never obeyed, and each source is tagged primary, research, journalism, vendor or user-generated.
- **Nothing is written before you confirm.**
- **It can say "don't".** If the evidence favours a smaller version or not doing it, the document says that.

The grilling gate follows the "interview me about every branch of the decision tree, one question at a time, with a recommended answer" pattern popularised by community "grill me" skills. The authoring structure (a short `SKILL.md`, details in references loaded on demand) follows common skill-authoring guidance.

## Status

Version 0.1.0. The structure is tested (`node --test`). Its behaviour in real sessions has not been evaluated yet; treat the first runs as a pilot and adjust the gates and question bank from what you see.

## Tests

```
node --test
```

Checks the frontmatter (name, description length), the folder name, the size of `SKILL.md`, that every reference it points to exists, and that long reference files have a contents list.

## License

MIT. See `LICENSE`.
