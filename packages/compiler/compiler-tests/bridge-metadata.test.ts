import { Packages, Type } from '@ast-utils'
import { AST, Langium, type ModuleOrigin, Parser } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { compileRuntimeType } from '../compiler-src/codegen/react-native/app/runtime-type-compiler'
import { Workspace } from '../compiler-src/workspace'

Describe('compiler: generated TypeScript contracts', () => {
  Test('keeps abstract numeric families opaque and publishes factories only for concrete descendants', async () => {
    const parsed = await Parser.parseCode(
      `
      public abstract type Family is numeric
      public type Span is Family with { units { seconds 1 (default), minutes 60 } }
      func Inspect(Value Family) fails never -> text { return NativeInspect(Value) from ./Native.ts }
      func NativeInspect(Value Family) fails never -> text { return "" }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const family = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Family')
    const span = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Span')
    Expect.Is(family, AST.isTypeDeclaration)
    Expect.Is(span, AST.isTypeDeclaration)
    Expect(Langium.toString(compileRuntimeType(Type.ofDefinition(family)))).toBe('TR.Value<TR.QuantityPayload>')
    Expect(Langium.toString(compileRuntimeType(Type.ofDefinition(span)))).toBe('TR.Value<TR.QuantityPayload>')
    const surface = BridgeMetadata.quantitySurfaceFor(parsed.entry.ast)
    Expect(surface?.declarations.map(row => row.declaration.name)).toEqual(['Span'])
    const module = BridgeMetadata.collect([parsed.entry], FS.dirname(parsed.entry.path))[0]!
    Expect(module.code).toContain('(arg0: TR.Value<TR.QuantityPayload>) => string')
    Expect(module.quantityModule?.code).toContain('export const Span')
    Expect(module.quantityModule?.code).not.toContain('export const Family')
  })

  Test('checks native associated methods and converters against their actual return contracts', async () => {
    const parsed = await Parser.parseCode(
      `
      type Source is text with {
        func ToText() fails never -> text { return NativeText(Source) from ./Host.ts }
        static func Create(Value text) fails never -> Source { return NativeSource(Value) from ./Host.ts }
        Source as Target fails Invalid { return NativeTarget(Source) from ./Host.ts }
      }
      type Target is text
      func NativeText(Source) -> text { return Source }
      func NativeSource(Value text) -> Source { return Source Value }
      func NativeTarget(Source) -> Target { return Target "" }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const module = BridgeMetadata.collect([parsed.entry], FS.dirname(parsed.entry.path))
      .find(item => item.sourcePath === parsed.entry.path)
    Expect(module?.code).toContain('(arg0: string) => string')
    Expect(module?.code).toContain('typeof Sidecar.NativeText')
    Expect(module?.code).toContain('typeof Sidecar.NativeSource')
    Expect(module?.code).toContain('typeof Sidecar.NativeTarget')
    const bridges = AST.streamAllContents(parsed.entry.ast).filter(AST.isFromExpression)
    Expect(bridges.map(bridge => Type.displayName(BridgeMetadata.bridgeResultType(bridge)!))).toEqual([
      'text',
      'Source',
      'Target',
    ])
    const converter = AST.streamAllContents(parsed.entry.ast).find(AST.isAssociatedConverterDeclaration)
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    Expect(module?.sourceMappings.some(mapping => mapping.source.start.line === converter.$cstNode?.range.start.line))
      .toBe(true)
  })

  Test('publishes erased case signatures from an unselected dependency file', async () => {
    await withTaoFiles('tao-bridge-private-case-', {
      'Main.tao': 'type HapticKind is one of Light, Heavy',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const selectedStatementsBySourcePath = new Map([[paths['Main.tao']!, []]])
      const module = BridgeMetadata.collect(validation.files, root, new Map(), { selectedStatementsBySourcePath })
        .find(item => item.sourcePath === paths['Main.tao'])
      Expect(module?.code).toContain(
        'export declare const HapticKind: Readonly<Record<"Light" | "Heavy", TR.Value<any>>>',
      )
      Expect(module?.implementationPaths).toEqual([])
      Expect(module?.code).not.toContain('TR.Enum(')
    })
  })

  Test('plans a hidden contract with exact Tao source locations and leaves publication to the caller', async () => {
    await withTaoFiles('tao-bridge-contract-', {
      'Main.tao': `app Demo { id "com.tao.demo" version "1.0.0-beta.1" name "Demo" view Main }
action Read() returns text from ./Bindings.ts
view Main() { render inject \`\`\`ts return null \`\`\` }`,
      'Bindings.ts': 'export const Read = () => "ok"',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const module = BridgeMetadata.collect(validation.files, root).find(module =>
        module.sourcePath === paths['Main.tao']
      )
      Expect(module).toBeDefined()
      Expect(module?.path).toBe(FS.resolvePath('.tao-ts/Main.tao.ts', root))
      Expect(module?.code).toContain('import type * as Sidecar from "../Bindings"')
      Expect(module?.code).toContain('// Source: ../Main.tao:2:1')
      Expect(module?.code).toContain('__TaoBridgeCheck<Read, typeof Sidecar.Read>')
      const sourceLine = module?.sourceMappings.find(mapping =>
        module.code.split('\n')[mapping.generated.start.line]?.includes('__TaoBridgeCheck<Read, typeof Sidecar.Read>')
      )
      Expect(sourceLine?.source).toEqual({
        start: { line: 1, character: 0 },
        end: { line: 1, character: 45 },
      })
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Main.tao.ts', root))).toBe(false)
    })
  })

  Test('imports runtime contract types from the selected runtime root', async () => {
    await withTaoFiles('tao-bridge-runtime-root-', {
      'Main.tao': `app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Main }
view Main() from ./View.tsx`,
      'View.tsx': 'export function Main() { return null }',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const runtimeRoot = FS.resolvePath('sdk/runtime', root)
      const module = BridgeMetadata.collect(validation.files, root, new Map(), { runtimeRoot })
        .find(item => item.sourcePath === paths['Main.tao'])
      Expect(module?.code).toContain('import type TR from "../sdk/runtime/TaoRuntime-src/TR"')
    })
  })

  Test('keeps a dependency contract and its implementation in the same origin namespace', async () => {
    await withTaoFiles('tao-bridge-dependency-', {
      'Main.tao': `app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Main }
action Read() returns text from ./Bindings.ts
view Main() { render inject \`\`\`ts return null \`\`\` }`,
      'Bindings.ts': 'export const Read = () => "ok"',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      const origin: ModuleOrigin = {
        projectRoot: root,
        modulePath: root,
        packageName: 'fixtures',
        packageVersion: '1.0.0',
      }
      const consumer = FS.resolvePath('consumer', root)
      const modules = BridgeMetadata.collect(validation.files, consumer, new Map([[paths['Main.tao']!, origin]]))
      const module = modules.find(module => module.sourcePath === paths['Main.tao'])
      Expect(module).toBeDefined()
      Expect(module?.path).toBe(`${BridgeMetadata.dependencySnapshotPath(consumer, paths['Main.tao']!, origin)}.ts`)
      Expect(module?.implementationPaths).toEqual([{
        sourcePath: paths['Bindings.ts'],
        path: BridgeMetadata.dependencySnapshotPath(consumer, paths['Bindings.ts']!, origin),
      }])
      Expect(BridgeMetadata.dependencySnapshotPath(consumer, paths['Bindings.ts']!, {
        ...origin,
        packageName: 'another-publication',
        packageVersion: '3.0.0',
      })).toBe(BridgeMetadata.dependencySnapshotPath(consumer, paths['Bindings.ts']!, origin))
      Expect(module?.code).toContain('import type * as Sidecar from "./Bindings"')
    })
  })

  Test('uses an explicit nested-project origin before filesystem containment', async () => {
    await withTaoFiles('tao-bridge-nested-origin-', {
      'Child/.tao/.gitkeep': '',
      'Child/Main.tao': `app Demo { id "com.tao.nested" version "1.0.0" name "Nested" view Main }
action Read() returns text from ./Words.ts
view Main() { render inject \`\`\`ts return null \`\`\` }`,
      'Child/Words.ts': 'export const Read = () => "ok"',
    }, async (paths, root) => {
      const childRoot = FS.resolvePath('Child', root)
      const validation = await (await Workspace.open(childRoot)).validate(paths['Child/Main.tao']!)
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const origin: ModuleOrigin = { projectRoot: childRoot, modulePath: childRoot }
      const module = BridgeMetadata.collect(validation.files, root, new Map([[paths['Child/Main.tao']!, origin]]))
        .find(item => item.sourcePath === paths['Child/Main.tao'])
      Expect(module?.path).toBe(`${BridgeMetadata.dependencySnapshotPath(root, paths['Child/Main.tao']!, origin)}.ts`)
      Expect(module?.implementationPaths).toEqual([{
        sourcePath: paths['Child/Words.ts'],
        path: BridgeMetadata.dependencySnapshotPath(root, paths['Child/Words.ts']!, origin),
      }])
      Expect(module?.code).toContain('import type * as Sidecar from "./Words"')
    })
  })

  Test('finds implementation sidecars only in an app declaration closure', async () => {
    await withTaoFiles('tao-bridge-app-closure-', {
      'Main.tao': `
        app Selected { id "com.tao.selected" version "1.0.0" name "Selected" view SelectedView }
        app Sibling { id "com.tao.sibling" version "1.0.0" name "Sibling" view SiblingView }
        view SelectedView() from ./Selected.tsx
        view SiblingView() from ./Sibling.tsx
      `,
      'Selected.tsx': 'export function SelectedView() { return null }',
      'Sibling.tsx': 'export function SiblingView() { return null }',
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      Expect(validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const context = await Packages.createContext(root)
      const graph = Packages.createResolver(context).projectGraph({
        fromFilePath: paths['Main.tao']!,
        workspaceFiles: validation.files.map(file => file.ast),
      })
      const selected = graph.appRequirements.find(entry => entry.app.name === 'Selected')!
      Expect(BridgeMetadata.implementationSidecarRoots(selected.sourceDeclarations)).toEqual([
        paths['Selected.tsx'],
      ])
    })
  })
})
