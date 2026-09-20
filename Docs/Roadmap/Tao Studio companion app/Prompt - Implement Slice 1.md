# Prompt - Implement Tao Studio companion Slice 1

Implement Slice 1, **Pair and render one real device**, from
[Plan - Tao Studio companion app](./Plan%20-%20Tao%20Studio%20companion%20app.md). Orchestrate the work
as a dependency-aware, multi-agent implementation while retaining one integration owner. Do not
implement later product slices merely because their protocol concepts appear in the plan.

## Outcome

Deliver the smallest honest development loop in which Tao Studio and its browser canvas keep working
while a fixed Tao Companion development build on a physical iPhone:

1. installs without starting another Metro;
2. opens from Studio or its QR fallback;
3. pairs through a narrow authenticated gateway;
4. renders the selected generated Tao app;
5. switches among three Studio scenarios;
6. receives ordinary Tao/TypeScript Fast Refresh;
7. acknowledges the exact applied compile revision;
8. rejects wrong, replayed, and revoked trust; and
9. disconnects and reconnects with an unmistakable stale/disconnected state.

The physical proof must record whether same-Wi-Fi LAN or an active cable link-local interface carried
Metro and control traffic. A simulator is useful during development but cannot close this slice.

## Authority and required reading

Before editing, inspect the live checkout, worktree list, branch, status, instructions, dependencies,
and current tests. Read these sources in order:

1. repository `AGENTS.md` and `packages/AGENTS.md`;
2. `agents/skills/delegation/references/parallel-implementation.md`;
3. the companion plan linked above, especially **Development foundation** and Slice 1;
4. `Docs/Roadmap/Tao Studio v1/Exploration - Native device as Studio canvas.md`;
5. `Docs/Spec/Tao Studio.md`;
6. `packages/dev/dev-src/studio/StudioPreviewRuntime.ts` and `StudioDev.ts`;
7. `packages/dev/dev-src/expo-dev-loop/expo-runner/metro.ts`, `physical-device.ts`, and their tests;
8. `packages/studio/studio-src/StudioProtocol.ts`, the server and client entry points, and Studio tests;
9. `packages/runtime/TaoRuntime-src/TR-studio-preview.tsx` and its tests;
10. the old repository's device launcher, LAN helper, dev-client config, and associated skill only as
    historical evidence.

Read the applicable repository skills before crossing their boundaries:

- `dev-automation` for commands, Justfile recipes, and `packages/dev`;
- `old-repo-porting` before reusing an approach from `~/code/tao-lang`;
- `studio-hybrid-client` for Studio browser/client UI;
- `runtime-codegen` if generated compiler/runtime contracts change;
- `test-quality` for the test strategy;
- `error-handling` for user-facing failures; and
- `git-workflow` before any authorized commit or branch operation.

Live repository evidence wins over this prompt. If it contradicts the plan materially, stop at the
integration barrier, show the evidence, and ask Ro to decide rather than silently changing the product
contract. Routine implementation details should be resolved from the code.

## Non-negotiable architecture

- Use one Studio-owned, per-project Expo/Metro process for both browser and native bundles. Never start a
  companion-owned Metro during the daily loop.
- Create the fixed Expo development-build shell under `packages/studio-companion-app`, remaining on the
  repository's Expo SDK 54 line for this slice. Use the compatible `expo-dev-client` version resolved by
  Expo's tooling; do not upgrade the repository SDK as part of this work.
- First installation uses `expo run:ios --device <device> --no-bundler`. A native rebuild is needed only
  when native dependencies or application configuration change.
- Keep the full Studio browser/API server loopback-only with its current Host validation. Add a separate,
  narrow, authenticated `StudioDeviceGateway` for device traffic.
- The phone initiates the control WebSocket. Expose only pairing, project/app/session identity, scenario
  bootstrap, revision state, device observations, and explicitly granted source-action proposals.
- Reuse the existing Studio manifest, cell/scenario, compile-revision, source-action, and applied-revision
  contracts internally. Do not create a parallel compiler, watcher, or source-authority path.
- Add a platform-specific `TaoStudioDeviceHost`; do not make the browser parent/DOM bridge pretend it is a
  native host.
