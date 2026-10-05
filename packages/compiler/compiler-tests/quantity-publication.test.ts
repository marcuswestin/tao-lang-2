import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import type { CompiledFile } from '../compiler-src/compiler'

const measure = `type Measure is numeric with {
  units { Seconds 1 (default), Minutes 60 }
}`

Describe('compiler: quantity publication', () => {
  Test('executes Tao and native construction through one leaf without a native initialization cycle', async () => {
    await withTaoFiles('tao-compiled-quantity-publication-', {
      'Main.tao': `${measure}
        public let InTao = 2 Minutes
        public function Make() returns Measure { return Make() from ./Native.ts }
        public let FromNative = Make()
        app Demo { id "com.tao.quantity" version "1.0.0" name "Quantity" view Main }
        view Main() from ./View.tsx
      `,
      'Native.ts': `import { types, type Measure } from './Main.tao'
        export const initial = types.Measure.Minutes(2)
        export function Make(): Measure { return initial }
      `,
      'View.tsx': 'export function Main() { return null }',
    }, async (paths, root) => {
      const result = await Workspace.compile(paths['Main.tao'])
      const file = result.validation.files.find(file => file.path === paths['Main.tao'])
      Assert.defined(file, 'compiled quantity fixture retains its source AST')
      const surface = BridgeMetadata.quantitySurfaceFor(file.ast)
      Assert.defined(surface, 'compiled quantity fixture publishes its surface')
      const row = surface.declarations.find(row => row.declaration.name === 'Measure')
      Assert.defined(row, 'compiled quantity fixture has its exact owner linkage')
      const leaves = result.files.filter(file => file.relativePath.endsWith('.quantities.ts'))
      Expect(leaves).toHaveLength(1)
      const leaf = leaves[0]!
      Expect(leaf.code).toContain('@runtime/TR-quantity-values')
      const native = result.files.find(file => file.relativePath.endsWith('Native.ts'))
      Assert.defined(native, 'compiled quantity fixture emits its native module')
      Expect(native.code).toContain('App.quantities')
      Expect(native.code).not.toContain('from "./App"')
      await writeCompiledGraph(result.files, root)
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import { InTao, FromNative } from './out/App.js'
        import { ${row.factoryExport} as Factory, ${surface.namespaceExport} as types } from './out/${
          leaf.relativePath.replace(/\.ts$/, '.js')
        }'
        import { initial } from './out/${native.relativePath.replace(/\.ts$/, '.js')}'
        import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }
        const tao = InTao.evaluate()
        const native = FromNative.evaluate()
        Platform.runtimeConsole.info(JSON.stringify({
          tao: Factory.read(tao), native: Factory.read(native),
          nativeIdentity: native === initial,
          constructors: types.${row.constructorMember}.Minutes(2).getJSValue(),
        }))
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(execution.stdout)).toEqual({
        tao: { canonical: 120, unit: 'Minutes' },
        native: { canonical: 120, unit: 'Minutes' },
        nativeIdentity: true,
        constructors: 120,
      })
    })
  })

  Test('executes mutually forwarding compiled leaves from either entry order', async () => {
    await withTaoFiles('tao-compiled-quantity-cycle-', {
      'Left.tao': `use package ./ as Local
        public ${measure.replace('Measure', 'LeftMeasure')}
        type RightAlias = Local.RightMeasure
      `,
      'Right.tao': `use package ./ as Local
        public ${measure.replace('Measure', 'RightMeasure')}
        type LeftAlias = Local.LeftMeasure
      `,
      'Native.ts': `import { types as left } from './Left.tao'
        import { types as right } from './Right.tao'
        export const first = right.LeftAlias.Minutes(2)
        export const second = left.RightAlias.Seconds(3)
        export function Home() { return null }
      `,
      'Main.tao': `app Demo { id "com.tao.quantity.cycle" version "1.0.0" name "Cycle" view Home }
        view Home() from ./Native.ts
      `,
    }, async (paths, root) => {
      const result = await Workspace.compile(paths['Main.tao'])
      const leaves = result.files.filter(file => file.relativePath.endsWith('.quantities.ts'))
      Expect(leaves).toHaveLength(2)
      const leafFor = (name: 'Left' | 'Right') => {
        const leaf = leaves.find(file => file.sourcePath === paths[`${name}.tao`])
        Assert.defined(leaf, 'the compiled cycle retains both leaves')
        const file = result.validation.files.find(file => file.path === leaf.sourcePath)
        Assert.defined(file, 'the compiled cycle retains its validated AST')
        const surface = BridgeMetadata.quantitySurfaceFor(file.ast)
        Assert.defined(surface, 'the compiled cycle has exact publication metadata')
        return { leaf, surface }
      }
      const left = leafFor('Left')
      const right = leafFor('Right')
      await writeCompiledGraph(result.files, root)
      for (const generated of result.files) {
        await FS.writeText(FS.resolvePath(`types-out/${generated.relativePath}`, root), generated.code)
      }
      const companion = result.files.find(file =>
        file.sourcePath === paths['Left.tao'] && file.relativePath.endsWith('.d.ts')
      )
      Assert.defined(companion, 'the compiled cycle emits its native declaration companion')
      const typedConsumer = FS.resolvePath('Types.ts', root)
      const typedSource = `
        import type { ${left.surface.facadeNamespaceExport} as Contracts } from './types-out/${companion.relativePath}'
        import { ${left.surface.namespaceExport} as left } from './types-out/${left.leaf.relativePath}'
        import { ${right.surface.namespaceExport} as right } from './types-out/${right.leaf.relativePath}'
        export const same: Contracts.LeftMeasure = right.LeftAlias.Minutes(2)
        export const alias: Contracts.RightAlias = right.RightMeasure.Seconds(3)
      `
      await FS.writeText(typedConsumer, typedSource)
      const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['bun'],
        lib: ['lib.es2023.d.ts'],
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowSyntheticDefaultImports: true,
        allowImportingTsExtensions: true,
        jsx: ts.JsxEmit.React,
        paths: {
          '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
          react: [FS.resolvePath('packages/apps/runtime/node_modules/@types/react/index.d.ts', Repo.getRoot())],
        },
      }
      const typeDiagnostics = () =>
        ts.getPreEmitDiagnostics(ts.createProgram([typedConsumer], options))
          .map(diagnostic => ({
            code: diagnostic.code,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          }))
      Expect(typeDiagnostics()).toEqual([])
      await FS.writeText(
        typedConsumer,
        `${typedSource}\nexport const wrong: Contracts.LeftMeasure = left.RightAlias.Seconds(3)`,
      )
      Expect(typeDiagnostics().map(diagnostic => diagnostic.code)).toEqual([2719])
      for (const entry of ['Left', 'Right'] as const) {
        const first = entry === 'Left' ? left : right
        const second = entry === 'Left' ? right : left
        const program = FS.resolvePath(`Cycle${entry}.ts`, root)
        await FS.writeText(
          program,
          `
          await import('./out/${first.leaf.relativePath.replace(/\.ts$/, '.js')}')
          await import('./out/${second.leaf.relativePath.replace(/\.ts$/, '.js')}')
          const left = await import('./out/${left.leaf.relativePath.replace(/\.ts$/, '.js')}')
          const right = await import('./out/${right.leaf.relativePath.replace(/\.ts$/, '.js')}')
          import * as Platform from ${
            JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
          }
          Platform.runtimeConsole.info(JSON.stringify({
            left: left.${left.surface.namespaceExport}.LeftMeasure === right.${right.surface.namespaceExport}.LeftAlias,
            right: right.${right.surface.namespaceExport}.RightMeasure === left.${left.surface.namespaceExport}.RightAlias,
            value: right.${right.surface.namespaceExport}.LeftAlias.Minutes(2).getJSValue(),
          }))
        `,
        )
        const execution = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [program],
          cwd: root,
          processPolicy: 'test',
        })
        Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
        Expect(JSON.parse(execution.stdout)).toEqual({ left: true, right: true, value: 120 })
      }
    })
  })

  Test('reaches a private alias owner without copying its unrelated provider', async () => {
    await withTaoFiles('tao-compiled-quantity-private-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
      'Library/@ui/Widget.tsx': `import { types } from './Private.tao'
        export const initial = types.Measure.Minutes(2)
        export function Widget() { return null }
      `,
      'Library/@ui/Private.tao': `use package @owners as Canonical
        type Measure = Canonical.Measure
      `,
      'Library/@owners/Owner.tao': `public ${measure}
        type UnusedSource is datasource with {
          StorageKey text
          supports { }
          provider MemoryProvider from ./Providers.ts
        }
      `,
      'Library/@owners/Providers.ts': "import 'undeclared-unused-package'\nexport const MemoryProvider = 42",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Package.tao':
        'package { version 1.0.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }',
      'Consumer/Main.tao': `use Widget from @widgets
        app Demo { id "com.tao.quantity.private" version "1.0.0" name "Private"
          requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets }
          view Home
        }
        view Home() { render Widget() }
      `,
    }, async (paths, root) => {
      const result = await Workspace.compile(paths['Consumer/Main.tao'])
      const leaves = result.files.filter(file => file.relativePath.endsWith('.quantities.ts'))
      Expect(leaves).toHaveLength(2)
      const ownerLeaf = leaves.find(file => file.sourcePath === paths['Library/@owners/Owner.tao'])
      const aliasLeaf = leaves.find(file => file.sourcePath === paths['Library/@ui/Private.tao'])
      Assert.defined(ownerLeaf, 'compiled private alias retains its canonical owner leaf')
      Assert.defined(aliasLeaf, 'compiled private alias retains its forwarding leaf')
      Expect(aliasLeaf.code).not.toContain('unique symbol')
      Expect(ownerLeaf.code.match(/: unique symbol/g)).toHaveLength(1)
      Expect(ownerLeaf.relativePath).toContain('modules/dependencies/')
      Expect(result.files.some(file => file.relativePath.endsWith('Providers.ts'))).toBe(false)
      await writeCompiledGraph(result.files, root)
      const ownerFile = result.validation.files.find(file => file.path === paths['Library/@owners/Owner.tao'])
      const aliasFile = result.validation.files.find(file => file.path === paths['Library/@ui/Private.tao'])
      Assert.defined(ownerFile, 'compiled private owner has its source AST')
      Assert.defined(aliasFile, 'compiled private alias has its source AST')
      const owner = BridgeMetadata.quantitySurfaceFor(ownerFile.ast)!.declarations[0]!
      const alias = BridgeMetadata.quantitySurfaceFor(aliasFile.ast)!.declarations[0]!
      const native = result.files.find(file => file.relativePath.endsWith('Widget.tsx'))
      Assert.defined(native, 'compiled private alias retains its native consumer')
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import { ${owner.factoryExport} as Factory } from './out/${ownerLeaf.relativePath.replace(/\.ts$/, '.js')}'
        import { ${alias.factoryExport} as AliasFactory } from './out/${aliasLeaf.relativePath.replace(/\.ts$/, '.js')}'
        import { initial } from './out/${native.relativePath.replace(/\.tsx$/, '.js')}'
        import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }
        Platform.runtimeConsole.info(JSON.stringify({ same: Factory === AliasFactory, reading: Factory.read(initial) }))
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(execution.stdout)).toEqual({ same: true, reading: { canonical: 120, unit: 'Minutes' } })
    })
  })
})

async function writeCompiledGraph(files: readonly CompiledFile[], root: string): Promise<void> {
  for (const generated of files) {
    if (generated.relativePath.endsWith('.d.ts')) {
      continue
    }
    const path = FS.resolvePath(`out/${generated.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`, root)
    await FS.writeText(
      path,
      ts.transpileModule(generated.code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
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
}
