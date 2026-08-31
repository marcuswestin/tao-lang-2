# Device capabilities — design exploration

Status: **exploration awaiting dialogue**. This is the thousand-mile overview for the "Bridge React
Native and Expo APIs into Tao" roadmap item; every sketch is an example to provoke, not a decided
surface. Rulings from dialogue with Ro land in the Direction section as they settle. Nothing here is
language law until it reaches `Tao Revolution/Decisions.md`, which wins wherever the two collide.

## Framing

Tao apps need the device: camera, photos, location, share, haptics, clipboard, files, biometrics.
Three capabilities already shipped (`@tao/device/haptic`, `clipboard`, `share`), and their findings
record (`Bridge React Native and Expo APIs into Tao/Findings - Native device capabilities.md`) hands
three questions forward: how an action delivers a declaration-owned outcome case into `when do`, how
permissions become provider-neutral multi-state values with honest `denied` / `unavailable` /
failure behavior, and what device-level smoke testing native modules still need.

The core question of this program is architectural, and it decides whether Tao's platform surface
grows at library speed:

> **Can bindings be generated from TypeScript definitions or published docs, configured per-API
> through one bridging engine, or must they be hand-written?** Optimize for the least work per
> additional API.

The driving use case is the planned drag-and-drop grocery app (`Roadmap.md`, Toward v1) extended
with the device: photograph a receipt, share a grocery list, a haptic on every drop. The proving
APIs are fixed by the roadmap item: `Vibration` and `Share` (React Native core), `Clipboard`,
`Haptics`, `Location` (Expo) — spanning fire-and-forget, async-with-result, and permission-gated
fallible shapes, with `Haptics`/`Vibration` overlapping deliberately to force the
one-capability-two-bindings question.

### What is already decided (and must not be re-decided)

- **Permissions are app-root keywordized bindings** producing multi-state values:
  `permissions LocationAccess { Reason "To find recipes near you" }`, rendered honestly with
  `when LocationAccess { granted -> …, denied -> … }` (Decisions §11). The `Reason` is source copy,
  shown at first use. There is **no per-site denial fallback clause** — a denied permission is a
  value the screen renders, never a `when permission denied` handler (§12).
- **Failure has one shape.** A sidecar can fail only through a case declared in Tao
  (`fails <Case> "<sentence>"`), surfaced three-tier at the call site: named case → `rejected` (any
  other declared case) → `error` (a thrown exception). English never crosses the boundary (§15).
- **The TypeScript boundary is `<expression> from <path>`** — named exports only, bare paths, no
  inline fences, no `implement`/`inject`; `progress` opt-in; every sidecar gets a `signal`;
  cancellation is never declared. An intent that crosses the boundary is non-undoable (§8, §15).
- **The swap seam is the app variant**: `app SkilletPreview = Skillet with { Datasource Memory }`.
  Test controls must lower to something the runtime can really do — `locale "es"` lowers to mocking
  the localization module; "nothing pretends to change the OS" (§16). `data <status>` was retired in
  favor of future spellings **that name the provider** — the explicit invitation for a
  capability-addressed test driver.
- **Three Tao-facing shapes already exist.** A constructed value with `action(...)` fields and
  reactive optional values (`Haptics`, `Pasteboard`, `ShareSheet`); a UI component
  (`ImageInput(Sources: camera, library)` — the decided spelling for camera/photos in the demo
  apps); a live handle with availability (`Here`, `places near Here within 5.km`). Capabilities
  pick the shape that fits; nothing forces one mold.
- **Word collisions to respect**: `capability` means holder-of-secret authority
  (`by capability Recipe.ShareCode`); `device` is a field trait and a scenario pin; `permission` in
  the authority chapter means store authority. New surface must not add senses to these words —
  §11's `permissions` binding already claims the OS sense.

### What the shipped tranche established

The `@tao/device` pattern: a thin `.tao` contract (a `public type` whose fields are actions and
reactive optionals, plus a `public function` constructor), a three-line sidecar
(`return Haptic() from ./Haptic.ts`), and a TR capability module over a lazy native-module kernel —
`createNativeModules(loaders)` with a **closed literal require union** (Metro resolves requires
statically) and constructor-injected loaders as the test seam. Vendor enums and result objects never
cross the Tao contract; declaration-owned case identities flow _into_ TR (Haptic passes its compiled
`HapticKind` cases down) and are matched by identity — the runtime must never manufacture lookalike
cases. Capabilities are stdlib-owned: app-authored native bindings are fenced out, and each new
native module is a new literal in the kernel. This is a curated set, not an open extension point.

## The evidence: what 30 draft bindings actually contain

