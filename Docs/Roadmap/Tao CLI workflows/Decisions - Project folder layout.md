# Decisions - Project folder layout

Where Tao keeps a project's state on disk, and what a project commits. Decided 2026-10-03 on
`feat/studio-preview-latency-next`; the successor branch implements it. The work's handoff is
[Studio preview speed continuation](<../Studio preview speed continuation.md>).

## Decided

1. **Who a file is for decides where it lives.** State everyone working on a project shares is
   committed with the project. State for one developer goes in the project's `.tao/` folder when it
   belongs to that project, and in the home Tao folder (`~/.tao`, `TaoHome`) when it is a
   preference, configuration, or data not tied to one project.
2. **A project's `.tao/` holds exactly four entries:** `store/`, `local/`, `cache/`, and
   `.gitignore`.
   1. `store/` is committed: state everyone on the project shares, written by Tao rather than
      authored. It replaces `.tao-project/`.
   2. `local/` is ignored: one developer's state for this project that Tao cannot regenerate
      (dev-session history, dev data, retained builds, Studio session state).
   3. `cache/` is ignored: what Tao regenerates, plus every temporary and lock file. Safe to delete
      while no Tao process uses the project.
   4. `.tao/.gitignore` lists `local/` and `cache/`.
3. **The project secret store moves to `.tao/store/secrets.jsonc`**, from `secrets/secrets.jsonc`.
   It holds encrypted values and public recipients and stays committed.
4. **A temporary or lock file never lands beside a committed file.** Every write Tao makes into
   committed project state stages its temporary file and keeps its lock under `.tao/cache/`, then
   moves the finished file into place. Today the sketch catalog's `.tmp`, `.lock`, owner, and claim
   files sit in `.tao-project/studio/`; this repository's root `.gitignore` hides only the `.tmp`
   ones (line 25, remove it once fixed) and a created project hides none.
5. **Everything Studio writes goes under a `studio/` folder** of whichever of `store/`, `local/`, or
   `cache/` it belongs in. The same holds in the home folder (`~/.tao/studio/`).
6. **Files only an app with agents needs go in an `agents/` folder** of the generated desktop host
   (`cache/dev/desktop/agents/`), so the host's own files read the same with or without agents.
7. **`tao create` writes a root `.gitignore` of common defaults**, one commented section per
   concern with a blank line between sections: operating system and editor files, Tao's generated
   sidecars (`*.tao.ts`), tooling output (`node_modules/`, `.expo/`, `*.tsbuildinfo`, `*.log`), and
   plain-text secrets (`.env`, `.env.*`). It no longer ignores `.tao/`; `.tao/.gitignore` does that
   part. Today it writes `'*.tao.ts\n.tao/\nnode_modules/\n'`
   (`packages/cli/tao-cli/cli-src/create/creation-lowering.ts:42`).
8. **No editor configuration file.** `.editorconfig` has no ignore setting and no ignore format is
   shared across IDEs; the common editors already skip gitignored files in search.
9. **The older layout moves once.** The first Tao process to prepare a project's `.tao/` moves each
   entry of the older layout to where it now lives, and leaves anything it does not recognize.
   Older entries: `.tao/sessions/`, `.tao/builds/`, `.tao/dev/` (with `dev/data/`),
   `.tao/bridge-check.tsconfig.json`, `.tao/browser-acceptance/`, `.tao-project/`, and
   `secrets/secrets.jsonc`.
10. **`skills.version` becomes a field of `store/lock.jsonc`.** `installTaoSkills`
    (`packages/ai/tao-skills/skills-src/tao-skills.ts:74`) writes it beside the skill files it
    installs into the project (`.agents/skills/`, `.claude/skills/`, `AGENTS.md`, `CLAUDE.md`), so a
    later Tao can tell whether those committed files are stale. It is per project because those
    files are, and `lock.jsonc` already records which Tao release the project pins. The migration
    folds an existing `.tao-project/skills.version` into the field.
11. **Datasource adapters get a Tao API to read and write `store/`, `local/`, and `cache/`.** Today
    only the `Dev` datasource's server writes into the project, through its own protocol. Whether
    the API is built in this project or deferred is to be decided; when deferred, it gets its own
    roadmap entry.

## The tree

Every kind of entry, shown three times where a project can hold several.

