# DEVENV-047 — Release-bundle proof shares Metro's cache with every other worktree

- **Status:** Resolved
- **Area:** Full verification
- **Impact:** `_ship-bundle-proof` can fail a green branch's landing run when another worktree bundles
  at the same moment, because both Expo exports write the same Metro cache under the system temp dir.
- **Evidence:** 2026-09-04 `just merge-with-main --execute --yes --push` on
  `feat/dev-speed-optimization-cbf7e5`: `expo export --platform ios … --clear` exited 1 with
  `ENOTEMPTY, Directory not empty: /var/folders/…/T/metro-cache/6b` while two Tao lanes were running;
  every other verify-full gate passed. DEVENV-013 moves Expo's user cache into `.artifacts/cache/expo`
  but not Metro's transformer cache, which `--clear` deletes from under a concurrent bundler.
- **Workaround:** Re-run the landing once the other lane has finished.
- **Proposed change:** Implemented in the runtime-toolchain Metro configuration: stable development keeps
  Metro's default shared transformer cache, while every disposable copied host receives both a local
  file-map cache and a `metro-cache` `FileStore` under that host root.
- **Dependencies:** DEVENV-013 owns the Expo cache move; this is the Metro half.
- **Acceptance:** Met on 2026-09-19. The focused Metro configuration tests prove cache placement and an
  actual `FileStore` write, and two concurrent `just ship-bundle-proof` processes both completed their
  release and preview exports without clearing or corrupting the other's cache.
- **Source:** 2026-09-04 development-speed landing run.
