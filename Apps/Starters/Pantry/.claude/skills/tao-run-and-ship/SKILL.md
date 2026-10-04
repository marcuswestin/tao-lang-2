---
name: tao-run-and-ship
description: Run Tao apps in the browser; understand later Simulator, Studio, Companion, and TestFlight release phases.
---

# Tao Run and Ship

## Release 1: run in a browser

Run `tao run [path] --web`. Tao discovers runnable apps, selects the only app or prompts when
several are present, compiles it, starts Metro, and watches source. Use `--app <Name>` for an
unambiguous selection. Bare `tao run` starts the server without opening a target. Use
`tao watch [path]` to refresh saved-file contracts without starting a runtime. Fix Tao diagnostics
with `tao fix <path>` and `tao check <path>`.

In a repository checkout, use `./agent tao` in place of the installed `tao` command. The signed
standalone CLI and marketplace extension require their own release acceptance before publication;
a development-checkout run does not establish that acceptance.

## Later phases

- Release 2 adds `tao run [path] --ios` and HTTP data through typed adapters. Simulator use needs
  a compatible published host and real Simulator interaction before it is a release claim.
- Release 3 adds native Studio and interactive scenario review. Scenario declarations are already
  part of release 1; `tao review` in the standalone binary remains deferred.
- Release 4 adds invitation Companion and private same-person CloudKit sync. Acceptance needs a
  distributed physical-device install and actual two-device synchronization.
- Release 5 adds `tao ship` for a developer's app through TestFlight, after signing, processing,
  invitation, tester install, and relaunch. The planned public modes are `--internal` and `--beta`;
  the current development command still has older options and does not define the public invocation.

Android, desktop app builds, App Store submission, and over-the-air `--update`/`--rollback` remain
deferred beyond release 5. Publishing a Tao project for other projects to import is unavailable;
do not use proposed `tao publish`, `tao install`, `tao require`, `requires`, or dependency-lock
workflows. Check the current release capability before suggesting a development-only command as a
public entry point.
