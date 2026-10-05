import { CLI, Diagnostic, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { CheckCache } from '../cli-src/check-cache'
import { runCheck, runFix } from '../cli-src/source-commands'
import { CANONICAL_VIEW, checkedWorkspaces, TWO_WORKSPACES } from './helpers/check-cache-fixtures'
import { withGitTaoFixture, withTaoFixture } from './test-cli-files'

/**
 * `tao check` skips a workspace whose inputs are byte-identical to the ones behind its last clean
 * check. Every test here is about the one question that makes that safe: does the input set really
 * cover what a verdict depends on. The fixtures give the stamp its own repository root, which is
 * both where it is written and the boundary outside which nothing is ever stamped — so these runs
 * cannot touch the checkout's own stamp, and the checkout's stamp cannot answer them.
 */

Describe('tao check per-workspace stamp', () => {
  Test('checks a no-project temp file without entering an unreadable sibling', async () => {
    const rootDir = await mkTestDir('tao-check-unreadable-sibling-', { location: 'host' })
    const deniedRoot = FS.resolvePath('denied', rootDir)
    try {
      const appPath = FS.resolvePath('fixture/App.tao', rootDir)
      await FS.writeText(appPath, CANONICAL_VIEW)
      await FS.writeText(FS.resolvePath('Secret.txt', deniedRoot), 'private\n')
      // Isolate the filesystem fault: module mocks must not leak into the other check fixtures.
      const probe = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [FS.resolvePath('fixtures/check-unreadable-sibling.ts', import.meta.dir), rootDir],
        processPolicy: 'test',
      })
      Expect({ exitCode: probe.exitCode, stderr: probe.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const { results, traversedByCheck, deniedByWalk } = JSON.parse(probe.stdout) as {
        results: Awaited<ReturnType<typeof runCheck>>
        traversedByCheck: string[]
        deniedByWalk: string[]
      }
      Expect(traversedByCheck).not.toContain('denied')
      Expect(deniedByWalk).toEqual(['denied'])
      const app = results.find(result => result.path === appPath)
      Expect(app?.error).toBeUndefined()
      Expect(results.flatMap(result => result.diagnostics ?? []).some(Diagnostic.isError)).toBe(true)
      Expect(
        results.flatMap(result => result.diagnostics ?? [])
          .some(diagnostic => diagnostic.message.includes('No Tao project marker')),
      ).toBe(true)
    } finally {
      await FS.remove(rootDir)
    }
  })

  Test('checks a standalone file at a Git root containing a directory symlink', async () => {
    await withGitTaoFixture(
      { 'App.tao': CANONICAL_VIEW, 'linked/Sidecar.ts': 'export const value = 1\n' },
      async rootDir => {
        const linkPath = FS.resolvePath('directory-link', rootDir)
        await FS.symlink('linked', linkPath)
        Expect(await Repo.filesUnder(rootDir)).toContain(linkPath)
        Expect(await CheckCache.open({ repositoryRoot: rootDir })).toBeDefined()
        const results = await runCheck('App.tao', { cwd: rootDir, cache: { repositoryRoot: rootDir } })

        Expect(results.map(result => FS.relativePath(rootDir, result.path))).toContain('App.tao')
      },
    )
  })

  Test('regenerates deleted metadata for an imported bridge on a targeted cached check', async () => {
    await withGitTaoFixture({
      'App/.gitignore': '/.tao-ts/\n/.tao/local/\n/.tao/cache/\nnode_modules/\n',
      'App/.tao/.gitkeep': '',
      'App/Main.tao': `use CountWords from ./Bridge.tao

function Total() returns number {
   return CountWords("hello")
}
`,
      'App/Bridge.tao': `public function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`,
      'App/Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async rootDir => {
      const main = FS.resolvePath('App/Main.tao', rootDir)
      const metadata = FS.resolvePath('App/.tao-ts/Bridge.tao.ts', rootDir)
      await runFix(FS.resolvePath('App', rootDir))
      const first = await runCheck(main, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(first.map(result => result.status)).toEqual(['unchanged'])
      Expect(await FS.isFile(metadata)).toBe(true)
      Expect(await checkedWorkspaces(rootDir, main)).toEqual({ App: 'replayed' })
      await FS.remove(metadata)
      Expect(await checkedWorkspaces(rootDir, main)).toEqual({ App: 'checked' })
      Expect(await FS.isFile(metadata)).toBe(true)
    })
  })

  Test('re-checks only the workspace whose Tao source changed', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/Main.tao', rootDir),
        'use Text from @tao/ui\n\nview MainView() {\n   render Text("Goodbye")\n}\n',
      )

      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('invalidates a clean verdict when root configuration or the shared lock changes', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
      await FS.writeText(
        FS.resolvePath('AppOne/tsconfig.json', rootDir),
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n',
      )
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      await FS.writeText(FS.resolvePath('AppOne/.tao/store/lock.jsonc', rootDir), '{"schemaVersion":1}\n')
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('re-checks a workspace when a file is added beside the ones it was asked about', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/Second.tao', rootDir),
        'use Text from @tao/ui\n\nview SecondView() {\n   render Text("Second")\n}\n',
      )

      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('re-checks a workspace when a TypeScript sidecar beside its declarations changed', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'AppOne/@ui/Shell.ts': 'export const shell = 1\n' },
      async rootDir => {
        await checkedWorkspaces(rootDir)
        await FS.writeText(FS.resolvePath('AppOne/@ui/Shell.ts', rootDir), 'export const shell = 2\n')

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test('re-checks every workspace when the Tao stdlib changed', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'packages/apps/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n' },
      async rootDir => {
        await checkedWorkspaces(rootDir)
        await FS.writeText(FS.resolvePath('packages/apps/stdlib/@tao/ui/Shell.ts', rootDir), 'export const shell = 2\n')

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
      },
    )
  })
})
