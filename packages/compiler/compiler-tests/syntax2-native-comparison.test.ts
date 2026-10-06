import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'

Describe('compiler: Syntax2 native comparison result', () => {
  Test('admits actual CompareTitles names as declaration-owned Comparison cases', async () => {
    const appRoot = Repo.resolvePath('Apps/Syntax2')
    const result = await Workspace.compile(FS.resolvePath('Main.tao', appRoot))
    const libraryPath = FS.resolvePath('library/Library.tao', appRoot)
    const nativePath = FS.resolvePath('library/Library.ts', appRoot)
    const corePath = Repo.resolvePath('packages/apps/stdlib/@tao/core/Core.tao')
    const library = result.validation.files.find(file => file.path === libraryPath)
    Assert.defined(library, 'the actual Library declarations are compiled')
    const title = library.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Title')
    Expect.Is(title, AST.isTypeDeclaration)
    const witness = associatedWitnessExports(library.ast).get(title)
    Assert.defined(witness, 'the actual Title associated witness is published')
    const moduleFor = (path: string) =>
      result.files.find(file => file.sourcePath === path && !file.relativePath.endsWith('.d.ts'))
    const libraryModule = moduleFor(libraryPath)
    const nativeModule = moduleFor(nativePath)
    const coreModule = moduleFor(corePath)
    Assert.defined(libraryModule, 'the actual Library module is emitted')
    Assert.defined(nativeModule, 'the real CompareTitles adapter is emitted')
    Assert.defined(coreModule, 'the actual Comparison declaration is emitted')

    await withTaoFiles('tao-syntax2-native-comparison-', {}, async (_paths, root) => {
      const outputPath = (path: string) => `out/${path.replace(/\.[cm]?tsx?$/, '.js')}`
      for (const generated of result.files) {
        if (!generated.relativePath.endsWith('.d.ts')) {
          await FS.writeText(
            FS.resolvePath(outputPath(generated.relativePath), root),
            ts.transpileModule(
              generated.code,
              {
                compilerOptions: {
                  target: ts.ScriptTarget.ES2022,
                  module: ts.ModuleKind.ESNext,
                  jsx: ts.JsxEmit.React,
                },
              },
            ).outputText,
          )
        }
      }
      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {
        compilerOptions: {
          paths: {
            '@runtime/*': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/*')],
            '@tao/runtime': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts')],
            react: [Repo.resolvePath('packages/apps/runtime/node_modules/react/index.js')],
          },
        },
      })
      const nativeImport = FS.resolvePath(outputPath(nativeModule.relativePath), root)
      const program = FS.resolvePath('CheckComparison.ts', root)
      await FS.writeText(
        program,
        `
        import { MockModule } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))}
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        const native = await import(${JSON.stringify(nativeImport)})
        const actualCompareTitles = native.CompareTitles
        const actualAddScores = native.AddScores
        let invalidName: string | undefined
        let nativeCalls = 0
        MockModule(${JSON.stringify(nativeImport)}, () => ({
          AddScores: actualAddScores,
          CompareTitles: (left: string, right: string) => {
            nativeCalls++
            return invalidName ?? actualCompareTitles(left, right)
          },
        }))
        MockModule('react-native', () => ({
          ActivityIndicator: 'ActivityIndicator', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView',
          Platform: { OS: 'ios' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch',
          Text: 'Text', TextInput: 'TextInput', View: 'View', Button: 'Button',
        }))
        const [library, core] = await Promise.all([
          import(${JSON.stringify(FS.resolvePath(outputPath(libraryModule.relativePath), root))}),
          import(${JSON.stringify(FS.resolvePath(outputPath(coreModule.relativePath), root))}),
        ])
        const compare = (left: string, right: string) =>
          TR.Call(library[${JSON.stringify(witness)}].Compare, TR.Value(left), TR.Value(right)).evaluate().jsValue
        const results = [compare('A', 'B'), compare('A', 'A'), compare('B', 'A')]
        const expected = ['less', 'equal', 'greater']
        const identities = results.map((value, index) => value === core.Comparison[expected[index]].evaluate().jsValue)
        const caseNames = results.map(value => value.caseName)
        const declaration = core.Comparison.less.evaluate().jsValue.declaration
        const ownership = results.every(value => value.declaration === declaration && typeof value.identity === 'symbol')
        const rejectionMessages: string[] = []
        for (const name of ['outside-comparison', 'constructor']) {
          invalidName = name
          try { compare('A', 'B') } catch (error) { rejectionMessages.push(error.message) }
        }
        runtimeConsole.info(JSON.stringify({ identities, caseNames, ownership, nativeCalls, rejectionMessages }))
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(execution.stdout)).toEqual({
        identities: [true, true, true],
        caseNames: ['less', 'equal', 'greater'],
        ownership: true,
        nativeCalls: 5,
        rejectionMessages: Array(2).fill('The native result must name a declared case of its Tao return type.'),
      })
    })
  })
})