- Prefer the custom-runtime URL returned by Expo's `/_expo/open`; retain SDK 54 `/_expo/link` and a tested
  generated deep-link fallback. Launch the installed bundle with current `xcrun devicectl` structured
  commands and always show the same URL as a QR.
- Use direct reachable-address bootstrap for Slice 1. Bonjour, Network.framework peer-to-peer discovery,
  DeviceDiscoveryUI, a Tao internet relay, TestFlight, accounts, beta updates, and App Store review are not
  dependencies for this slice.
- Do not depend on `iproxy`, `usbmuxd`, private USB forwarding, or a custom `expo-dev-launcher` patch unless
  a documented physical-device failure proves it necessary and Ro approves the scope expansion.
- Never send `localhost` to a physical device. Treat `169.254.*` as a candidate that must succeed from the
  phone, not as proof of a tunnel.
- Add the development local-network privacy and ATS declarations. Add Bonjour service declarations only
  when Bonjour itself is implemented in a later slice.
- The Mac remains source authority. The device carries revision-bound typed messages and renders only the
  revision Studio acknowledges.
- Do not invent cryptography. At the first design barrier, select a maintained implementation for an
  authenticated ephemeral handshake, transcript-bound short-code comparison, replay resistance, Keychain
  device identity, revocation, and secure reconnect. Document the threat model and why the chosen primitive
  fits before integrating it.

## Execution graph

Keep one orchestrator as integration owner. Give every implementation agent exclusive paths or concepts,
forbid Git/index operations in shared worktrees, and require each handoff to include decisions, changed
files, tests, remaining risks, and developer-environment ledger entries. Reserve root manifests, dependency
locks, shared protocol exports, generated artifacts, and final documentation for the integration owner.

### Barrier 0 - establish the seam

The integration owner must first:

- map the current Studio process, preview runtime, Expo session, generated application entry, revision
  acknowledgement, and cleanup lifecycle;
- verify the exact Expo SDK 54 development-client install command and custom-runtime URL response locally;
- choose where the versioned protocol lives so Studio, development tooling, and the dependency-light runtime
  can consume it without illegal imports;
- write the handshake threat model and choose maintained primitives/libraries;
- specify the smallest `tao-studio-device-v1` message set, state machine, size limits, version failure,
  authorization checks, and error vocabulary; and
- publish ownership boundaries before parallel edits begin.

No agent may independently invent a second protocol or revise these seams after Barrier 0 without telling
the integration owner.

### Parallel workstream A - companion shell and device tooling

Own the new companion package and isolated device-install/open tooling delegated by the integration owner.

- Scaffold the SDK-matched Expo development client with fixed development bundle id and generated scheme.
- Add disconnected/pairing/stale/error surfaces, local-network declarations, and secure device-key storage.
- Implement structured physical-iOS discovery, installed-app status, install/open commands, endpoint
  candidates, QR data, and named diagnostics through existing shared wrappers.
- Add `just studio-companion-install device="<name>"` without creating a second Metro.
- Adapt proven old-repository ideas, not its bash, `jq`, `grep`, silent error handling, or Expo Go coupling.

### Parallel workstream B - gateway, protocol, and trust

Own the versioned protocol and narrow gateway paths assigned after Barrier 0.

- Bind only the device gateway to a reachable interface; preserve the loopback Studio server unchanged.
- Implement handshake, short-code confirmation, capability/session binding, stored-device reconnect,
  revocation, replay rejection, message limits, lifecycle cleanup, and actionable errors.
- Adapt existing Studio data internally; expose no filesystem path, arbitrary HTTP route, admin credential,
  or unrelated project state.
- Unit-test parsing and every trust boundary before connecting product UI.

### Parallel workstream C - native generated-runtime host

Own the platform host and its focused runtime/compiler tests.

- Mount the selected generated Tao app without a browser parent or DOM.
- Connect, pair, request cell/scenario bootstrap, render, switch scenario, acknowledge applied revision,
  reconnect, and show disconnected/stale state.
