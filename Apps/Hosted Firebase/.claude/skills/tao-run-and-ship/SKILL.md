---
name: tao-run-and-ship
description: Run Tao apps on the web; understand later simulator, Studio, Companion, and TestFlight release phases.
---

# Tao Run and Ship

## Release 1: run in a browser

Run `tao dev [path] --web`. Tao discovers runnable apps, selects the only app or prompts when
several are present, compiles it, starts Metro, and watches source. Use `--app <Name>` for an
unambiguous selection. Bare `tao dev` starts the server without opening a target. Fix a Tao
diagnostic with `tao fix <path>` and `tao check <path>`.

In a repository checkout, use `./agent tao` in place of the installed `tao` command. The signed
standalone release-1 CLI and marketplace extension are planned but not yet published.

## Later phases

- Release 2 adds `tao dev [path] --ios` for iOS Simulator and HTTP data through typed adapters.
- Release 3 adds native Studio and interactive scenario review. Scenario declarations are already
  part of release 1; `tao review` in the standalone binary remains deferred.
- Release 4 adds invitation Companion and private CloudKit sync.
- Release 5 adds `tao ship` for TestFlight, after signing and genuine tester acceptance. The
  planned author modes are `--internal` and `--beta`; the current development command still has
  older options and does not define the eventual public invocation.

Android, desktop app builds, App Store submission, and over-the-air `--update`/`--rollback` are
deferred beyond release 5. Do not present a development-checkout command as a published release.
