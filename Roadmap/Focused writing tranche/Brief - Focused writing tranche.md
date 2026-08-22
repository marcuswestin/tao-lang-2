# Brief - Focused writing tranche

Implementation brief: findings and constraints, not a plan. Devise the plan yourself, and re-verify
every grammar and repository seam against the live checkout — the grammar facts below were read from
`packages/parser/parser-grammar/` on the day the tranche was cut.

This is the first tranche cut from the Current ↔ MVP gap (`Roadmap/Tao Revolution/Process.md`,
step 5), and the first after the dialect migration, so everything it adds is written once, in the
final dialect. **The cut is made:** `Apps/WordFlower/2 - Next` is open and carries the contract; its
`WordFlower.tao-next` header lists every decision, `@ui/Focus.tao-next` and `Focus.test.tao-next`
are the feature and its journeys, and `@tao-next/` is the scratch stdlib contract.

**Forcing feature:** a **focused writing session** in WordFlower — pick a length, write until the
clock runs out, pause and resume, or stop early. `Apps/WordFlower/3 - MVP/WordFlower.tao-mvp` names
it as the forcing feature for `@tao/time`, and `Coverage.md` marks the row **MVP** with WordFlower
as the app that must prove it.

**Decisions implemented:** §2 _Unit values and literals_ (duration only) and the calendar arithmetic
beside it; §9 _Ticking clock — `@tao/time`_; §15 `<expression> from <path>` in expression position;
§8's compact `when <boolean> <Yes> / not <No>`; §16's controllable clock, as `advance <duration>`.

## Why this slice

It is the smallest cut that forces a capability the language does not have, rather than respelling
one it does. Three things fall out of one product feature:

- A **unit family** with conversion (`10.min`, `220.ms`, `Wait.s`), which nothing today can express.
- A **library value whose reading changes over time** (`time.Interval(1.s)`), the first reactive
  source that is neither state nor a query.
- A **derived value that recomputes from it** (`let Left = EndsAt - Tick.Value`), which proves the
  derivation path is live rather than evaluated once.

Every other pending MVP row — preferences, design blocks, copy, the full TypeScript boundary — is
either larger or has no single feature that forces it yet.

## Findings

Read from the live checkout at the cut. Each is a seam the implementation crosses.

- **Unit syntax parses; nothing gives it meaning.** `terminals.langium` keeps `1.5` one `NUMBER` and
  `1.ms` as `NUMBER '.' ID`; `PostfixExpression` parses `.member` on any primary and the compiler
  lowers it as a plain member read. `min`, `s`, `h`, `d` are not grammar keywords, so `10.min` lexes
  cleanly. No type carries a family, so `Wait.meters` is accepted and `60.s == 1.min` is false.
- **Expression-position `from` does not exist.** The grammar has only the binding-site form,
  `configuration.langium`'s `<protocol> <Export> from <path>` for `provider` and `nav`. The dialect
  tranche put the general operator out of scope, and `packages/stdlib/@tao/text/Text.tao` still
  binds `CountWords` and `Join` through `inject <type> … \`\`\`ts`fences (`injections.langium`).`@tao/time`binds its runtime through the operator, so this tranche adds it and migrates`@tao/text`in the same step. Decisions §15 also names a bridge metadata module (`X.tao.ts`) so
  the TypeScript side can check the join; ship it only if the sidecar typing needs it.
- **`now` parses anywhere but is legal only as a `time` default** (`Spec/Tao Data.md`); `state
  EndsAt = now` and `now + Length` need it as an ordinary expression, with `time ± duration` and
  `time − time` typed per §2.
- **No member call.** `Tick.Stop()` is a call on a member path; `FunctionCallExpression` today calls
  a bare declaration name. `Tick.Start()` as an action statement is likewise new.
- **The compact ternary is not implemented.** `when <boolean> <Yes> / not <No>` (§8) appears in §9's
  decided example and the contract relies on it; the block `when X { … otherwise -> … }` exists in
  render and expression position with a mandatory `otherwise`, and `yes`/`no` case branches need
  confirming. `check` (§8) is also unimplemented — actions still early-exit with `guard X empty` —
  but the feature does not force it; leave it.
- **`state` has no type annotation** (`'state' name=ID '=' value=Expression`); the contract avoids
  needing one by anchoring `EndsAt = now` and keeping a boolean `Focusing`, rather than an optional
  time.
- **No clock in the runner.** `Spec/Tao Testing.md` says toast expiry "remains deferred until the
  runner has an explicit clock or wait contract", and every check receives a fresh Memory store but
  no controlled clock. The harness runs React under `act`; a fake-timer clock driven by
  `advance <duration>` (firing due `setInterval` callbacks in order) is the natural fit.
