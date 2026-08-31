# Deterministic simulation and verification — design exploration

Status: **exploration, dialogue open**. This is the thousand-mile overview for running whole Tao
apps as fully deterministic simulations — simulated clock, scripted network, scripted providers —
plus property testing derived from declared constraints, deterministic replay, time-travel, and
executable design rules across scenario cells. Direction settled with Ro is recorded in dated
sections as the dialogue proceeds. Nothing here is language law until it reaches
`Tao Revolution/Decisions.md`, which wins wherever the two collide.

## Framing

A Tao app is closer to a deterministic state machine than any React or Swift app can be, and the
distance that remains is *enumerable* — because the compiler sees every construct that touches the
world. That is the whole thesis. Three products fall out of one mechanism:

1. **Deterministic simulation** — run the whole app against a scripted world: a virtual clock, a
   network whose latency and failures are declared, providers whose answers are written down.
   Same script, same seed → byte-identical run, every time, on every machine.
2. **Property and fuzz testing** — generate the world instead of scripting it. The `data`
   declaration is already the generator schema; `validate`, `required`, `refuse`, access rules,
   and `runs single / latest` are already the invariants. Nobody writes generators or properties;
   they are derived from what the app already declares.
3. **Replay and time-travel** — a captured failure is a fixture plus an event journal; replaying
   the journal reproduces the failure deterministically, and truncating it is time-travel. The
   Studio error architecture already captures the state; simulation makes the journal replayable.

The precedent is FoundationDB: a system whose entire test story is running the real program inside
a simulator that owns time, network, and disk, with seeded chaos — and which shipped a distributed
database with famously few production surprises because every bug found in the field could be
turned into a seed. Tao can make the same move, and can make it *language-native*: where FDB had to
discipline a C++ codebase by convention, Tao's effects are language constructs, so the boundary is
checkable by the compiler rather than promised by the team.

## What is already deterministic (the honest audit)

More is in place than the roadmap's "regressed" row suggests. As implemented today:

- **Time is virtualized, centrally.** `TR.Clock` (`packages/runtime/TaoRuntime-src/TR-units.ts`)
  is a singleton virtual clock: `beginTest` pins now to a fixed epoch (`2026-01-01 09:00 UTC`),
  `advance` fires due callbacks in time order, `endTest` cancels everything. It already owns
  `now`, `@tao/time` tickers, `(default now)` stamps, toast expiry, fill-cache windows, and
  Studio's simulated network latency. Every `test` check holds it; `advance 90.s` is a language
  step with compile-time-folded durations and a backwards-advance diagnostic.
- **The store is deterministic.** Fresh in-memory provider per check; entity IDs are a monotonic
  counter persisted in the snapshot, not random; writes commit synchronously and saves queue in
  call order; `SettleAll` is a real barrier (load → drain fills → drain saves). InstantDB rows get
  content-derived deterministic UUIDs.
- **The runner is deterministic.** Every event runs inside React's `act`; `settleData` runs after
  every step; assertions never poll or sleep; app-target resolution is order-independent; native
  navigation surfaces are disabled in favor of a synchronous basic host.
- **A deterministic network simulator exists — in Studio.** The environment overlay
  (`TR-studio-environment.ts`, `TR.Studio.Environment.Provider`) wraps any datasource provider:
  latency awaits the *Tao clock* (not `setTimeout`), offline throws before the adapter is called,
  and declared fill failures are a scripted schedule addressed by entity and 1-based occurrence.
  Cell-local snapshots mean the durable provider is never touched.
- **Deterministic re-crash detection exists.** The error-containment boundary
  (`TR-error-containment.tsx`, on the Studio v2 branch) computes a failure fingerprint over
  `(state key, error name, message)`; a retry that reproduces the fingerprint escalates or stops.
  That is a determinism *check* already running in production containment.
- **A versioned capture format exists.** `TaoRuntimeCaptureArtifact` (version 1): exact provider
  snapshots, `(persist)` state, navigation state, a bounded 50-entry redacted action history, and
  the Studio cell environment — loadable back into a cell as a replay.

## The leaks (equally honest)

- **`TR.Async` has no join point.** Detached `async { }` blocks are fire-and-forget
  (`TR.ts:266`); `SettleAll` covers data only. This is the largest structural hole: a simulation
  cannot claim "the app has settled" while unowned work may still be in flight. Even today, one
  runtime test resorts to `setTimeout(resolve, 0)` as its barrier.
