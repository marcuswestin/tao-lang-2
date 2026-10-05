import { Diagnostic, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { type CheckWorkspaceOutcome, runCheck } from '../cli-src/source-commands'
import { checkedWorkspaces, TWO_WORKSPACES } from './helpers/check-cache-fixtures'
import { withGitTaoFixture, withTaoFixture } from './test-cli-files'

Describe('tao check per-workspace stamp', () => {
  Test('does not replay a clean verdict through an external extended TypeScript config', async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'AppOne/Sidecar.ts': 'export function answer() { const unused = 1; return 42 }\n',
    }, async rootDir => {
      const sharedConfig = FS.resolvePath('shared/tsconfig.json', rootDir)
      await FS.writeText(sharedConfig, '{"compilerOptions":{"noUnusedLocals":false}}\n')
      await FS.writeText(
        FS.resolvePath('AppOne/tsconfig.json', rootDir),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../shared/tsconfig.json"]}\n',
      )
      const cold = await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: rootDir } })
      Expect(cold.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })

      await FS.writeText(sharedConfig, '{"compilerOptions":{"noUnusedLocals":true}}\n')
      const changed = await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: rootDir } })
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(diagnostic => diagnostic.code === 'TS6133'))
        .toBe(true)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('does not replay through a mutable root node_modules installation', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/node_modules/installed/package.json', rootDir),
        '{"name":"installed","version":"1.0.0"}\n',
      )
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('replays with only the repository-owned runtime link installed', async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'packages/apps/runtime/package.json': '{"name":"@tao/runtime","version":"1.0.0"}\n',
    }, async rootDir => {
      await checkedWorkspaces(rootDir)
      const scope = FS.resolvePath('AppOne/node_modules/@tao', rootDir)
      await FS.mkdir(scope)
      await FS.symlink(FS.resolvePath('packages/apps/runtime', rootDir), FS.resolvePath('runtime', scope))
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
    })
  })

  Test('checks an unmarked external helper after a clean check and reports its type error', async () => {
    await withGitTaoFixture({
      'App/.tao/.gitkeep': '',
      'App/Main.tao': 'view Main() from ../Host/Widget.tsx\n',
      'Host/Widget.tsx': `import { value } from './Helper'
export function Main(_props: unknown) { return value.toUpperCase() ? null : null }
`,
      'Host/Helper.ts': "export const value = 'ready'\n",
    }, async rootDir => {
      const app = FS.resolvePath('App', rootDir)
      const first = await runCheck(app, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir, app)).toEqual({ App: 'checked' })

      await FS.writeText(FS.resolvePath('Host/Helper.ts', rootDir), 'export const value = 1\n')
      const outcomes: CheckWorkspaceOutcome[] = []
      const changed = await runCheck(app, {
        cache: { repositoryRoot: rootDir },
        onWorkspace: outcome => outcomes.push(outcome),
      })
      Expect(outcomes.map(outcome => outcome.resolution)).toEqual(['checked'])
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(diagnostic => diagnostic.code === 'TS2339'))
        .toBe(true)
    })
  })

  Test('invalidates a warm verdict when a sidecar directory gains an empty project marker', async () => {
    await withGitTaoFixture({
      'App/.tao/.gitkeep': '',
      'App/Main.tao': 'view Main() from ./Host/Widget.tsx\n',
      'App/Host/Widget.tsx': 'export function Main(_props: unknown) { return null }\n',
    }, async rootDir => {
      const app = FS.resolvePath('App', rootDir)
      const first = await runCheck(app, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir, app)).toEqual({ App: 'replayed' })

      await FS.mkdir(FS.resolvePath('Host/.tao', app))
      const outcomes: CheckWorkspaceOutcome[] = []
      const changed = await runCheck(app, {
        cache: { repositoryRoot: rootDir },
        onWorkspace: outcome => outcomes.push(outcome),
      })
      Expect(outcomes.map(outcome => outcome.resolution)).toEqual(['checked'])
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(Diagnostic.isError)).toBe(true)
    })
  })
})
