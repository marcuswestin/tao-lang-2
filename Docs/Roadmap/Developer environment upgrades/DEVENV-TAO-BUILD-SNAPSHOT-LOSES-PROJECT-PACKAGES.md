# DEVENV-TAO-BUILD-SNAPSHOT-LOSES-PROJECT-PACKAGES — Tao build snapshot loses project packages

- **Status:** Candidate
- **Section:** External
- **Area:** `tao build --web`, project snapshots, package resolution
- **Impact:** A valid WordFlower app cannot produce a retained web build through the Tao CLI, even though direct compilation and Expo web export succeed. Its failed build also leaves generated directories that break repository verification.
- **Evidence:** On 2026-09-22, `./tao build 'Apps/WordFlower/1 - Current/WordFlower.tao' --app WordFlowerInstantDB --web` recorded failure in `Apps/WordFlower/1 - Current/.tao/builds/2026-09-22T20-45-16-410Z-e7834f9a/build.json`: the snapshot compile could not resolve `@data`, `@nav`, and `@ui` or their declarations. `./tao compile` of the same app succeeded, and `expo export --platform web` from the compiled Expo host succeeded. A subsequent `./agent verify-changed` failed with `EISDIR` while walking the generated `.tao` directory; removing that directory was denied with `Operation not permitted` in the managed sandbox. A copy of the build receipt remains at `.artifacts/logs/wordflower-cloud-build-failure.json`.
- **Workaround:** Compile the app directly and export web from the generated Expo host, retaining the output under `.artifacts/build/`.
- **Proposed change:** Make the build snapshot preserve project package visibility when `Runtime.generateApp` compiles its copied entry; keep the snapshot isolated and immutable. Ensure failed snapshots are cleaned up, and exclude generated `.tao` paths from verification source walks.
- **Dependencies:** None.
- **Acceptance:** A focused build test with project-local `@data` and `@ui` packages succeeds from the snapshot; `tao build` produces a retained WordFlower web artifact; a failed build leaves no generated tree that breaks `./agent verify-changed`.
- **Source:** Hosted WordFlower InstantDB acceptance run, 2026-09-22.