- **Foreign TypeScript is a black box.** `render inject` blocks and `from ./X.ts` sidecars run
  arbitrary code — their own timers, `fetch`, `Date`, `Math.random` — invisible to the clock and
  the overlay. The Http datasource's *adapter* is app TypeScript calling real `fetch`; today's
  only discipline is swapping the whole adapter via an app variant.
- **One unseeded random in the runtime.** The browser-history epoch mints
  `crypto.randomUUID() ?? Date.now()+Math.random()` (`TR-navigation-browser-history.ts:375`).
- **Locale-sensitive collation in canonical identity.** Four runtime sites plus one compiler site
  sort with `localeCompare`, so canonical descriptors and capture artifacts are byte-stable only
  per ICU build. (The data layer already sorts by code unit; these should match.)
- **Environment dimensions are inert.** Scenario `appearance`, `locale`, `direction` lower into
  the manifest but are not enforced at runtime; `Scheme` simulation is explicitly refused until
  reactive design resolution exists.
- **Layout measurement is real.** Adaptive views flip on `onLayout` events that never fire under
  the headless harness, so device-class simulation has no measurement source.
- **Animation timing is native-owned.** No Reanimated, no `requestAnimationFrame` in the runtime;
  transitions belong to `react-native-screens` and `Modal`. Under simulation there is nothing to
  virtualize — and nothing to assert against. The harness already sidesteps it by disabling native
  surfaces; the honest position is that animation is *outside* the determinism boundary, like
  pixels.
- **The scripted-failure surface is unreachable from the language.** The overlay's rich
  per-entity/per-occurrence schedule is TypeScript-only; the scenario spelling stops at
  `network online | offline`, and Studio's UI lowering drops error status/code and cannot address
  entities. The decided fault injection (`datasource fails after create Membership "…"`) is
  *write-side* and nothing built covers writes at all. `TR.Data.setTestStatus` survives as an
  orphaned API with zero callers.
- **Two time systems.** `TR.Clock` and `jest.useFakeTimers()` coexist uncoordinated; two
  navigation tests use the latter.

## The determinism boundary

What the runtime must virtualize, axis by axis. The doctrine throughout: **every axis is owned by
a runtime seam, and the compiler knows every hole in the fence.**

| Axis | Today | Target |
| --- | --- | --- |
| Time | `TR.Clock`, complete inside the runtime | unchanged; becomes the *only* clock a simulation admits |
| Storage | fresh Memory store per check; exact snapshot codec | unchanged; seeded from fixtures or generators |
| Network reads (fills) | Studio overlay: latency, offline, scripted failures | promoted to the harness proper, with a language spelling |
| Network writes | nothing | the decided `datasource fails after create X "…"` — atomicity's proof |
| Sidecars / foreign actions | nothing | the decided `action X fails Case` / `action X returns { … }` stubs |
| Randomness | one leak; `new secret` unspecified in tests | a seeded PRNG seam behind everything random |
| Identity / accounts | fixture `account` handles; `as` in decided tests | simulated sign-in per the decided `as` steps |
| Environment (locale, scheme, text scale) | manifest-only, inert | enforced per cell once reactive resolution exists |
| Layout measurement | real `onLayout` only | injectable measurement from the cell's device class |
| Foreign views | none; no boundary of their own | declared holes: scripted or stubbed per scenario, reported by `tao check` |
| Animation | native-owned | declared *outside* the boundary; simulation asserts states, not motion |

The last two rows carry the doctrine's teeth. Foreign code cannot be forced deterministic — but it
is *declared* (`from ./X.tsx`, the sidecar graph), so the compiler can print the complete list of
holes an app has punched in the simulation fence, exactly the way the AI direction made the prompt
surface a derived report. A simulation whose every hole is scripted is deterministic *by
construction*; one with an unscripted hole gets a diagnostic, not a silent flake. That is the move
React and Swift structurally cannot make: their effect surfaces are unenumerable userland.

## The harness architecture

A simulation is a **cell with a script**. It reuses the Studio pipeline end to end — fixture plan,
scenario environment, per-cell provider overlay, capture codec — and adds a driver:

- **One virtual timeline.** Every event the app can experience is an entry on the Tao clock's
  schedule or an explicit step: user interactions (the existing selector steps), clock advances,
  scripted fill completions and failures, provider pushes, account switches, relaunch. The
  scheduler stays React; determinism is asserted at the settle barrier (`act` + `SettleAll` + the
  new async join), not at instruction granularity.
