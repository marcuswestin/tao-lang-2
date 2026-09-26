# Tao

Today, building an app is 20% value and 80% boilerplate, platform-specific detail, and unnecessary
complexity.

Tao is a new programming language, and it takes care of that 80% for you. Every time.

It was first prototyped fifteen years ago. This year, it was finally built.

The current version is a fully functional preview. Production ready in 2027.

## What a Tao app looks like

One file declares the project, the app, its navigation, and its screens:

```tao
use StackNav from @tao/nav
use Col, Text from @tao/ui

project {
   id "reading-list"
   name "ReadingList"
   remote none
   license MIT
}

app ReadingList {
   Name "Reading List"
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

Tao compiles to TypeScript for Expo and React Native, so a Tao app runs on iOS, Android, and the
web.

## Install

<!-- The standalone CLI release replaces this section with its one-line install (macOS on Apple Silicon first). -->

The standalone `tao` command for macOS on Apple Silicon is on its way. Until it ships, run Tao from
a checkout on macOS with [Nix](https://nixos.org) and [devenv](https://devenv.sh) installed:

```sh
git clone <repository> tao && cd tao
./enter-tao-dev-env
./tao create "A reading list"
```

The entry script enters the pinned environment once, runs `./agent setup`, and opens your interactive
shell in that same environment. A failed setup stops entry. Running it again inside this checkout's
active environment returns immediately without repeating setup or nesting another shell. A different
checkout still enters its own environment. `./enter-tao-dev-env --setup-only` explicitly refreshes
the pinned environment and runs setup without an interactive shell. Type `exit` to leave. Then:

| Command      | What it does                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| `tao create` | Creates a new project from a one-line description                                     |
| `tao dev`    | Runs the app on the web, an iOS simulator, Android, or the desktop, reloading on save |
| `tao check`  | Reports syntax and validation errors, and canonical form                              |
| `tao fix`    | Applies every automatic source fix: formatting and organized `use`s                   |
| `tao test`   | Runs the behavior tests declared in `.tao` files                                      |
| `tao ship`   | Builds and ships to TestFlight                                                        |

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

Tao is built by its author working with coding agents. Commit trailers are omitted for a clean
history.

## Licence

Tao is released under the GNU Affero General Public License v3.0; see [LICENSE](LICENSE). The
licence structure for apps built with Tao is being settled before the first public release.
