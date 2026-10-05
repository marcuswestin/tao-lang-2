# DEVENV-SETUP-SUCCEEDS-WHEN-RULESYNC-REJECTS-HOOKS — Setup succeeds when rulesync rejects the hooks file

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent setup` generation of harness hook configuration from `.rulesync/hooks.jsonc`.
- **Impact:** A hooks source rulesync cannot load leaves every generated hook file unchanged while
  setup reports success, so an agent believes a new or changed hook is installed when no harness
  will run it.
- **Evidence:** On 2026-10-05, in a Linux cloud container, adding a `userPromptSubmit` event to
  `.rulesync/hooks.jsonc` made `./agent setup` print, twice,
  `Failed to load Rulesync hooks file (.rulesync/hooks.jsonc): Zod raw error: [{"code":"custom","path":["hooks"],"message":"unknown hook event name(s): userPromptSubmit"}]`
  and still exit 0. `.claude/settings.json` and `.codex/hooks.json` were left as they were. The
  canonical rulesync name is `beforeSubmitPrompt`.
- **Workaround:** After editing `.rulesync/hooks.jsonc`, read setup's log for `Failed to load` and
  confirm the event appears in `.claude/settings.json` and `.codex/hooks.json`.
- **Proposed change:** Make setup fail, naming the rulesync message, when rulesync reports that it
  could not load a source file.
- **Dependencies:** None.
- **Acceptance:** `./agent setup` exits non-zero and quotes the rulesync error when
  `.rulesync/hooks.jsonc` names an unknown event.
- **Source:** Cloud developer workflow verification, `feat/cloud-workflow-verify`, 2026-10-05.