- **Scripted providers, one registry.** The overlay's `controlledFill` generalizes into the
  harness's provider layer: read-side latency/failure schedules, write-side fault injection,
  sidecar stubs by declared case, scripted models (`model answers …` from the AI direction), and
  the device-capability test drivers from the capabilities program — one seam, not five.
- **Relaunch and collaborators are re-mounts over one store.** `relaunch` unmounts and remounts
  the app against the same provider state (the restoration path already exists); a concurrent
  collaborator is a second app instance bound to the same simulated provider, interleaved on the
  same timeline. This is where the FDB analogy pays off most directly: sync semantics
  (`Conflicts fieldwise latest`, `queued` → `saved` drains) become testable as *properties over
  interleavings*, not hand-written races.
- **Results surface in the scenario-group matrix.** The group is already the display unit; a
  simulation verdict is a per-cell banner in the exact slot the runtime-failure panel occupies
  today.

## Property-based testing, derived

Nothing here asks the developer to learn QuickCheck. The inputs exist:

- **Generators come from the schema.** Typed slots, case sets, unit families, optionality (`?`
  never defaulted), defaults, `yes/no` poles, relations with inferred cardinality, `unique`,
  `together` — every one narrows the generator. The substrate is the fixture plan: a generated
  world is generated rows through the same codec that named fixtures and captures use. (The AI
  direction already claims this: "the fixture generator *is* the `makeSamples` analog.")
- **The fuzzer's alphabet comes from the intent surface.** Titled actions with typed parameters
  are a closed vocabulary; access rules bound who may invoke what; `as <account>` steps switch
  actors. A random journey is a random word over that alphabet — well-typed by construction.
- **Invariants come from declarations.** Candidate derived properties, each checked after every
  step of every generated journey:
  - every `validate` holds on every row (the store enforced it — the property catches enforcement
    gaps, especially at provider boundaries);
  - every `refuse when` and access rule refuses exactly what it declares (probe with `as`);
  - **atomicity**: under any injected write fault, no partial transaction is observable;
  - **undo round-trip**: for any store-only intent, do → undo restores the exact snapshot (the
    derived-inverse model makes this checkable with zero developer input);
  - **convergence**: two collaborators, any interleaving, `fieldwise latest` → identical final
    stores;
  - **offline equivalence**: a journey run offline then drained equals the journey run online;
  - `runs single` never double-fires; `runs latest` never lets a stale result land;
  - **no crash**: the containment boundary never fires across generated states (and when it does,
    the capture *is* the repro).
- **Shrinking is sound because runs are deterministic.** A failing world is a fixture plan plus an
  event script plus a seed — all data. Shrink by dropping rows and events and re-running; the
  fingerprint says when the same failure survives. The failing seed is the artifact CI hands back.

## Replay and time-travel

**One format, extended — never a second one.** The Studio v2 capture artifact stays the state
codec. Simulation adds the missing half: today's action history is a bounded diagnostic tail;
under simulation, recording is total — the full event journal from the fixture forward. Then:

- **Replay** = load the fixture, run the journal. Deterministic by the boundary above; the
  existing fingerprint check tells you whether the crash reproduced.
- **Time-travel** = run a journal prefix. Determinism makes stored snapshots unnecessary in
  principle (re-run from zero), and a snapshot-every-N-events cache makes scrubbing instant in
  practice — the capture codec already snapshots exactly.
- **A production failure capture is a degenerate journal**: state at the failing frame plus a
  50-entry tail. The same loader consumes both; the tail replays where it can, and the two-pass
  diagnostic re-render generalizes from "re-execute the crashed frame" to "re-execute the last N
  events" — the mechanism the error architecture already built, widened.

## Design rules across cells

