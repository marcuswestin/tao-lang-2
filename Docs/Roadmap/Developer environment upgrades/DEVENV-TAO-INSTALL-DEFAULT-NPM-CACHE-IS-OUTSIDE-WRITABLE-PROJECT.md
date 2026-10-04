# DEVENV-TAO-INSTALL-DEFAULT-NPM-CACHE-IS-OUTSIDE-WRITABLE-PROJECT — Tao install defaults to an npm cache outside the writable project

- **Status:** Candidate
- **Section:** External
- **Area:** Dependency installation
- **Impact:** An approved project dependency installation can fail before installing packages because
  npm writes its default cache outside the managed shell's writable roots. npm's root-owned-cache
  explanation does not distinguish that sandbox denial from an actual ownership problem.
- **Evidence:** On 2026-10-03, `./agent tao install 'Apps/Test Apps/Native Bridge'` failed with
  `npm error code EPERM`, `npm error syscall open`, and a path under `/Users/ro/.npm/_cacache/tmp/`.
  npm also could not write `/Users/ro/.npm/_logs`. The shell's writable roots excluded `.npm`;
  cache ownership was not inspected or changed. The installation's hidden project directory was
  writable. Enabling subprocess output exposed the failure previously hidden by the generic command
  error. No alternate cache path, permission change, or elevated retry was attempted.
- **Workaround:** Run the same official install command from a normal terminal. That retry has been
  requested; its result is pending.
- **Proposed change:** Decide the supported installation/cache policy, then configure it explicitly
  and report sandbox denials with an accurate normal-terminal recovery instruction. Preserve npm
  integrity checks and existing installations; do not infer a need to change ownership from EPERM.
- **Dependencies:** The project installation feature and the managed shell permission policy.
- **Acceptance:** An approved install either completes through the supported managed-shell path or
  prints a precise recovery command with the denied path, and the normal-terminal retry succeeds.
- **Source:** Project/module/package/generated-TypeScript implementation, 2026-10-03.
