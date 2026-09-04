# Slice 2 - Everyday development canvas

Status: in progress. This records what is built, what was proven live, and what is waiting on a
decision. It extends the settled contract in
[Slice 1 - Device protocol and trust](./Slice%201%20-%20Device%20protocol%20and%20trust.md); nothing
here replaces a Slice 1 seam.

Slice 2's acceptance, from [the plan](./Plan%20-%20Tao%20Studio%20companion%20app.md): _"edit Mac to
native frame, select both ways, capture/restore WordFlower state, run one journey, and report whether
compatible state survived refresh."_

## Built

### A reconfigure reaches the device

`StudioSessionEvent` gained `cell-reconfigured`, emitted by `StudioProjectSession.reconfigureCell`,
and the gateway re-assigns the connection rendering that cell.

This closed a defect that predates the slice. `StudioMatrixSession.reconfigure` releases every live
instance of a cell, and the session emitted nothing. The browser never noticed, because it drives the
reconfigure itself and remounts; a device rendering the same cell was left holding an instance the
session would refuse from that moment on, and its next `device.applied` came back as no longer
current, silently.

It is also the seam the rest of the slice needs: the gateway already forwards a cell's `replay` and
`environment` inside `studio.cellAssigned`, and the device host already mounts `ReplayHost` and
`StudioEnvironmentControls.Host` around them. Provider and network control on a device therefore
works with no runtime change at all — a reconfigure carrying an `environment` now reaches the phone.

### Studio can ask a device for its runtime state

Two new sealed messages, plus their failure twin:

```text
studio.captureRuntime        requestId
device.runtimeCaptured       requestId, capture
device.runtimeCaptureFailed  requestId, error
```

`POST /api/device/capture` drives it from the loopback API. The client takes the capture as an
injected seam, the way it already takes its socket, storage and timers.

Every capture domain — action history, persisted state, navigation, data, scheme, environment —
registers at module scope, so a paired device always had a complete artifact to give; nothing could
ask for one.

**The frame-limit question is settled by measurement, not argument.** A capture is the first message
on this protocol that could plausibly exceed the 256 KiB sealed-frame limit, and an oversized frame
closes the connection. Real WordFlower captures taken from the simulator range from **7,305 bytes**
just after launch to **18,713 bytes** with a scenario's data loaded and a navigation stack built up —
both more than an order of magnitude below the limit, and the spread is the point: what a capture
costs is what the app is holding, not a fixed overhead. The client still measures each frame and
answers the request with a failure naming the size rather than sending an oversized frame, so a
larger capture degrades to a readable error instead of a dropped session.

### The phone is a canvas that selects both ways

The browser canvas hit-tests by asking the DOM what is under a click. A device has no DOM, so a phone
could render a cell but not answer "what is this?".

`TR-studio-device-inspect.ts` is that answer: every Studio-compiled native root registers a
measurable handle beside the occurrence identity `TaoProps` already lowers onto it, and a tap
measures the registered nodes and takes the most specific frame containing the point. Registration
is Studio-only by construction — the compiler emits studio identity only under `studio: true` — and
the ref registers nothing for a node without `measureInWindow`, which is every node under
react-native-web, so the browser canvas pays one property check and nothing else.

Four sealed messages carry it:

```text
device.selectSource        occurrence
studio.highlightSource     occurrence?          (absent clears the outline)
device.sourceAction        action, occurrence, requestId
studio.sourceActionResult  requestId, ok, error?
```

A device selection reaches the workbench on the `device-state` status snapshot rather than as its own
event, carrying a `sequence` that advances per tap — the same status is re-sent whenever anything
about the connection changes, and re-opening the editor on each one would fight the person's cursor.

**An occurrence carries the source version of the file in the bundle the device is running**, not the
one on disk now. That is what makes a span from a phone trustworthy: the device may be minutes
behind, and a range measured against older text would select — or edit — the wrong thing. Studio
refuses a stale one, exactly as it does for the browser canvas.

The envelope for a device-originated edit is built by the gateway, not the device. Everything that
decides whether an edit is legal — which cell instance is current, which scenario it renders — is
Studio's own state; a device that could assert those could edit against a tree Studio has already
replaced. The device supplies only what it alone knows: which render was touched and where it goes.

### The badge is a fan-out companion menu

