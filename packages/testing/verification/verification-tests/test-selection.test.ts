import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { PackageGraph } from '../verification-src/PackageGraph'
import { type SuiteInventory, TestSelection } from '../verification-src/TestSelection'

/**
 * A small workspace with the shapes the real one has: a leaf everything imports (`shared`), a
 * chain (`language/parser` -> `compiler` -> `workspace`), the CLI the Tao behavior tests run
 * through, the dev-tooling chain that reaches it (`cli/dev-cli` -> `testing/verification` ->
 * `cli/cli-kit`, with `cli/tao-cli` also importing `cli/cli-kit` directly and, lazily, only for
 * `studio-review`, `ides/studio-tooling`), Studio's own package (`ides/studio`, which
 * `ides/studio-tooling` imports the way the real workspace does), and a package nothing imports
 * (`studio`). The grouped packages — `apps/runtime`, `apps/expo-host`, `apps/stdlib`,
 * `cli/tao-cli`, `cli/cli-kit`, `testing/verification`, `ides/studio`, `ides/studio-tooling`,
 * `language/formatter`, `language/parser` — keep the real two-segment ids, because
 * `TestSelection`'s own `TAO_APPS_PACKAGES`, `LANGUAGE_PERFORMANCE_PACKAGES`, and
 * `STUDIO_APP_PACKAGE` match on those exact ids.
 */
const graph: PackageGraph = {
  imports: new Map<string, ReadonlySet<string>>([
    ['compiler', new Set(['language/parser', 'shared'])],
    ['cli/dev-cli', new Set(['shared', 'testing/verification'])],
    ['language/formatter', new Set()],
    ['language/parser', new Set(['shared'])],
    ['apps/runtime', new Set()],
    ['apps/expo-host', new Set(['apps/runtime', 'shared'])],
    ['shared', new Set()],
    ['apps/stdlib', new Set(['shared'])],
    ['studio', new Set(['shared', 'workspace'])],
    ['ides/studio', new Set(['shared'])],
    ['cli/tao-cli', new Set(['cli/dev-cli', 'workspace', 'cli/cli-kit', 'ides/studio-tooling'])],
    ['cli/cli-kit', new Set(['shared'])],
    ['testing/verification', new Set(['shared', 'cli/cli-kit'])],
    ['ides/studio-tooling', new Set(['shared', 'testing/verification', 'ides/studio'])],
    ['workspace', new Set(['compiler'])],
  ]),
  packages: [
    'compiler',
    'cli/dev-cli',
    'language/formatter',
    'language/parser',
    'apps/runtime',
    'apps/expo-host',
    'shared',
    'apps/stdlib',
    'studio',
    'ides/studio',
    'cli/tao-cli',
    'cli/cli-kit',
    'testing/verification',
    'ides/studio-tooling',
    'workspace',
  ],
}

const inventory: SuiteInventory = {
  hasPerformanceChecks: true,
  hasRuntimeJest: true,
  hasTaoApps: true,
  packageSuites: [
    'compiler',
    'cli/dev-cli',
    'language/formatter',
    'language/parser',
    'apps/runtime',
    'apps/expo-host',
    'shared',
    'apps/stdlib',
    'studio',
    'ides/studio',
    'cli/tao-cli',
    'cli/cli-kit',
    'testing/verification',
    'ides/studio-tooling',
    'workspace',
  ],
}

function plan(paths: readonly string[]) {
  return TestSelection.planChangedSuites(paths, graph, inventory)
}

Describe('changed test selection', () => {
  Test('resolves an explicit ref directly and includes tracked and untracked paths', async () => {
    const calls: string[] = []
    const run: typeof CLI.run = async (command, spec) => {
      const args = [...spec?.args ?? []]
      calls.push(args.join(' '))
      const joined = args.join(' ')
      const stdout = joined === 'rev-parse --verify topic^{commit}'
        ? 'abc123\n'
        : joined === 'diff --name-only abc123'
        ? 'packages/parser/parser-src/Parser.ts\n'
        : joined === 'ls-files --others --exclude-standard'
        ? 'Apps/New.tao\n'
        : joined === 'rev-list --merges --count abc123..HEAD'
        ? '1\n'
        : joined === 'log -1 --format=%cI abc123..HEAD'
        ? '2026-09-03T12:00:00Z\n'
        : joined === 'log -1 --merges --format=%cI abc123..HEAD'
        ? '2026-09-02T12:00:00Z\n'
        : ''
      return { args, command, cwd: spec?.cwd, error: undefined, exitCode: 0, signal: null, stderr: '', stdout }
    }

    const selection = await TestSelection.changedSelection('topic', '/repo', run)

    Expect(selection.reference).toBe('abc123')
    Expect(selection.changedPaths).toEqual(['Apps/New.tao', 'packages/parser/parser-src/Parser.ts'])
    Expect(selection.hasMergeCommit).toBe(true)
    Expect(selection.newestCommitAt).toBe('2026-09-03T12:00:00Z')
    Expect(selection.newestMergeAt).toBe('2026-09-02T12:00:00Z')
    Expect(calls.some(call => call.startsWith('merge-base'))).toBe(false)
  })
})

