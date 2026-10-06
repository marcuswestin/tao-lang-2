import { AST } from '@parser'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { testParseSyntax } from '../../language/parser/parser-tests/test-parse'
import { type QuantityNativeImportTarget, rewriteQuantityNativeImports } from '../compiler-src/quantity-native-imports'
import { QuantityNativeModule } from '../compiler-src/quantity-native-module'

const target: QuantityNativeImportTarget = {
  modulePath: '/out/Owner.tsx',
  declarationsPath: '/out/Owner.d.ts',
  quantity: {
    path: '/out/Owner.quantities.ts',
    namespaceExport: 'types',
    facadeNamespaceExport: 'types_1',
    typeExportsByName: new Map([['Reading', '__ReadingValue']]),
  },
}
const rewrite = (source: string) =>
  rewriteQuantityNativeImports(
    source,
    '/src/Native.ts',
    '/out/native/Native.ts',
    path => path === '/src/Owner.tao' ? target : undefined,
  )

Describe('native quantity import routing', () => {
  Test('splits constructors and exact quantity types while retaining native contracts and defaults', () => {
    const result = rewrite(
      `import Default, { types_1 as Units, type Reading as Value, type NativeContract, Run } from './Owner.tao';`,
    )
    Expect(result).toBe(
      'import { types as Units, type __ReadingValue as Value } from "../Owner.quantities"; import Default, { type NativeContract, Run } from "../Owner";',
    )
    Expect(ts.transpileModule(result, { reportDiagnostics: true }).diagnostics).toEqual([])
  })

  Test('routes namespace construction directly without changing shadowed lexical values', () => {
    const result = rewrite(`import * as Owner from './Owner.tao';
const First = Owner.types_1.Reading.Base(2);
type Value = Owner.Reading;
function Shadow(Owner: any) { return Owner.types_1.Reading.Base(3); }
`)
    Expect(result).toContain('from "../Owner.quantities";')
    Expect(result).not.toContain('from "../Owner";')
    Expect(result).toContain('const First = __TaoQuantity_Owner_types.Reading.Base(2);')
    Expect(result).toContain('type Value = __TaoQuantity_Owner___ReadingValue;')
    Expect(result).toContain('return Owner.types_1.Reading.Base(3);')
    Expect(result.split('\n')).toHaveLength(5)
  })

  Test('keeps nonquantity namespace reads and avoids generated alias collisions', () => {
    const result = rewrite(`import * as Owner from './Owner.tao';
const __TaoQuantity_Owner_types = 1;
const First = Owner.types_1.Reading.Base(2);
const Later = () => Owner.Run();
`)
    Expect(result).toContain('types as __TaoQuantity_Owner_types_1')
    Expect(result).toContain('import * as Owner from "../Owner";')
    Expect(result).toContain('const Later = () => Owner.Run();')
    Expect(result).toContain('const First = __TaoQuantity_Owner_types_1.Reading.Base(2);')
  })

  Test('retains namespace bindings used by shorthand properties and local exports', () => {
    for (const use of ['const Box = { Owner };', 'export { Owner };', 'export { Owner as Forwarded };']) {
      const result = rewrite(`import * as Owner from './Owner.tao';
const First = Owner.types_1.Reading.Base(2);
${use}
`)
      Expect(result).toContain('import * as Owner from "../Owner";')
      Expect(result).toContain(use)
    }
    const shadow = rewrite(`import * as Owner from './Owner.tao';
const First = Owner.types_1.Reading.Base(2);
function Shadow(Owner: any) { return { Owner }; }
`)
    Expect(shadow).not.toContain('from "../Owner";')
    Expect(shadow).toContain('return { Owner };')
  })

  Test('keeps pure type imports erased and ignores unrelated sources', () => {
    const result = rewrite(`import type { Reading, NativeContract } from './Owner.tao';
import type { Reading as Other } from './Other.tao';`)
    Expect(result).toContain('import type { __ReadingValue as Reading } from "../Owner.quantities";')
    Expect(result).toContain('import type { NativeContract } from "../Owner";')
    Expect(result).toContain("import type { Reading as Other } from './Other.tao';")
    Expect(ts.transpileModule(result, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).not.toContain(
      'import ',
    )
  })

  Test('preserves authored lines when splitting multiline imports and selectors', () => {
    const source = `import {
  types_1 as Units,
  type Reading
} from './Owner.tao';
const Here = 2;
`
    const result = rewrite(source)
    Expect(result.split('\n').indexOf('const Here = 2;')).toBe(4)
    Expect(result.split('\n')).toHaveLength(source.split('\n').length)
    const bracket = rewrite(`import * as Owner from './Owner.tao';\nconst Here = Owner['types_1'].Reading.Base(2);`)
    Expect(bracket).toContain('__TaoQuantity_Owner_types.Reading.Base(2)')
    Expect(bracket).not.toContain('from "../Owner";')
  })

  Test('executes native initialization through the checked leaf without loading the Tao module', async () => {
    const source = 'type Reading is number'
    await withTaoFiles('tao-quantity-import-routing-', { 'Owner.tao': source }, async (_paths, root) => {
      const parsed = await testParseSyntax(source)
      const owner = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
      Assert.defined(owner, 'the native import fixture declares its quantity owner')
      const runtimeRoot = FS.resolvePath('packages/apps/runtime', Repo.getRoot())
      const leaf = QuantityNativeModule.emit({
        owners: [{
          owner,
          units: [{ name: 'Seconds', scale: 1 }, { name: 'Minutes', scale: 60 }],
          defaultUnit: 'Seconds',
        }],
        outputPath: FS.resolvePath('Owner.quantities.ts', root),
        runtimeRoot,
      })
      // Supplied owner metadata is the boundary here; semantic discovery belongs to publication proof.
      await FS.writeText(
        leaf.path.replace(/\.ts$/, '.js'),
        ts.transpileModule(leaf.code, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      )
      await FS.writeText(
        FS.resolvePath('Owner.js', root),
        `
        import { ErrorControls } from ${JSON.stringify(FS.resolvePath('TaoRuntime-src/TR-errors.ts', runtimeRoot))}
        ErrorControls.failInput('Native construction loaded the Tao module.')
      `,
      )
      const native = `import * as Owner from './Owner.tao';
        import * as Platform from ${
        JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
      };
        const First = Owner.types_1.Reading.Minutes(2);
        function Shadow(Owner: any) { return Owner.types_1.Reading.Minutes(3); }
        const shadow = Shadow({ types_1: { Reading: { Minutes: (value: number) => value + 1000 } } });
        Platform.runtimeConsole.info(JSON.stringify({ canonical: First.getJSValue(), shadow }));
      `
      const nativePath = FS.resolvePath('Native.ts', root)
      const routed = rewriteQuantityNativeImports(
        native,
        nativePath,
        nativePath,
        path =>
          path === FS.resolvePath('Owner.tao', root)
            ? {
              ...target,
              modulePath: FS.resolvePath('Owner.js', root),
              quantity: { ...target.quantity, path: leaf.path },
            }
            : undefined,
      )
      const executable = nativePath.replace(/\.ts$/, '.js')
      await FS.writeText(
        executable,
        ts.transpileModule(routed, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      )
      const run = await CLI.run(Platform.runtimeProcess.execPath, {
        cwd: root,
        args: [executable],
        processPolicy: 'test',
      })
      Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(run.stdout)).toEqual({ canonical: 120, shadow: 1003 })
    })
  })

  Test('executes retained shorthand and exported namespace bindings beside routed construction', async () => {
    await withTaoFiles(
      'tao-quantity-retained-namespace-',
      { 'Owner.tao': 'type Reading is number' },
      async (_, root) => {
        await FS.writeText(FS.resolvePath('Owner.js', root), 'export const Marker = "retained";')
        // This fixture isolates namespace preservation; checked construction execution is proved above.
        await FS.writeText(
          FS.resolvePath('Owner.quantities.js', root),
          'export const types = { Reading: { Base: value => value * 60 } };',
        )
        const nativePath = FS.resolvePath('Native.ts', root)
        for (
          const use of [
            { body: 'export const Box = { Owner };', binding: 'Box', namespace: 'Box.Owner' },
            { body: 'export { Owner };', binding: 'Owner as Forwarded', namespace: 'Forwarded' },
            { body: 'export { Owner as Forwarded };', binding: 'Forwarded', namespace: 'Forwarded' },
          ]
        ) {
          const native = `import * as Owner from './Owner.tao';
export const First = Owner.types_1.Reading.Base(2);
${use.body}
export function Shadow(Owner: any) { return { Owner }; }
`
          const routed = rewriteQuantityNativeImports(
            native,
            nativePath,
            nativePath,
            path =>
              path === FS.resolvePath('Owner.tao', root)
                ? {
                  ...target,
                  modulePath: FS.resolvePath('Owner.js', root),
                  quantity: { ...target.quantity, path: FS.resolvePath('Owner.quantities.ts', root) },
                }
                : undefined,
          )
          await FS.writeText(
            FS.resolvePath('Native.js', root),
            ts.transpileModule(routed, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText,
          )
          const consumer = FS.resolvePath('Consumer.js', root)
          await FS.writeText(
            consumer,
            `import { First, Shadow, ${use.binding} } from './Native.js';
import * as Expected from './Owner.js';
import * as Platform from ${JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))};
Platform.runtimeConsole.info(JSON.stringify({
  first: First, marker: ${use.namespace}.Marker, same: ${use.namespace} === Expected, shadow: Shadow("local").Owner,
}));`,
          )
          const run = await CLI.run(Platform.runtimeProcess.execPath, {
            cwd: root,
            args: [consumer],
            processPolicy: 'test',
          })
          Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
          Expect(JSON.parse(run.stdout)).toEqual({ first: 120, marker: 'retained', same: true, shadow: 'local' })
        }
      },
    )
  })
})
