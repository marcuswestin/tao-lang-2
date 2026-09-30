---
name: tao-run-and-ship
description: >-
  Run and ship Tao apps. Use when starting an Expo dev loop, opening an app in Studio for review,
  preparing device execution, or releasing through TestFlight or App Store Connect; publishing still
  requires the user's authorization.
---

# Tao Run and Ship

## Run locally

Run `tao dev [path]`. Tao discovers runnable apps, selects the only app or prompts when several are
present, compiles it, starts Metro on port 8081 or another available port, and watches source. Bare
`tao dev` opens no target; pass `--ios`, `--android`, `--web`, or `--desktop` to open the selected
targets. Use `--app <Name>` for an unambiguous noninteractive selection. Install Expo Go or the
appropriate development client on a target before opening its Metro link.

The interactive dashboard reports compile, Metro, device, and runtime output. Fix the first Tao
diagnostic with `tao fix`/`tao check`; restart only when the dashboard says the host needs it.

Studio is Tao's visual project editor and scenario matrix. Its cells come from `fixture` and
`scenarios` declarations, can focus an app or view, and use the same compiler/runtime behavior as the
app. Use `tao review [path]` to run every authored scenario and write a portable web-rendered review;
use `--app`, `--output`, or `--against <review.json>` when needed.

## Project metadata

Shipping requires one `project` block with an opaque `id`, display `name`, numeric SemVer `version`,
and a complete app. `app Name` selects the ordinary default; otherwise pass `--app Name`.
`remote none` is currently the only implemented project-remote behavior.

## Ship

Start with `tao ship --dry-run`. It discovers the project, checks Git and host prerequisites, prints
the exact plan, and makes no release changes. A real ship requires macOS, Xcode 15 or later, Apple
signing, App Store Connect credentials, a clean Git tree unless `--ignore-git` is deliberate, and a
release-capable datasource configuration.

- `tao ship --beta` uploads for TestFlight; `--beta email@example.com,...` adds recipients.
- Without `--beta`, shipping creates or reuses the App Store version, attaches the processed build,
  and submits it for review.
- `--patch`, `--minor`, or `--major` forces one version bump; `--yes` accepts the printed plan.
- `--notes <text>` sets TestFlight notes; `--no-wait` returns after upload.
- `--update` publishes a compatible over-the-air bundle; `--rollback` republishes the prior bundle.

The command records accepted store/build state under `.tao-project/` and may commit a version bump or
tag a release. Review the dry run and Git state before authorizing it.

Publishing a Tao project for other Tao projects to import is unavailable. Do not use proposed
`tao publish`, `tao install`, `tao require`, `requires`, or dependency-lock workflows.
