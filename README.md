# Tao

Today, building an app is 20% value and 80% boilerplate, platform-specific detail, and unnecessary complexity.

Tao is a new programming language, and it takes care of that 80% for you. Every time.

It was first prototyped fifteen years ago. This year, it was finally built.

Tao is a development preview. The staged public releases are planned, not yet published.

## What a Tao app looks like

One file declares the app, its navigation, and its screens:

```tao
use StackNav from @tao/nav
use Col, Text from @tao/ui

app ReadingList {
   id "reading-list"
   version "0.1.0"
   name "Reading List"
   Navigator LibraryStack
}

nav LibraryStack = StackNav {
   Initial BookList
}

scene BookList() {
   Title "Reading List"
   render Col() {
      Text("Reading List")
}  }
```

Data, editing, design, a layout that adapts from phone to desktop, and behavior tests that drive the
whole app are declared the same way. [Your First Tao App](<Docs/Tutorials/Your First Tao App.md>)
builds a complete reading-list app in nine steps, about thirty minutes.

Tao compiles to TypeScript for Expo and React Native. The first public release targets web app
execution on a supported Apple Silicon Mac. iOS Simulator is planned for release 2; Android and
desktop app builds are deferred beyond the five planned releases.

## Install

The signed, notarized standalone CLI for macOS on Apple Silicon and the editor extension's
marketplace listings are not published yet, so there is no public install command.

## Developing Tao

