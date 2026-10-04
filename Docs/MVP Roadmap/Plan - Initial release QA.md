# Plan — initial release QA and new-user experience

## Aim and boundary

Judge the **integrated, public release candidate** as a new developer would encounter it: discover Tao, install it, make and change an app, run it, get unstuck, and give feedback. This is a journey review, not another inventory of unit tests or a plan to finish currently open branches. Assume their intended work has landed before this process starts. Test the actual published artifacts and public destinations, not just source checkout commands or local preview builds.

The first public CLI target is **macOS on Apple Silicon**. The public story also includes a downloadable native Studio, the VS Code and Open VSX extension, and an invitation-beta Companion. The CLI install script is the initial distribution channel; Homebrew, npm, Linux, Windows, Intel Mac, `tao review` in the standalone binary, and Tao-hosted app updates are outside this release's claims. The Companion beta and `tao ship` have account and device boundaries that require separate distribution evidence. These are the [Developer MVP Roadmap](<Developer MVP Roadmap.md>) decisions, especially R3, R4, R7, and R11–R13.

“Website” means the public `devtao.com` entry point **if one is published**, plus whatever public page actually receives a first-time visitor (possibly GitHub). A website is not assumed to exist in this checkout. QA should check the released route rather than prescribe a new site. Likewise, “demo” means the public examples the release actually points to, not every experimental app in `Apps/`.

## How to run the review