The reference branch `reference/rn-expo-bridge-drafts` (reference only, never merges) holds 47 draft
modules, 30 of them full bindings sharing one pattern: a structural driver type, a
`setDriverForTests` hatch, lazy `require()` inside a resolver function. Decomposing those ~2,600
lines:

| Layer                                                    | Share of code | Variation across 30 modules            |
| -------------------------------------------------------- | ------------- | -------------------------------------- |
| Resolver + test hatch                                    | ~15%          | byte-identical except the require name |
| Action-object types and `xAction()` factories            | ~25%          | two shapes, mechanically derivable     |
| Doc comments and barrel re-aliases                       | ~17%          | formulaic                              |
| **API-specific: driver members, enum maps, verb bodies** | **~40–45%**   | the actual content                     |

Per module the ratio tracks complexity: Clipboard is ~17% unique, Vibration ~15%, Share ~24%,
Haptics ~35% (half of that two enum mappers derivable from the enum shape), Location ~58%. What
makes Location unique is exactly what no generator can produce: **the editorial decision of what the
Tao verb means** — fusing permission-request into the read, collapsing two or three native calls
into one Tao call, normalizing the result into a Tao-shaped record. The drafts also contain two
unreconciled permission models (permission-as-boolean-field on results, and an explicit status enum
for Android only) and no failure model at all — three different ad-hoc encodings and zero try/catch.
Both gaps are what the decided language now supplies.

Two readings follow. First, **roughly 55–60% of a hand-written binding is envelope** that never
varies — and 30 hand-copies of it produced zero drift, evidence the pattern is stable enough to
freeze into an engine. Second, **the remaining 40% is language design, not translation**: which
native calls make one Tao verb, what the case set is, what honest unavailability looks like. That
part _should_ be hand-written, because it is exactly the part Ro decides per capability.

## The tradeoff, laid out honestly

**Option A — generate bindings from TypeScript definitions (or docs).** A generator reads
`expo-location.d.ts` and emits driver type, resolver, actions, and a Tao declaration.
_For:_ new APIs at near-zero cost; upstream drift caught by regeneration. _Against:_ the `.d.ts`
does not contain the design — no case sets, no permission fusion, no verb boundaries, no honest
`unavailable`; a generated surface is vendor-shaped, which the shipped pattern explicitly forbids
("Expo's enum families never cross the Tao contract"); docs-driven generation is strictly worse
(unverifiable input). The generator would excel at producing the 60% envelope — which an engine
makes ~0 lines anyway — and fail at the 40% that matters.

