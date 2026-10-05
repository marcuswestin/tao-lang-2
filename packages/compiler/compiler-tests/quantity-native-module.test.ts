import { AST } from '@parser'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { testParseSyntax } from '../../language/parser/parser-tests/test-parse'
import {
  type QuantityNativeLinkage,
  QuantityNativeModule,
  type QuantityNativeModuleOutput,
  type QuantityNativeOwner,
} from '../compiler-src/quantity-native-module'

const nativeOptions: ts.CompilerOptions = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
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
}

const units = [{ name: 'Seconds', scale: 1 }, { name: 'Minutes', scale: 60 }] as const
const runtimeRoot = FS.resolvePath('packages/apps/runtime', Repo.getRoot())

async function parseOwners(source: string): Promise<readonly QuantityNativeOwner[]> {
  // Unit metadata is supplied by the caller; this leaf does not resolve the numeric contract.
  const parsed = await testParseSyntax(source)
  return parsed.entry.ast.statements.filter(AST.isTypeDeclaration).map(owner => ({
    owner,
    units,
    defaultUnit: 'Seconds',
  }))
}

function linkage(output: QuantityNativeModuleOutput, owner: QuantityNativeOwner): QuantityNativeLinkage {
  const result = output.linkageByOwner.get(owner.owner)
  Assert.defined(result, 'the emitted leaf links its original owner identity')
  return result
}

function runtimeImport(module: string): string {
  return JSON.stringify(FS.resolvePath(`TaoRuntime-src/${module}.ts`, runtimeRoot))
}

async function writeLeaf(output: QuantityNativeModuleOutput): Promise<void> {
  await FS.writeText(output.path, output.code)
  await FS.writeText(
    output.path.replace(/\.ts$/, '.js'),
    ts.transpileModule(output.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
  )
}

function diagnostics(path: string): readonly ts.Diagnostic[] {
  return ts.getPreEmitDiagnostics(ts.createProgram([path], nativeOptions))
}

function diagnosticSummary(path: string): readonly Readonly<{ code: number; message: string; file?: string }>[] {
  return diagnostics(path).map(diagnostic => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    file: diagnostic.file?.fileName,
  }))
}

