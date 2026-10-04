# Companion Slice 2 and Studio hot reload: combined handoff

Recorded 2026-09-21 from the Companion Slice 2 dialogue, the separate Studio hot reload dialogue, the existing hot reload handoff, the Slice 2 roadmap, and current repository inspection. This is a working handoff, not an implemented contract. Recheck paths, Git state, and roadmap text before editing. The Developer prefers decision rounds of three questions, with concrete outcomes and pros and cons. This tracked copy is the shared starting point for the two implementation branches.

## Ownership and Git state

- The separate Studio hot reload discussion handed off its context and said it would make no further repository changes. Neither discussion wrote Companion or hot reload code.
- The original checkout /Users/ro/code/tao-lang-2 is clean on dev/ro at 071101d1 after the Developer explicitly authorized recovery. The failed merge had left 260 tracked changes and 200 untracked paths; all were checked against known main snapshots before a hard reset to HEAD and guarded deletion of the 200 byte-matched paths. Check Git with core.fsmonitor=false because the file monitor hid dirty paths during recovery.
- The shared starting branch is feat/studio-companion-hot-reload. It was fast-forwarded to local main at 375e0db2 before this document was added. The unique dev/ro commit 071101d1 is not on that branch. At this handoff point, no Companion or hot reload implementation has been committed, landed, or pushed. Each new task should use its own worktree branched from this starting branch.
- The old packages/studio-companion-app path was deleted locally. The source originated on the Companion implementation branch (07c9505a, 2026-09-03), landed on main in 8658ee9e, and moved in 2bc90866 to packages/ides/studio-companion-app. The nine current source/config files are tracked in both main and dev/ro. The removed old-path native ios/ tree was generated and untracked; no ios/ project at either path exists in any registered worktree or Git history. The current package README documents regeneration through just studio-companion-install device="<name>"; manual Xcode team selection may be needed again. Git cannot prove whether the deleted generated tree had local-only signing edits. Do not recreate the obsolete path.

## Parallel work boundaries

- The Companion Slice 2 task owns the Companion package, device runtime interaction, Studio device controls, capture/restore UI, and device log presentation, with its focused tests and Companion roadmap wording. It must not change Studio's preview compiler, draft synchronization, matrix iframe lifecycle, or Studio client/server reload implementation.
- The Studio hot reload task owns the Tao edit-to-preview pipeline, browser/phone revision feedback, and Studio client/server code reload, with its focused tests and Studio roadmap wording. It must not change the Companion package or device capture/restore and log UI.
- Shared server/gateway files, package manifests, lockfiles, and cross-workstream documents are integration seams. Before either task edits such a file, it should name the needed change and coordinate ownership with the Developer or the integration task. Separate worktrees prevent clobbering but do not prevent conflicting merges.
- Each task should settle its own three open choices with the Developer before implementing behavior, commit and validate its own branch, and stop before landing to main. The integration task will combine both branches, resolve shared seams, run the final gates, and propose the landing.

## Product direction

### Settled in conversation

- R12, revised 2026-09-26: [the staged public release plan](<../../MVP Roadmap/Plan - Staged public releases.md>) places supported, publicly downloadable native macOS Studio in release 3 and invitation Companion in release 4. The earlier first-release Studio promise is superseded and R12 is decided in the Developer MVP Roadmap. Native packaging and installed self-update acceptance remain separate from hot reload and from browser/source evidence.
- Initial local development host versioning: use an exact Tao-version match for now. This does not settle the store Companion's release cadence or all of R7.
- Slice 2 scope change: put device capture and restore controls in Studio. Running a device journey moves from Slice 2 to Slice 4. Preview hot reload is part of this combined work. The original Slice 2 acceptance sentence in Docs/Roadmap/Tao Studio companion app/Plan - Tao Studio companion app.md has not yet been amended.
- Refresh behavior: prioritize fast Tao app refresh in browser previews and a paired phone, then Studio's own client/server code reload. Preserve compatible browser and phone interaction state. A Tao compile error keeps the last working preview visible and shows a Studio source diagnostic. Use Metro's existing preview feedback for bundling/JavaScript errors; Studio owns Tao compile status and the phone's applied-revision status. Aim for the fastest practical response without a fixed numeric speed target.
- Existing scenario iframes and the paired Companion consume one Studio-owned Metro graph. The Companion does not need a second independent hot reload engine for this development path.

### Tentative product model, not a completed R7 decision

- The App Store Companion is an easy install path for invited beta builds, feedback, and optional pairing with Studio. An app-specific development build handles custom native code absent from the store Companion. Share Studio pairing, inspection, editing, and capture code across those builds.
- A paired store Companion should ideally receive compatible app updates from Studio; the Developer questioned whether it needs true Fast Refresh outside the local development flow. The beta-update mechanism and App Store acceptance remain open. A Linux/Windows Studio pairing with an already-installed iPhone Companion is a target architecture, not proven current behavior. If an app needs unavailable native code, the UI should explain that a matching native build is required. TestFlight/App Review feasibility needs proof before promising a universal store shell.
- Project/app switching on the phone is distinct from Studio's browser preview switching. A phone connection currently binds to one project session and Metro bundle; another project/app needs a bundle handoff and relaunch. Browser previews can still update when Studio switches projects.

### Three unanswered Companion Slice 2 choices

Discuss these with the Developer before implementing the affected behavior. Prior recommendations are not decisions.