```text
<project>/
├── .gitignore                       created defaults (decision 7)
└── .tao/
    ├── .gitignore                   local/ and cache/
    ├── store/                       committed
    │   ├── lock.jsonc               toolchain pin and skills version (from .tao-project/)
    │   ├── secrets.jsonc            from secrets/
    │   └── studio/
    │       └── sketches.jsonc       from .tao-project/studio/
    ├── local/                       ignored, one developer
    │   ├── sessions/
    │   │   ├── owner.json
    │   │   ├── 1b0e….json
    │   │   ├── 5c7a….json
    │   │   └── 9f42….json
    │   ├── dev-data/
    │   │   ├── HNReader/
    │   │   │   ├── bookmarks.json
    │   │   │   ├── history.json
    │   │   │   └── settings.json
    │   │   ├── Inbox/…
    │   │   └── Notes/…
    │   ├── builds/
    │   │   ├── agents -> 2026-10-03T18-40-11Z-3c1d9e0a/agents
    │   │   ├── 2026-10-01T09-12-44Z-a81f2c3b/
    │   │   │   ├── build.json
    │   │   │   ├── agents
    │   │   │   ├── compiled/<target>/_gen_tao-app/
    │   │   │   ├── desktop/
    │   │   │   ├── visionos/
    │   │   │   ├── watchos/
    │   │   │   └── web/{site/, run, serve.ts}
    │   │   ├── 2026-10-02T…/
    │   │   └── 2026-10-03T…/
    │   └── studio/
    │       └── session.json         active previews, focused preview, editor tabs, canvas viewport
    └── cache/                       ignored, regenerable
        ├── bridge-check/
        │   └── tsconfig.json
        ├── dev/
        │   ├── node_modules/
        │   ├── runtime/
        │   ├── expo-home/
        │   └── desktop/
        │       ├── electrobun.config.ts
        │       ├── hutch.config.ts
        │       ├── package.json
        │       ├── site/
        │       ├── src/bun/index.ts
        │       └── agents/          only for an app with agents
        │           ├── tao-agent.json
        │           ├── agent-rpc.ts
        │           ├── agent-host.js
        │           └── index.ts
        ├── studio/
        │   ├── locks/               sketch catalog lock, owner, and claim files
        │   └── tmp/                 sketch catalog staging
        ├── ship/
        │   └── HNReader/{DerivedData/, export/, ExportOptions.plist}
        ├── logs/
        │   ├── expo.log
        │   ├── expo-8081.log
        │   ├── expo-8082.log
        │   └── ship/HNReader-42.log
        ├── browser-acceptance/
        ├── locks/                   project lock, secret store, project version rewrite
        └── tmp/                     their staging files
```

Home folder, for state not tied to one project:

```text
~/.tao/
├── studio/
│   ├── recent-projects.json
│   ├── prefs.json                   pane sizes, layout preset, rail panel, drawer tab, lens
│   ├── device-trust/
│   ├── launches/
│   └── logs/
├── agents/<app id>/{session.json, origin.json, service.log}
└── cache/cocoapods/
```

## Where today's files come from

1. **Builds:** `.tao/builds/<ISO>-<uuid8>/`; `builds/agents` links the newest agent client
   (`packages/cli/tao-cli/cli-src/agent-client-build.ts:38-45`).
2. **Dev loop:** `.tao/dev/{runtime,node_modules,expo-home,logs/expo[-port].log,desktop/…}`.
   `desktop/` is the desktop host: the Electrobun macOS app shell Tao generates to run a Tao app as
   a desktop app, against Metro in development or a static export in a build (`DesktopHost`,
   `packages/apps/expo-host/expo-host-src/desktop-host.ts:10-56`). Its files, including the four
   agent-only ones, are written at `:22-54`; with agents its `src/bun/index.ts` is a different
   source too (`:45`). Check that Electrobun's build accepts entry points under `agents/` before
   moving them.
3. **Dev data:** `.tao/dev/data/<AppName>-<sha256(projectRoot)[:8]>/<encodeURIComponent(key)>.json`
   (`dev-loop/dev-data/DevDataBootstrap.ts:37-41`, `DevDataServer.ts:239`). Each file is one
   durable stream for one storage key of the `Dev` datasource
   (`packages/apps/stdlib/@tao/data/providers/dev/Dev.ts`): `{ format: 'tao-dev-data-state-v1',
   revision, snapshot }`, written atomically under a lock. Inside a project's own `.tao/` the path
   hash is redundant; drop it.
4. **Ship:** output in the toolchain root's `.artifacts/ship` (it collides across projects), logs in
   `<git root>/.artifacts/logs/ship`. Both move into the project's `cache/`.