1. **Freeze the candidate.** Record the source commit, CLI version and download digest, Studio DMG/version, extension package/version and both marketplace listing URLs, Companion build and invitation, documentation revision, website URL, host asset versions, and example app revisions. Reviewers must use the same candidate. If an artifact or destination is unpublished, mark its story **blocked**, never passed by a local substitute. Use a fresh macOS user or machine where possible, with no Tao checkout, cached host, or preinstalled Bun/Node/Nix. Keep a second machine or profile for upgrade and existing-project flows. Apple recommends testing the distributed, notarized product on a different Mac so development state cannot mask first-run failures ([Apple distribution guidance](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)).
2. **Run realistic tasks without coaching.** Give each reviewer a goal (“make a reading list I can edit on my phone”), not a click script. The listed flows are coverage prompts and evidence requirements, not lines to read to a participant. Start with the exact entry point a visitor would find. Ask a small number of outside developers to think aloud while an observer records wrong turns, time to first successful app, prompts they mistrust, and where they seek help. Use separate short rounds after fixes rather than treating one large panel as a statistical score; this follows [Nielsen Norman Group's small, iterative usability studies](https://www.nngroup.com/articles/how-many-test-users/).
3. **Capture one record per story.** Record story ID, candidate/build, OS/device, reviewer, start route, outcome (**pass / friction / fail / blocked / not run**), time and assistance needed, screenshots or terminal log, exact first confusing point, and issue link. “Pass” means the user reached the goal unaided and the result persisted or appeared at the promised destination. “Friction” means success required a detour, unexplained prompt, or help. A script passing is only agent evidence for the story, not a proxy for a human's understanding. Keep credentials and personal data out of captures.
4. **Triage by journey impact.** P1 is a release gate: a published claim, first success, safety, or distribution path fails. P2 is a common next action or recovery path and should pass before broad invitation; a narrow, clearly disclosed limitation may be consciously accepted. P3 is important but lower frequency. P4 is polish or an edge flow. P5 is optional polish if bandwidth remains. These ranks set **QA order**, not a development backlog. If a P1 fails, fix it and repeat the journey from its original public entry point on the replacement artifact. Also retest the few adjacent stories that share the changed seam.
5. **Make a release decision from evidence.** Require no unresolved P1 failures or blocked public claims, a working feedback route, and an honest limitations story. Summarize P2–P5 friction with owners and accepted scope; do not turn “not run” into “pass.” Record what was proved from a clean install, from a browser or simulator, from a physical device, and from a real distribution channel separately. The Developer makes the final quality and release judgment after seeing the story record and a short uncoached session.

### Live native authentication acceptance

Run the Clerk/InstantDB iOS journey after changing native auth, gateway exchange, or session restoration,
and again against the pre-MVP candidate. This is explicit host acceptance, outside `verify`,
`verify-changed`, and the credential-free `verify-full` membership: it needs an installed iOS runtime,
Xcode, materialized development Clerk keys, network access, and the local InstantDB stack. Missing
prerequisites fail the requested run rather than silently reporting a pass. Deterministic auth and
sensitive-log regression tests stay in ordinary verification.

From the repository root:

```sh
./agent unsandboxed local-instantdb start
TAO_CLERK_LIVE=1 TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-ios-auth.test.ts
```

For an iteration using a Companion simulator binary already built from the intended native sources,
set `TAO_CLERK_IOS_APP_PATH` to its `.app` directory. The receipt labels this as supplied-binary evidence
and records its path and executable hash; omit it for fresh-build acceptance.

The journey owns a fresh simulator, synthetic Clerk user, and ephemeral Instant app. Builds and
relaunches use background commands. The native driver preserves an already-running Simulator or
Device Hub, or runs headless if neither is running; avoid opening or quitting that host during
driver startup because Appium chooses its presentation mode from that state. It compares
Studio pairing codes, selects the authored iPhone scenario, signs in through native controls, saves
profile and notes, checks their ownership directly in Instant, relaunches the process, and checks
sign-out isolation and email-code authentication. Stage receipts and cleanup ownership records live
under `.artifacts/tests/studio-smoke/`; request logs, credentials, and screenshots are excluded.
A green simulator journey is automated evidence only. Physical-device LAN behavior, real registration,
and the distributed TestFlight build retain their separate acceptance boundaries.

The separate phone-review regression runs the actual `clerk-review --no-browser` command with stored
development credentials, its LAN gateway, and the unchanged authored **Fill email / Fill password**
values. It does not provision a replacement account, change the password, or write profile/note data.
It checks password sign-in and signs out only its simulator session. A provider-required verification
challenge fails this unattended journey rather than being bypassed. It remains an explicit live lane:

```sh
TAO_CLERK_LIVE=1 ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-ios-review.test.ts
```

This covers the manual review setup that the disposable-account journey intentionally replaces.
It still does not prove physical-device network permissions or the installed phone binary.

### Tags

- **A** — an agent can run the whole story and judge the observable result from the released surface.
- **P** — an agent can do setup, repeatable checks, and evidence capture; a human must judge experience or operate a permission, account, or physical-device step.
- **D** — the Developer should personally run or decide this story, in addition to any agent review.

Tags are additive. Every story has **A** or **P** for agent coverage; **D** is also assigned wherever the Developer's own review is worthwhile. A story tagged **A, D** gets two independent passes. A story tagged **P, D** gets agent preparation and the Developer's firsthand judgment. Other **P** stories can use another human reviewer.

P1–P5 are assigned to every story. If a flow is outside the final public claim, record that claim and mark the row **out of scope** before execution; do not quietly skip it.

## Story inventory

### Public arrival and website

| ID   | New-user story and representative flows                                                                                                                                                                                                                              | Tags | Priority |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| WEB1 | **Understand Tao in two minutes.** Arrive at `devtao.com` or the public repository from search/share → find a plain promise, one real app example, supported host/platforms, 0.x status, and a clear first action → explain what Tao does and does not do today.     | P, D |    1     |
| WEB2 | **Reach a trustworthy download.** Follow “Install,” “Studio,” and “editor extension” links from the front door → land on the intended official release/listing → see version, architecture, publisher, and install path without dead links or surprising redirects.  |  A   |    1     |
| WEB3 | **Decide whether Tao fits.** Find requirements, current limitations, licence implications for an app built with Tao, pricing or account expectations, and the supported platforms before downloading; check that site, README, and release notes say the same thing. |  P   |    2     |
| WEB4 | **Get help from any public page.** From a failed install or confusing feature, find documentation and GitHub Issues/Discussions in at most a short navigation path; broken links and private or inaccessible destinations fail.                                      |  A   |    2     |
| WEB5 | **Share Tao with a colleague.** Paste the public front-door link into a chat or issue → confirm the page title, preview, and destination make sense without the sender's explanation.                                                                                |  A   |    5     |

### Standalone CLI and first app

| ID    | New-user story and representative flows                                                                                                                                                                                                                                                                 | Tags | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| CLI1  | **Install Tao on a clean supported Mac.** Start from the public instructions → inspect the install command and source → run it without Bun, Node, Nix, or a checkout → verify `tao --help`/version and the first macOS security prompt; repeat from a browser download/quarantined artifact if offered. | P, D |    1     |
| CLI2  | **Create a useful starter.** Run `tao create` with a simple app idea → understand any AI-lane or download choice → get a named, runnable project with an obvious next command; try both the one-feature and two-feature starter shapes.                                                                 | A, D |    1     |
| CLI3  | **See an edit on screen quickly.** From the created project run `tao run` for web → open the generated app → change text or a small layout → see a useful reload without having to know Expo or repository internals.                                                                                   | P, D |    1     |
| CLI4  | **Run on a supported simulator or emulator.** Use the documented `tao run --ios` or `--android` route → understand first-use host/toolchain downloads and consent → get the same app on the selected target; retry with a compatible host already installed.                                            |  P   |    2     |
| CLI5  | **Diagnose and fix a beginner mistake.** Introduce a syntax error and an unknown reference → run `tao check` → understand file, position, cause, and next action → use `tao fix`/`fmt` and recheck; inspect exit codes and whether fixes preserve intent.                                               |  A   |    2     |
| CLI6  | **Prove behavior.** Run the starter's `.test.tao` journey with `tao test` from an installed CLI → see a readable pass → introduce one failing expectation → locate the failing action/assertion → restore it; include first managed-Node download.                                                      |  A   |    2     |
| CLI7  | **Resume an existing project.** Close and reopen a project, run it again, and retain intended local data and version pin; move the project outside the original create directory and verify the commands still find its entry.                                                                          |  A   |    2     |
| CLI8  | **Understand versions and upgrades.** Check for updates → open an older pinned project with a missing Tao version → see the exact download request and size → accept or decline → confirm the project stays on its pin and release notes name relevant breaking changes.                                |  P   |    3     |
| CLI9  | **Recover from a failed dependency or network step.** Deny/cancel an initial download or go offline during host setup → see a specific remedy and no false success → retry online without corrupting the project or cache; confirm no unexplained `sudo` request.                                       |  A   |    2     |
| CLI10 | **Use Tao with a coding agent.** Open a generated starter in a supported agent harness → ask for a small Tao change using the copied project guidance → inspect/edit the result → run `tao check` and the project test; judge whether the guidance directs the agent toward implemented syntax.         |  P   |    4     |

### Tao Studio on macOS

| ID   | New-user story and representative flows                                                                                                                                                                                                                     | Tags | Priority |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| STU1 | **Install and first-launch the native Studio.** Download the public DMG → pass ordinary Gatekeeper prompts without disabling security → open Welcome, choose an existing project, and see a live app; quit and reopen it.                                   | P, D |    1     |
| STU2 | **Find the everyday workbench.** In a starter, locate files, editor, preview, scenarios, data, logs, and tests without an explanation; make a tiny source edit, Save, see compile status and preview update, then undo and recover from a deliberate error. | P, D |    1     |
| STU3 | **Review the app at useful sizes and states.** Switch phone/desktop preview cells and scenarios → inspect loading, empty, populated, and error states → confirm labels and scenario identity make it clear which state is shown.                            |  P   |    2     |
| STU4 | **Edit through a visual control.** Select a rendered element → inspect its source and style → perform one supported text, layout, or binding action → Save → see source and preview agree; undo/reopen and check no accidental edit to another view.        |  P   |    2     |
| STU5 | **Work with project files safely.** Search and navigate definitions, open two files, rename or create a relevant file, and trigger an external edit while Studio has unsaved work; judge conflict wording and preservation of both versions.                |  P   |    3     |
| STU6 | **Run a Tao journey in Studio.** Find a project test, run it, identify pass/failure and relevant source, then return to the affected preview or file; check that a nontechnical failure can be reported with enough context.                                |  P   |    2     |
| STU7 | **Understand data while iterating.** Create and edit a row in the preview, inspect the Data panel, switch scenario/variant, restart Studio, and verify intended data and isolation; inspect an obvious bad value or provider failure.                       |  P   |    3     |
| STU8 | **Manage native windows and updates.** Open a second project/window, close one, use keyboard/menu actions, quit/relaunch, and check update notification/application on a published release without losing project state.                                    |  P   |    3     |
| STU9 | **Recover from a broken preview or service.** Cause a compile or runtime error and a disconnected preview → find useful status/logs and retry/restart paths → verify source edits are preserved and the app returns when the dependency does.               |  P   |    2     |

### Tao Companion and device experience

| ID   | New-user story and representative flows                                                                                                                                                                                                                                                                                                                                                                                                                  | Tags | Priority |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| COM1 | **Install the invitation beta.** Receive a genuine invitation → install the distributed Companion on a supported physical iPhone → understand its purpose, local-network prompt, and what requires a Mac/Studio session. TestFlight approval, invite delivery, and install are separate evidence from a development build ([Apple TestFlight guidance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers)). |  P   |    1     |
| COM2 | **Pair and render a real app.** Open a Studio project → discover/open the device link → compare and confirm the pairing code → see the same selected scenario on the physical phone; disconnect/relaunch and reconnect without another confusing setup.                                                                                                                                                                                                  | P, D |    1     |
| COM3 | **Trust and revoke safely.** Pair a device, inspect its identity/revision in Studio, revoke trust, and try reconnecting → verify re-pairing is required and the UI explains what happened.                                                                                                                                                                                                                                                               |  P   |    2     |
| COM4 | **Iterate on a phone.** Save a small Tao edit in Studio → see compile/apply acknowledgement and the changed app on device → switch scenario from the Companion → distinguish a compatible refresh from a state reset.                                                                                                                                                                                                                                    |  P   |    2     |
| COM5 | **Recover from real network conditions.** Deny local-network access, switch Wi-Fi/VPN, background and foreground the phone, or take the Mac offline → see a named problem and a workable reconnect path, with no stale “synced” status.                                                                                                                                                                                                                  |  P   |    2     |
| COM6 | **Inspect and report from the device.** Open logs/inspection or capture a device state supported by this release → return to Studio and identify the same app/scenario/revision; avoid promising the later recorder, relay, sketch, or collaborator features as first-release functionality.                                                                                                                                                             |  P   |    4     |

### IDE extension

| ID   | New-user story and representative flows                                                                                                                                                                                                                              | Tags | Priority |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| IDE1 | **Install from either editor marketplace.** On a clean editor profile, find the expected publisher/listing in VS Code Marketplace and Open VSX → install the published version → open a `.tao` file without a repository checkout or separate language-server setup. |  P   |    1     |
| IDE2 | **Get useful language feedback.** Type an invalid declaration/reference → see positioned diagnostics and a sensible suggestion → fix it, format, and confirm syntax highlighting remains readable.                                                                   |  P   |    2     |
| IDE3 | **Navigate a real project.** From a starter's use/reference, go to definition, find references, and apply one source action → verify imports and files remain valid after the edit; try a multi-root workspace only if the listing claims it.                        |  P   |    3     |
| IDE4 | **Understand extension/CLI relationship.** Read listing and README → identify which tasks need the standalone CLI, how versions relate, and where to get help; opening a project with a different pinned Tao version should not silently mislead.                    |  A   |    3     |

### Documentation, tutorial, and example apps

| ID   | New-user story and representative flows                                                                                                                                                                                                                                                                      | Tags | Priority |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--: | :------: |
| DOC1 | **Follow the first tutorial without insider knowledge.** Start from the public front door → complete [Your First Tao App](<../Tutorials/Your First Tao App.md>) in a clean project → run its final behavior test and view it; record every point where a sentence, screenshot, or command requires guessing. | P, D |    1     |
| DOC2 | **Find the next lesson.** After the tutorial, locate the language tour/spec, a relevant data/navigation/design topic, and an example using it; verify links, terminology, and code against the shipped version.                                                                                              |  P   |    3     |
| DOC3 | **Run a promoted example.** Open each app explicitly promoted to newcomers (starters, HNReader, WordFlower Current if advertised) using public instructions → exercise its main interaction and one data or navigation flow; verify “design only” material is labeled distinctly.                            |  P   |    2     |
| DOC4 | **Learn the limits honestly.** Compare the README, release notes, docs, website, Studio welcome, and editor listing on 0.x stability, supported platforms, physical-device beta, hosted data, and shipping; follow one “not yet supported” route to the relevant explanation.                                | A, D |    1     |
| DOC5 | **Get help after a tutorial failure.** Deliberately use an older syntax or miss a setup step → search docs and diagnostics for the remedy → see a clear route to a feedback report when the answer is absent.                                                                                                |  P   |    3     |

### Building, distributing, and experiencing a Tao app

| ID   | New-user story and representative flows                                                                                                                                                                                                                                                                    | Tags | Priority |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| APP1 | **Use the generated app as an end user.** In a promoted starter or WordFlower, create/edit/delete ordinary content, navigate away and back, restart the app, and verify visible state and persistence. Check empty/loading/error states and clear action labels.                                           |  P   |    2     |
| APP2 | **Experience one app across target sizes.** Run the same promoted app on web, simulator/emulator, and the available physical-device beta → check navigation, scrolling, keyboard/input, layout reflow, and state continuity where promised. Keep platform-specific differences explicit.                   |  P   |    2     |
| APP3 | **Use and understand the public data demo.** Start the advertised WordFlower hosted variant from a clean public path → create data on one client → see it on a second client or device → recover from a dropped connection without a silent loss or unexpected exposure of other users' data.              |  P   |    2     |
| APP4 | **Prepare a beta build.** From a suitable app run the documented `tao ship --beta` flow → inspect identity, signing, build, and upload prompts → see a real TestFlight build and invitation accepted by a tester. A dry run, local development build, or successful upload alone does not pass this story. |  P   |    2     |
| APP5 | **Use the distributed beta.** An invited tester installs the Tao-built app, completes its primary action, relaunches, and sends feedback; the author can match that feedback to app/build/version.                                                                                                         |  P   |    3     |

### Feedback and contributing to the repository

| ID    | New-user story and representative flows                                                                                                                                                                                                                                                 | Tags | Priority |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--: | :------: |
| COMT1 | **Report a confusing or broken experience.** From the README/site/app failure, choose Issue or Discussion → submit the intended template without needing a Tao checkout → attach a safe version/environment description and reproduction → receive a usable link to the report.         |  P   |    1     |
| COMT2 | **Decide whether contributing is welcome and safe.** Find the public repository's contribution guide, licence, conduct/support route, project scope, and a small first contribution path; judge whether a newcomer knows which instructions apply without reading the internal roadmap. |  P   |    2     |
| COMT3 | **Make a first source or docs contribution.** Fresh clone → follow the contribution setup → change one typo or small example → run the stated focused check → open a draft PR; record hidden toolchain, permission, or repository-specific knowledge.                                   |  P   |    3     |
| COMT4 | **Report a real bug reproducibly.** Cause a small CLI or Studio failure → capture relevant version, environment, minimal source, and log without secrets or home paths → use the public issue form; have another reviewer attempt reproduction from the report alone.                   |  P   |    3     |
| COMT5 | **Read the public project as its creator.** Review the front door, release notes, licence explanation, contribution welcome, and first GitHub Issue/Discussion view in one sitting; decide whether the claims and tone match the product and the community you intend to invite.        | P, D |    1     |

## Parallel review clusters

Run clusters against the same frozen candidate; each worker owns separate temporary projects and profiles. Share results by story ID, not by broad “looks good” summaries. A cluster can be given to one agent or a human-plus-agent pair. Avoid concurrent changes to the same project data, release account, device pairing, or public listing.

| Cluster                        | Stories and output                                                    | Best reviewer                                       | Dependency / collision                                                                   |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Public front door           | WEB1–5, DOC4, IDE4; link/claim map and first-impression notes         | Agent + one outside developer                       | Public site/README and release links must be frozen.                                     |
| 2. Clean CLI first hour        | CLI1–6, DOC1; timed install-to-first-app recording                    | Agent + uncoached Mac user; Developer runs D rows   | Separate clean macOS user or machine; no shared Tao cache.                               |
| 3. Existing-project resilience | CLI7–10, DOC2/5; recovery and version-pin record                      | Agent, human for agent-harness and doc friction     | Separate project and controlled network interruption.                                    |
| 4. Native Studio workbench     | STU1–9; recorded native window, editing, visual, and failure journeys | Agent + human macOS reviewer; Developer runs D rows | One native app/profile per worker; do not equate browser preview with native acceptance. |
| 5. Editor distribution         | IDE1–3; both marketplace installs and project edit                    | Agent + editor user                                 | Isolated VS Code/Open VSX profiles; published listings.                                  |
| 6. Device and app reality      | COM1–6, APP1–3; physical-device evidence and app UX                   | Agent + human with iPhone; Developer runs D rows    | One paired device and Studio session at a time; TestFlight build available.              |
| 7. Ship and tester loop        | APP4–5; TestFlight artifact, invite, tester feedback                  | Agent + account holder + outside tester             | Serial account/build actions; do after a good first-app path.                            |
| 8. Public community            | COMT1–4, DOC3; contribution and feedback friction                     | Agent + first-time contributor                      | Use test issues/draft PRs with clear cleanup; avoid duplicate public reports.            |

The **creator pass** is deliberately selective: the D-tagged WEB1, CLI1–3, STU1–2, COM2, DOC1, DOC4, and COMT5 stories. The Developer should experience these as one newcomer journey, preferably on the distributed artifacts and with no coaching. An outside developer still matters: the creator knows where everything is, so cannot replace the uncoached sessions. If time is tight, do the P1 rows and one outside first-hour session before P3–P5. Use P2 as the second wave; only expand P4–P5 after seeing what that evidence reveals.

## Cross-cutting probes and release evidence

Apply these to the **same journeys**, rather than creating a separate exhaustive feature matrix:

- **Accessibility and input:** keyboard-only website/Studio/editor navigation, visible focus and error text, VoiceOver on the first app/device flow, larger text, contrast, and reduced motion at representative screens. Automated scanners can help, but [W3C says they cannot determine accessibility alone](https://www.w3.org/WAI/test-evaluate/tools/selecting/); Apple recommends completing main app tasks with accessibility settings enabled ([Apple accessibility testing](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app)). Record the scope tested, not an unearned conformance claim.
- **Trust and privacy:** verify publisher and download origin, checksum, signed/notarized Mac launch, and the artifact's relationship to the frozen source/version. Check logs, screenshots, issue templates, Companion pairing, demo data isolation, and public repository history for accidental secret or personal-data exposure. GitHub's own secret scanning guidance explicitly covers **history**, not just the current tree ([GitHub](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)); build provenance is useful for tracing an artifact to its inputs ([SLSA](https://slsa.dev/spec/v1.2/provenance)). This is an evidence review, not a claim of any SLSA level.
- **Recovery and honesty:** at one key step per cluster, cancel, go offline, deny permission, or use an unsupported platform/version. The product should name the obstacle and a next action, preserve user work, and never imply success. Inspect all public claims against the agreed first-release scope.
- **Performance as experienced:** record elapsed time to install, first visible app, first successful edit, first native Studio preview, first device connection, and first test. Use the timings to find surprises and long unexplained waits; do not set speculative global speed targets before measurement.
- **Channel proof:** keep distinct records for source test, installed artifact, public download, browser preview, simulator, physical device, TestFlight, and marketplace listing. None substitutes for another. Apple notes that a notarization ticket informs Gatekeeper on first launch ([Apple notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)); a signed build tested only from the development directory does not prove this experience.

## Final review packet

The QA lead collects a one-page result: candidate identity; P1 story outcomes; P2 failures or accepted limitations; outside-user observations; creator-pass notes; evidence links for the public download, marketplaces, native Studio, physical Companion, and TestFlight; accessibility scope; and every blocked/not-run story. The Developer then makes the release call. Keep discovered implementation work in ordinary issues; this plan records the experience to verify, not a new milestone list.
