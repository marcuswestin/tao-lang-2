import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'

Describe('compiler: associated witnesses across source modules', () => {
  for (const visibility of ['use all', 'folder'] as const) {
    Test(
      `executes inherited and own implementations under ${visibility} runtime import collisions`,
      async () => {
        const libraryPath = visibility === 'use all' ? 'Library/Token.tao' : 'Token.tao'
        const exportedVisibility = visibility === 'use all' ? 'public' : 'folder'
        await withTaoFiles('tao-associated-private-witness-', {
          'Main.tao': `
        ${visibility === 'use all' ? 'use all from ./Library' : ''}
        let __tao_associated_import_1__ = "authored collision"
        type Local is text with { func ToText() -> text { return Local } }
        let Own = Local " local"
        public func Read(Value Child, Token text) -> text {
          return Value.ToText() + Own.ToText() + __tao_associated_witness_1__
        }
        public let Result = Read(Child "expected", "shadow")
        app Demo { id "com.tao.associated.witness" version "1.0.0" name "Witness" view Home }
        view Home() from ./Native.tsx
      `,
          [libraryPath]: `
        file type Token is text with { func ToText() -> text { return Token } }
        ${exportedVisibility} type Child is Token
        ${exportedVisibility} let __tao_associated_witness_1__ = " imported"
      `,
          'Native.tsx': 'export function Home() { return null }',
        }, async (paths, root) => {
          const result = await (await Workspace.open(root)).compile(paths['Main.tao'])
          const main = result.files.find(file =>
            file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
          )
          const library = result.files.find(file =>
            file.sourcePath === paths[libraryPath] && file.relativePath.endsWith('.tsx')
          )
          Assert.defined(main, 'the compiled witness consumer is emitted')
          Assert.defined(library, 'the defining private witness source is retained')
          Expect(main.code).toContain('as __tao_associated_import_1__1')
          Expect(main.code).toContain('export { __tao_associated_witness_1__1 }')
          Expect(library.code).toContain('export { __tao_associated_witness_1__1 }')
          Expect(library.code).not.toContain('export const Token')
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
        import { Result } from './out/App.js'
        import * as Platform from ${
              JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
            }
        Platform.runtimeConsole.info(JSON.stringify(Result.getJSValue()))
      `,
          )
          const execution = await CLI.run(Platform.runtimeProcess.execPath, {
            args: [program],
            cwd: root,
            processPolicy: 'test',
          })
          Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
          Expect(JSON.parse(execution.stdout)).toBe('expected local imported')
        })
      },
    )
  }
})