Describe('compiler: quantity native module', () => {
  Test('executes constructors and the single checked factory through real runtime wrappers', async () => {
    const source = 'type Measure is numeric\ntype Ratio is numeric'
    await withTaoFiles('tao-quantity-native-runtime-', { 'Main.tao': source }, async (_paths, root) => {
      const owners = await parseOwners(source)
      const [measure, ratio] = owners
      Assert.defined(measure, 'the fixture declares Measure')
      Assert.defined(ratio, 'the fixture declares Ratio')
      const emitted = QuantityNativeModule.emit({
        owners,
        outputPath: FS.resolvePath('Quantity.ts', root),
        runtimeRoot,
      })
      const [siblingOwner] = await parseOwners('type Measure is numeric')
      Assert.defined(siblingOwner, 'the sibling declares another Measure owner')
      Expect(siblingOwner.owner).not.toBe(measure.owner)
      const sibling = QuantityNativeModule.emit({
        owners: [siblingOwner],
        outputPath: FS.resolvePath('Sibling.ts', root),
        runtimeRoot,
      })
      await writeLeaf(emitted)
      await writeLeaf(sibling)
      const measureLink = linkage(emitted, measure)
      const ratioLink = linkage(emitted, ratio)
      const siblingLink = linkage(sibling, siblingOwner)
      const consumer = [
        `import { ${emitted.namespaceExport} as types, ${measureLink.factoryExport} as Measure, ${ratioLink.factoryExport} as Ratio } from './Quantity.js'`,
        `import { ${siblingLink.factoryExport} as Sibling } from './Sibling.js'`,
        `import { reactiveValue, copyValue as CopyRuntime, createWritableCell } from ${
          runtimeImport('TR-reactive-values')
        }`,
        `import { TaoActionFailure } from ${runtimeImport('TR-errors')}`,
        `import { QuantityFailureCases } from ${runtimeImport('TR-quantity-values')}`,
        `import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }`,
        `const constructed = types.${measureLink.constructorMember}.Minutes(2)`,
        "const direct = Measure.fromUnit(2, 'Minutes')",
        "const selected = Measure.inUnit(constructed, 'Seconds')",
        'const wrapped = reactiveValue(constructed.jsValue)',
        'const copied = reactiveValue(CopyRuntime(wrapped.evaluate().jsValue))',
        'const nested = CopyRuntime({ Amount: constructed.jsValue })',
        'const cell = createWritableCell(copied)',
        'const before = Measure.read(cell.evaluate())',
        "cell.set(Measure.inUnit(constructed, 'Seconds'))",
        'const throughArgument = (value: typeof constructed) => value.evaluate()',
        'function failure(body: () => unknown): string {',
        '  try { body(); return "not rejected" }',
        '  catch (error) { return error instanceof TaoActionFailure ? error.caseName : "wrong failure" }',
        '}',
        'Platform.runtimeConsole.info(JSON.stringify({',
        '  members: Object.keys(types),',
        `  constructors: Object.keys(types.${measureLink.constructorMember}),`,
        '  constructed: Measure.read(constructed), direct: Measure.read(direct),',
        '  selected: Measure.read(selected), canonicalInput: Measure.read(Measure.fromJSValue(120)),',
        '  native: constructed.getJSValue(), copiedNative: copied.getJSValue(), cellNative: cell.getJSValue(),',
        '  copyIdentity: copied.jsValue === constructed.jsValue, nestedIdentity: nested.Amount === constructed.jsValue,',
        '  before, after: Measure.read(throughArgument(cell.evaluate())),',
        '  nested: Measure.read(reactiveValue(nested.Amount)),',
        '  wrongOwners: [',
        '    failure(() => Measure.read(Ratio.fromJSValue(120) as unknown as typeof constructed)),',
        "    failure(() => Measure.inUnit(Ratio.fromJSValue(120) as unknown as typeof constructed, 'Seconds')),",
        '    failure(() => Measure.read(Sibling.fromJSValue(120) as unknown as typeof constructed)),',
        "    failure(() => Measure.inUnit(Sibling.fromJSValue(120) as unknown as typeof constructed, 'Seconds')),",
        '  ], expectedFailure: QuantityFailureCases.DomainMismatch,',
        '}))',
      ].join('\n')
      const consumerPath = FS.resolvePath('Consumer.ts', root)
      await FS.writeText(consumerPath, consumer)
      await FS.writeText(
        consumerPath.replace(/\.ts$/, '.js'),
        ts.transpileModule(consumer, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      )
      const run = await CLI.run(Platform.runtimeProcess.execPath, {
        cwd: root,
        args: [consumerPath.replace(/\.ts$/, '.js')],
        processPolicy: 'test',
      })
      Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(run.stdout)).toEqual({
        members: ['Measure', 'Ratio'],
        constructors: ['Seconds', 'Minutes'],
        constructed: { canonical: 120, unit: 'Minutes' },
        direct: { canonical: 120, unit: 'Minutes' },
        selected: { canonical: 120, unit: 'Seconds' },
        canonicalInput: { canonical: 120, unit: 'Seconds' },
        native: 120,
        copiedNative: 120,
        cellNative: 120,
        copyIdentity: true,
        nestedIdentity: true,
        before: { canonical: 120, unit: 'Minutes' },
        after: { canonical: 120, unit: 'Seconds' },
        nested: { canonical: 120, unit: 'Minutes' },
        wrongOwners: [
          'QuantityDomainMismatch',
          'QuantityDomainMismatch',
          'QuantityDomainMismatch',
          'QuantityDomainMismatch',
        ],
        expectedFailure: 'QuantityDomainMismatch',
      })
    })
  })

  Test('retains nominal owner types through native construction, copies, cells and return contracts', async () => {
    const source = 'type Measure is numeric\ntype Ratio is numeric'
    await withTaoFiles('tao-quantity-native-types-', { 'Main.tao': source }, async (_paths, root) => {
      const owners = await parseOwners(source)
      const [measure, ratio] = owners
      Assert.defined(measure, 'the fixture declares Measure')
      Assert.defined(ratio, 'the fixture declares Ratio')
      const emitted = QuantityNativeModule.emit({
        owners,
        outputPath: FS.resolvePath('Quantity.ts', root),
        runtimeRoot,
      })
      const [siblingOwner] = await parseOwners('type Measure is numeric')
      Assert.defined(siblingOwner, 'the sibling declares another Measure owner')
      Expect(siblingOwner.owner).not.toBe(measure.owner)
      const sibling = QuantityNativeModule.emit({
        owners: [siblingOwner],
        outputPath: FS.resolvePath('Sibling.ts', root),
        runtimeRoot,
      })
      await writeLeaf(emitted)
      await writeLeaf(sibling)
      const measureLink = linkage(emitted, measure)
      const ratioLink = linkage(emitted, ratio)
      const siblingLink = linkage(sibling, siblingOwner)
      const baseline = [
        `import { ${emitted.namespaceExport} as types, ${measureLink.factoryExport} as Measure, ${ratioLink.factoryExport} as Ratio, type ${measureLink.valueTypeExport} as MeasureValue } from './Quantity.js'`,
        `import { ${siblingLink.factoryExport} as Sibling } from './Sibling.js'`,
        `import { reactiveValue, copyValue as CopyRuntime, createWritableCell } from ${
          runtimeImport('TR-reactive-values')
        }`,
        `export const value: types.${measureLink.typeMember} = types.${measureLink.constructorMember}.Minutes(2)`,
        'export const other = Ratio.fromJSValue(120)',
        'export const sibling = Sibling.fromJSValue(120)',
        "export const direct: MeasureValue = Measure.fromUnit(2, 'Minutes')",
        'export const wrapped: MeasureValue = reactiveValue(value.jsValue)',
        'export const copied: MeasureValue = reactiveValue(CopyRuntime(wrapped.evaluate().jsValue))',
        'export const cell = createWritableCell(copied)',
        "cell.set(Measure.inUnit(value, 'Seconds'))",
        'export const read = Measure.read(cell.evaluate())',
        'export const canonical: number = cell.getJSValue()',
        'export function sameOwner(input: MeasureValue): MeasureValue { return input.evaluate() }',
      ].join('\n')
      const consumerPath = FS.resolvePath('Native.ts', root)
      await FS.writeText(consumerPath, baseline)
      Expect(diagnosticSummary(consumerPath)).toEqual([])
      const rejected = [
        'Measure.read(other)',
        "Measure.inUnit(other, 'Seconds')",
        'export function wrongReturn(): MeasureValue { return other }',
        'Measure.read(sibling)',
        'Measure.read(reactiveValue(120))',
        "Measure.fromUnit(2, 'Hours')",
        `types.${measureLink.constructorMember}.fromJSValue(120)`,
      ]
      const expectedErrors = rejected.flatMap(line => ['// @ts-expect-error nominal or constructor boundary', line])
        .join('\n')
      await FS.writeText(consumerPath, `${baseline}\n${expectedErrors}\n`)
      Expect(diagnosticSummary(consumerPath)).toEqual([])
      // Removing the directives proves every negative check reaches a real diagnostic.
      await FS.writeText(consumerPath, `${baseline}\n${rejected.join('\n')}\n`)
      const failures = diagnostics(consumerPath)
      Expect(failures.map(diagnostic => diagnostic.code)).toEqual([2345, 2345, 2322, 2345, 2345, 2345, 2339])
      Expect(failures.map(diagnostic => {
        Assert.defined(diagnostic.file, 'the native type error names a source file')
        Assert.defined(diagnostic.start, 'the native type error has a source position')
        Expect(diagnostic.file.fileName).toBe(consumerPath)
        const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
        return diagnostic.file.text.split('\n')[line]
      })).toEqual(rejected)
    })
  })

  Test(
    'allocates colliding names deterministically and executes computed constructor keys with owner mappings',
    async () => {
      const names = [
        'types',
        '__quantityMakeType',
        '__quantityFreeze',
        '__q0Owner',
        '__q0ValueExport',
        '__q0FactoryExport',
        'Object',
        'class',
        '__proto__',
        'eval',
        'arguments',
      ]
      const source = names.map(name => `type ${name} is numeric`).join('\n')
      await withTaoFiles('tao-quantity-native-names-', {
        'Main.tao': source,
        '.runtime/TaoRuntime-src/TR-quantity-values.ts': `export * from ${runtimeImport('TR-quantity-values')}`,
        '.runtime/TaoRuntime-src/TR-reactive-values.ts': `export * from ${runtimeImport('TR-reactive-values')}`,
      }, async (_paths, root) => {
        const parsed = await parseOwners(source)
        const owners = parsed.map(entry => ({
          ...entry,
          units: [{ name: 'read', scale: 1 }, { name: 'fromJSValue', scale: 60 }, { name: '__proto__', scale: 2 }],
          defaultUnit: 'read',
        }))
        const options = {
          owners,
          outputPath: FS.resolvePath('Quantity.ts', root),
          runtimeRoot: FS.resolvePath('.runtime', root),
          reservedNames: ['types_1', '__q0FactoryExport_1'],
        }
        const emitted = QuantityNativeModule.emit(options)
        const repeated = QuantityNativeModule.emit(options)
        Expect(repeated.code).toBe(emitted.code)
        Expect([...repeated.linkageByOwner]).toEqual([...emitted.linkageByOwner])
        Expect(repeated.sourceMappings).toEqual(emitted.sourceMappings)
        Expect(emitted.namespaceExport).toBe('types_2')
        Expect(emitted.linkageByOwner.size).toBe(names.length)
        const exports = [
          emitted.namespaceExport,
          ...[...emitted.linkageByOwner.values()].flatMap(link => [link.factoryExport, link.valueTypeExport]),
        ]
        Expect(new Set(exports).size).toBe(exports.length)
        for (const name of [...names, ...options.reservedNames]) {
          Expect(exports).not.toContain(name)
        }
        const generatedLines = emitted.code.split('\n')
        for (const [index, owner] of owners.entries()) {
          const link = linkage(emitted, owner)
          Expect(link.owner).toBe(owner.owner)
          const expectedMember = new Map([
            ['__proto__', '__proto___1'],
            ['class', 'class_'],
            ['eval', 'eval_1'],
            ['arguments', 'arguments_1'],
          ]).get(owner.owner.name) ?? owner.owner.name
          Expect(link.constructorMember).toBe(expectedMember)
          const mappings = emitted.sourceMappings.filter(mapping => mapping.source.start.line === index)
          Expect(mappings.length).toBeGreaterThan(0)
          Assert.defined(owner.owner.$cstNode, 'a quantity fixture has an authored source range')
          for (const mapping of mappings) {
            Expect(mapping.source).toEqual(owner.owner.$cstNode.range)
            const line = generatedLines[mapping.generated.start.line]
            Assert.defined(line, 'a quantity mapping points to a generated line')
            Expect(mapping.generated).toEqual({
              start: { line: mapping.generated.start.line, character: 0 },
              end: { line: mapping.generated.start.line, character: line.length },
            })
          }
          Expect(
            mappings.some(mapping =>
              generatedLines[mapping.generated.start.line]?.includes(` as ${link.factoryExport} }`)
            ),
          ).toBe(true)
          Expect(
            mappings.some(mapping =>
              generatedLines[mapping.generated.start.line]?.includes(`export const ${link.constructorMember} =`)
            ),
          ).toBe(true)
        }
        await writeLeaf(emitted)
        const consumer = [
          `import { ${emitted.namespaceExport} as types, ${
            owners.map((owner, index) => `${linkage(emitted, owner).factoryExport} as Factory${index}`).join(', ')
          } } from './Quantity.js'`,
          `import * as Platform from ${
            JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
          }`,
          'export const results = [',
          ...owners.map((owner, index) => {
            const link = linkage(emitted, owner)
            return `{ keys: Object.keys(types.${link.constructorMember}), read: Factory${index}.read(types.${link.constructorMember}.read(3)), fromJSValue: Factory${index}.read(types.${link.constructorMember}.fromJSValue(2)), prototype: Factory${index}.read(types.${link.constructorMember}["__proto__"](4)), canonical: Factory${index}.read(Factory${index}.fromJSValue(5)) },`
          }),
          ']',
          'Platform.runtimeConsole.info(JSON.stringify(results))',
        ].join('\n')
        const consumerPath = FS.resolvePath('Native.ts', root)
        await FS.writeText(consumerPath, consumer)
        Expect(diagnosticSummary(consumerPath)).toEqual([])
        await FS.writeText(
          consumerPath.replace(/\.ts$/, '.js'),
          ts.transpileModule(consumer, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText,
        )
        const run = await CLI.run(Platform.runtimeProcess.execPath, {
          cwd: root,
          args: [consumerPath.replace(/\.ts$/, '.js')],
          processPolicy: 'test',
        })
        Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
        Expect(JSON.parse(run.stdout)).toEqual(names.map(() => ({
          keys: ['read', 'fromJSValue', '__proto__'],
          read: { canonical: 3, unit: 'read' },
          fromJSValue: { canonical: 120, unit: 'fromJSValue' },
          prototype: { canonical: 8, unit: '__proto__' },
          canonical: { canonical: 5, unit: 'read' },
        })))
      })
    },
  )
})