5. **Studio, per user:** in a checkout `<repo>/.artifacts/user/studio`, packaged in Electrobun's
   userData: `recent-projects.json`, `project-viewports/<hash>.json`
   (`studio-tooling-src/StudioDev.ts:114-115`, `StudioPackagedService.ts:63-65`), `device-trust/`,
   `launches/`, `logs/`, and packaged `dev-data/`. Viewports are per project, so they move to
   `local/studio/session.json`; the rest move to `~/.tao/studio/`.
6. **Studio, in the browser:** global keys `tao-studio:pane-sizes:v4`, `layout-preset`,
   `rail-panel`, `drawer-tab`, `tao-studio.lens`, `tao-studio-fast-draw` (removed by preview
   activation), `tao-studio:agent-position:v1`; per project `tao-studio:active-cell:<project>:<app>`
   (`studio-src/client/StudioApp.ts:133`) and `tao-studio:editor-tabs:v1:<project>:<app>`
   (`studio-src/client/StudioEditorTabs.ts:147`). The per-project keys move to
   `local/studio/session.json`, read and written through the Studio server; the active cell is
   renamed the focused preview there (see the continuation's preview activation item 3).
7. **Agents service:** `~/Library/Caches/Tao/agents/<hash>/` moves to `~/.tao/agents/`.
8. **Temporary and lock writers into committed state** (decision 4):
   1. Sketch catalog: `studio-src/StudioSketchCatalog.ts:321` (staging) and `:341-342` (lock).
   2. Project lock: `cli-src/ship-lock.ts:120`.
   3. Project version rewrite: `cli-src/ship-project.ts:269` (stages beside the project's `.tao`
      source).
   4. Secret store: `cli-src/project-secrets-command.ts:99` and `:110`.
   5. `FS.withFileMutationLock` puts `<target>.tao-file-mutation.lock` beside its target
      (`packages/shared/shared-src/FS.ts:886`); callers writing committed files need a lock
      directory parameter or a project-aware wrapper.
9. **Bridge check config:** `cli-src/bridge-check.ts:46-85` writes a tsconfig whose `files` are the
   generated contract modules (`*.tao.ts`) and which extends the project's `tsconfig.json` (or
   `packages/tsconfig.base.json` in this checkout), adds the host's ambient type roots and, without
   a project config, a `@tao/runtime` path; then it runs `tsc --project` on it. A file exists only
   because `tsc` takes a project file; the in-process TypeScript API (already imported at line 37)
   could replace both.

## Open

1. **When the adapter storage API is built** (decision 11): in this project or deferred.
2. **The desktop host's folder name.** `cache/dev/desktop/` holds the generated Electrobun shell, not
   a desktop app's output, while a build's `desktop/` is the built app. Recommended:
   `cache/dev/desktop-host/`, matching `DesktopHost`, with `agents/` inside it.
3. **Home Studio preferences.** Whether the global browser keys in item 6 move to
   `~/.tao/studio/prefs.json` or stay in the browser.
4. **The generated app.** `_gen_tao-app` sits in the toolchain root, shared by every project;
   whether it moves to each project's `cache/` is open.

## Implementation state

Commit `WIP: route project .tao state through ProjectLocal` on `feat/studio-preview-latency-next`
is a first pass, untested, that predates decisions 2, 5, 6, 10, and 11. It adds `ProjectLocal`
(`packages/shared/shared-src/ProjectLocal.ts`) with `storeResolve`, `cacheResolve`, `stagingPath`,
`prepare`, and a legacy-entry move, and routes dev sessions, the dev runtime, dev data, builds,
clean, the bridge check, standalone acceptance, the desktop agent proof, and the QA screenshot
cleanup through it. Its `storeResolve` means today's `local/` (rename it `localResolve` and add a
committed `storeResolve`), and its `.tao/.gitignore` ignores everything. Not started: decision 4's
call sites, `.tao-project/` and `secrets/` into `store/`, the created root `.gitignore`, Studio
and agents subfolders, the home moves, and updating tests (`build-clean-cli.test.ts:69` and `:82`,
`project-dev-session.test.ts`, `repo-lint.test.ts:291-298` and `:361`, `compile-app.test.ts:148`),
documentation naming `.tao/sessions`, `.tao/builds`, or `.tao/dev`, `Apps/VisionHello/README.md`,
and the storage-archive skill.
