# Tao ship — design exploration

Status: **exploration, open dialogue**. This is the thousand-mile overview of the third leg of
Tao's product loop — write (language), preview (Studio), **ship** — plus the option spaces for
the decisions the dialogue with Ro will settle. Rulings land in dated "Direction settled"
sections below. Nothing here is language law until it reaches `Tao Revolution/Decisions.md`,
which wins wherever the two collide; amendments to it are proposed, never made here.

The first slice is planned concretely in `Tao ship/Plan - Beta distribution in one command.md`,
with the substrate facts it rests on in `Tao ship/Research - Beta distribution lanes.md`.

## Direction settled — 2026-09-02

Ro decided to create a **Tao Studio companion app**: a Tao-published phone app for an improved
development experience, paired with Tao Studio, and for pre-release testing and feedback by
members a developer invites to their project on the Tao Lang servers, each with an account
there. It is the Expo Go model under Tao's control and the native-device Studio canvas in one
binary. The assessment, the App Store rules it rests on, and the design rules it carries are in
`Tao ship/Plan - Beta distribution in one command.md`; the program is open work in `Roadmap.md`.

The same day settled the first slice's decisions, recorded with their reasoning in that plan:

- **The verb is `tao ship`.** Plain `tao ship` builds locally, uploads, and submits to App Store
  review, automating as much as possible; `tao ship --beta` sends the same build to TestFlight
  with named recipients. The companion app's delivery lane gets its own flag when that app
  exists. `tao publish` stays the package registry's verb, and the `tao publish --app` and
  `tao build` placeholders are retired. Builds are local, through Xcode and the App Store
  Connect API key; EAS is a later option, not a requirement.
- **Identifier facts are accepted project metadata** in the `ship` section of the project's one
  committed `.tao-project/lock.jsonc`, written by `tao ship`, never hand-edited, following the old
  design lock's contract (identity, input hash, accepted or suggested status, provenance). Later
  locks take sections of the same file. The bundle identifier rule is
  `<namespace>.<project id>[.<variant>]`.
- **A non-primary variant is its own bundle identifier and store record.**
- **The icon is a Tao default asset with a badged variant default**; an `Icon` slot on `app` is a
  separate grammar argument.
- **No Expo Go bridge**; the companion app covers the zero-account case.

## Framing

A Tao app today can be written and previewed but not shipped: the CLI ends at `compile`, the
Expo host project is a single checked-in shell named "Tao Runtime" with no bundle identifier,
and the only store-adjacent sentence in the repository is a placeholder (`tao publish --app`,
`Docs/Spec/Tao Packages.md`). Meanwhile the language has already decided almost everything a
deployment pipeline normally makes you configure:

- **The product envelope is declared** — `project { id, name, targets, languages, license }`
  (§11) is the app-store listing's skeleton, written at the top of the source.
- **Environments are already in the language.** `app WordFlowerStage = WordFlower with
  { Datasource WordFlowerStageStore }` is a staging environment: a variant swaps providers,
  seeds, and accounts without forking a declaration, and §10 already gives variants distinct
  persisted-state identity. `tao ship` should ship _an app variant_, not a project plus a flag
  file — no new "environment" concept is needed, and none should be invented.
- **The backend is derivable.** The compiler already owns what a hosted platform makes you
  author by hand: entity `validate`s lower to per-operation store rules (§2), publish
  projections lower to provider view permissions (§4), `unique`/`index`/`search` are declared
  storage facts, `automation` (§12) is scheduled work with trigger, dedup key, audience, and
  payload fully specified in source, and `permissions … because "…"` sentences are exactly the
  platform usage-description strings. All of it is compiler output with **no publication
  channel** — the channel is what `tao ship` builds.

So the thesis: **`tao ship` is one declared motion — source in, running product out — where
Firebase and Vercel users write dashboards, YAML, and glue.** The developer declares intent in
the language they already write; the pipeline derives builds, signing, store submission, OTA
channels, the hosted backend, and its provisioning from declarations that exist for other
reasons. And because the hosted half (Cloud datasources, automation execution, push, auth,
error reports) is a running service, this is also the commercial engine: the thing people pay
for monthly is the thing only Tao can derive.

The claim to keep testing throughout: every place this document says _derived_, there must be a
declaration that already exists for a non-shipping reason. Where a fact is genuinely new (a
signing credential, a store listing screenshot), it is named as declared-or-provided, never
smuggled in as inference.