Interactions that only make sense on a companion live here rather than in the app: Inspect (a mode),
Move up, Move down, and Scenarios. Inspect is a mode on purpose — no gesture reliably means "tell me
about this" on a phone already using taps, long-presses and drags for the app's own purposes — so an
overlay takes every touch while it is on, and the app underneath is deliberately unreachable.

The result of an edit is shown on the phone. The person making the edit is looking at the device, so
Studio's answer — applied, or refused and why — belongs on that screen and not only in Studio's log.

Offline and Slow network are there too. The mechanism needed nothing new — a reconfigure carrying an
environment already reaches the phone — so this is the phone naming a situation and Studio deciding
whether its cell is still current. The condition is merged into the environment the cell is already
under, so choosing Offline does not also reset its scheme and viewport.

### The phone's console reaches Studio

`device.log` batches console output on a short timer and the gateway writes each line into Studio's
own output. Mirrored, not moved: the lines still print on the device, so a dropped connection costs
the mirror and not the log. A runaway render loop is capped at 200 buffered lines and says how many
it dropped rather than exhausting memory on the phone.

Studio's Logs drawer is bound to a browser preview connection, so device lines do not appear there
yet; that needs a decision about whether a device counts as a preview connection for panel purposes.
Studio's terminal output is where they land today, which is already the thing that was missing:
watching a phone previously meant watching Metro's terminal, which is not where a person driving
Studio is looking, and is not available at all with the cable pulled.

## Proven live on the simulator

- A reconfigure carrying a new environment reaches the device and re-assigns it with a live instance;
  its next acknowledgement is accepted rather than refused as stale.
- `POST /api/device/capture` returns a complete artifact from the phone — all six domains, and the
  18,713-byte upper measurement quoted above.
- The artifact carries real interaction state: typing a workspace name into the running app on the
  device and capturing again produced an artifact containing that text.
- **Restoring a device capture works.** Feeding one back as `replay` re-assigns the device and the
  restored screen renders. This previously failed with `Restored navigation descriptor does not match
  live 'SelectionNav'`; see "Every app variant gets its own navigation capture" below.
- **A tap on the phone reaches the Mac's source.** Tapping the "Open workspace" button on the device
  produced exactly `@ui/Workspaces.tao:11186..11278` — the `FormButton("Open workspace")` render —
  with its owner and the device's own source version.
- **An edit made on the phone changed the Mac's file.** Selecting that button and choosing Move up
  reordered it above "Delete workspace" in `Workspaces.tao`, tags and all; Studio recompiled and the
  phone re-rendered in the new order.
- **A selection made on the Mac outlines on the phone.** Clicking "Open workspace" in Studio's canvas
  outlined exactly that render on the device, and clicking "Delete workspace" moved the outline to
  it. The outline is passive — inspect mode is off, and the phone's own touches still reach the app —
  which is the difference between being shown something and being taken over.

### What the live run caught that the tests did not

A move named only one side of the gap it was landing in. Studio reads a before-only anchor as "make
this the block's first render" and refused with _"A before-only drop anchor must be the first render
expression."_ A move now names both bounding renders, the way the browser canvas does when a render
is dropped between two others. The device is what surfaced it, and it is a test now.

## Fixed here, both older than this slice

**Every app variant gets its own navigation capture.** `appCaptureKey` keyed on the app declaration
alone, so `WordFlower`, `WordFlower - Drawer Preview`, `WordFlower - Dark` and
`WordFlower - InstantDB` — four variants sharing one base declaration — shared one capture slot. A
capture taken in one variant was offered to another on restore, and the navigator refused it because
the descriptors genuinely differ. The key now includes each lane's canonical descriptor. No rendered
test anywhere asserted a capture/restore round trip; `capture-restore-e2e.jest-test.tsx` does.

**A replayed cell no longer restarts its restore on every render.** `ReplayHost` keyed the restore on
the replay artifact's object identity, and the generated preview roots rebuild that artifact every
render, so each render restarted the restore and restarting set state. It is content-keyed now, and
the fast path is still identity, so a caller that keeps the artifact stable pays nothing.

## Open: a replayed cell still spins

Mounting a cell that carries a replay still logs `Maximum update depth exceeded` repeatedly, in the
browser canvas as well as on the device. What is established:

- It is **not** caused by anything in this slice: it reproduces in the browser canvas, which does not
  mount the device host, and it predates the inspect registry.