Clone on an Apple Silicon Mac with [Nix](https://nixos.org) and [devenv](https://devenv.sh), then
run from the checkout root:

```sh
./enter-tao-dev-env   # pinned toolchain, dependency setup, then a shell; `exit` leaves
just doctor           # diagnose the checkout; each FAIL line names its fix
```

Setup offers direnv so later terminals load the environment automatically (zsh; it writes
`~/.tao-dev` and one line in your zsh startup file). `./enter-tao-dev-env --setup-only` reruns setup
without a shell, and `./dev shell-setup --configure` changes the direnv choice.
[CONTRIBUTING.md](CONTRIBUTING.md) walks a fresh macOS or Linux machine from installing Nix to a
running dev loop; on Linux, `./.config/bootstrap-tao-dev-env` takes the place of `./enter-tao-dev-env`.

Three entry points cover everything: `./tao` is the Tao CLI (an installed release will be plain
`tao`), `just` is the task menu (`just help`), and `./dev` runs repository workflows
(`./dev help`). Coding agents use an entry point of their own.

**Build and run apps**

| Command                                                    | Does                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `./tao create "A reading list" --provider local --ai none` | Create a project with a starter app and its tests             |
| `./tao run Apps/Starters/Notebook --app Notebook --web`    | Run an app in the browser; `--ios` opens the iOS Simulator    |
| `./tao check Apps/HNReader`                                | Report errors; always pass a path, or it scans the repository |
| `./tao fix Apps/HNReader`                                  | Format and apply source fixes                                 |
| `./tao test Apps/HNReader --name "reading history"`        | Run Tao behavior tests; `--watch` reruns on save              |
| `just dev`                                                 | Pick any app in the repository and run it                     |
| `just studio Apps/HNReader`                                | Open Tao Studio on a project                                  |
| `just install-ide-extension`                               | Install the editor extension locally                          |

Example apps: `Apps/Starters/Notebook`, `Apps/Starters/Pantry`, `Apps/HNReader` (`--app HNReaderStub`
for offline data), and `"Apps/WordFlower/1 - Current"` (`--app WordFlower`).
[Your First Tao App](<Docs/Tutorials/Your First Tao App.md>) builds a single-file reading list by hand.

**Test and verify**, cheapest first. Local lanes are iteration evidence; hosted `Verify` plus the
local host-only gates are the merge proof, and landing runs both.

| Command                                                           | Does                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `just test-file packages/cli/tao-cli/cli-tests/tutorials.test.ts` | One test file or directory                           |
| `just test`                                                       | The suites your changes affect                       |
| `just fix` / `just check`                                         | Apply all formatters and fixes / lint, types, source |
| `just verify-changed`                                             | The per-commit gate                                  |
| `just verify`                                                     | Everything except browser and native lanes           |
| `just verify-full`                                                | Adds browser, native, and bundle lanes               |
| `just verify-repo`                                                | Nothing cached, plus checks that need a person       |

**Branches and landing**

| Command                                 | Does                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `just my-branch`                        | Switch to your own `dev/<name>` branch, created from `main` once     |
| `just my-status` / `just my-sync`       | Show branch, changes, and next step / merge current `main` in        |
| `just my-land`                          | Squash-merge your `dev/<name>` branch into `main` locally            |
| `./dev start-branch feat/<name>`        | Start a feature branch from `origin/main`; `take-branch` adopts one  |
| `./dev merge-main`                      | Merge current `main` into a feature branch                           |
| `just finalize`                         | Merge `main`, verify, and draft the merge message to review          |
| `just open-pr --auto-merge`             | Push, open the PR, run the host-only gates; GitHub merges when green |
| `just pr-checks --wait` / `just landed` | Follow the PR's checks / confirm the branch landed                   |
| `just land-fix`                         | Land a fix committed after GitHub already merged the branch          |
| `just board`                            | Every worktree, running lane, and the landing lock                   |

**Clean up**

| Command                                     | Does                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `./dev resources`                           | List retained sessions, caches, and output; deletes nothing            |
| `just reclaim`                              | Classify worktrees; `./dev reclaim --execute` removes reclaimable ones |
| `just clean` / `just clean-all`             | Remove dependencies and build output / every artifact too              |
| `./dev studio-stop` / `./dev dev-loop stop` | Stop a leftover Studio or background app loop                          |
| `./dev watchman stop` then `start`          | Only when `just doctor` reports a stale Watchman launch agent          |

**Installed-CLI acceptance**

| Command                                          | Does                                                            |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `just standalone-cli-acceptance`                 | Install a built release into a throwaway HOME and exercise it   |
| `just standalone-cli-vm-setup`                   | Install Tart, once                                              |
| `just vm-images`                                 | Download the pinned VM images and build the macOS base, once    |
| `just standalone-cli-clean-machine`              | The same acceptance in a disposable vanilla macOS VM            |
| `just standalone-cli-clean-machine --base xcode` | The same in the Xcode image; download it with `vm-images xcode` |

## Release scope

Release 1 covers `create`, `run --web`, `check`, `fix`, and `test`. The iOS Simulator arrives in
release 2, native Studio in release 3, and `tao ship --beta` to TestFlight in release 5. Android,
desktop builds, over-the-air updates, and `tao review` in the standalone CLI are deferred. A
checkout exposes commands a release build hides.

## Where things are

- [Docs/Tutorials](Docs/Tutorials) — learning material, starting with Your First Tao App.
- [Docs/Spec](Docs/Spec) — the contract for what the toolchain implements today.
- [Decisions.md](<Docs/Roadmap/Tao Revolution/Decisions.md>) — the decided language, including what
  is designed but not yet built.
- [Roadmap.md](Roadmap.md) — open work.
- [Apps](Apps) — WordFlower, the app the language is built through, plus the test apps and starters.

## Preview status

Tao is 0.x. Expect breaking changes between versions, each named in the release notes. What is
built is tested; what is designed but not built is marked as such in the specification and the
decisions.

## Licence

**Apps you build with Tao are yours.** Write them, ship them, sell them, and license them however
you like. You never have to publish their source or license them in any particular way, and nothing
in Tao's licence claims your code or what Tao's tools generate from it. The
[Tao Application Exception](LICENSE-APP-EXCEPTION.md) says so in licence terms, including for the
runtime and standard library that Tao builds into your app.

**Tao itself is under the GNU Affero General Public License v3.0** ([LICENSE](LICENSE)). Anyone may
use, study, and change Tao, but whoever distributes a changed Tao, or offers one to users over a
network, must share those changes under the same licence. That includes changes made to the runtime
inside an app; it does not include the rest of the app.

**Documentation** in [`Docs/`](Docs/) is under [CC BY 4.0](Docs/LICENSE): reuse it however you like,
with credit. **Tao's names and logo** are not covered by any of these licences; see the
[trademark policy](TRADEMARKS.md).

**Contributing:** a pull request is merged once its author has accepted the
[Contributor License Agreement](CLA.md) by posting the one sentence it asks for; a check on every
pull request holds it until then. The agreement leaves you the copyright in your contribution and
lets the maintainer license Tao, your contribution included, under any terms.
