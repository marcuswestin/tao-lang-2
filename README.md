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

The signed, notarized standalone CLI for macOS on Apple Silicon has not been published. A public
install command cannot be given yet. Release 1 also requires the editor extension to be published
in both marketplaces; a source checkout or local VSIX does not establish that publication.

For repository development, [CONTRIBUTING.md](CONTRIBUTING.md) takes a fresh macOS or Linux machine
from Nix to a running dev loop and a changed compiler. In short, once [Nix](https://nixos.org) is
installed, enter the checkout and run one bootstrap command, then create a starter:

```sh
./enter-tao-dev-env   # macOS; on Linux run ./.config/bootstrap-tao-dev-env
./tao create "A reading list" --provider local --ai none
```

The bootstrap command builds the pinned environment and installs dependencies. A failed setup stops
with the failing step. Optional automatic shell activation with direnv is described at the end of
[CONTRIBUTING.md](CONTRIBUTING.md#optional-automatic-shell-activation).

The checkout runs Tao CLI commands through `./tao`; an installed standalone CLI will use
`tao` directly. `create` generates a multi-file starter. [Your First Tao App](<Docs/Tutorials/Your First Tao App.md>)
instead builds a separate, single-file reading list by hand.

| Command or surface                                         | Availability and purpose                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./tao create "A reading list" --provider local --ai none` | Checkout analogue of release-1 creation; `--provider local` keeps data on the device and `--ai none` forces the plain starter in the development checkout. The public release-1 command will be `tao create "A reading list" --provider local`. |
| `./tao run Apps/Starters/Notebook --app Notebook --web`    | Development checkout: run the checked-in starter in a browser. Release-1 creation projects its later design features into supported styles.                                                                                                     |
| `./tao check Apps/Starters/Notebook`                       | Development checkout: check the named starter. Public `check` starts in release 1 for source supported by that release.                                                                                                                         |
| `./tao fix Apps/Starters/Notebook`                         | Development checkout: apply source fixes to the named starter. Public `fix` starts in release 1.                                                                                                                                                |
| `./tao test Apps/Starters/Notebook`                        | Development checkout: run the starter's behavior tests. Public `test` starts in release 1.                                                                                                                                                      |
| `./tao run Apps/Starters/Notebook --app Notebook --ios`    | Development checkout: run the checked-in starter in iOS Simulator. Public Simulator support starts in release 2 for supported source.                                                                                                           |
| Native Studio                                              | Release 3: native workbench and interactive scenario review, after distribution.                                                                                                                                                                |
| `tao ship --beta`                                          | Release 5: TestFlight, after distribution and acceptance.                                                                                                                                                                                       |

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
