import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

async function libraryFiles() {
  const root = FS.resolvePath('packages/apps/stdlib/@tao', Repo.getRoot())
  return {
    'core/Quantity.tao': await FS.readText(FS.resolvePath('core/Quantity.tao', root)),
    'core/Quantity.ts': await FS.readText(FS.resolvePath('core/Quantity.ts', root)),
    'time/Durations.tao': await FS.readText(FS.resolvePath('time/Durations.tao', root)),
    'time/Durations.ts': await FS.readText(FS.resolvePath('time/Durations.ts', root)),
    'View.tsx': 'export function Home() { return null }',
  }
}

Describe('compiler: Time.Now standard library', () => {
  Test('captures fixed epoch-millisecond snapshots from the runtime test clock', async () => {
    await withTaoFiles('tao-time-now-stdlib-', {
      ...await libraryFiles(),
      'Main.tao': `use Time from ./time/Durations
        public func Snapshot() -> time { return Time.Now() }
        app Demo { id "com.tao.time.now" version "1.0.0" name "Time Now" view Home }
        view Home() from ./View.tsx`,
    }, async (paths, root) => {
      const result = await Workspace.compile(paths['Main.tao'])
      Expect(result.validation.files.some(file => file.path === paths['core/Quantity.tao'])).toBe(true)
      Expect(result.validation.files.some(file => file.path === paths['time/Durations.tao'])).toBe(true)
      for (const generated of result.files) {
        if (generated.relativePath.endsWith('.d.ts')) {
          continue
        }
        await FS.writeText(
          FS.resolvePath(`out/${generated.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`, root),
          ts.transpileModule(generated.code, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.React,
            },
          }).outputText,
        )
      }
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
              react: [FS.resolvePath('packages/apps/runtime/node_modules/react/index.js', Repo.getRoot())],
            },
          },
        }),
      )
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import * as App from './out/App.js'
        import TR from '@runtime/TR'
        import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }
        TR.Clock.beginTest(1700000000000)
        try {
          const first = TR.Call(App.Snapshot)
          const firstReading = first.getJSValue()
          TR.Clock.advance(1250)
          const readings = [firstReading, first.getJSValue(), TR.Call(App.Snapshot).getJSValue()]
          Platform.runtimeConsole.info(JSON.stringify(readings))
        } finally { TR.Clock.endTest() }
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Assert(execution.exitCode === 0, `Time.Now execution failed: ${execution.stderr}`)
      Expect(JSON.parse(execution.stdout)).toEqual([1700000000000, 1700000000000, 1700000001250])
    }, { location: 'worktree' })
  })
})
