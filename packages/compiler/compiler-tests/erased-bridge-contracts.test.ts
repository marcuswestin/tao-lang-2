import { AST } from '@parser'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { Workspace } from '../compiler-src/workspace'

const nativeOptions: ts.CompilerOptions = {
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noEmit: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

Describe('compiler: erased native bridge checks', () => {
  Test('shares explicit contextual result types without guessing untyped native results', async () => {
    await withTaoFiles('tao-bridge-context-', {
      'Main.tao': `
        type Reading is number
        function Read() returns Reading { return Read() from ./Native.ts }
        let Sample is Reading = Sample from ./Native.ts
        type Settings is { Sample Reading is Sample from ./Native.ts }
        let Unknown = Unknown from ./Native.ts
      `,
      'Native.ts': '',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      const errors = validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
      Expect(errors).toHaveLength(1)
      Expect(errors[0]?.nodeType).toBe('FromExpression')
      Expect(errors[0]?.range?.start.line).toBe(4)
      const file = validation.files.find(file => file.path === paths['Main.tao'])
      Assert.defined(file, 'contextual native test source is validated')
      const expressions = [...AST.streamAllContents(file.ast)].filter(AST.isFromExpression)
      Expect(expressions).toHaveLength(4)
      const reading = file.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'Reading'
      )
      Assert.defined(reading, 'the declared nominal native result type exists')
      const results = expressions.map(BridgeMetadata.bridgeResultType)
      for (const result of results.slice(0, 3)) {
        Assert.defined(result, 'explicit native result type is available')
        Expect(BridgeMetadata.resultType(result)).toBe('number')
        Assert(result.kind === 'primitive', 'the native reading has primitive storage')
        Expect(result.nominal).toBe(reading)
      }
      Expect(results[3]).toBeUndefined()
    })
  })

  Test('preserves signature, parameter-count, and result compatibility directions', async () => {
    await withTaoFiles('tao-erased-bridge-types-', {
      'Main.tao': 'action Read(Value text) returns text from ./Native.ts\naction Write(Value text) from ./Native.ts',
      'Native.ts': '',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const companion = BridgeMetadata.collect(validation.files, root).find(item =>
        item.sourcePath === paths['Main.tao']
      )
      Assert.defined(companion, 'native bridge companion is generated')
      await FS.writeText(companion.path, companion.code)
      const fixtures = [
        {
          native: 'export function Read(value: number): string { return String(value) }',
          rejectedChecks: ['__TaoBridgeSignature1'],
        },
        {
          native: 'export function Read(value: string): number { return value.length }',
          rejectedChecks: ['__TaoBridgeSignature1', '__TaoBridgeResult1'],
        },
        {
          native: 'export function Read(): string { return "ok" }',
          rejectedChecks: ['__TaoBridgeArity1'],
        },
        {
          native: 'export function Read(value: string, extra: string): string { return value + extra }',
          rejectedChecks: ['__TaoBridgeSignature1', '__TaoBridgeArity1'],
        },
        {
          native: 'export function Read(value: string): string { return value }',
          write: 'export function Write(value: string): number { return value.length }',
          rejectedChecks: ['__TaoBridgeSignature2', '__TaoBridgeResult2'],
        },
        {
          native: [
            'export function Read(value: string): string',
            'export function Read(value: number): number',
            'export function Read(value: string | number): string | number { return value }',
          ].join('\n'),
          rejectedChecks: ['__TaoBridgeResult1'],
        },
        { native: 'export function Read(value: unknown): "ok" { void value; return "ok" }', rejectedChecks: [] },
        { native: 'export function Read(value?: string): string { return value ?? "ok" }', rejectedChecks: [] },
        {
          native: 'export function Read(value: string, extra?: string): string { return value + (extra ?? "") }',
          rejectedChecks: [],
        },
        { native: 'export function Read(...values: string[]): string { return values.join("") }', rejectedChecks: [] },
        { native: 'export async function Read(value: string): Promise<string> { return value }', rejectedChecks: [] },
      ]
      for (const fixture of fixtures) {
        await FS.writeText(
          paths['Native.ts'],
          `${fixture.native}\n${fixture.write ?? 'export function Write(value: string): void { void value }'}\n`,
        )
        const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([companion.path], nativeOptions))
        const rejectedChecks = diagnostics.map(diagnostic => {
          Assert.defined(diagnostic.file, 'native signature diagnostic names the generated companion')
          Assert.defined(diagnostic.start, 'native signature diagnostic has a generated position')
          Expect(diagnostic.file.fileName).toBe(companion.path)
          const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
          const source = companion.code.split('\n')[line]
          Assert.defined(source, 'native signature diagnostic names an emitted check')
          const name = source.match(/^export type (\S+) =/)?.[1]
          Assert.defined(name, 'native signature diagnostic names a type-only check')
          return name
        })
        Expect(rejectedChecks).toEqual(fixture.rejectedChecks)
        Expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(fixture.rejectedChecks.map(() => 2344))
      }
    })
  })

  Test('keeps generated check names distinct from authored contract names under unused-type checking', async () => {
    const names = [
      '__TaoBridgeCheck',
      '__TaoBridgeCheck_1',
      '__TaoBridgeSignature1',
      '__TaoBridgeArity1',
      '__TaoBridgeResult1',
      'Sidecar',
    ]
    await withTaoFiles('tao-erased-bridge-names-', {
      'Main.tao': names.map(name => `action ${name}() returns text from ./Native.ts`).join('\n'),
      'Native.ts': names.map(name => `export function ${name}(): string { return "ok" }`).join('\n'),
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const companion = BridgeMetadata.collect(validation.files, root).find(item =>
        item.sourcePath === paths['Main.tao']
      )
      Assert.defined(companion, 'native bridge companion is generated')
      await FS.writeText(companion.path, companion.code)
      Expect(ts.getPreEmitDiagnostics(ts.createProgram([companion.path], nativeOptions))).toEqual([])
      for (const name of names) {
        Expect(companion.code).toContain(`export type ${name} = () => string | Promise<string>`)
      }
    })
  })

  Test('loading an emitted companion never loads its sidecar, including a native back-import', async () => {
    const platformImport = `import * as Platform from ${
      JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
    }`
    await withTaoFiles('tao-erased-bridge-load-', {
      'Main.tao': 'action Read() returns text from ./Native.ts',
      'Native.ts': [
        platformImport,
        "import * as Companion from './.tao-ts/Main.tao.js'",
        'Platform.runtimeConsole.info("native initialized")',
        'export function Read(): string { return String(Object.keys(Companion).length) }',
      ].join('\n'),
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao'])
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const companion = BridgeMetadata.collect(validation.files, root).find(item =>
        item.sourcePath === paths['Main.tao']
      )
      Assert.defined(companion, 'native bridge companion is generated')
      const javascript = ts.transpileModule(companion.code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
      }).outputText
      await FS.writeText(companion.path.replace(/\.ts$/, '.js'), javascript)
      await FS.writeText(
        FS.resolvePath('Native.js', root),
        ts.transpileModule(await FS.readText(paths['Native.ts']), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      )
      const run = await CLI.run(Platform.runtimeProcess.execPath, {
        cwd: root,
        args: [
          '-e',
          [
            platformImport,
            "await import('./.tao-ts/Main.tao.js')",
            'Platform.runtimeConsole.info("companion loaded")',
            "const native = await import('./Native.js')",
            'Platform.runtimeConsole.info("native result=" + native.Read())',
          ].join('\n'),
        ],
        processPolicy: 'test',
      })
      Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(run.stdout).toBe('companion loaded\nnative initialized\nnative result=0\n')
      // Keep the import resolver honest: an executable sidecar import must be observable.
      await FS.writeText(companion.path.replace(/\.ts$/, '.js'), `${javascript}\nimport '../Native.js'\n`)
      const mutation = await CLI.run(Platform.runtimeProcess.execPath, {
        cwd: root,
        args: [
          '-e',
          `${platformImport}\nawait import('./.tao-ts/Main.tao.js'); Platform.runtimeConsole.info('companion loaded')`,
        ],
        processPolicy: 'test',
      })
      Expect(mutation.exitCode).toBe(0)
      Expect(mutation.stdout).toBe('native initialized\ncompanion loaded\n')
    })
  })
})
