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
closes the connection. A real WordFlower capture from the simulator is **7,305 bytes** — two orders of
magnitude below the limit (the artifact is at `.artifacts/slice-2/device-capture-wordflower.json`).
The client still measures each frame and answers the request with a failure naming the size rather
than sending an oversized frame, so a larger capture degrades to a readable error instead of a
dropped session.

## Proven live on the simulator

- A reconfigure carrying a new environment reaches the device and re-assigns it with a live instance;
  its next acknowledgement is accepted rather than refused as stale.
- `POST /api/device/capture` returns a complete artifact from the phone.
- The artifact carries real interaction state: typing a workspace name into the running app on the
  device and capturing again produced an artifact containing that text (7,398 bytes against a 7,305
  byte baseline).

## Open: restore does not round-trip on device

Restoring a device capture fails, reproducibly, and this blocks the "capture/restore WordFlower
state" half of the acceptance.

Feeding a capture back through `POST /api/preview/cell/reconfigure` as `replay` reaches the device
correctly — the re-assign works — and then the device shows:

```text
Restored navigation descriptor does not match live 'SelectionNav'.
```

followed by a "Maximum update depth exceeded" notice. It fails the same way for a true round trip:
capture and immediately restore that same artifact onto the same cell at its current revision.

What is known:

- The refusal is `restoreNavigationSnapshot` in `TR-navigation-value.ts:290-295`, comparing the
  snapshot's `descriptor` against the live navigator's `canonicalDescriptor`.
- It is **not** a device-only path. No rendered test anywhere — browser or device — asserts a
  navigation capture/restore round trip; the only coverage is `TR-runtime-capture.test.ts`, which
  exercises the registry rather than a mounted navigator. So this is most likely a pre-existing gap
  in capture/replay that the device surfaced, not something the device introduced.
- The failure is at least honest: the runtime refuses the restore and says why, rather than silently
  half-restoring.

Closing it means understanding why a canonical descriptor captured from a mounted `SelectionNav`
does not equal the one live after a remount. That is work in the navigation capture subsystem, which
is shared with the browser canvas, and it should be settled there rather than worked around at the
gateway.

## Not attempted, and why

**Run one journey.** Journeys are `*.test.tao` files beside the app, compiled by a Mac-side worker
(`TestCompiler.Worker.compileTestPlan`) and executed by a runner that depends on
`@testing-library/react-native` and mounts its own tree. The device's preview bundle carries only
`TaoApp.tsx`, `TaoStudioManifest.ts` and `modules/` — no compiled journey travels to the phone. So
this is a fork, not a task: bundle a test library into the companion and run headless, or build a
driver that drives the live cell through the real touch pipeline (which is what the plan means by
"on the real renderer, show each step"). Ro's call.

**Bidirectional selection.** The render identity is already on the device — `nativePropsWithStudioIdentity`
lowers `TaoStudioIdentity` onto every generated native root — so what is missing is the geometry and
hit-test layer the browser gets free from the DOM, plus a decision the exploration document
explicitly defers: what a tap means when the app is live. Long-press, an explicit mode, or a
two-finger gesture all collide differently with app gestures and with the badge's own drag.

**Project, app, variant, and persona switching.** `persona` and `variant` have no definition anywhere
outside the plan — zero occurrences in `packages/` or `Docs/Spec/`. Project and app switching is
architecturally blocked rather than unbuilt: a connection binds to one session at handshake and the
Metro bundle a device loaded _is_ the project, so switching means relaunching the device into another
bundle, not sending a control message.

**Checkpoint restore.** `checkpoint` in `StudioProjectSession` means the source-action undo group, not
a state checkpoint; the state mechanism is called `replay`. The bullet is ambiguous between them.