## Where things stand (grounded 2026-08-30)

What exists, what is decided-but-unbuilt, and what is a hole:

| Concern            | Status                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project` envelope | Decided (§11). Grammar implements only `id/name/remote none/license/requires` — no `targets`, no `languages`.                                                                                                                |
| App variants       | Decided (§11), implemented, in daily use (`WordFlowerInstantDB`, `WordFlowerStage` pattern). The environment mechanism.                                                                                                      |
| Datasources        | `Local`/`Memory`/`Http`/`InstantDB` implemented on the provider-neutral snapshot protocol. `Cloud { Conflicts, Deletes, Offline }` decided (§11), unimplemented.                                                             |
| InstantDB provider | Semi-experimental. Stores the whole app snapshot as **one opaque JSON string in one row**; no schema push, no rules push, no admin token, `AppId` hardcoded in source. Last-snapshot-wins.                                   |
| `automation`       | Semantics fully decided (§12); execution host **never named**; zero implementation; Post-MVP tier.                                                                                                                           |
| Permissions        | Decided as reason-carrying multi-state values; spelling drift between §11 (`Reason "…"`) and the demos (`location while using because "…"`); no grammar support yet.                                                         |
| Secrets            | `secret` is a decided _capability value type_ (§2–§4). Build/deploy credentials have **no owner, no syntax, no channel** — `Roadmap.md`'s "Implement secrets" is ambiguous between the two.                                  |
| Build toolchain    | One checked-in Expo host (SDK 54 / RN 0.81.5); compiler overwrites `_gen_tao-app/` in place; dev = Metro + Expo Go on LAN; no dev-client, no EAS, no eas.json, no expo-updates, no release path of any kind.                 |
| Store/OTA posture  | Repo stance (native-device exploration): production builds **reject live compilation**; internal preview builds may take "an explicitly compatible signed update"; "Do not add an unrestricted production remote-code path." |
| Schema migration   | **Nothing.** See its own section — the current behavior on any `data` change is total refusal.                                                                                                                               |
| Studio-in-release  | Open item: nothing today proves Studio instrumentation is absent from a release bundle. `tao ship` must prove it.                                                                                                            |

External facts that bound the design (researched 2026-08-30):

- **EAS** covers the whole pipeline: cloud iOS/Android builds with managed signing credentials,
  automated TestFlight/Play submission via App Store Connect API keys / Play service accounts,
  and OTA with channels, rollbacks, progressive rollouts, and `runtimeVersion` gating. Pricing:
  free tier (15+15 builds/mo, 1,000 update MAU), $19/mo starter, $199/mo production, per-build
  $1–4, updates ~$0.005/MAU at overage. `eas build --local` runs the same pipeline on your own
  machine.
- **The expo-updates client speaks an open, published protocol** — production-grade self-hosted
  servers exist. Building on EAS Update keeps a credible self-host exit for the update plane.
  CodePush is retired (March 2025); EAS is the only maintained managed option.
- **Store OTA policy**: Apple (3.3.1(b), 2.5.2) and Google (interpreter exception) permit JS
  bundles executed by the shipped runtime that fix and adjust _your own reviewed app_; both
  actively enforce against apps that generate or download new behavior (Apple pulled
  app-generating "vibe coding" apps in March 2026). Tao's compiled-bundle OTA sits squarely in
  the safe zone _because_ Tao compiles ahead of time; a live-compilation path in production
  would sit squarely in the enforcement zone. The language's own posture and the platform's are
  the same posture.

## The publish pipeline

The motion, end to end, as the developer experiences it:

```bash
tao ship WordFlowerStage         # build + sign + submit the stage variant to TestFlight
tao ship WordFlower              # the production variant, to the stores
tao ship WordFlower --update     # OTA: compiled-bundle update to the shipped binary, when compatible
```

One argument: an app declaration name. Everything else is derived or remembered.

### What is derived, from declarations that already exist

| Pipeline fact                         | Derived from                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App display name                      | `app { Name … }` (variants override — "WordFlower Stage" labels itself)                                                                                                                                                               |
| Bundle identifier / package name      | `project { id }` + a settled derivation rule (open: see Versioning & identity)                                                                                                                                                        |
| Device families                       | `project { targets phone, tablet, laptop }`                                                                                                                                                                                           |
| Locales in the store listing          | `project { languages … }`                                                                                                                                                                                                             |
| `Info.plist` / manifest usage strings | the `permissions` block's `because` sentences, per locale                                                                                                                                                                             |
| Native dependency closure             | the compiled module graph — the compiler knows exactly which sidecars/SDKs are reachable, so the **runtime fingerprint for OTA compatibility is computed, not hand-declared** (EAS makes you author `runtimeVersion`; Tao derives it) |
| Update channel                        | the shipped variant — `WordFlowerStage` and `WordFlower` are distinct channels because they are distinct declarations with distinct persisted-state identity (§10)                                                                    |
| Push entitlements & config            | the app's `Notifications` provider + any `automation … notify`                                                                                                                                                                        |
| Backend provisioning                  | the `Cloud`/InstantDB datasource + derived rules (see The hosted runtime)                                                                                                                                                             |
| Schema fingerprint                    | the `data` declarations (see Schema migration)                                                                                                                                                                                        |

### What is declared or provided, honestly

- **Store credentials**: an Apple Developer account and a Play Console account are the
  developer's own — no design can change that. `tao ship` collects them once (App Store
  Connect API key, Play service-account key) and remembers them (see Secrets & deploy
  configuration).
- **Version**: some part of the version braid is authored (see Versioning & identity).
- **Listing assets**: icon, screenshots, store copy. Candidates for derivation later (Studio
  can render screenshots from named states; an icon slot on `app`), but v1 treats them as
  provided files with sensible defaults.

### Substrate: build on EAS vs own pipeline

The option space, for the record (dialogue decision #1):

- **A — Tao-managed on EAS.** `tao ship` talks to a Tao service that fronts EAS: builds,
  signing custody, submission, and updates run under Tao's platform account; the developer
  never sees Expo. Commercially strongest (the managed path _is_ the product); operationally
  heaviest (Tao intermediates credentials and billing from day one).
- **B — Bring-your-own EAS.** `tao ship` drives the developer's own Expo account (and their
  Apple/Google credentials) directly. Thin, shippable immediately, zero Tao infrastructure —
  and zero revenue, plus a second account signup in the getting-started path.
- **C — Own pipeline.** fastlane + owned macOS builders + a self-hosted expo-updates-protocol
  server. Maximum control and margin; a large standing operational commitment that competes
  with language work, for capabilities that are commodity.

Recommended: **EAS as substrate (never C for v1), B's mechanics first, A as the commercial
layer** — `tao ship` v1 drives EAS with the developer's accounts (this is also what
`eas build --local` needs, keeping a fully-local lane), and the Tao-managed front grows over
the same seam. The update plane's open protocol preserves the self-host exit if EAS pricing or
policy ever forces C.

### Versioning & identity — the braid

Five versions coexist and must be told apart, not unified:

1. **Store version** ("1.4.2") — marketing, authored or auto-bumped.
2. **Build number** — monotonic, derived (the ship service counts).
3. **Runtime fingerprint** — derived from the native closure; gates OTA compatibility.
4. **Schema fingerprint** — derived from `data`; gates data compatibility (see Schema
   migration). Distinct from the runtime fingerprint: a copy change moves neither; a new
   sidecar moves 3 but not 4; a new field moves 4 but not 3.
5. **Project version** — `tao publish`'s package-registry version (Tao Packages.md), a
   different product surface that happens to share the word.

Open: where the authored piece lives (`project { version "1.4" }`? ship-time prompt? derived
date-version?), and the bundle-identifier derivation rule (`project id` is an opaque immutable
string like `"wordflower"`; reverse-DNS needs an owned namespace — `app.tao.wordflower` under a
Tao-managed lane vs a declared `bundle` fact under BYO).

### OTA, within the rules

- **What an update is**: the compiled JS bundle + assets of the _same reviewed app_ — the exact
  artifact `tao compile` already produces, published to the variant's channel. Never a
  compilation path in production; the repo's standing prohibition and Apple's 2.5.2 enforcement
  agree, and this document treats that as a constraint, not a choice.
- **Compatibility is double-gated, both gates derived**: an update reaches a binary only when
  the runtime fingerprint matches (native closure unchanged) _and_ the schema fingerprint is
  compatible (see Schema migration). EAS enforces the first natively; the second is Tao's own
  gate on top — `tao ship --update` refuses to publish an update whose schema change the
  installed base can't survive, which no general-purpose OTA product can offer because none of
  them can see the schema.
- **Rollback** rides the channel (EAS republish/rollback), with the same double gate pointed
  backwards — rolling back past a schema migration is refused unless the migration is
  reversible (recorded as an honest limitation, not solved away).
- Internal-preview builds (TestFlight) take signed compatible updates per the native-device
  exploration's "limit" verdict; the Studio pairing/instrumentation machinery stays out of
  production profiles entirely, and slice work must add the missing production-bundle assertion.

## The `tao ship` surface in the language

Almost nothing new. The candidates, in decreasing confidence:

- **Nothing new for environments** — variants are it (settled above as a design premise, to be
  ratified in dialogue).
- **A `ship`/store block is probably not a language form at all.** Store metadata that is
  neither behavior nor copy-with-a-compiler-guarantee (screenshot lists, review notes) belongs
  in project files the CLI reads, not in the grammar. The bar from the AI program applies:
  a keyword must carry a guarantee a file cannot.
- **Possible small additions**, each to be argued individually: an `Icon` slot on `app` (it
  varies per variant — stage builds want a badged icon); `version` in `project`; a `bundle`
  identity fact if BYO custody needs one.
- **Naming**: `tao ship` vs the placeholder `tao publish --app`. Recommended: `ship` for the
  app motion (build/submit/update/backend), leaving `publish` for the package registry — two
  products, two verbs; the Packages.md placeholder gets superseded.

## Secrets & deploy configuration

Two different things currently share one word, and the first act of this section is to split
them:

1. **`secret` the value type** (§2–§4): capability-grade, rotatable, lives in user data,
   already decided. Owned by the authority program. Not this document's subject — except that
   the ship pipeline must honor its guarantees (a `secret` never serializes into a prompt,
   never into an error report — see Error reports).
2. **Deploy credentials and provider configuration**: App Store Connect keys, Play
   service-account keys, InstantDB admin tokens, API keys a sidecar needs. **No owner today**;
   `AppId` values are hardcoded in `.tao` source, which is survivable only because InstantDB
   app ids are public client values.

Design sketch for (2), to be settled in dialogue: configuration values referenced by name in
provider bindings, resolved at ship time from a per-project store that is never source:

```tao
datasource WordFlowerStore = InstantDB { AppId config InstantAppId }
```

with `tao ship` resolving `InstantAppId` per variant from the ship service's config store (or a
local `.tao-project/` file for the fully-local lane), prompting on first miss. Admin-grade
values (an Instant admin token, an ASC key) never reach the client bundle at all — they are
consumed server-side by the ship/backend service; the type system can enforce the split
(client-config vs server-credential) because the compiler knows which side each consumer runs
on. **Seam flag**: the word `config` vs overloading `secret`, and the InstantDB provider's
config surface, are shared with the authority & multiplayer program — collision to surface, not
decide here.

## The hosted runtime — a backend derived, not configured

The server-shaped parts of a declared Tao app, and where each comes from:

| Hosted piece        | Derived from                                                    | Firebase/Vercel equivalent           |
| ------------------- | --------------------------------------------------------------- | ------------------------------------ |
| Data store + schema | `data` declarations                                             | hand-authored schema/collections     |
| Store rules         | `validate` lowering, access rules, publish projections (§2, §4) | hand-written security rules          |
| Scheduled work      | `automation` — trigger, `while`, `once per`, audience, payload  | cron config + job code + dedup logic |
| Push delivery       | `notify` payloads + `Notifications` provider                    | FCM/APNs glue                        |
| Auth service        | `use auth from @tao/auth`, account references in access rules   | Auth product config                  |
| Error-report store  | the error architecture's capture bundles                        | third-party crash SDK                |
| Analytics           | declared intents/transactions/screens (see Derived analytics)   | event-tracking SDK + taxonomy doc    |

Two grounding facts give this section its shape. First, §12 decided `automation` is
"provider-owned scheduled work … explicitly not a timer on one mounted device" — but no
decision names the machine it runs on when every device is off. There is exactly one honest
answer: a hosted service. The hosted runtime is not an optional accessory; it is the
**unnamed execution host the language already promised.** Second, §4's publish machinery is
decided as "(none of it is server code)" — lowered to provider-native rules. So the hosted
runtime's job is narrow and derivable: hold the store, enforce the derived rules, evaluate
automation schedules, deliver push, answer auth — and _not_ run app code. An automation cannot
write (§12); it `do`es a transaction, whose authority question (§12 gap: what identity does a
server-side scheduled `do` carry?) is a real language decision this program must put to Ro.

Provisioning is a ship-time act: `tao ship` diffs the derived backend (schema, rules, indices,
automation schedules, push config) against what the service currently runs for that variant,
shows the diff, applies it. The InstantDB provider is the precedent and the gap: today it
pushes nothing (one opaque row, empty rules). The path runs through making the provider
protocol provisioning-aware — schema push, rules push, and (see next section) a migration
lane — regardless of whether the store under the Tao service is InstantDB, Postgres, or
provider-per-plan.

**Error vocabulary is a contract, not a style.** Everything the hosted runtime emits speaks the
established language: provider failures are `fails <Case> "<sentence>"` — a case declared in
Tao, never a server-authored string ("English never crosses into TypeScript" extends to
"English never crosses out of the server"); a server-side write rejection arrives shaped
exactly like a local `validate`/`refuse when` outcome (`rejected` with a sentence, not an
`error`); offline is never an error. A backend whose failures are ordinary Tao cases is a
backend whose failures are renderable, translatable, and testable with the existing scenario
machinery.

### Auth hosting

§11 decides the surface (`use auth from @tao/auth`, `auth.Account`, sign-in flows); InstantDB
brings its own auth (magic codes); the authority program owns access semantics. Ship's
narrower questions: who operates the identity service under a Tao-managed backend, whether
accounts are per-app or Tao-wide (recommended: per-app — a WordFlower account is WordFlower's;
Tao-wide identity is a product decision nobody has made), and how auth config (OAuth client
ids, Apple Sign-In keys) rides the deploy-configuration channel. Flagged as a seam; not
designed past here.

## Schema migration — the honest option space

The hardest unsolved question in the language, confronted here deliberately. First, the ground
truth, verified in code (2026-08-30):

**Today, any change to any `data` declaration is fatal to all existing data.** The runtime's
`parseEnvelope` demands _exact_ equality between the persisted shape and the compiled shape —
entity sets and per-row field sets must match by name; even a purely additive field trips it on
the first row. `schemaVersion` is wired end-to-end through the envelope but hardcoded to `1` by
the compiler; it has never once gated anything. The outcomes:

- **Local datasource**: the app blocks behind a modal whose only working button is **"Reset app
  data and reload"** — one tap, total data loss. The old data is not corrupted — it sits intact
  and unreadable on disk while the app offers to erase it.
- **InstantDB**: the connection deliberately grants no `reset()` (correct in isolation — a
  client must not wipe a shared store it can't read), so the only button is a retry that can
  never succeed. **Shipping a schema change to a hosted Tao app today permanently bricks every
  existing client.**
- **Mixed-version fleet**: a running client that receives a peer's newer-shaped snapshot
  degrades to a recoverable sync error — and then the two clients last-snapshot-wins overwrite
  each other's divergent data, because the store is an opaque blob that cannot arbitrate.

And one structural fact that shapes every option: **the store cannot help.** The hosted
snapshot is one JSON string InstantDB never parses; there is no server-side representation of
entities to migrate. Any migration is a read-transform-write by something that understands both
shapes — a client, or a Tao-aware service.

### The theaters

Any answer must play in three places at once:

1. **The device** — a Local snapshot upgraded in place when the app updates.
2. **The hosted store** — shared state that must change shape exactly once, not once per client.
3. **The fleet** — during any rollout (and forever, for users who never update), old and new
   binaries coexist against the same store.

### The option space

- **O0 — Status quo (refuse + wipe).** Honest, implemented, and disqualifying for a shipped
  app. Recorded because it is the baseline every option is measured against: anything shipped
  must strictly dominate "brick or wipe."

- **O1 — Derived compatibility: make `schemaVersion` real.** The compiler derives a schema
  fingerprint from the `data` declarations' content. The ship service keeps every shipped
  schema (this is the uniquely-Tao move: **schema history is a ship artifact**, so `tao ship`
  always holds both shapes and can classify the diff _before anything reaches a user_).
  Additive-compatible changes — new entity; new field with a derivable default (optional,
  defaulted, or case-with-none) — migrate mechanically: fill on read, write back upgraded.
  Anything else is refused at ship time until the developer says what it means. The lenient
  half of the classifier is small, checkable, and covers the overwhelming majority of real
  app evolution.

- **O2 — Declared migrations, in Tao.** For the refused class, the developer states meaning in
  source, next to the entity, in the language's own vocabulary:

  ```tao
  data Documents / Document {
     Title text
     Body text
     Starred boolean            // added in the same change as:
     migrate from 3 { Starred: no }          // sketch — spelling entirely unsettled
     migrate from 2 { Title: Name }          // a rename is a statement, not a guess
  }
  ```

  Checked at ship time against the _actual_ previous shipped schema (not a guessed one — the
  service has it), chainable across skipped versions, testable with the scenario machinery
  against captured fixtures from the old shape. The design bar: a migration is a total,
  deterministic, store-only function of the old row — no I/O, no model calls, so it can run
  anywhere (device or service) with identical results.

- **O3 — Eager server-side migration on deploy.** The ship service transforms the hosted
  snapshot(s) once, at `tao ship` time, using the O1/O2 rules. Solves theater 2 exactly once;
  requires the provider protocol to grow a migration lane (or the service to own the store
  outright), and requires the fleet gate below, because the moment the store is new-shaped,
  old binaries can no longer be allowed to write.

- **O4 — Lazy client-side migration on load.** Each client upgrades whatever it reads (old
  envelope → chained migrations → new shape) and writes back. Perfect for theater 1 (Local:
  this is simply what "app update" should mean). Dangerous alone in theater 2: with
  last-snapshot-wins blob storage, a lagging old client can overwrite the upgraded snapshot
  wholesale — lazy migration of a shared store is unsound without the fleet gate.

- **O5 — Expand/contract (dual-shape tolerance windows).** The industrial answer for
  zero-downtime services: ship shapes that read both, contract later. Maximum availability,
  maximum ceremony — it forces every developer to think in three-phase deploys, which is
  precisely the class of burden Tao exists to delete. Recorded as the escape hatch for the
  hosted service's _own_ internals, not as the developer surface.

- **The fleet gate (orthogonal, required by O3/O4).** The schema fingerprint becomes a sync
  gate the way the runtime fingerprint gates OTA: the store carries its shape's version; a
  client behind it does not brick and does not overwrite — it renders an honest, decided-vocabulary
  state ("This app needs updating to keep working with your data"), read-only at best. The
  current mixed-fleet mutual-overwrite behavior is thereby retired. Old binaries that never
  update stay in theater-3 purgatory honestly instead of corrupting theater 2 silently.

### Recommended composite (to seed the dialogue, not to end it)

O1 as the spine (derived fingerprint, ship-held schema history, mechanical additive class) +
O2 for everything the classifier refuses + O4 for Local + O3-with-fleet-gate for hosted stores
once the provider protocol has a migration lane. The WordFlower acceptance test falls out:
adding `Starred boolean` is O1's additive class — no declaration, no ceremony, and **no user
loses a document**, on device or hosted. Renaming `Name` to `Title` is one O2 line. Deleting a
field is a decision (`migrate` says drop, or the ship refuses) — never an accident.

What this composite deliberately does not solve, kept visible: reversible rollback past a
migration (refused unless the migration declares an inverse); migrations that need I/O or
human judgment (out of the model — that is an app feature, not a migration); and the long tail
of never-updated clients (gated read-only, forever, honestly).

## Error reports in production

The PROD half of the error architecture, deferred to this program by the Studio work. The
vocabulary and the capture machinery already exist; ship adds transport, storage, and defaults.

- **A capture bundle is the existing Studio capture, produced in the field**: the datasource
  snapshots (the only implemented capture domain, extended per the error architecture),
  persisted state, nav state, the action log, and environment values — exactly the ingredients
  Studio already replays as fixture + scenario. A production error report is therefore _a
  reproducible test case_, not a stack trace: opened in Studio, it becomes a named state and a
  failing scenario.
- **Structural exclusions, not scrubbing lists**: `secret`-typed values never serialize into a
  capture (the same language-level guarantee that keeps them out of prompts); credentials are
  excluded by construction because the capture domains simply do not include a credential
  store. Reports carry account _identity_ (whose session) because replay and support need it —
  identity is data the app already holds; credentials are not.
- **Scrubbing defaults for the rest**: user-content fields are the app's actual data, and a
  full-snapshot capture of them is radioactive. Default posture to settle in dialogue —
  leaning: report capture is **opt-in per app** (`Reports` slot or similar), with a declared
  redaction level (shape-only / sampled / full), surfaced to the developer at ship time and to
  the user in the platform-standard consent surface.
- **The report store is part of the hosted runtime**, keyed by shipped version + runtime
  fingerprint + schema fingerprint (so a report is replayable against the exact source that
  produced it — the ship service holds every shipped artifact). Report-store auth rides the
  same account model as the rest of the backend.
- **Errors speak the vocabulary**: a report's headline is a `Case + sentence` when the app
  refused/failed honestly, and only unhandled exceptions arrive as raw `error` — making the
  ratio of the two the first derived quality metric.

## Derived analytics

Tao apps need no analytics SDK because the taxonomy is the source: every titled intent,
transaction, and screen is a named event with declared parameters; the navigation graph is the
funnel diagram. The hosted runtime counts them.

- **Counts, not content**: the derived event is the declaration name + timestamp + anonymous
  session key — parameters and payloads stay out unless explicitly opted in, matching the
  deny-by-default posture everywhere else in the language.
- The dashboard is derivable too: screens over the nav graph, intents per screen, the
  `rejected`-vs-`saved` outcome ratio per transaction (which doubles as the health metric the
  error section wants).
- Open: whether analytics is on-by-default-anonymous or opt-in like reports; app-store privacy
  ("nutrition label") declarations are themselves derivable from these choices — a genuinely
  novel derivation (the compiler can _prove_ what the app collects).

## The commercial shape

What people pay for, and why it is defensible:

- **Free**: the language, the compiler, Studio, local/BYO shipping (`tao ship` over your own
  EAS/Apple/Google accounts, Local datasources, self-hosted anything). The loop must be
  walkable end to end for $0 — the funnel is the product.
- **Paid — the managed path** (per app per month, tiered by MAU/usage, in the shape of the
  hosting market: free dev tier → ~$19 hobby → ~$99+ production):
  1. **Hosted backend** — the Cloud datasource, derived rules, automation execution, push,
     auth, error-report store, analytics. The recurring engine; none of it exists without a
     server, and Tao's server is provisioned by the compiler.
  2. **Managed pipeline** — Tao-fronted builds/submission/updates (EAS underneath, invisible),
     signing custody, schema-gated OTA, schema history and migration checks. Sold as "ship
     without ever seeing four consoles," priced above the passed-through EAS costs.
- **Tenancy**: the `project id` is the tenant key (already decided as the stable identity that
  "travels with clones and published artifacts", with `--replace` as the explicit fork/sever
  operation); variants are environments _within_ a project's tenancy; a Tao account owns
  projects. Per-app auth (recommended above) keeps end-user accounts inside the app's tenancy.
- **The moat is derivation, not hosting.** Hosting is commodity; what Firebase/Vercel/Supabase
  cannot do is _see the app_: derived rules that cannot drift from `validate`, OTA gated by a
  schema the platform actually understands, migration checked against held history, analytics
  with a compiler-proven privacy label, error reports that replay as test cases. Every paid
  feature above is a compiler feature wearing a service; that is the pitch and the defense.

## Driving use case — WordFlower on TestFlight, three acts

The acceptance narrative for the whole program, in the canonical app:

1. **Clean checkout → installable build.** `tao ship WordFlowerInstantDB` on a fresh clone:
   derives name/bundle-id/targets/permission strings, builds via EAS with the developer's
   accounts, submits to TestFlight. A phone installs it; documents sync through InstantDB.
2. **A one-line copy change, over the air.** Edit a string; `tao ship WordFlowerInstantDB
   --update`. Runtime fingerprint unchanged, schema fingerprint unchanged → the update
   publishes to the variant's channel; the installed app picks it up on next launch. No store
   review, no build.
3. **A `data` field addition that loses no one's document.** Add `Starred boolean` to
   `Documents`; ship an update. The schema gate classifies it additive; devices upgrade their
   envelope on load; the hosted snapshot upgrades once; a teammate's un-updated phone is gated
   honestly rather than overwriting. Every document survives. _(Acts 1–2 need no migration
   machinery; act 3 is the migration program's first proof.)_

Per the tranche rule — a capability exists only if a real feature in one of the four apps
forces it — WordFlower's `2 - Next` tier grows the ship-forcing features as slices land.

## Cross-program seams (flagged, not decided)

- **Studio v2 / error architecture**: this program owns the PROD half (capture transport,
  report store, scrubbing defaults) and must emit the settled vocabulary exactly; the fixture +
  scenario replay path is consumed as-is. The desktop Studio shell (Electron wrapper today;
  signed/distributable packaging explicitly beyond Studio v1) is the eventual publish cockpit
  and the most demanding ship customer — recorded as a known lane; phone-first is v1. The
  missing production-bundle assertion (no Studio machinery in release builds) becomes a ship
  slice requirement.
- **Authority & multiplayer**: the `secret` value type vs deploy-config wording; the InstantDB
  provider's config/auth surface; per-app account semantics. Shared dependencies — collisions
  get surfaced to Ro, not designed past.
- **AI in Tao apps**: hosted agent execution, agent access to production data, on-device model
  entitlements in store builds, and eval runs against shipped model versions are intersections;
  noted here, owned there.
- **`tao publish` (packages)**: name and version-word collision; recommendation above keeps
  the verbs separate.

## Promptable slices

Slice 1 is constructed to need **no unsettled decisions beyond substrate custody defaults**
(BYO accounts, which every option keeps as a lane):

1. **`tao ship` v0 — WordFlower on TestFlight.** BYO Apple + Expo accounts. Implement
   `project { targets }` (minimum for iOS), generate a real per-app Expo config from
   declarations (bundle id via a provided value if the derivation rule is unsettled, name,
   icon default, version prompt), wrap `eas build` + `eas submit`, prove the release bundle
   excludes Studio machinery. No OTA, no migration, no hosted backend beyond the existing
   InstantDB app. Act 1 of the driving use case, whole.
2. **OTA v0.** expo-updates in the release profile, channel-per-variant, derived runtime
   fingerprint, `tao ship --update`, rollback. Act 2.
3. **Schema fingerprint + the additive class.** Make `schemaVersion` real (content-derived),
   ship-held schema history, mechanical additive migration for Local, the ship-time
   compatibility gate on `--update`. Act 3 on-device.
4. **Deploy configuration channel.** The `config`-resolution mechanism, per-variant stores,
   credentials out of source. (Blocks on the secrets-wording seam with the authority program.)
5. **Hosted provisioning v0.** Managed InstantDB app-per-variant provisioning + the first
   derived rules push; the provider protocol grows schema/rules lanes. Act 3 hosted, fleet
   gate included.
6. **Beyond**: automation execution host, error-report store, derived analytics, the managed
   commercial front, Play/store expansion, desktop lane — sequenced by dialogue.

Short self-contained implementation prompts for any slice on request, after its decisions
settle.

## Open questions, gathered

1. Substrate and custody (decision #1): EAS under BYO vs Tao-managed front, and the sequencing
   between them.
2. ~~The verb~~ — settled 2026-09-02: `tao ship`, with `--beta`; the placeholder is retired.
3. ~~Bundle-identifier derivation; where the authored version lives~~ — settled 2026-09-02:
   `<namespace>.<project id>[.<variant>]`, held with the version in `.tao-project/lock.jsonc`.
4. Migration composite: ratify O1+O2+O4+O3-with-gate? What may the additive classifier accept
   without a declaration? `migrate` spelling and its ship-held-history check.
5. Automation authority: what identity does a server-side scheduled `do` carry? (A §12 gap
   that needs a Decisions.md amendment, not just implementation.)
6. Error-report capture default (opt-in level, redaction tiers) and analytics default
   (anonymous-on vs opt-in).
7. Permissions spelling reconciliation (§11 `Reason` vs demos' `while using … because`) —
   needed before usage-string derivation is implementable.
8. Per-app vs Tao-wide end-user accounts (flagged to the authority seam).
9. Listing-asset derivation (Studio-rendered screenshots, `Icon` slot) — v1 provided, later
   derived? The icon half is settled 2026-09-02: a Tao default with a badged variant default now,
   the `Icon` slot argued separately.
10. Web delivery (the browser is a medium, not a target): where `tao ship` puts the web build,
    and whether it is slice-worthy before the stores are solid.

## Deferred (liked, not scheduled)

- Studio as publish cockpit: the ship motion with a face — diff of the derived backend, channel
  dashboards, migration previews over captured fixtures.
- Screenshot derivation from named states; store-listing copy through the translation pipeline.
- Compiler-proven privacy nutrition labels submitted with the listing.
- Reversible migrations with declared inverses enabling gated rollback across schema changes.
- Self-hosted update server lane (open protocol) as an enterprise posture.
- Desktop (Electron/Electrobun) app shipping — signed, notarized, auto-updating — the Studio
  shell itself as first customer.
