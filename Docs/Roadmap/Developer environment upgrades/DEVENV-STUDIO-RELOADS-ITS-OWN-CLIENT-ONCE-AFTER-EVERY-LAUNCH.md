# DEVENV-STUDIO-RELOADS-ITS-OWN-CLIENT-ONCE-AFTER-EVERY-LAUNCH — Studio reloads its own browser client once shortly after every launch

- **Status:** Candidate
- **Section:** External
- **Area:** Studio dev loop, `tao review`, `tao _preview qa`, Studio smoke lanes
- **Impact:** Any tool that drives the Studio page over the Chrome DevTools Protocol right after
  launch can fail with "Inspected target navigated or closed", because the page reloads itself a
  few seconds in. The failure reads as a flaky browser rather than a Studio behaviour.
- **Evidence:** Observed 2026-09-27 on the first UI screenshot archive capture (now `./agent unsandboxed storage qa`) of
  WordFlower. Launching Studio compiles its own Tao client, rewriting `Apps/Tao Studio/*.tao.ts`
  (for example `TaoStudioClient.tao.ts` and `@code-editor/CodeEditor.tao.ts`, whose mtimes matched
  the launch). The dev reload watcher
  (`packages/ides/studio-tooling/studio-tooling-src/StudioClientDevReload.ts`) watches `.ts` files
  under `Apps/Tao Studio`, rebuilds, and publishes revision 1 ("Reloading Studio client revision 1"
  in the Studio log); the page's revision poller (`StudioServer.ts` `studioClientHtml`) then calls
  `window.location.reload()`. Not checked: whether the rewrite happens when the compiled output is
  unchanged, and whether `tao review` has failed this way in practice.
- **Workaround:** `tao _preview qa` waits until `/studio-dev/revision` has been quiet for eight
  seconds before driving the page (`QaScreenshots.ts` `waitForStudioClient`).
- **Proposed change:** Have the watcher ignore Studio's own compiled `.tao.ts` output, or have the
  launch finish that compile before the watcher starts, so a launch never reloads its own client.
- **Dependencies:** None.
- **Acceptance:** A fresh Studio launch publishes no client revision until a watched source is
  edited, and `tao _preview qa` can drop its wait.
- **Source:** 2026-09-27 UI screenshot archive proof of concept.
