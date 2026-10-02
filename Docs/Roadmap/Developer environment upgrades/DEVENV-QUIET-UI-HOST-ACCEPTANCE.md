# DEVENV-QUIET-UI-HOST-ACCEPTANCE — Quiet UI host acceptance

- **Status:** In progress
- **Section:** External
- **Area:** Native Studio, iOS simulators, visibility permission, and host-operation availability.
- **Impact:** Source checks prove guards and configuration, but cannot prove the Developer's focus,
  native consent, or real concurrent device cleanup.
- **Evidence:** The 2026-10-01 pass adds scoped visibility permission, `--show-studio` preflight and
  launch guards, parent/retry flag propagation, and warnings preserved in text and JSON reports.
  Native canary and simulated-user probes hide their windows and remain available without a flag.
  Visible native acceptance was initially awaiting scoped authorization. The named process inspection
  operation refused to leave its sandbox; no raw host-tool fallback was used.
  On 2026-10-02 the standalone process operation and host capabilities succeeded; shell redirection
  of the same named operation still failed host dispatch. A live missing-flag check returned one
  JSON refusal before launch. The Developer's native Studio holds the primary checkout's identity,
  which existing native probes also use; preserve it rather than accepting a takeover prompt.
  The Developer's booted iPhone is likewise preserved. The harness rejected terminal input and
  Ctrl-C, and a task-owned prompt could not be signaled from the sandbox. The Developer subsequently
  chose named background `dev-loop` start/status/logs/stop/restart/reload controls with no default
  runtime timer, agent-managed retention, and isolated native test identity. Visible task-owned
  windows and brief Mac2 focus-taking are authorized for this acceptance scope, subject to native
  consent and pause/revocation. Later inventory found the old selector and primary native Studio
  absent; the Developer's Chrome, booted iPhone, and unrelated Metro processes remain preserved.
  Canonical adapters now include `dev-loop`, but the running task still denies that new prefix's
  host exception. Standalone existing named operations work. Redirection causes the named wrapper's
  `ps` host-capability probe to fail under the sandbox; capture tool results from standalone commands.
  An isolated hidden native runtime probe passed, followed by a real visible semantic host-control
  check on `com.devtao.studio.test-4351d865b9f4`; both reported owned process shutdown and lease release.
  Host-control warnings were preserved at startup and in the final report. These checks do not
  establish coexistence with a running development Studio or absence of focus interruption.
  The visible Mac2 attempt failed during WebDriverAgent session attachment with a 240000ms remote
  timeout. Its JSON report retained the warning, and native/Appium cleanup completed; subsequent
  complete process inventory found no children from those invocations. No consent was bypassed.
  The attempt exposed a shared WebDriverAgent project/build root and default port despite a private
  Appium home; those driver resources require explicit scoping. Shared Xcode cache remains preserved
  because exclusive ownership of its directory was not recorded.
  Driver inspection also found that startup sends `DELETE /` to an existing port listener without
  proving ownership. The source correction owns WebDriverAgent startup and verifies its listener before
  attachment through the documented
  [`webDriverAgentMacUrl` capability](https://appium.github.io/appium-mac2-driver/v4/reference/capabilities/).
  A machine lease alone cannot authorize deleting a non-cooperating listener. The pinned driver's
  shared version-cache metadata is separately recorded; no cross-run takeover was found from it.
  External attachment bypasses its shared project-cleanup/version-write step. Owned startup uses
  copied WDA source, invocation-local DerivedData and an explicit leased port under the physical-input
  lease. Unproved detached runners refuse readiness; unknown shutdown retains/quarantines ownership
  and artifacts. Independent native/fixture cleanup still runs after a WDA cleanup failure.
  A continuously bound invocation-owned forwarding server now guards every internal Appium status,
  session, action and deletion request with fresh lease/listener identity checks. It refuses backend
  redirects, disables forwarding before teardown, and remains inert until Appium shutdown is proved.
  Focused regressions and guard-removal mutation checks establish these source boundaries; real
  Mac2 interaction still requires host acceptance of the corrected topology.
  Final integrated typecheck and both ownership/cleanup reviews passed. The corrected Mac2 host
  retry built its invocation-local WDA successfully, then refused the detached listener because its
  ownership was not captured (16 seconds, invocation `6d2dce4a-17e4-440e-88c3-be3b4a59af0e`). It did
  not contact or adopt that listener. Studio/Appium shutdown completed, the WDA receipt reached
  `closed`, and complete subsequent host inventory found no Appium/WDA/invocation-owned processes.
  The Developer's original Chrome and unrelated Metro identities remain unchanged. This proves
  safe refusal and cleanup for that attempt, not Mac2 interaction or native consent/focus behavior.
  Exact-file formatting is now available as `./agent fmt <files…>` so shared-checkout checks do not
  need to format concurrent app edits; paths with spaces were exercised through the front door.
- **Workaround:** Run quiet checks and record visible or unavailable host checks separately. Obtain
  scoped permission through `quiet-ui-workflows` before visible checks; preserve native consent.
- **Proposed change:** Complete acceptance with existing drivers, scoped visibility options, managed
  app-loop lifecycle controls, and a separate native test identity and mutable state. Keep the
  unified persistent UI interaction controller deferred; introduce no generic visibility flag.
  [Remaining acceptance handoff](<../Managed development loops - Acceptance handoff.md>) records
  the source, host-permission, driver-ownership and human-observation dependencies for the next plan.
- **Dependencies:** Host tools and scoped visibility permission; native Accessibility/Automation
  consent where requested by the existing driver.
- **Acceptance:** Hidden native probing and visible semantic host-control interaction with owned
  child cleanup are proved. Still open: real iOS simulator reuse, parallel isolation, viewer-free
  execution, teardown and inactive viewer focus; Mac2 interaction, coexistence with development
  Studio, focus observation, human manual checks and native permission-prompt behavior; and the
  managed loop's safe automated stop path on the host. Standalone process inspection is proved, redirected-command
  denial is diagnosed, and the historical task selector is absent. Browser and Android checks remain in their
  dedicated entries. Persistent UI session control is explicitly deferred until after MVP.
- **Source:** Developer-directed quiet development and testing workflow plan, 2026-10-01.
