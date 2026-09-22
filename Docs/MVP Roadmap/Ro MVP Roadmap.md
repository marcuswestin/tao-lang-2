# Ro MVP Roadmap

The judgments only Ro can make before Tao goes out to a small number of outside developers. The
agent-executable half is `Agent MVP Roadmap.md` beside this file, and its entries name the decision
here they wait on.

Each entry states the question, what it blocks, the options as they stand, and a marked
recommendation. A recommendation is a starting position for the decision, never the decision.

## Decide first — these block the release path

### R1 — The license

AGPL-3.0 covers the whole repository today, including the runtime and stdlib that end up inside
every app someone builds with Tao. Many developers stop reading at AGPL for anything that links into
their own product.

- Blocks: publishing at all, and `A6` (the IDE extension) with it.
- Options: keep AGPL everywhere; keep AGPL with a runtime exception so apps built with Tao are
  unaffected; license the runtime and stdlib permissively (MIT or Apache-2.0) and keep the toolchain
  AGPL; go permissive throughout.
- **Decided 2026-09-20 — direction, not the final licence.** Keep AGPL-3.0 for now and settle the
  structure as part of a final release consideration. What that structure must achieve:
  - Anyone may use Tao to build anything, in any app, for any purpose, using the shipped versions of
    the Tao stack. Nothing built with Tao carries an obligation.
  - The only restriction targets serving the functionality of the Tao stack _itself_ as a product —
    taking the Tao source and repackaging it as something to sell — as distinct from selling the
    products someone built with Tao.
  - Probable shape: a permissive licence (MIT) at the root, with copyleft licences on the particular
    packages that need them, each scoped to what that part may not be used for.
  - Governing principle: the first impression must be that Tao is open source and that there is no
    danger whatsoever in using it to build products. Restrictions exist only as the mechanism that
    prevents a company repackaging Tao as a competing product.
- **To resolve at that consideration:** LGPL is the copyleft named above, but LGPL has no network
  clause — its obligation concerns relinking a modified library, not offering software as a service.
  A company could host the Tao stack as a product without triggering it. The licences that do bind a
  hosted repackager are AGPL, which this repository already carries, or a source-available licence
  such as BSL. The goal above is the thing LGPL alone does not achieve, so the pairing needs
  deliberate choice.
- **Structural prerequisites, whatever is chosen:** `LICENSE` stops at §17 with no
  `END OF TERMS` and no appendix, names no copyright holder, and no `package.json` declares a
  `license`. Until those are fixed this decision is invisible downstream — see
  `Report - Publication audit.md` `P24`, and `P23` for why the runtime's licence reaches inside every
  app built with Tao.
- Relicensing is cheap only while there is one copyright holder. Every commit is authored by one
  person today; a second contributor turns this into a consent-gathering exercise.

### R2 — What becomes public

Publishing this repository as it stands also publishes the agent instruction set, the subagent and
skill definitions, `Roadmap.md` including the `Ro STACK` section, machine-specific files, and a
committed `secrets/secrets.jsonc`.

- Blocks: `A3` (what the README addresses), and the disposition of `A10`'s audit findings.
- Options: publish as-is and accept the exposure; publish a curated public repository (toolchain,
  docs, examples) and keep this one private; split by subtree with a one-way sync.
- **Decided 2026-09-20: publish the whole repository.** The aim is an open-source contributor
  community around Tao, and a curated or split repository works against that — contributors cannot
  send a pull request to a mirror, and a one-way sync makes every outside change a manual port.
  Publishing everything is what makes contribution possible at all.
- What that accepts, from `Report - Publication audit.md`: the agent instruction set and the
  `Response format` section (`P1`), the "never mention an agent identity" rule (`P2`), the sandbox
  policy as a map of what agents may do (`P3`), `Roadmap.md`'s two personal sections (`P7`, `P8`),
  the September remediation record (`P9`), the developer-environment backlog (`P10`), and commit
  authorship in perpetuity (`P20`). The audit judged none of these unsafe — only candid.
- What it does **not** waive, because publishing as-is makes these mandatory rather than optional:
  `P15` (untrack the App Store Connect identifiers and rotate that key), `P16` (`roPhone`), `P17`
  and `P18` (the machine-specific paths), and `P24` (the licence structure). These were the audit's
  prerequisites under every option and they are now the only blocking work.
- Worth doing deliberately rather than by omission: the audit's per-entry recommendations for `P1`,
  `P2`, and `P7`–`P10` assumed a curated repository was available as an out. It no longer is, so
  each becomes a choice to publish as written, to edit before publishing, or to move out of the
  repository — decide them as a set rather than one at a time.