- **Toast `Duration` is hard-wired in the grammar** (`navigation.langium`: `'Duration' ':'
  duration=Expression`) and documented as numeric seconds. `3.s` already parses there; the
  runtime must read a duration instead of a bare number.
- **The JS number is the base.** §2 fixes duration's base at nanoseconds; a double is exact to 2^53
  ns ≈ 104 days, and `time` values are epoch milliseconds, so `time − time` is exact at millisecond
  resolution. Do not reopen the base; note the precision edge in the spec page.

## Decisions taken at the cut

Each is derivable from `Decisions.md` and recorded in the Next header; the first is the one Ro
should confirm before slice 2 begins, because it touches the import model.

1. **`use time from @tao/time` binds the package under its lowercase service name** and
   `time.Interval(…)` calls into it. §9 and §11 (`use auth from @tao/auth`) both spell stdlib
   services this way while every other stdlib import names capitalized declarations, so the coherent
   reading is: a lowercase name in a `use` line imports the package itself; capitalized names import
   declarations. This needs a scope rule, not a new declaration form. The alternative —
   `use Interval from @tao/time` and bare `Interval(1.s)` — respells a decided example and would
   have to amend `Decisions.md` in the same change (Process principle 5). **Confirm with Ro.**
2. **Duration is the only family registered.** The mechanism is a shared family/unit/ratio table so
   adding distance or mass is a row, but nothing forces them (Process principle 2), so they stay out
   and `Coverage.md` stays honest.
3. **`.Clock` is a duration reading** — whole seconds, `m:ss` under an hour, `h:mm:ss` from an hour
   up, `0:00` for zero or negative. §9's example and Skillet's `// \`.Clock\`: "19:59"`fix the
   shape; this fixes the edges. It is a reading on the family, not a`@tao/text` function and not
   copy (§14).
4. **A unit value compares against the bare literal `0`.** §2 makes value-plus-bare-number a compile
   error; §9's decided display writes `Left > 0`. Zero has no unit, so the rule is: comparison with
   the literal `0` is allowed, any other bare number is the §2 error.
5. **`advance <duration>` is the clock control**, taking any duration expression, so tests and
   product share one unit spelling and the runner gains no second number-word grammar. The
   unconsolidated Tao Future journeys write `advance 1 minute`; Process step 3 aligns them.
   Absolute `clock …` pinning is not forced by this feature and stays out.
6. **A toast's `Duration` is a duration** (`3.s`). A seconds-valued slot taking a bare number is
   exactly the pre-unit convention §2 retires.

## Slices

1. **Unit families and conversion (§2).** `duration` as a Prelude primitive and value head; the
   family table; `.unit` construct and read; equality by normalization; dimensional arithmetic;
   cross-family and bare-number diagnostics; `now` as an expression with `time ± duration` and
   `time − time`; `.Clock`. Owner: `ast-utils` types plus the validator; the compiler lowers to a
   normalized number; the formatter must leave `10.min` and `(1.cm).meters` untouched.
2. **Expression-position `from` (§15).** The operator, binding loosest, with free names resolved
   against the sidecar's named exports; `@tao/text` migrated off its fences in the same step and the
   fence retired from bodies. This is the slice that makes `@tao/time` possible.
3. **`@tao/time` (§9).** The stdlib package beside `@tao/ui` and `@tao/data`, per
   `2 - Next/@tao-next/Time.tao-next`: the lowercase service import, `Interval(Every)`, and the
   reactive value's `Value`, `Running`, `Start()`, `Stop()`, with mount/unmount lifetime.
4. **Live derived readings and the compact ternary.** `let` over an interval recomputes as it
   ticks; `when <boolean> <Yes> / not <No>`. This slice decides whether derivation is already live
   enough (a `let` in a view body re-evaluates per render) or needs runtime work.
5. **The test clock.** Fresh, fixed clock per test; `advance <duration>` fires due ticks in order;
   toast expiry proved in the documents journey.
6. **The product feature.** `@ui/Focus.tao-next` into Current, with `Focus.test.tao-next`'s two
   journeys green. Its behavior journeys are the gate.

## Definition of done

The six steps in `Process.md` § _Cutting a tranche_, with step 3 as the gate that matters: every
construct introduced is proved by a behavior test written in Tao and green under `tao test`.
Specifically — `2 - Next` returns to `absorbed` with `@tao-next/` graduated and deleted;
`Coverage.md`'s _Ticking clock_ row reads _in Current_ and the _unit values_ and _conditionals_ rows
advance; `Spec/` gains the unit-family and `@tao/time` pages and `Spec/Tao Testing.md` gains the
clock; `3 - MVP` and `4 - Revolution` take the focus session in the reconcile pass; and
`./agent verify` is green.