Describe('changed suite plan', () => {
  Test('a package source change selects that package and every package importing it', () => {
    const result = plan(['packages/compiler/compiler-src/Compiler.ts'])

    Expect([...result.selected.keys()]).toEqual([
      'compiler',
      'studio',
      'cli/tao-cli',
      'workspace',
      'performance-checks',
      'tao-apps',
    ])
    Expect(result.selected.get('compiler')).toBe('changed directly')
    Expect(result.selected.get('workspace')).toBe('imports compiler')
    Expect(result.selected.get('studio')).toBe('imports workspace')
    // The CLI compiles the Tao behaviour tests, so a change reaching it does reach every app — but
    // reaching it through the graph is true of nearly every package, and selecting all sixteen apps
    // on that made this lane as wide as the full one. The language test apps exercise the same
    // compile-and-render pipeline at a fraction of the cost; `verify` still runs them all.
    Expect(result.taoAppPaths).toEqual(['Apps/Test Apps'])
    Expect(result.skipped).toContain('runtime-jest')
    Expect(result.skipped).toContain('cli/dev-cli')
    Expect(result.everything).toBeUndefined()
  })

  Test('a leaf package nothing imports selects only its own suite', () => {
    const result = plan(['packages/studio/studio-src/client/Editor.ts'])

    Expect([...result.selected.keys()]).toEqual(['studio'])
    Expect(result.skipped.length).toBe(inventory.packageSuites.length + 2)
  })

  Test('a changed test file selects only the suite that runs it', () => {
    Expect([...plan(['packages/shared/shared-tests/FS.test.ts']).selected.keys()]).toEqual(['shared'])
    Expect([...plan(['packages/apps/runtime/TR-tests/TR.test.ts']).selected.keys()]).toEqual(['apps/runtime'])
    Expect([...plan(['packages/cli/tao-cli/cli-tests/cli.test.ts']).selected.keys()]).toEqual(['cli/tao-cli'])
    Expect([...plan(['packages/apps/expo-host/expo-host-tests/nav.jest-test.tsx']).selected.keys()])
      .toEqual(['runtime-jest'])
    Expect([...plan(['packages/cli/dev-cli/performance-checks/language-performance.test.ts']).selected.keys()])
      .toEqual(['performance-checks'])
  })

  Test('runtime and toolchain sources reach the Jest suite and every Tao app', () => {
    const result = plan(['packages/apps/runtime/TaoRuntime-src/TR.ts'])

    Expect(result.selected.get('runtime-jest')).toBe('imports apps/runtime')
    Expect(result.selected.get('tao-apps')).toBe('apps/runtime changed directly')
    Expect(result.taoAppPaths).toEqual(['Apps'])
  })

  Test('an app change runs its behavior tests and every suite that reads app sources', () => {
    const result = plan([
      'Apps/WordFlower/1 - Current/Tests/Login.tao',
      'Apps/Skillet/Skillet.tao',
      'Apps/WordFlower/README.md',
    ])

    Expect([...result.selected.keys()]).toEqual(['language/formatter', 'apps/expo-host', 'runtime-jest', 'tao-apps'])
    Expect(result.taoAppPaths).toEqual(['Apps/Skillet', 'Apps/WordFlower'])
    Expect(result.selected.get('tao-apps')).toBe('Apps/Skillet changed, Apps/WordFlower changed')
  })

  Test('a spec-dialect source selects nothing, since Tao discovery never reads it', () => {
    const result = plan([
      'Apps/Tao Future/Hearth/Hearth.test.tao-revolution',
      'Apps/WordFlower/2 - Next/Words.tao-next',
      'Apps/WordFlower/3 - MVP/Words.tao-mvp',
    ])

    Expect(result.selected.has('tao-apps')).toBe(false)
    Expect(result.taoAppPaths).toBeUndefined()
  })

  Test('a Studio app change also selects the studio package suites its behavior proof lives in', () => {
    const result = plan(['Apps/Tao Studio/TaoStudioClient.tao'])

    Expect(result.selected.get('ides/studio')).toBe('changed directly')
    Expect(result.selected.get('ides/studio-tooling')).toBe('imports ides/studio')
    // ides/studio-tooling reaches cli/tao-cli the same lazy way it always has, which is the language
    // sample apps' own widening rule, not something this change introduces.
    Expect(result.taoAppPaths).toEqual(['Apps/Tao Studio', 'Apps/Test Apps'])
  })

  Test('an app-local TypeScript module also selects cli/tao-cli, which owns the Apps/tsconfig.json gate', () => {
    const result = plan(['Apps/WordFlower/Foo.ts'])

    Expect(result.selected.get('cli/tao-cli')).toBe('changed directly')
  })

  Test('a Tao file outside Apps and packages widens the app run to every app', () => {
    Expect(plan(['Docs/Tutorials/example.tao']).taoAppPaths).toEqual(['Apps'])
    Expect(plan(['Apps/WordFlower/Design.tao', 'packages/apps/stdlib/stdlib-src/Text.tao']).taoAppPaths).toEqual([
      'Apps',
    ])
  })

  Test('repository workflow files select the developer suites that prove them', () => {
    for (
      const path of [
        'Justfile',
        'agent',
        'enter-tao-dev-env',
        '.rulesync/permissions.jsonc',
        'agents/skills/git-workflow/SKILL.md',
        '.config/dprint.jsonc',
      ]
    ) {
      const result = plan([path])
      Expect(result.selected.get('cli/dev-cli')).toBe('repository workflow changed')
      Expect(result.selected.get('testing/verification')).toBe('repository workflow changed')
      Expect(result.everything).toBeUndefined()
    }
    Expect([...plan(['Justfile']).selected.keys()]).toEqual(['cli/dev-cli', 'testing/verification'])
    Expect(plan(['packages/cli/dev-cli/dev-cli-src/dev.ts']).selected.has('tao-apps')).toBe(false)
  })

  Test('a testing/verification-only change selects dev but not the Tao apps', () => {
    const result = plan(['packages/testing/verification/verification-src/GateCatalog.ts'])

    Expect(result.selected.get('testing/verification')).toBe('changed directly')
    Expect(result.selected.get('cli/dev-cli')).toBe('imports testing/verification')
    Expect(result.selected.has('tao-apps')).toBe(false)
  })

  Test('a cli/cli-kit change selects the Tao apps and cli/tao-cli, which ships its output helper', () => {
    const result = plan(['packages/cli/cli-kit/cli-kit-src/OutputText.ts'])

    Expect(result.selected.get('cli/cli-kit')).toBe('changed directly')
    Expect(result.selected.get('cli/tao-cli')).toBe('imports cli/cli-kit')
    Expect(result.selected.has('tao-apps')).toBe(true)
    // Reached through `cli/tao-cli` rather than by editing it, so the language test apps run.
    Expect(result.taoAppPaths).toEqual(['Apps/Test Apps'])
  })

  // The distinction the narrow lane turns on, stated on its own: editing one of the packages every
  // app is compiled by or runs on selects every app, while merely depending on one of them does not.
  Test('separates editing a package every app runs on from depending on one', () => {
    for (
      const path of [
        'packages/apps/runtime/TaoRuntime-src/TR.ts',
        'packages/apps/stdlib/stdlib-src/Text.tao',
        'packages/cli/tao-cli/cli-src/compile-command.ts',
      ]
    ) {
      Expect(plan([path]).taoAppPaths).toEqual(['Apps'])
    }
    for (
      const path of [
        'packages/language/parser/parser-src/Parser.ts',
        'packages/compiler/compiler-src/Compile.ts',
        'packages/shared/shared-src/FS.ts',
      ]
    ) {
      Expect(plan([path]).taoAppPaths).toEqual(['Apps/Test Apps'])
    }
  })

  // A directly changed app still runs its own behaviour tests, and still does when a language
  // package changed in the same commit: the sample replaces the widening, never a named app.
  Test('keeps a directly changed app beside the sampled ones', () => {
    const result = plan([
      'Apps/WordFlower/1 - Current/Design.tao',
      'packages/language/parser/parser-src/Parser.ts',
    ])

    Expect(result.taoAppPaths).toEqual(['Apps/Test Apps', 'Apps/WordFlower'])
  })

  Test('an ides/studio-tooling-only change selects cli/tao-cli but not the Tao apps', () => {
    // cli/tao-cli depends on studio-tooling only for the lazy `studio-review` command; without the
    // exclusion, every studio-tooling edit would select every Tao app suite.
    const result = plan(['packages/ides/studio-tooling/studio-tooling-src/StudioReview.ts'])

    Expect(result.selected.get('ides/studio-tooling')).toBe('changed directly')
    Expect(result.selected.get('cli/tao-cli')).toBe('imports ides/studio-tooling')
    Expect(result.selected.has('tao-apps')).toBe(false)
  })

  Test('root dependency and toolchain files widen to every suite', () => {
    for (
      const path of [
        'package.json',
        'bun.lock',
        'devenv.nix',
        'devenv.yaml',
        'devenv.lock',
        'devenv.local.nix',
        'packages/cli/dev-cli/dev-cli-src/environment/toolchain-packages.nix',
        'packages/cli/dev-cli/dev-cli-src/environment/portable-profile.nix',
      ]
    ) {
      const result = plan([path])
      Expect(result.everything).toBe(path)
      Expect(result.selected.size).toBe(inventory.packageSuites.length + 3)
      Expect(result.taoAppPaths).toEqual(['Apps'])
    }
  })

  Test('documentation selects nothing', () => {
    const result = plan([
      'Docs/Roadmap/Plan.md',
      'AGENTS.md',
      'packages/cli/dev-cli/README.md',
      'LICENSE',
      '.gitignore',
    ])

    Expect(result.selected.size).toBe(0)
    Expect(result.skipped.length).toBe(inventory.packageSuites.length + 3)
  })

  Test('a path no rule owns widens the run to every suite and names the path', () => {
    const result = plan(['packages/language/parser/parser-tests/Parser.test.ts', 'scripts/mystery.sh'])

    Expect(result.everything).toBe('scripts/mystery.sh')
    Expect(result.selected.size).toBe(inventory.packageSuites.length + 3)
    Expect(result.selected.get('studio')).toBe('scripts/mystery.sh is not mapped to a suite')
    Expect(result.skipped).toEqual([])
    Expect(result.taoAppPaths).toEqual(['Apps'])
  })

  Test('the shared TypeScript configuration and an unknown package directory widen the run', () => {
    Expect(plan(['packages/tsconfig.base.json']).everything).toBe('packages/tsconfig.base.json')
    Expect(plan(['packages/brand-new/brand-new-src/index.ts']).everything).toBe(
      'packages/brand-new/brand-new-src/index.ts',
    )
  })

  Test('selected suites keep the inventory order so the printed plan reads like a run', () => {
    const result = plan(['packages/workspace/workspace-src/index.ts', 'packages/cli/dev-cli/dev-cli-src/dev.ts'])

    // `workspace` is not a language-performance package (only `compiler`, its merged home, is), so
    // this path exercises order across a package suite, two importers, and the app suite — not
    // `performance-checks`, which the compiler-change test above already covers.
    Expect([...result.selected.keys()]).toEqual([
      'cli/dev-cli',
      'studio',
      'cli/tao-cli',
      'workspace',
      'tao-apps',
    ])
  })
})

Describe('package test suite name', () => {
  Test("a test file nested inside a grouped package's -tests directory names the group/package pair", () => {
    Expect(TestSelection.packageTestSuite('packages/ides/studio/studio-tests/code-editor/code-editor-lens.test.ts'))
      .toBe('ides/studio')
  })

  Test("a test file nested inside a top-level package's -tests directory names that package alone", () => {
    Expect(TestSelection.packageTestSuite('packages/compiler/compiler-tests/workspace/workspace.test.ts'))
      .toBe('compiler')
  })

  Test('a test file directly inside a -tests directory still resolves, grouped or not', () => {
    Expect(TestSelection.packageTestSuite('packages/shared/shared-tests/FS.test.ts')).toBe('shared')
    Expect(TestSelection.packageTestSuite('packages/apps/runtime/TR-tests/TR.test.ts')).toBe('apps/runtime')
  })

  Test('a test file inside a package nested two groups deep names all three segments', () => {
    Expect(TestSelection.packageTestSuite(
      'packages/apps/providers/icloud/icloud-tests/icloud-native.test.ts',
    )).toBe('apps/providers/icloud')
  })
})
