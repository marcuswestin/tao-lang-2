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
