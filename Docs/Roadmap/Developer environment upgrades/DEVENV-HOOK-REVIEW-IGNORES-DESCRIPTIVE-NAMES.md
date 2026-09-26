# DEVENV-HOOK-REVIEW-IGNORES-DESCRIPTIVE-NAMES — Hook review ignores descriptive names

- **Status:** Blocked
- **Section:** External
- **Area:** Hook approval
- **Impact:** The desktop harness labels approval rows "Hook 1", "Hook 2", and so on, preventing
  users from identifying the behavior they are approving from the collapsed row.
- **Evidence:** On 2026-09-26, the installed desktop application's
  `webview/assets/hooks-settings-BZUWWtv0.js` renders each row through an index-only formatter:
  `formatMessage($.fallbackHookTitle, {index: e + 1})`. The row does not consult hook metadata.
  The installed configuration translator supports per-handler `name` and `description` fields;
  `feat/descriptive-hook-names` supplies both for every canonical hook and regenerates the adapters.
  This improves configuration readability but cannot fix the installed application's row titles.
- **Workaround:** Read the generated hook configuration's names, descriptions, and commands before
  approving. Do not assume the numbered rows have acquired descriptive titles after regeneration.
- **Proposed change:** The desktop harness must render each handler's name in approval and settings
  rows, with its description available during review. This requires an upstream application change.
- **Dependencies:** The desktop harness's hook inventory and approval UI.
- **Acceptance:** The review dialog displays the configured names for all seven project hooks,
  including distinct names for the three delegation logging events.
- **Source:** Developer screenshot and read-only inspection of the installed application, 2026-09-26.