1. Project/app switching on the phone: (a) leave its current app until manual opening; (b, recommended) offer Open this app on device in Studio and deliberately relaunch into its bundle; (c) automatically follow Studio selection.
2. Capture retention: (a, recommended) named captures for the current Studio session, restorable to a compatible cell; (b) durable project fixtures immediately; (c) latest capture only.
3. Device logs in Studio: (a, recommended) show labeled device lines in the Logs drawer in Slice 2; (b) move that UI to Slice 3 diagnostics; (c) show only the latest error in the Device panel. Device log mirroring to Studio terminal output already works.

### Three unanswered preview refresh choices

Discuss these with the Developer in one round before implementing the affected behavior. Prior recommendations are not decisions.

1. Trigger for editor typing: (a, recommended) refresh as fast as possible after explicit Save; (b) automatically save/compile after a short pause; (c) compile an unsaved in-memory draft. StudioDraftSync currently retains text until Save.
2. Incompatible state: (a, recommended) remount only affected previews with a brief reset notice; (b) reset all browser previews and the phone; (c) keep the old result until manual reload.
3. Phone lag: (a, recommended) let browser previews show the new revision immediately and mark the phone pending until acknowledgement; (b) reveal the new revision only when both have applied it.

After these rounds, settle the full Studio reload boundary: which long-lived resources survive a server-code reload, whether in-flight agent chats may reset with a notice, and how native mode participates. Do not silently treat a whole-process restart as equivalent to hot reload.

## Companion Slice 2: built, missing, and unproven

The detailed source of truth is Docs/Roadmap/Tao Studio companion app/Slice 2 - Everyday development canvas.md (status: in progress). Its simulator proof is useful, but it is not physical-device release acceptance.

- Built: device reconfiguration, sealed runtime capture, scenario/network controls, phone-to-source selection, Studio-to-phone highlighting, phone-initiated Move up/down, and bounded device console mirroring. A simulator run demonstrated capture/restore of WordFlower state, selection both ways, a phone edit changing source, and refresh reaching the simulator.
- Missing UI: Studio capture and restore controls. Browser capture/replay controls do not drive device capture. Device logs reach Studio terminal output, not the Logs drawer. Studio already has a Tests drawer Run control; the phone's fan-out menu lacks its own test command/result line.
- Known replay defect: mounting a cell that already carries replay repeatedly logs Maximum update depth exceeded in both browser and device. Restore completes and the screen appears. The Slice 2 note points toward a changing generated cell-runtime object and calls for a stack trace before a fix.
- Physical acceptance remains open: install/launch/pair on a real iPhone, three scenarios, refresh/state preservation, trust rejection/revocation, reconnect after Studio restart/network change, and cable link-local with Wi-Fi off. Document simulator/software proof separately from those runs. The store Companion and public native Studio distribution need their own release proofs.
- Adjacent language/product findings stay separate: scenario versus preview declarations, variant/persona semantics, layout fidelity/defaults, and locale/direction clauses that are currently inert. Do not fold those into this slice without the Developer's design decision.

## Hot reload seams and implementation order

1. Measure the current app-preview loop first. packages/ides/studio/studio-src/StudioPreviewSession.ts calls Runtime.generateApp directly through the serialized StudioCompileCoordinator.ts. StudioDraftSync.ts controls explicit Save. StudioPreviewMatrix.ts retains matching iframe identities. StudioCompileEvents.ts presents compile diagnostics and reconnects the browser event stream. The generated app and paired device share one Metro graph. Measure save-to-browser and save-to-phone acknowledgement on current main; preserve the last good bundle on Tao compile failure.
2. Inspect recent CLI performance changes before attributing speedups. Local main contains changes including bfa09d9d (import resolution) and f48e80ec (one workspace build per command). Improvements limited to tao check / tao fmt startup or caching may not affect Studio's direct Runtime.generateApp path; shared parser/compiler changes might. Measure the Studio path rather than importing CLI assumptions.
3. Coordinate app revision display. Studio tracks the generated manifest revision and the phone's applied acknowledgement. Metro handles bundle refresh in existing browser iframes and the paired device; Studio covers the stages Metro cannot see (Tao compile and device lag). Implement the three open refresh choices only after the Developer answers them.
4. Then reload Studio code itself. packages/ides/studio-tooling/studio-tooling-src/StudioClientDevReload.ts rebuilds the browser shell, but server modules stay loaded and it warns to restart. StudioDev.ts disables client reload in native mode. A real solution must coordinate client and server revisions while preserving or recovering the project session, compile coordinator, watcher, Metro preview runtime, device gateway endpoints, pairing identity, browser/simulator/phone connections, and any in-flight chat state. Docs/Roadmap/Tao Studio v2/Exploration - Studio server hot reload.md is a problem statement, not a chosen design.

## Verification and landing boundaries

- Read packages/AGENTS.md before package edits, ./agent help before the first agent command, and Git/verification skills before a merge or finalization. Use focused checks while editing, then normal required gates. Check visible behavior in browser and simulator; do not claim physical-device or signed native-release acceptance from those checks.
- Refresh roadmap/ledger wording changed by this work before final verification. Keep the distinction between decided conversation scope and the stale R7/R12/Slice 2 written roadmap until those records are deliberately reconciled.
- The Developer earlier said to merge main and land finished work if appropriate. The feature worktree starts at current local main; there is presently no feature implementation to land. Respect the repository's landing review and approval requirements once implementation and evidence are ready. Preserve the clean dev/ro checkout and unrelated worktrees.
