# Contributing to Tao

This is the short path from a fresh machine to a changed compiler you can see running. It works on
macOS (Apple Silicon) and on Linux. Every command below is what the clean-machine proofs run, so a
step that fails for you is a defect in this document or the checkout; please report it.

Before your first pull request, read the licence and the Contributor License Agreement summary in
the [README](README.md#licence).

## 1. Prerequisites

- `git` and `curl`. On a Mac, the first `git` run offers Apple's command line tools; accept it.
- Administrator rights, once, for the Nix installer.
- Free disk of several tens of gigabytes. The pinned toolchain and its dependencies are large.
- Nix, which provides every other tool at the version this repository pins, and on macOS also
  [devenv](https://devenv.sh). Install them once per machine.

macOS:

```sh
curl -sSfL https://artifacts.nixos.org/nix-installer | sh -s -- install
nix-env --install --attr devenv -f https://github.com/NixOS/nixpkgs/tarball/nixpkgs-unstable
```

Open a new terminal afterwards so the shell picks up Nix. On Linux the bootstrap command in step 2
installs Nix for you when you give it `--install-nix`; use that only in a disposable machine or
container, because it installs Nix without a daemon. On a Linux machine you keep, install Nix with
the command above and omit the flag.

## 2. Get the tools and dependencies

Clone the repository, enter the checkout, and run the one command for your platform.

macOS:

```sh
./enter-tao-dev-env
```

Linux:

```sh
./.config/bootstrap-tao-dev-env
```

On a disposable Linux machine without Nix, run `./.config/bootstrap-tao-dev-env --install-nix`
instead.

Both build the pinned toolchain and install the dependencies. The first run takes the longest;
later runs reuse the result. `./enter-tao-dev-env` then opens a shell with the tools on its path.
To refresh the environment without opening a shell, run `./enter-tao-dev-env --setup-only`. A
failed setup stops with the failing step and a log path.

From here on, run commands from the checkout root with `just`, `./dev`, or `./tao`; they find the
pinned tools themselves on either platform.

## 3. Run tests

Run one test file while you work:

```sh
./dev test-file packages/language/parser/parser-tests/dialect.test.ts
```

Name a package directory to run all of its tests:

```sh
./dev test-file packages/language/source-actions
```

Before you open a pull request, run `just verify-changed`. It checks and tests what your branch
changed. Tao programs have their own behaviour tests: `./tao test Apps/Starters/Notebook`.

## 4. Start the dev loop

The dev loop compiles a Tao app and serves it on a local web address, without opening a window.
Start it on the Notebook starter:

```sh
./dev dev-loop start Apps/Starters/Notebook --app Notebook --json
```

The reply names a session and, once `./dev dev-loop status --session <session> --json` reports
`"state":"ready"`, a `url`. Fetch the page with `curl` or open it in a browser. Stop the loop when
you finish:

```sh
./dev dev-loop stop --session <session> --json
```

`./tao run Apps/Starters/Notebook --app Notebook --web` does the same in the foreground and keeps
the terminal.

## 5. Change the language or the toolchain, and see it

Work is organised by stage. A language feature crosses the stages, each in its own package:

| You change                    | Where                                           |
| ----------------------------- | ----------------------------------------------- |
| Syntax                        | `packages/language/parser`                      |
| Diagnostics and rules         | `packages/language/validator`                   |
| Formatting and source fixes   | `packages/language/formatter`, `source-actions` |
| The TSX a Tao app compiles to | `packages/compiler/compiler-src`                |
| The `tao` and `dev` commands  | `packages/cli`                                  |

[packages/AGENTS.md](packages/AGENTS.md) describes how the stages share names and what each owns.

To see a change in a running app, edit the source, then stop the loop and start it again as in
step 4. A running loop does not reload the compiler's own source, so restarting it with
`./dev dev-loop restart` shows an edit to a `.tao` file but not to the toolchain. After the restart,
fetch the page again; the app it serves is compiled by your edited toolchain. For a compiler edit,
`just check` and the relevant `./dev test-file` run confirm it as well.

## Optional: automatic shell activation

None of this is needed for the steps above. It saves running the entry script each time you return
to a checkout.

The entry script enters the pinned environment once, runs setup, and opens your interactive shell
in that same environment. Running it again inside this checkout's active environment returns
immediately without repeating setup or nesting another shell. A different checkout still enters its
own environment. Type `exit` to leave.

At the end of successful setup, a developer terminal offers to install the pinned direnv and enable
automatic environments for this repository and all its registered Git worktrees. After opting in,
open a new terminal and enter a checkout to load its tools automatically. Without activation, run
the entry script when you return to the checkout.

The optional integration keeps developer settings and its installed shell helper under `~/.tao-dev`,
adds one source line to your zsh startup file, and keeps direnv available through a Nix
garbage-collection root. The opt-in trusts environment configuration in current and future
registered worktrees of this repository, including changes to their root `.envrc`; unrelated
repositories and nested `.envrc` files are not automatically trusted. Dependency setup remains
explicit: entering a directory loads its environment without running setup. Setup prepares
checkout-local completions; worktrees that have not run setup use the copy installed under
`~/.tao-dev`. Directory entry never invokes the dependency installer to obtain completions. For an
already enabled repository, setup also warms this checkout's own devenv cache, so its first
directory entry can use the cached evaluation. This moves cold Nix work into setup rather than
eliminating it; a checkout entered before setup still evaluates normally. Branch-specific toolchain
changes remain subject to devenv's normal invalidation. Preparation is bounded and optional: a
missing or inaccessible Nix installation leaves setup usable and directory entry retries normally.

For an older worktree with no root `.envrc`, the hook creates the standard loader as an untracked
file. It never replaces an existing file or symlink, or restores a tracked file you deleted.

Noninteractive setup never prompts or changes personal shell settings. Run `just shell-setup` to
change your choice or refresh the installed integration, or `./enter-tao-dev-env --setup-only` to rebuild
the pinned toolchain after its dependencies change. Automatic activation currently supports zsh; the
manual entry script remains available for other shells. Turning off automatic trust preserves
existing direnv authorizations; those remain under direnv's own control.

## Prove the path on a clean machine

Two repeatable proofs run this document on a fresh machine and keep per-step timings and logs under
`.artifacts/`. Each uses the committed source only.

```sh
just contributor-linux-test
just contributor-macos-test
```

Both proofs clone a pinned Tart image (vanilla macOS, Ubuntu 24.04 for Linux) and need Tart installed
(`just standalone-cli-vm-setup`). Download the images once, and again whenever a pin changes; a proof
whose image is missing stops and prints this command:

```sh
just vm-images
```

They are periodic acceptance checks and a debugging aid; hosted CI is the integration proof.
