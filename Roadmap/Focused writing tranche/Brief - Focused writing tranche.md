# Brief - Focused writing tranche

The next tranche cut from the Current ↔ MVP gap, per `Roadmap/Tao Revolution/Process.md`. It is the
first tranche after the dialect migration, so everything it adds is written once, in the final
dialect.

**Forcing feature:** a **focused writing mode** in WordFlower — spend X minutes free-writing before
stopping. `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp` names it as the forcing feature for
`@tao/time`, and `Coverage.md` marks the row **MVP · pending** with WordFlower as the app that must
prove it.

**Decisions implemented:** §2 _Unit values and literals_, §9 _Ticking clock — `@tao/time`_.

## Why this slice

It is the smallest cut that forces a capability the language does not have, rather than respelling
one it does. Three things fall out of one product feature:

- A **unit family** with conversion (`10.min`, `220.ms`, `Wait.s`), which nothing today can express.
- A **library value whose reading changes over time** (`time.Interval(1.s)`), which is the first
  reactive source that is not state or a query.
- A **derived value that recomputes from it** (`let Left = Timer.EndsAt - Tick.Value`), which proves
  the derivation path is live rather than evaluated once.

Every other pending MVP row — preferences, design blocks, copy, the TypeScript boundary — is either
larger or has no single feature that forces it yet.

## What already exists

The dialect tranche left the lexing and parsing in place, so this tranche is semantics, not syntax:

- `1.ms` already lexes as `NUMBER '.' ID` — `terminals.langium` tightened `NUMBER` so `1.5` stays one
  token while `1.ms` does not.
- `PostfixMemberAccess` already parses `.member` on any primary, including `(1.cm).meters`, and
  already lowers through the compiler.
- `<expr> from <path>` and named-export sidecars are in, which is how `@tao/time` binds its runtime.

What is missing is everything that gives those forms meaning.

## Slices

1. **Unit families and conversion (§2).** A `duration` family over `ms`, `s`, `min`, `h`. `.unit` on a
   number constructs; `.unit` on a typed value reads back. Typing rejects a cross-family read
   (`Wait.meters`), and equality normalizes (`1000.cm` equals `10.m`). Owner: `ast-utils` types plus
   the validator; the compiler lowers to a normalized number.
2. **`@tao/time` (§9).** A stdlib package beside `@tao/ui` and `@tao/data`, exporting `Interval`
   bound to its runtime through a named-export sidecar. `Tick.Value`, `Tick.Stop()`, `Tick.Start()`,
   `Tick.Running`. Starts on mount, stops on unmount.
3. **Live derived readings.** `let` over an interval recomputes as the interval ticks. This is the
   slice that decides whether derivation is already live enough or needs work in the runtime.
4. **The product feature.** A focused writing session in WordFlower Current: set a duration, run it
   down, stop at zero. Its behavior journeys are the gate.

## Open questions to settle before implementing

- **Which unit families ship.** §2 shows duration and distance. Duration is forced by this tranche;
  distance is not. Shipping only what is forced keeps `Coverage.md` honest, but a one-family
  mechanism risks not generalizing. Recommend: build the mechanism generically, register only
  duration.
- **`Left.Clock`.** §9's example formats a duration for display. That is either a unit reading, a
  `@tao/text` concern, or copy (§14). It needs an owner before the UI slice.
- **Determinism in journeys.** A ticking clock in a behavior test needs a controlled source. The
  world controls that would provide one are the same ones the retired `data <status>` waited on
  (see `Coverage.md`, fault-injection row). This tranche either brings a minimal time control with
  it or its journeys cannot be deterministic — decide before slice 4, not during.

## Definition of done

The six steps in `Process.md` § _Cutting a tranche_, with step 3 as the gate that matters: every
construct introduced is proved by a behavior test written in Tao and green under `tao test`.
Specifically — `2 - Next` carries the contract and returns to `absorbed`; `Coverage.md`'s
_Ticking clock_ row reads _in Current_; `Spec/` gains the unit-family and `@tao/time` pages; and
`./agent verify` is green.