- Preserve the browser host and platform-neutral Tao runtime contract.
- If compiler-generated imports or `TR` APIs change, use the `runtime-codegen` skill and keep the change a
  named vertical slice with generated-code coverage.

### Workstream D - Studio integration and product UI

Start after the protocol and lifecycle interfaces are stable. Own the Studio server/client paths assigned
by the integration owner.

- Extend `StudioPreviewRuntime` and its Expo session to produce the custom-runtime URL and bootstrap facts;
  do not add a watcher or Metro process.
- Add Studio actions for `Open on Device`, `Copy device URL`, `Show QR`, `Reconnect`, and revoke trust.
- Add one compact device button/popover showing install state, connected device, transport, project/app,
  scenario, compile revision, applied revision, and the exact failing layer.
- Keep Studio usable when no device exists, permissions are denied, the phone disconnects, or an alternate
  Metro port is allocated.

### Workstream E - adversarial integration and physical proof

Start focused test design after Barrier 0; integrate once the other workstreams expose stable seams.

- Add behavior-focused tests for endpoint selection, structured `devicectl` parsing, authorization,
  malformed/oversized/version-mismatched messages, wrong project/session/revision, stale/replayed/revoked
  trust, reconnect, cleanup, and simultaneous browser/native consumers.
- Test port 8081 and an allocated alternate Metro port.
- Run the real-iPhone proof below and retain concise evidence in the task handoff or ignored `.artifacts/`,
  never in a fabricated passing test.
- Independently review cross-workstream authority, cleanup, error reporting, and accidental second-Metro
  risks before the full repository gate.

## Integration checkpoints

Integrate only at these green barriers:

1. **Contract:** protocol/state machine, threat model, package boundary, and lifecycle API reviewed.
2. **Shell:** development client builds and installs with `--no-bundler`; no other Metro starts.
3. **Render:** native host renders a generated Tao app from Studio's existing Metro while browser Studio
   remains usable.
4. **Control:** pairing, three-scenario switching, revision acknowledgement, revocation, and reconnect work
   through the narrow gateway.
5. **Product:** Studio actions, QR fallback, state display, and named diagnostics work with and without a
   device.
6. **Proof:** automated focused tests pass, the physical-device checklist is recorded, and `./agent verify`
   has run.

At each barrier, the integration owner reviews the actual diff and validation rather than accepting an
agent's completion claim. Re-read shared files before integrating because other work may be concurrent.

## Physical-device acceptance

On one real iPhone, demonstrate and record:

- one native install with no companion Metro process;
- Studio opening the installed app and the QR opening the same runtime;
- short-code pairing, stored-key reconnect, explicit revocation, replay rejection, and re-pairing;
- the selected Tao app rendered beside the still-working browser/Electrobun canvas;
- three distinct scenario switches;
- a Tao source edit reaching the phone through Fast Refresh;
- matching Studio compile and device applied-revision identities;
- foreground reconnect after disconnect/backgrounding; and
- a diagnostic for at least one deliberately broken host, permission, or port condition.

State the phone model/iOS version, Mac/Xcode version, Metro port, device-gateway port, connection route,
whether Wi-Fi and cable link-local were each tried, and any unclosed hardware limitation.

## Validation and completion rules

- Run focused tests throughout; run the repository's required generators/formatters when their sources
  change.
- Run `./agent verify` as the final gate. Do not hide, rewrite, or call an unrelated pre-existing failure a
  pass; identify it precisely and keep focused validation separate.
- Maintain the required developer-environment ledger with symptom, command, evidence or likely cause,
  workaround, and possible repository/host improvement.
- Do not alter language semantics, beta distribution, relay infrastructure, later companion features, or
  unrelated dirty work.
- Do not stage, commit, merge, push, or publish unless the invocation explicitly authorizes it. If commits
  are authorized, use a named `feat/` branch, read `git-workflow`, and commit only reviewed green
  integration units. Never merge or push merely because implementation is complete.

The final handoff must lead with whether the real-device outcome works. Then list changed architecture and
files, focused and full validation, physical proof, security decisions, remaining limitations, and a
**Developer environment** section separating fixed issues, repository improvement suggestions, and
external/policy limitations.