### R3 — Launch timing, positioning, and the stability promise

Process steps 2 to 5 are open, so the language will keep changing. What do we tell people, and when
do we say it?

- Blocks: `A3`'s pitch and honesty page; how much of `A13` must land first.
- Options: launch now on "build small iOS and web apps with data, navigation, and tests, in one
  language"; wait until Current equals MVP; wait for the design system.
- **Recommended:** launch before MVP is complete, with an explicit 0.x promise — expect breaking
  changes, `tao fix` migrates what it can. Outside feedback should shape the tranches still to come,
  and it cannot if it arrives after they are cut.

### R4 — What we claim about platforms

Parts of the toolchain are macOS-only (`sips` in the create brief, the Apple helper, Xcode). Android
and web work everywhere.

- Blocks: `A3`'s install instructions and `A8`'s target matrix.
- Options: say macOS-only for now; say macOS for iOS and full support elsewhere for web and Android;
  invest first in making Linux a first-class development platform.
- **Recommended:** the middle option. It is true today and it does not turn away the Linux
  developers who would otherwise try the web lane.
- Concrete form: `Plan - Standalone Tao CLI.md` question 3 asks which of the five buildable targets
  are release targets, and F7 there records exactly what is macOS-only today.

## Decide next — these unblock program and device work

### R5 — Does the authority cluster enter MVP?

`Process.md` carries this as the open scope question for step 4: whether `access` rules,
transactions, invites, `publish`, and presence enter MVP through collaborative WordFlower
workspaces, or wait for the app expansion. `Coverage.md` holds the cluster as unassigned until it is
answered.

- Blocks: Process step 4, and therefore the tranche list in `A13`.
- Options: in MVP through collaborative workspaces; deferred to the app expansion with Skillet.
- **Recommended:** defer it. The release needs an installable, explorable Tao, and the authority
  cluster is the largest remaining capability that no first-hour experience touches.

### R6 — The three deferred runtime contracts

Deferred on 2026-08-31 and still open: the action-transaction contract, semantic failure capture and
replay, and fixture-through-action result and handle semantics. The implemented Studio behavior in
each area is working code, not an adopted language contract.

- Blocks: any tranche that reaches them; nothing in the first hour.
- **Recommended:** leave them deferred for the release and label the areas experimental, rather than
  settling three contracts under launch pressure.

### R7 — Host scope and versioning

The prebuilt host app is what lets someone run a Tao app on a phone or emulator without Xcode. Is
that host the companion app itself, and does one host serve several Tao versions or exactly one?

- Blocks: `A9`, and the full device half of `A4`.
- Options: the companion app is the host, with rare shell releases and a compatibility check against
  the bundle; a separate host built per Tao version; both, with the companion adding the
  Studio-pairing features on top of the same shell.
- **Recommended:** one shell, released rarely, with an explicit bundle-compatibility check. The
  companion plan already assumes rare shell releases, and `tao ship`'s OTA path already carries a
  compatibility fingerprint that this can reuse.

### R8 — Where builds run, and where signing happens

`tao ship` is implemented against local Xcode, and EAS was evaluated and rejected. The open question
is whether Tao later grows a way to hand a build to another machine — the developer's own Mac over
SSH, their CI, a third-party service, or a Tao service — and whether signing may ever leave the
developer's machine.

- Blocks: nothing for the release; it shapes `A8`'s design if decided early.
- **Recommended:** keep local-first as the product promise, add the developer's own machines and
  their own CI as the first remote executors, and make signing on the developer's machine a firm
  rule. Third-party and Tao-hosted builders stay open.

## Smaller, but still yours

### R9 — Style defaults and how a caller clears them

Recorded in `Roadmap.md` in your own words: whether a declaration may carry style defaults a caller
overrides, and how a caller clears a default rather than adding to it (`render Foo() [pad 0, bg
none]`).

