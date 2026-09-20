---
name: decision-rounds
description: >-
  Settle the product, design, roadmap, or language-semantics judgments a task raises with Ro before planning or implementing: brainstorm the decision inventory wide, narrow it, then decide a handful at a time with marked recommendations. Use when a task has choices Ro must make, when Ro asks to brainstorm, weigh options, or decide something, or before writing a plan that rests on unsettled decisions.
---

# Decision Rounds

Root `AGENTS.md` owns the boundary between Ro's decisions and routine implementation choices. This skill owns how the decisions that are Ro's get found and settled: all of them first, then a handful at a time.

## When

- Open a round when a task holds judgments that are Ro's to make, before writing any plan that rests on them. A single such judgment is one round with one item; do not open a round for routine implementation choices.
- Language semantics still land through `Apps/WordFlower/2 - Next` and `Docs/Roadmap/Tao Revolution/Decisions.md`. A round feeds those records and never replaces them.

## Find every decision first

1. Brainstorm wide. List every decision the task raises, grouped by area, before narrowing anything. Include the items you would default and the items you would drop.
2. Show the whole inventory in the numbered/lettered shape root `AGENTS.md` sets for replies to Ro, marking each item you propose to drop or default with the default stated in a few words.
3. Narrow with Ro. Ro strikes, adds, or promotes items; the survivors are the decision list.

## Settle them a handful at a time

1. Present three to five per round, upstream decisions first so later rounds shrink or disappear.
2. Give each decision its realistic options, one line each, and mark the recommended one.
3. Ro may answer "your recommendations" or "defaults for the rest"; take them and continue. An item Ro skips takes its recommendation, and the next message says so in one line so Ro can veto it.
4. Continue until the list is settled, then plan and implement. A decision discovered during implementation joins the next round; it is not decided silently.

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

Decide now
A. Depth cap (1.b): 1. two levels  2. three levels (recommended)
B. Placement (2.a): 1. AGENTS.md only  2. AGENTS.md plus one skill (recommended)
```
