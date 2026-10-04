---
name: decision-rounds
description: >-
  Settle product, design, roadmap, and language-semantics decisions with the Developer. Use when
  asked to brainstorm, weigh options, or decide those questions, and before planning or
  implementing work that depends on unsettled Developer decisions. Routine implementation choices
  are excluded.
---

# Decision Rounds

Root `AGENTS.md` owns the boundary between the Developer's decisions and routine implementation choices. This skill owns how the decisions that are the Developer's get found and settled: all of them first, then a handful at a time.

## When

- Open a round when a task holds judgments that are the Developer's to make, before writing any plan that rests on them. A single such judgment is one round with one item; do not open a round for routine implementation choices.
- Language semantics still land through `Apps/WordFlower/2 - Next` and `Docs/Roadmap/Tao Revolution/Decisions.md`. A round feeds those records and never replaces them.

## Find every decision first

1. Brainstorm wide. List every decision the task raises, grouped by area, before narrowing anything. Include the items you would default and the items you would drop.
2. Show the whole inventory in the numbered/lettered shape root `AGENTS.md` sets for replies to the Developer, marking each item you propose to drop or default with the default stated in a few words.
3. Narrow with the Developer. The Developer strikes, adds, or promotes items; the survivors are the decision list.

## Every reply ends with questions

Until the list is settled, every reply in the dialogue ends with a `Decide now` block, even a reply that answers the Developer's question, records their answers, or adds context they asked for:

- Each item is a top-level list entry phrased as a question, ending in `?`.
- Under it, its realistic options, one line each, with exactly one marked **(recommended)**.
- Nothing else goes inside the block. Context, evidence, and what was settled come before it, ideally under one short heading per question, so the questions can be answered without rereading the prose.

A reply that ends in context, a summary, or a vague "which do you prefer" breaks the dialogue. The only reply without a `Decide now` block is the one that says the list is settled and what happens next.

## Settle them a handful at a time

1. Present three to five per round, upstream decisions first so later rounds shrink or disappear.
2. Give each decision its realistic options and mark the recommended one, as above.
3. Print the round as text in the reply, in the shape below. Never put it through a harness question prompt such as `AskUserQuestion`: a prompt hides the round from the transcript, caps what an answer can say, and forces every item through its own box. The Developer answers in the conversation — by letter and number, in prose, or with an option the round did not offer.
4. The Developer may answer "your recommendations" or "defaults for the rest"; take them and continue. An item the Developer skips takes its recommendation, and the next message says so in one line so the Developer can veto it.
5. Continue until the list is settled, then plan and implement. A decision discovered during implementation joins the next round; it is not decided silently.

## Record what was settled

- The conversation is the record. The handoff lists the decisions made, and the commit message carries the ones that shaped the change among its bullets.
- Language and product decisions additionally follow their existing owners: amend `Decisions.md` or `2 - Next` in the same change, as `Docs/Roadmap/Tao Revolution/Process.md` requires.

## Shape

Informative, not prescriptive; the shape bends to the task.

```text
Decision inventory
1. Response shape
   - a. addressable sub-items — default: letter them
   - b. depth cap — propose dropping; judgment covers it
2. Placement
   - a. AGENTS.md, a skill, or both

Context
- Depth cap: replies nest lists up to three levels today; two would force flatter answers.

Decide now
A. How deep may reply lists nest (1.b)?
   1. Two levels
   2. Three levels (recommended)
B. Where does the rule live (2.a)?
   1. AGENTS.md only
   2. AGENTS.md plus one skill (recommended)
```