- It is **not** domain-specific: a replay carrying only the `data` domain reproduces it, as does one
  with the scheme domain removed.
- It needs the replay to be present **when the cell mounts** — configuring a replay onto an
  already-mounted cell does not trigger it, reloading afterwards does.
- The `ReplayHost` identity churn above was real and is fixed, but was not the whole cause.
- The restore itself completes and the correct screen renders, so this degrades performance and fills
  the log rather than breaking the feature.

The next step is a stack, not more bisection: React attributes the loop to a `setState` in an effect
whose dependency changes every render, and the generated preview root rebuilds its whole cell runtime
object on each render, which hands a new object to every consumer below it. Memoizing that in codegen
is the likely fix and would close the class rather than one instance.

## Next in this area

These three are the work this slice would take next. The full inventory of what was
surfaced and left open — including these — is under "Discovered and not addressed" at the end.

**Run a test command from the fan-out menu.** `POST /api/tests/run` already exists, and the menu is
now the established place for companion-only actions, so this is a menu item and a result line rather
than new plumbing. It is the smallest remaining piece of "the phone as a real Studio canvas".

**Device lines in Studio's Logs drawer**, once it is decided whether a device is a preview connection
for panel purposes — see above. Diagnosing the scenario-switch freeze needed those lines and they are
only in Studio's terminal output, which is the wrong place for the one panel built to read them.

**Scenario and preview as separate declarations.** The split above is drawn at the boundary between
what a device can be and what only a canvas can frame, and it is drawn in the runtime rather than in
the language. Ro's proposal is to draw it in the language instead: a `scenario` owns the fixture,
subject and steps, and one or more `preview` entries under it own the frame — screen size and the
like — laid out horizontally in Studio. That would make the rule structural rather than a list of
which clauses travel, and it would let one scenario be previewed at several sizes without repeating
its fixture. It is a grammar change, so it belongs in a Revolution decision and a tranche.

## Three red screens on the device, and what each one turned out to be

All three were reported from a phone. Two were real defects, one was a language question standing in
for a missing containment, and none of them stays.

**Open workspace in the `states:novel` scenario threw** `Cannot present WorkspaceDetail: no enclosing
or explicit navigation target.` A `render ViewName(...)` cell mounted its view directly under
`AppShell` with no navigator anywhere above it, and presenting is legal in any view body — so a row
that opens its own screen died on the first tap. A focused view now mounts under a navigator of its
own: the compiler emits one app definition per focusable view, whose navigator is a slot holding
that view, which is the same shape `app Name { View Something }` already compiles to. `present` swaps
the slot, the app host draws Back, and the design comes from the app the scenario names. It is built
per cell and disposed with it, and its restoration is `fresh`.

**Deleting a workspace twice threw** `Cannot delete missing Workspace 'Workspace-1'.` The throw is
deliberate and tested; what was wrong is that a contained failure took the whole phone. LogBox is not
a passive observer on a device: its window becomes the key window the moment anything is logged and
keeps every touch afterwards, so one contained failure froze the badge, the tab bar and the app
together while all three still looked alive. The device host now turns LogBox off — console output is
mirrored to Studio, a render failure still renders the host's own failure screen — and takes the
unowned-failure seam itself, naming the failure in a dismissible notice at the top of the screen and
sending it to Studio. Repeats of one failure are shown once: the failures worth containing include
the ones a live query reproduces on every revision.

**Switching scenarios froze the phone.** Scoping persisted navigation to the cell (the previous fix)
was necessary and not sufficient. An app definition lives at generated-module scope, so its _mounted_
navigation and its memoized load both outlive the cell that produced them: the next cell opened on
the previous cell's stack, holding entity handles from a provider generation its own fixture had just
replaced. Those screens re-offered their queries on every revision, every offer threw
`Entity handle 'Workspace-1' belongs to an inactive provider generation`, and React eventually gave
up with `Maximum update depth exceeded`. What the person saw was a blank screen with a Back button
that ignored every touch. A cell change is now a relaunch: the host resets mounted navigation and
starts a new restoration launch under the new scope, in a layout effect, which is the one place that
runs after the outgoing tree is unmounted and before any passive effect reads the store.

The device log mirror is what found the third one, and it could only name it once mirrored errors
carried a few stack frames rather than a message alone.

## What a device loads: the scenario, not the frame