The decided three-way split stands: statically decidable rules (contrast per declared ink/background
pair, tap-target minimums, unnamed controls) are build diagnostics; layout-dependent measurements
run over the scenario gallery; perceptual judgements are review criteria, never assertions. What
simulation adds is the middle tier's *muscle*: with every scenario cell rendered deterministically
in CI, measured-but-machine-decidable checks (a rendered control's actual hit target under this
device class and text scale; a resolved ink/background pair the static checker couldn't see) can
run over every cell on every push. The functionality/QA line is respected — anything requiring
human judgement stays gallery-annotated, not red.

## What Tao can do that React and Swift structurally cannot

- **Enumerate the effect surface.** In React, effects are unbounded userland (`useEffect`,
  `fetch`, third-party stores); no tool can list an app's holes. In Tao, time, queries, writes,
  intents, generations, and datasources are language constructs, and foreign code is a declared
  import. The simulation fence has a parts list.
- **Own the store.** React apps have N stores with no common snapshot codec; Swift apps have Core
  Data/SwiftData plus ad-hoc state. Tao's store is language-owned with an exact versioned codec —
  capture, seed, diff, and generate all speak it.
- **Derive the oracles.** `validate`/`required`/`refuse`/access/`runs`/derived-undo are declared
  semantics, so properties cost nothing. Swift's closest analog bolts `@Generable` onto structs;
  nothing derives invariants from it.
- **Close the interaction alphabet.** Selectors and titled intents bound what "a user action" is;
  a fuzzer over a React DOM has no such vocabulary.
- **Make determinism a diagnostic.** Because the boundary is checkable, "this app is fully
  simulable" is a compiler-verifiable claim — per app, in CI. Neither platform can even state it.

## Where the FoundationDB analogy holds — and breaks

Holds: one virtual timeline; all I/O through scripted interfaces; seeded chaos with declared fault
points (their `BUGGIFY` is our declared fill/write fault schedule); the failing seed as the bug
report; thousands of cheap seeded runs in CI. And in one respect Tao's position is *better*: FDB
simulated a distributed system it had to build; Tao's "cluster" is app instances over a provider
whose sync semantics are already declared (`fieldwise latest`, tombstones, offline queues) — the
simulator tests a contract, not an implementation's emergent behavior.

Breaks, and where honesty matters: FDB owns its event loop down to the instruction; Tao's
scheduler is React plus the JS engine, so determinism is asserted at settle-barrier granularity —
same inputs, same settled states — not identical micro-interleavings. FDB forces all I/O through
simulated interfaces by fiat; Tao cannot force foreign TypeScript, only declare it, script it, and
diagnose the unscripted. And FDB had no pixels: native rendering, animation, and real gestures sit
outside Tao's boundary permanently — simulation proves state machines, the gallery and human
review prove what things look and feel like.

## Cross-program seams

- **Studio v2 + error architecture** (in implementation, currently uncommitted on
  `feat/tao-studio-v2` in a Codex worktree): the capture artifact is the replay format — consumed
  and extended, never duplicated. The two-pass diagnostic and failure fingerprint generalize into
  the simulator's repro check. Scenario groups are where results display. Foreign views are the
  shared determinism hole; whatever scripting spelling lands here must serve both programs.
- **Device capabilities** (parallel): capability test drivers register in the same scripted-
  provider layer — one seam.
- **AI in Tao apps** (in implementation): `model answers` is a scripted provider in this registry;
  agent-driven app exploration is guided fuzzing over the same derived alphabet; the fixture
  generator serves both eval datasets and property worlds.

## Sequencing sketch (pre-decision)

1. **Seal the runtime** — the async join point, the seeded-random seam, the `localeCompare` and
   browser-epoch fixes. No language surface; pure hardening the whole program stands on.
2. **Promote the overlay** — one scripted-provider layer shared by tests, Studio cells, and the
   harness; the language spelling for read-side network control lands here.
3. **Land the decided fault surface** — write-side `datasource fails after …` and sidecar stubs,
   closing the regressed Coverage row with behavior tests in Tao.
4. **Journal + replay** — total recording under simulation; capture loads as a runnable journal.
5. **Derived generators and first properties** — generated fixtures, generated journeys, the
   no-crash and validate properties first; seeds in CI.
6. **Cells as CI matrix** — scenario groups × seeds × environments; measured design rules over
   every cell; time-travel scrubbing in Studio last, on top of the journal.

## Open questions (the decisions queue)

1. The determinism contract itself: guaranteed-by-construction with diagnosed holes, or
   best-effort harness? (First dialogue decision.)
2. Where simulation lives in the language: extending `test` world-control steps, extending
   `scenario`, or a third declaration.
3. The spelling for read-side network scripting (latency, scripted failures) — explicitly
   deferred by Decisions §16 pending a provider-addressed form.
4. Randomness: one app-visible seed? What does `new secret` yield under simulation?
5. Whether property runs are declared (`property …`?), derived-only with no syntax, or configured
   per app.
6. Journal ownership: runtime codec or Studio protocol; and what of it, if anything, is authored.
7. Collaborator simulation: how a second account's instance is spelled and interleaved.
8. Foreign-view scripting: stub by declaration (like sidecar stubs) or per-scenario binding.
9. Whether measured design rules may ever gate CI, or remain gallery annotations plus static
   diagnostics only.
10. Time-travel in Studio: scrubber UI, journal display, and how it meets the existing
    action-history panel.
