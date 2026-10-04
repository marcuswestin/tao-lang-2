# Tao

Today, building an app is 20% value and 80% boilerplate, platform-specific detail, and unnecessary
complexity.

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

The signed, notarized standalone CLI for macOS on Apple Silicon has not been published. A public
install command cannot be given yet. Release 1 also requires the editor extension to be published
in both marketplaces; a source checkout or local VSIX does not establish that publication.

For repository development, clone this repository on macOS with [Nix](https://nixos.org) and
[devenv](https://devenv.sh) installed, enter the checkout, then run:

```sh
./enter-tao-dev-env
./agent tao create "A reading list" --ai none
```

The entry script enters the pinned environment once, runs `./agent setup`, and opens your interactive
shell in that same environment. A failed setup stops entry. Running it again inside this checkout's
active environment returns immediately without repeating setup or nesting another shell. A different
checkout still enters its own environment. `./enter-tao-dev-env --setup-only` explicitly refreshes
the pinned environment and runs setup without an interactive shell. Type `exit` to leave.

At the end of successful setup, a developer terminal offers
to install the pinned direnv and enable automatic environments for this repository and all its
registered Git worktrees. After opting in, open a new terminal and enter a checkout to load its
tools automatically. Without activation, run the entry script when you return to the checkout.

The optional integration keeps developer settings and its installed shell helper under
`~/.tao-dev`, adds one source line to your zsh startup file, and keeps direnv available through a
Nix garbage-collection root. The opt-in trusts environment configuration in current and future
registered worktrees of this repository, including changes to their root `.envrc`; unrelated
repositories and nested `.envrc` files are not automatically trusted. Dependency setup remains
explicit: entering a directory loads its environment without running `./agent setup`.
Setup prepares checkout-local completions; worktrees that have not run setup use the copy installed
under `~/.tao-dev`. Directory entry never invokes the dependency installer to obtain completions.
For an already enabled repository, setup also warms this checkout's own devenv cache, so its first
directory entry can use the cached evaluation. This moves cold Nix work into setup rather than
eliminating it; a checkout entered before setup still evaluates normally. Branch-specific toolchain
changes remain subject to devenv's normal invalidation. Preparation is bounded and optional: a
missing or inaccessible Nix installation leaves setup usable and directory entry retries normally.

For an older worktree with no root `.envrc`, the hook creates the standard loader as an untracked
file. It never replaces an existing file or symlink, or restores a tracked file you deleted.

Noninteractive setup never prompts or changes personal shell settings. Run `./agent shell-setup`
to change your choice or refresh the installed integration, or `./agent setup --environment` to rebuild the pinned toolchain after its
dependencies change. Automatic activation currently supports zsh; the manual entry script remains
available for other shells. Turning off automatic trust preserves existing direnv authorizations;
those remain under direnv's own control.

The checkout runs Tao CLI commands through `./agent tao`; an installed standalone CLI will use
`tao` directly. `create` generates a multi-file starter. [Your First Tao App](<Docs/Tutorials/Your First Tao App.md>)
instead builds a separate, single-file reading list by hand.

| Command or surface                                            | Availability and purpose                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./agent tao create "A reading list" --ai none`               | Checkout analogue of release-1 creation; `--ai none` forces the plain starter in the development checkout. The public release-1 command will be `tao create "A reading list"`. |
| `./agent tao run Apps/Starters/Notebook --app Notebook --web` | Development checkout: run the checked-in starter in a browser. Release-1 creation projects its later design features into supported styles.                                    |
| `./agent tao check Apps/Starters/Notebook`                    | Development checkout: check the named starter. Public `check` starts in release 1 for source supported by that release.                                                        |
| `./agent tao fix Apps/Starters/Notebook`                      | Development checkout: apply source fixes to the named starter. Public `fix` starts in release 1.                                                                               |
| `./agent tao test Apps/Starters/Notebook`                     | Development checkout: run the starter's behavior tests. Public `test` starts in release 1.                                                                                     |
| `./agent tao run Apps/Starters/Notebook --app Notebook --ios` | Development checkout: run the checked-in starter in iOS Simulator. Public Simulator support starts in release 2 for supported source.                                          |
| Native Studio                                                 | Release 3: native workbench and interactive scenario review, after distribution.                                                                                               |
| `tao ship --beta`                                             | Release 5: TestFlight, after distribution and acceptance.                                                                                                                      |

Android, desktop app builds, over-the-air updates, and `tao review` in the standalone CLI are
deferred. The development checkout may expose commands that a release-1 build hides.

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

Tao is released under the GNU Affero General Public License v3.0; see [LICENSE](LICENSE). The
licence structure for apps built with Tao remains an unresolved pre-release decision. Do not infer
an app licence from Tao's repository licence.
