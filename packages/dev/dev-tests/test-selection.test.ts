import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { PackageGraph } from '../dev-src/repository-tests/PackageGraph'
import { type SuiteInventory, TestSelection } from '../dev-src/repository-tests/TestSelection'

/**
 * A small workspace with the shapes the real one has: a leaf everything imports (`shared`), a
 * chain (`parser` -> `compiler` -> `workspace`), the CLI the Tao behavior tests run through, and a
 * package nothing imports (`studio`).
 */
const graph: PackageGraph = {
  imports: new Map<string, ReadonlySet<string>>([
    ['compiler', new Set(['parser', 'shared'])],
    ['dev', new Set(['shared'])],
    ['parser', new Set(['shared'])],
    ['runtime', new Set()],
    ['runtime-toolchain', new Set(['runtime', 'shared'])],
    ['shared', new Set()],
    ['stdlib', new Set(['shared'])],
    ['studio', new Set(['shared', 'workspace'])],
    ['tao-cli', new Set(['dev', 'workspace'])],
    ['workspace', new Set(['compiler'])],
  ]),
  packages: [
    'compiler',
    'dev',
    'parser',
    'runtime',
    'runtime-toolchain',
    'shared',
    'stdlib',
    'studio',
    'tao-cli',
    'workspace',
  ],
}

const inventory: SuiteInventory = {
  hasPerformanceChecks: true,
  hasRuntimeJest: true,
  hasTaoApps: true,
  packageSuites: [
    'compiler',
    'dev',
    'parser',
    'runtime',
    'runtime-toolchain',
    'shared',
    'stdlib',
    'studio',
    'tao-cli',
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
      'tao-cli',
      'workspace',
      'performance-checks',
      'tao-apps',
    ])
    Expect(result.selected.get('compiler')).toBe('changed directly')
    Expect(result.selected.get('workspace')).toBe('imports compiler')
    Expect(result.selected.get('studio')).toBe('imports workspace')
    // The CLI compiles the Tao behavior tests, so a change reaching it reaches every app.
    Expect(result.taoAppPaths).toEqual(['Apps'])
    Expect(result.skipped).toContain('runtime-jest')
    Expect(result.skipped).toContain('dev')
    Expect(result.everything).toBeUndefined()
  })

  Test('a leaf package nothing imports selects only its own suite', () => {
    const result = plan(['packages/studio/studio-src/client/Editor.ts'])

    Expect([...result.selected.keys()]).toEqual(['studio'])
    Expect(result.skipped.length).toBe(inventory.packageSuites.length + 2)
  })

  Test('a changed test file selects only the suite that runs it', () => {
    Expect([...plan(['packages/shared/shared-tests/FS.test.ts']).selected.keys()]).toEqual(['shared'])
    Expect([...plan(['packages/runtime-toolchain/runtime-toolchain-tests/nav.jest-test.tsx']).selected.keys()])
      .toEqual(['runtime-jest'])
    Expect([...plan(['packages/dev/performance-checks/language-performance.test.ts']).selected.keys()])
      .toEqual(['performance-checks'])
  })

  Test('runtime and toolchain sources reach the Jest suite and every Tao app', () => {
    const result = plan(['packages/runtime/TaoRuntime-src/TR.ts'])

    Expect(result.selected.get('runtime-jest')).toBe('imports runtime')
    Expect(result.selected.get('tao-apps')).toBe('runtime changed directly')
    Expect(result.taoAppPaths).toEqual(['Apps'])
  })

  Test('an app change runs the Tao behavior tests under that app only', () => {
    const result = plan([
      'Apps/WordFlower/1 - Current/Tests/Login.tao',
      'Apps/Skillet/Skillet.tao',
      'Apps/WordFlower/README.md',
    ])

    Expect([...result.selected.keys()]).toEqual(['tao-apps'])
    Expect(result.taoAppPaths).toEqual(['Apps/Skillet', 'Apps/WordFlower'])
    Expect(result.selected.get('tao-apps')).toBe('Apps/Skillet changed, Apps/WordFlower changed')
  })

  Test('a Tao file outside Apps and packages widens the app run to every app', () => {
    Expect(plan(['Docs/Tutorials/example.tao']).taoAppPaths).toEqual(['Apps'])
    Expect(plan(['Apps/WordFlower/Design.tao', 'packages/stdlib/stdlib-src/Text.tao']).taoAppPaths).toEqual(['Apps'])
  })

  Test('repository workflow files select the developer suite that proves them', () => {
    for (
      const path of [
        'Justfile',
        'agent',
        '.rulesync/permissions.jsonc',
        'agents/skills/git-workflow/SKILL.md',
        'config/dprint.jsonc',
      ]
    ) {
      const result = plan([path])
      Expect(result.selected.get('dev')).toBe('changed directly')
      Expect(result.everything).toBeUndefined()
    }
    // `tao-cli` imports `dev`, so a workflow change also reaches the CLI and, through it, the apps.
    Expect(plan(['Justfile']).selected.get('tao-cli')).toBe('imports dev')
  })

  Test('documentation selects nothing', () => {
    const result = plan(['Docs/Roadmap/Plan.md', 'AGENTS.md', 'packages/dev/README.md', 'LICENSE', '.gitignore'])

    Expect(result.selected.size).toBe(0)
    Expect(result.skipped.length).toBe(inventory.packageSuites.length + 3)
  })

  Test('a path no rule owns widens the run to every suite and names the path', () => {
    const result = plan(['packages/parser/parser-tests/Parser.test.ts', 'scripts/mystery.sh'])

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
    const result = plan(['packages/workspace/workspace-src/index.ts', 'packages/dev/dev-src/dev.ts'])

    Expect([...result.selected.keys()]).toEqual([
      'dev',
      'studio',
      'tao-cli',
      'workspace',
      'performance-checks',
      'tao-apps',
    ])
  })
})