A scenario declares two kinds of thing, and only one of them is about the scenario. `fixture`,
`prepare`, the subject, `appearance` and `network` describe the run. `device phone` /
`device tablet 1024 x 1366` describes a frame for Studio's canvas — and a phone is already a device,
whose own size is the truth. So a device now loads the scenario and drops the one clause that can
only ever have been a frame, rather than silently applying part of the rest.

That cut the other way too. `devices:tabletDark` declares `appearance dark` and used to arrive on the
phone in Light, because `resolveScheme` answered every native request with `fixed-light-native`. That
boundary is real but narrower than it was written: what a native runtime cannot do is _follow the
device's own appearance_. Nothing stops it rendering dark when a scenario asks for dark, and a
scenario's appearance is part of the scenario. A pin now resolves to itself on native under a new
`pinned-native` capability; only a preview cell ever pins, so a shipped app resolves exactly as
before.

The phone says what it dropped. A cell whose declared frame does not fit on this screen raises a
dismissible notice naming both sizes, once per cell, and the scenario sheet carries the same line
permanently for when the notice is long gone. It stays quiet when the frame does fit: no device is
ever exactly a declared preset, and a notice on every scenario is a notice nobody reads.

`locale` and `direction` are still declared and applied nowhere — not on a device and not in the
canvas. They are in the manifest and no code reads them.

## The layout a phone shows and the canvas does not

`Col` and `Row` both default to `[content top stretch, fill]`, so every container grows to share its
parent's main axis. On a device that is what happens: WordFlower's Settings hero and card each take
half the screen, and HNReader's orange header takes two thirds of it. In Studio's browser canvas
neither does, because React Native Web's `ScrollView` content container has no definite height for
`flexGrow` to distribute, so the same tree measures to its content instead.

Both readings are defensible and they cannot both be right. Either the `fill` default is what these
apps should be written against — and Studio's canvas is showing a layout the phone will not produce,
which is the more serious of the two — or a container should hug by default and `fill` should be
asked for. It is a language decision with repo-wide blast radius, so it is recorded rather than
taken. One unambiguous instance was fixed in the app: WordFlower's `Card` let its title claim and
compress, because a heading beside an action does not fit at its natural width on a phone and both
were running off the card.

## Not attempted, and why

**Run one journey.** Journeys are `*.test.tao` files beside the app, compiled by a Mac-side worker
(`TestCompiler.Worker.compileTestPlan`) and executed by a runner that depends on
`@testing-library/react-native` and mounts its own tree. The device's preview bundle carries only
`TaoApp.tsx`, `TaoStudioManifest.ts` and `modules/` — no compiled journey travels to the phone. So
this is a fork, not a task: bundle a test library into the companion and run headless, or build a
driver that drives the live cell through the real touch pipeline (which is what the plan means by
"on the real renderer, show each step"). Ro's call.

**Project, app, variant, and persona switching.** `persona` and `variant` have no definition anywhere
outside the plan — zero occurrences in `packages/` or `Docs/Spec/`. Project and app switching is
architecturally blocked rather than unbuilt: a connection binds to one session at handshake and the
Metro bundle a device loaded _is_ the project, so switching means relaunching the device into another
bundle, not sending a control message.

**Checkpoint restore.** `checkpoint` in `StudioProjectSession` means the source-action undo group, not
a state checkpoint; the state mechanism is called `replay`. The bullet is ambiguous between them.

## Discovered and not addressed

The handoff list. Everything the slice's work surfaced and did not close, with enough context to
decide whether it is worth taking and roughly where the work would land. None of it blocks Slice 2's
acceptance, and the order is rough leverage, not priority — picking is the next worker's call.

**A device and the canvas lay the same tree out differently.** `Col` and `Row` default to `fill`
(`Docs/Spec/Tao Layout and UI.md`, UI Defaults), so on a device every container shares its parent's
main axis — WordFlower's Settings hero and its card each take half the screen, HNReader's header
takes two thirds — while the browser canvas measures the same tree to its content, because React
Native Web's `ScrollView` content container gives `flexGrow` no definite height to distribute. Two
ways out, and they are not equivalent. Make the canvas reproduce the device: give the web content
container a definite height in `TR-app-shell.tsx` and check both apps against the phone; that is a
fidelity fix in one file and it leaves the language alone. Or change the default so a container hugs
and `fill` is asked for; that is a language decision with repo-wide blast radius. Doing neither means
Studio keeps showing a layout the phone will not produce, which is the more serious half. Also
recorded under LANG-017 in
[Deferred Tao language decisions](../Deferred%20Tao%20language%20decisions.md).

