# DEVENV-102 — No gate parses `.tao-revolution` spec sources

- **Status:** Candidate
- **Section:** External
- **Area:** Verification coverage
- **Impact:** `.tao-revolution` (and `.tao-mvp`, `.tao-next`) files are deliberately invisible to Tao
  discovery, so nothing parses them. The dead-export scanner is the one gate that reads them at all,
  and only for the single line that binds a TypeScript module. A malformed spec source — unbalanced
  braces, a retired keyword, a reference to a declaration that no longer exists — can therefore sit
  in the repository indefinitely and only surfaces when a tranche graduates the file, which is
  exactly the moment `Apps/Tao Future/README.md` says a graduation must need nothing but a rename.
- **Evidence:** During the 2026-09-17 Tao Future consolidation,
  `Apps/Tao Future/Hearth/Lists.tao-revolution` was found to have one closing brace too many in the
  `ShoppingContent` view — present in the file as committed, and invisible to `verify --complete`,
  `dprint`, and every test suite. A ten-line brace-depth script over the 40 spec sources found it in
  under a second. The same pass then found, by hand rather than by any gate, three orphaned
  translation keys and a sidecar left on a retired boundary.
- **Workaround:** Run an ad-hoc brace-depth pass (strip string literals before line comments, so a
  URL's `//` is not read as a comment) over the tier and Tao Future sources after editing them.
- **Proposed change:** Add a lint-lane check that parses every non-discovered Tao dialect source with
  the ordinary parser and reports syntax errors only — no validation, no type checking, since these
  files intentionally use constructs the validator has not implemented yet. A parse-only pass is
  enough to catch the whole class and keeps the "graduation is a rename" promise honest. Which
  extensions to include is the existing mapping in `Apps/WordFlower/README.md`.
- **Dependencies:** None; the parser already accepts a file path independently of discovery.
- **Acceptance:** A deliberately unbalanced `.tao-revolution` file fails the lint lane with its file
  and line, and the 40 current Tao Future sources plus the WordFlower tiers pass.
- **Source:** 2026-09-17 Tao Future dialect consolidation (Process step 3).