- Blocks: part of the design system MVP in `A14`.
- **Decided 2026-09-22.** A declaration's defaults live in a header clause (`view Foo() [pad 12, bg
  red] {`), the declaration's public style surface; precedence is design element default → header
  → caller, later value wins; the root render's own clauses are private and win over that chain; a
  caller may give any clause; `none` clears a clause (`bg none`, `pad left none`); `pad 0` sets zero
  and a raw `0` is not design exploration. Recorded in `Decisions.md` §13 and the layout spec's
  "Declaration Style Defaults".

### R10 — Where feedback happens

GitHub Issues and Discussions, a Discord, or something else. Small, but it is the entire point of
the release.

- Blocks: half of `A7`.
- **Recommended:** GitHub Issues and Discussions only, to start. One place, no moderation load, and
  it keeps reports next to the code.

### R11 — Hosted services for the release

Three services are already implied: Tao's own update service (implemented, unhosted), a hosted
InstantDB application for the WordFlower demo (`A16`), and later the Tao Lang servers the companion
app's membership model assumes.

- Blocks: `A16`, and any demo of sync or over-the-air updates.
- Decide for the release: who runs the update service and at what scale, and whether the public demo
  uses a hosted Instant application you own.
- A fourth service joins them once `A2` lands: `Plan - Standalone Tao CLI.md` question 7 asks who
  hosts the release binaries, their checksums, and the version index. One answer probably serves
  both.

### R12 — What the public story includes

Which surfaces the release presents: the CLI alone, the CLI plus Studio, the companion app, the IDE
extension. Studio is the most impressive and the least finished.

- Blocks: `A3`'s scope and `A5`'s example set.
- **Recommended:** CLI and IDE extension as the product, Studio shown as a video or screenshots and
  offered to anyone who asks. Studio's own reliability gate closed with `A15`, so this is now a
  question of how finished Studio feels to a stranger rather than of whether it is proved.
- Also part of the story's edge: `Plan - Standalone Tao CLI.md` question 8 asks whether `tao review`
  ships in the first release, since it needs a local Chrome.

### R13 — The standalone CLI's remaining questions

`Plan - Standalone Tao CLI.md` measured what a shipped `tao` binary takes and left eight questions
that are yours. Four are already covered above — 3 under `R4`, 6 under `R1` and `R2`, 7 under `R11`,
8 under `R12` — and these four have no other home:

- **Question 1:** does `tao test` ship with a managed Node (about 50 MB per version), or does the
  test harness change so nothing needs Node? The plan recommends a managed Node first and a harness
  change as the durable answer.
- **Question 2:** is the Expo host installed from a pinned lockfile on first run, shipped as a
  per-platform archive, or both? The lockfile needs registry access; the archive needs hosting.
- **Question 4:** is the per-project version pin exact, and may `tao` download a missing version
  without asking? rustup downloads silently; 90 MB unannounced may not be what you want.
- **Question 5:** which distribution channels the first release carries — an install script alone,
  or script plus Homebrew plus npm. Each is a surface that has to keep working.

### R14 — The spellings the Tao Future consolidation had to choose

Process step 3 (`A12`) aligned Skillet, Hearth, and Wayfare to `Decisions.md` and found nine
constructs the apps genuinely need that no decision covers, plus one place where `Decisions.md`
still disagrees with itself. Each is listed in `Apps/Tao Future/README.md`; the port chose a spelling so
the apps would read as one dialect, and none of those choices is a decision.

The ten: the reorder affordance and the drop target as container members (`Col(Reorderable: …)`,
`Col(Accepts: …)` with `on drop`) now that `List` is retired and §18 fixes only `Reorderable: yes`;
`where` on a `loop`; `first N of`; a composite `unique A, B`; `order by relevance`;
`device.timeZone` and the `Connection` and `Sync` environment values, none of which §13's
environment table carries; `X.Cases`; `to X otherwise Y` and a `never` schedule case in an
automation; `runs single per Row`; and the world controls a journey uses beyond §16's named set
(`clock`, `advance`, `collaborator`, `capture shared link`, `expect notification`, `expect window`,
`move … onto …`); and `invalidate <Draft> with <Problem>`, which the apps use at six sites where §5
decides the opposite shape — a bare `save` whose unhandled rejection populates `Draft.Invalid` and
`Draft.Problems` with no `when` at the site.

One self-contradiction remains: §1 says two visibility modifiers "and no others" while §8's command
example and `visibility.langium` carry five (`file`, `folder`, `package`, `workspace`, `public`).
The apps follow §1 and use only `file` and `public`. The other one this pass reported —
`TabNav` against `SelectionNav` — was settled while `Apps/WordFlower/4 - Revolution` was rewritten:
§10 now retires `TabNav` without an alias, which is the spelling these apps had already chosen.

- Blocks: nothing in the first hour, and no tranche until one of these constructs is the one being
  implemented. It blocks the graduation promise: a file graduates by rename alone, so a spelling
  decided differently later is an edit at graduation time, which is the thing the rule forbids.
- **Recommended:** settle the remaining contradiction now, since it is a one-word correction to
  `Decisions.md` and the implementation already chose. Take the nine as a decision round when the
  first tranche reaches one of them, rather than deciding ten spellings with no code pressing on
  them.