**A query filter naming a deleted row throws.** Deleting a workspace twice in WordFlower ends in
`Query filter refers to missing Workspace '…'.`, asserted by `relationId` in `TR-data-schema.ts`,
because the screen that deleted the row re-evaluates its own filter before it goes away. The device
host now contains that failure rather than letting it take the phone, which makes it survivable and
leaves it undecided: a filter naming a row that is gone could as defensibly evaluate to no matches.
Deciding "no matches" means moving that assertion out of the filter path and letting the screen show
its own empty state; deciding "throws" makes it an app-authoring rule — a screen holding a row must
guard on it still existing — and the guard belongs in WordFlower as an example. Also recorded under
LANG-008.

**`locale` and `direction` are declared and read by nobody.** Both are accepted in a `scenarios`
block and carried in `TaoStudioManifest`, and no code on either surface reads them: a scenario
declaring `locale "de"` renders exactly as one that does not. Either wire them (the device honours
`appearance` through `resolveScheme` now, and these would follow the same path) or stop accepting
them until something does — accepting a clause that does nothing is worse than not having it.

**Scenario and preview as separate declarations.** See "Next in this area" above. The split between
what a device can be and what only a canvas can frame is currently a rule in the runtime; Ro's
proposal makes it structural in the grammar. Needs a Revolution decision and a tranche. Also recorded
under LANG-028.

**Device console lines never reach the Logs drawer.** They are mirrored to Studio's stdout only, so
the one panel built for reading them shows the browser cell alone. Diagnosing the scenario-switch
freeze needed those lines and they were in a terminal. Blocked on deciding whether a device counts as
a preview connection for panel purposes — see "Next in this area".

**Nothing in Studio drives capture or restore.** `POST /api/device/capture` and the restore path both
work and are tested, and neither has a control anywhere: capture/restore is command-line only, so the
slice's own acceptance sentence is exercised by curl. The fan-out menu is the established place for
device-side actions and the drawer for Mac-side ones.

**No test command from the fan-out menu.** `POST /api/tests/run` exists; this is a menu item and a
result line rather than new plumbing, and it is the smallest remaining piece of the phone as a real
canvas.

**A journey cannot run on the device.** The preview bundle carries no compiled journey, so this is a
fork rather than a task — bundle a test library into the companion and run headless, or drive the
live cell through the real touch pipeline. See "Not attempted, and why".

**Project, app, variant and persona switching is architecturally blocked**, not merely unbuilt: a
connection binds to one session at handshake and the Metro bundle a device loaded is the project. See
"Not attempted, and why".

**HNReader's online scenarios show fixture rows beside live ones.** The fixture's `HnId`s match
`StubAdapter`, not the live Algolia feed, so an online cell fills real stories in around two seeded
rows that never merge with anything. Fine for the stub variant and confusing anywhere else. Either
seed ids the live feed actually returns, or make the online scenarios start from no fixture at all
and keep `HNFrontPage` for the offline and row-focused cells.

**A companion has to be re-pointed at Studio after every restart.** Studio takes a fresh preview-Metro
port and a fresh gateway port each launch, and the companion derives both from the bundle it loaded,
so a phone left running against a dead Metro shows a blank white screen, dials nothing, and logs
nothing anywhere. Recovering it means an `openurl` with the new port. Trust already survives restarts,
so this is discovery rather than pairing: either hold the ports stable across restarts of one project
(`StudioSmoke.reserveResources` is prior art), or have the companion re-resolve a session it already
trusts. It is the sharpest remaining edge in daily use, and it is tracked as DEVENV-020 in
[Developer environment upgrades](../Developer%20environment%20upgrades.md).

**`just studio-native` logs one transient `Unable to resolve "./_gen_tao-app/App"`.** Metro reaches
the entry before the generated app is written, recovers on the next write, and leaves a red herring in
the output of the command a person runs most. Ordering the first compile ahead of the Metro start
would remove it; tracked as DEVENV-039.

**A replayed cell still spins.** Unchanged by this slice and reproducing in the browser canvas too;
the next step is a stack rather than more bisection, and the likely fix is memoizing the cell runtime
object in codegen. See "Open: a replayed cell still spins".