**Option B — one bridging engine, per-API configuration, hand-written Tao contracts and verb
bodies.** The engine (grown from `createNativeModules`) owns everything the drafts copy-pasted:
lazy module loading and caching, the driver/test-injection seam, permission-status normalization
(the drafts duplicate `granted === true || status === 'granted'` verbatim across modules),
error-to-outcome mapping honoring declared case identities, availability probing, friendly
missing-module errors. A capability then costs: a ~5–15 line `.tao` contract, a ~3-line sidecar, a
~30–80 line TR module (driver subset type + verb bodies over engine helpers), one loader literal,
one scripted test driver, behavior tests in Tao. _For:_ marginal cost per API is a focused
afternoon, all of it design rather than plumbing; one place to fix a cross-cutting bug; the seam is
constructor-injected (no singleton registry — the native-canvas exploration's warning). _Against:_
an engine is an abstraction that must earn each helper; over-generalizing it recreates the
boilerplate as configuration.

**Option C — keep hand-writing whole bindings.** _For:_ zero abstraction risk; the shipped three
prove it works. _Against:_ the drafts are the counterfactual — 30 modules of copy-paste, two
permission models, no failure model. At eight-plus capabilities the envelope drift risk and the
per-API cost dominate.

**Recommendation: B, with generation inverted into verification.** Bindings are configured through
one engine and their meaning is hand-written. TypeScript definitions still get used — not to author
drivers but to **check** them: a generated conformance assertion per capability
(driver-subset-of-module, `satisfies`-style against the real package's types) turns every SDK
upgrade into a compile-time diff of exactly what the binding relies on. Generation as author loses
the design; generation as auditor catches upstream drift for free. Enum-case mapping tables (the
one genuinely derivable API-specific layer) may graduate to codegen later if they multiply.

## Sketches to provoke

All examples, none decided.

### Permissions as multi-state values

The decided two cases (`granted`, `denied`) are not enough for honesty — the findings record asks
for explicit denied, **unavailable**, and failure behavior, and every platform distinguishes
never-asked from refused. A minimal honest case set:

```tao
permissions CameraAccess { Reason "To photograph receipts into your list" }

when CameraAccess {
   granted      -> CaptureButton()
   undetermined -> CaptureButton()                     // first use will ask, showing the Reason
   denied       -> Text("Camera access is off. Enable it in Settings to snap receipts.")
   unavailable  -> Text("No camera on this device.")   // web preview, simulator, hardware absence
}
```

`undetermined` renders the same affordance as `granted` in the common case (the OS prompt appears on
first gated use — which is where the decided "Reason shown at first use" lives); it exists so a
screen _can_ distinguish "will ask" from "was refused". `unavailable` is what makes the Studio web
preview and the simulator honest rather than lying `denied`. Open: whether iOS `limited` (partial
photo access) is a fifth case or deferred; whether re-asking (deep link to Settings) is an action on
the permission value or a stdlib affordance.

### Location: a handle with availability, gated by its binding

```tao
use Location from @tao/device/location

app Grocer {
   permissions LocationAccess { Reason "To find stores near you" }
}

// Here is a live handle with availability, like every provider-backed value —
// its unavailability *is* the permission state; no boolean, no call-site request ceremony.
when Here {
   available -> StoreMap(Near: Here)
   otherwise -> when LocationAccess { denied -> EnableLocationHint(), otherwise -> Spinner() }
}
```

The permission-gated _read_ is availability on the value; the permission-gated _effect_ (one-shot
"locate me now") is an action with declared failures:

```tao
action LocateStore() {
   fails NoLocation "We couldn't get a location fix."
}
when do LocateStore() { NoLocation -> present Notice(Problem) as toast, error -> … }
```

### Share, with the outcome it was cut without

```tao
when do GroceryList.Share() {
   shared    -> do MarkShared(GroceryList)
   dismissed -> …                             // the person changed their mind; not an error
}
```

`shared` / `dismissed` are declaration-owned cases on the stdlib `ShareSheet` contract, fed into
`when do` by identity — the mechanism the findings record says Haptic proved downward but no action
yet delivers upward. This is the program's language-mechanism dependency, shared with every
outcome-bearing effect in the language.

### The scripted test driver, addressed to the capability

```tao
scenario ReceiptCapture {
   permissions CameraAccess granted
   camera returns ReceiptPhoto                // a fixture image; the driver is scripted, not real
   do SnapReceipt()
   expect GroceryList has { Source is ReceiptPhoto }
}

scenario ShareDeclined {
   share resolves dismissed                   // outcome case, checked against the declaration
   do ShareList()
   expect ListScreen shows "List not shared"
}
```

Following §16's grammar exactly: the spelling names the provider/capability (`camera returns …`,
like `datasource fails after create …`), cases are declaration-checked at test-compile time (like
`action FetchRecipe fails NotARecipe`), and each control lowers to a real seam — the engine's
injected loaders, the same seam Jest, the Studio provider overlay, and a future native canvas all
consume. One driver seam, several consumers.

### What a capability costs under the engine (the library-speed claim)

```
@tao/device/location/
  Location.tao        ~12 lines   the contract: types, actions, availability   (hand-written, design)
  Location.ts         ~3 lines    sidecar pass-through                         (pattern)
runtime/TR-location.ts ~60 lines  driver subset type + verb bodies             (hand-written, small)
  + 1 loader literal in the kernel, + 1 scripted-driver registration
  + generated conformance assertion against expo-location's types              (machine-checked)
  + behavior tests in Tao, + a device smoke-test entry
```

## RN core versus Expo

Neither can be exclusive: Expo lacks Share and Vibration; RN core lacks (or deprecated) Clipboard
and semantic haptics; the runtime is already an Expo app, so choosing RN-core primacy removes no
dependency. The drafts' revealed preference is the workable rule: **Expo when it offers the module,
RN core otherwise** — the one free choice on the branch (Linking, where both exist identically)
went to Expo. Under the recommended architecture this stops being an architectural question at all:
the Tao surface is vendor-neutral by construction, and RN-vs-Expo is a per-capability sourcing note
inside one TR module, changeable behind the contract. Both stay first-class at the require level;
Expo is the default reach.

## Haptics and Vibration: the deliberate overlap

The shipped `Haptic` is semantic ("not raw vibration"): `Play(Selection | Light | … | Error)`.
Raw `Vibration.vibrate(pattern)` is a different vocabulary — durations and motor patterns. Three
readings of the roadmap's "may one capability expose two bindings":

1. **One capability, one binding** — Haptic is Tao's tactile surface; raw patterns stay out until a
   real feature forces them (no current app feature does; Coverage.md demands a forcing feature).
   Vibration still proves the engine's RN-core fire-and-forget lane — as the engine's cheapest
   conformance case, not necessarily as shipped stdlib surface.
2. **Two capabilities** — semantic feedback and motor patterns are different things with different
   names (the drafts' implicit answer: `Feedback` and `Vibration` coexisted as distinct surfaces).
3. **One capability, two bindings** — `Haptic` maps to expo-haptics where present, degrades to
   RN `Vibration` otherwise. Rejected on current evidence: silent degradation lies about what the
   person feels, the opposite of honest multi-state values.

Leaning 1, with 2 available the day a feature forces patterns.

## Studio and simulation posture

The web preview host has no camera, no haptic motor, often no real share sheet. The AI program's
posture transfers whole: **honest `unavailable` is itself the day-one cross-platform support.** A
capability in the Studio preview is, in order of preference: really available (clipboard on web),
scripted by the active named state / environment (a fixture photo for the camera), or honestly
`unavailable` — never silently no-op'd where the state is observable, never faked as `granted`.
This requires the Studio environment/provider overlay to grow a device dimension it does not have
today (`TaoStudioEnvironment` is datasource-shaped only) — a seam collision with the deterministic
simulation program, flagged below, not decided here.

## Sequence, sketched (final shape after dialogue)

1. **Engine consolidation** (no unsettled language decisions): grow the kernel into the bridging
   engine under the three shipped capabilities without changing their Tao contracts; add the
   generated conformance assertions; prove the envelope on `Vibration` as the RN-core
   fire-and-forget conformance case. Pure runtime work, existing tests must stay green.
2. **Outcome delivery**: `when do` receiving declaration-owned cases from a capability action —
   Share's `shared` / `dismissed` as the proving feature, plus the scripted-outcome test spelling.
3. **Permissions**: the extended case set, the binding-to-capability wiring, the scenario pin, the
   Studio `unavailable` posture — proved on Camera-for-`ImageInput` or Location (dialogue picks).
4. **Location**: the `Here`-style handle, permission-gated reads, declared failures — the full
   permission-gated fallible shape end to end.
5. **Grocery app integration**: receipt photo, share-with-outcome, haptic on drop, as behavior
   tests in Tao — the tranche's Definition of Done.

## Cross-program seams (flag, don't decide)

- **Deterministic simulation** (parallel): the scripted capability driver must be one seam with
  that program's provider harness — the engine's injected loaders surfaced through the same
  overlay that scripts datasources. Two driver registries would be the singleton-registry mistake
  the native-canvas exploration warns against.
- **AI in Tao apps** (in implementation): same patterns by construction — capability behind a
  seam, honest availability, scripted drivers. Its `generate Recipe from Photo` will eventually
  want camera/photos from this program; noted as a future dependency, nothing built for it now.
- **Studio as a Tao app** (parallel): the preview's device posture above must ride Studio's
  provider overlay, not a parallel mechanism.

## Deferred (liked or inevitable, not now)

- Biometrics (`expo-local-authentication`) — needs a forcing feature; none in the current apps.
- Files as picker/attachments — belongs to the decided `files` provider (Wayfare · Documents,
  Post-MVP), not to this program's engine work.
- iOS `limited` photo access as a permission case; Android's `never_ask_again` distinction.
- Background location, geofencing, watch-position streams (`runs latest` interplay).
- Secure store, contacts, calendar — each waits for its forcing feature.
- App-authored native bindings (opening the closed require union) — explicitly out; the set stays
  curated until a real extension story is designed.
- Enum-map codegen — only if mapping tables multiply.

## Open questions, gathered

1. The permission case set: is `granted / undetermined / denied / unavailable` the honest minimum,
   and is `limited` in or deferred?
2. How does a capability _name_ its permission — does `@tao/device/location` declare "needs
   `LocationAccess`" in its contract, or does the app root wire binding to capability explicitly?
3. Re-asking after denial: an action on the permission value (`do CameraAccess.Ask()` deep-linking
   to Settings), a stdlib affordance, or nothing (render the hint, the person acts)?
4. What forces Location before Hearth · Around (Post-MVP)? The grocery app has receipt-camera and
   share honestly; "stores near you" may be contrivance. Coverage.md demands the answer.
5. The scripted-driver spellings: `camera returns <fixture>` / `share resolves dismissed` /
   `permissions <Name> denied` — one grammar for all three, or does each capability shape
   (fire-and-forget, async-result, permission-gated) want its own verb?
6. Does the `when do` outcome mechanism (slice 2) generalize to every effectful action in the
   language, and is this program the right place to build it, given every other program will
   consume it?
7. Camera beyond `ImageInput`: is the component the _only_ camera surface for now (leaning yes —
   it is the decided spelling in three demo apps), with an imperative capture capability deferred?
8. Device smoke tests: what is the minimum real-hardware loop (module linking, Info.plist/manifest
   permission strings, platform behavior) that Jest cannot prove, and where does it run?
