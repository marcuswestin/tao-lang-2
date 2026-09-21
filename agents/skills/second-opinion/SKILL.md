---
name: second-opinion
description: >-
  Ask a model from another vendor to judge a Tao question independently, when agreement inside one
  family is not evidence. Use when Ro asks for a second opinion, a cross-check, or what another
  model thinks, and before a decision that is expensive to reverse. Off unless Ro asks for it.
---

# Second Opinion

Two agents from one model family that agree have not confirmed anything; they have shared a prior.
A model from another vendor, given the same question and none of the reasoning, is the cheapest
independent check available. Its disagreement is the signal — not its verdict.

`delegation` owns escalating to a stronger model of the same family through `oracle`. This skill
covers only the case where the value is in the vendor being different.

## Ro asks for it. You do not.

A second opinion sends repository contents outside this machine, and root `AGENTS.md` otherwise
forbids that. Ro has allowed it under three conditions, all of which must hold:

- The vendor is already configured for this repository — Codex or Gemini, whose CLIs and
  credentials are set up here. Never a service this repository does not already use.
- Ro asked for it in the current request. There is no standing permission, and one request does not
  extend to the next.
- What you send is the question and the code it concerns. Never `.env` files, secrets, keys,
  `~/.ssh`, `~/.aws`, `~/.config/gh`, or a whole-repository dump, and never a path Ro has not put in
  scope.

When those hold and you are unsure whether a particular file belongs in the prompt, leave it out and
say what you withheld.

## Running it

```bash
codex exec -s read-only --ephemeral --color never "<the question and the code it concerns>"
```

Give it stdin — `echo "" | codex exec …` — or it blocks reading stdin and looks hung.

## What the answer is worth

The other model cannot see this conversation or why the code is the way it is, so read it for the
second, not the first.

- Where it agrees, you have learned little; agreement is what a plausible answer produces.
- Where it disagrees, find out which of you is reasoning from something the other cannot see, and
  resolve that against the code rather than by picking a side.
- Quote what it said when you report it, and name the vendor and model. A second opinion relayed as
  your own conclusion is worse than not having asked.
