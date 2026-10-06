import { Packages } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { testParseSyntax } from '../../language/parser/parser-tests/test-parse'
import { CompilerDependencies } from '../compiler-src/compiler-dependencies'
import { Workspace } from '../compiler-src/workspace'

Describe('compiler: dependency environments and sidecar imports', () => {
  Test('selects only explicitly published quantity constructor dependencies', async () => {
    const parsed = await testParseSyntax(`type Measure is number
type Other is number
type Unpublished is number
view Unrelated() from ./Missing.tsx`)
    const declarations = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
    const [measure, other] = declarations
    Expect(declarations.map(declaration => declaration.name)).toEqual(['Measure', 'Other', 'Unpublished'])
    const surface = {
      facadeNamespaceExport: 'types_1',
      declarations: declarations.slice(0, 2).map(declaration => ({ declaration })),
    }
    // Unit discovery is publication-owned. This consumer receives its exact declaration identities.
    const selected = (valueNames: string[], runtimeNamespace = false, metadata = surface) =>
      CompilerDependencies.taoSidecarValueDeclarations(parsed.entry.ast, { valueNames, runtimeNamespace }, metadata)
    for (const result of [selected(['types_1']), selected([], true)]) {
      Expect(result.map(declaration => declaration.name)).toEqual(['Measure', 'Other'])
      Expect([result[0] === measure, result[1] === other]).toEqual([true, true])
    }
    Expect(selected(['types']).map(declaration => declaration.name)).toEqual([])
    Expect(selected(['Unpublished']).map(declaration => declaration.name)).toEqual([])
    Expect(selected(['Unrelated']).map(declaration => declaration.name)).toEqual(['Unrelated'])
    Expect(
      CompilerDependencies.taoSidecarValueDeclarations(parsed.entry.ast, {
        valueNames: ['types_1'],
        runtimeNamespace: true,
      }).map(declaration => declaration.name),
    ).toEqual([])
  })
  Test('keeps overlapping publications independent when checking a shared TypeScript sidecar', async () => {
    await withTaoFiles('tao-compiler-dependency-boundaries-', {
      'Main.tao':
        'app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Home } view Home() { render inject ```ts return null ``` }',
      'P.tao':
        'package { name "P" version 1.0.0 license AGPL-3.0-only includes @ui requires ts npm:date-fns version 4.1.0 as util }',
      'Q.tao': 'package { name "Q" version 1.0.0 license AGPL-3.0-only includes @ui }',
      '@ui/Foo.tao': 'public view Foo() from ./Foo.tsx',
      '@ui/Foo.tsx': "import { format } from 'util/subpath'\nexport function Foo() { return format(0) }",
    }, async (paths, root) => {
      const validation = await (await Workspace.open(root)).validate(paths['Main.tao']!)
      const context = await Packages.createContext(root)
      const graph = Packages.createResolver(context).projectGraph({
        fromFilePath: paths['Main.tao']!,
        workspaceFiles: validation.files.map(file => file.ast),
      })
      const p = graph.publications.find(publication => publication.name === 'P')!
      const q = graph.publications.find(publication => publication.name === 'Q')!
      const sourcePath = paths['@ui/Foo.tsx']!
      const sourceText = FS.readTextSync(sourcePath)
      const check = (requirements: typeof p.requirements, ownerLabel: string) =>
        CompilerDependencies.validateSidecarImports({ sourcePath, sourceText, requirements, ownerLabel })
      Expect(check(p.requirements, 'package P')).toEqual([])
      const qDiagnostics = check(q.requirements, 'package Q')
      Expect(qDiagnostics.map(diagnostic => diagnostic.message)).toEqual([
        "TypeScript import 'util/subpath' used by package Q requires a declared npm dependency.",
      ])
      Expect(qDiagnostics[0]?.range?.start).toEqual({ line: 0, character: 23 })
      Expect(CompilerDependencies.collect(graph, { kind: 'publication', publication: p })[0]?.npm)
        .toEqual([{ alias: 'util', packageName: 'date-fns', versionRange: '4.1.0' }])
      Expect(CompilerDependencies.collect(graph, { kind: 'publication', publication: q })[0]?.npm).toEqual([])
      Expect(CompilerDependencies.collect(graph, { kind: 'project' })[0]?.npm)
        .toEqual([{ alias: 'util', packageName: 'date-fns', versionRange: '4.1.0' }])
    })
  })

  Test('classifies import forms without reading comments or string contents', () => {
    const tick = String.fromCharCode(96)
    const sourceText = [
      "// import 'imaginary'",
      'const prose = "export * from \'imaginary\'"',
      "import { value } from 'util/subpath'",
      "export { value } from './local'",
      "void import('react-native')",
      "const module = require('@tao/runtime/core')",
      'void import(' + tick + 'util/subpath' + tick + ')',
      'void import(' + tick + './He\\u006cper' + tick + ')',
      'void import(' + tick + './\\${literal}' + tick + ')',
    ].join('\n')
    const imports = CompilerDependencies.sidecarImports({ sourcePath: '/project/Sidecar.ts', sourceText })
    Expect(imports.map(item => [item.specifier, item.form, item.kind])).toEqual([
      ['util/subpath', 'static', 'bare'],
      ['./local', 'reexport', 'relative'],
      ['react-native', 'dynamic', 'bare'],
      ['@tao/runtime/core', 'require', 'bare'],
      ['util/subpath', 'dynamic', 'bare'],
      ['./Helper', 'dynamic', 'relative'],
      ['./${literal}', 'dynamic', 'relative'],
    ])
    Expect(imports[0]?.range.start).toEqual({ line: 2, character: 22 })
    Expect(
      CompilerDependencies.validateSidecarImports({
        sourcePath: '/project/Sidecar.ts',
        sourceText: 'void import(' + tick + 'missing-alias' + tick + ')',
        requirements: [],
        ownerLabel: 'package Q',
      }).map(diagnostic => diagnostic.code),
    ).toEqual(['undeclared-npm-import'])
  })

  Test('records computed imports without guessing an alias or relative path', () => {
    const tick = String.fromCharCode(96)
    const sourceText = [
      "void import('./' + part)",
      'void import(' + tick + './${part}' + tick + ')',
      'void import(path)',
      "void import('./literal')",
    ].join('\n')
    const request = { sourcePath: '/project/Sidecar.ts', sourceText }
    Expect(CompilerDependencies.sidecarImports(request).map(item => item.specifier)).toEqual(['./literal'])
    Expect(CompilerDependencies.unresolvedSidecarImports(request).map(item => [item.form, item.range.start.line]))
      .toEqual([['dynamic', 0], ['dynamic', 1], ['dynamic', 2]])
  })

  Test('reports computed module paths with the complete argument range', () => {
    const tick = String.fromCharCode(96)
    const sourceText = [
      "void import('./' + part)",
      'void import(' + tick + './${part}' + tick + ')',
      'require(resolveName(part))',
    ].join('\n')
    const diagnostics = CompilerDependencies.validateSidecarImports({
      sourcePath: '/project/Sidecar.ts',
      sourceText,
      requirements: [],
      ownerLabel: 'app Demo',
    })
    Expect(diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message])).toEqual([
      [
        'computed-sidecar-import',
        'TypeScript import used by app Demo needs a literal module path so its dependency can be checked.',
      ],
      [
        'computed-sidecar-import',
        'TypeScript import used by app Demo needs a literal module path so its dependency can be checked.',
      ],
      [
        'computed-sidecar-import',
        'TypeScript require used by app Demo needs a literal module path so its dependency can be checked.',
      ],
    ])
    Expect(diagnostics.map(diagnostic => diagnostic.range)).toEqual([
      { start: { line: 0, character: 12 }, end: { line: 0, character: 23 } },
      { start: { line: 1, character: 12 }, end: { line: 1, character: 23 } },
      { start: { line: 2, character: 8 }, end: { line: 2, character: 25 } },
    ])
  })

  Test('checks executable requires whose only binding is ambient or type-only', () => {
    for (
      const declaration of [
        'declare const require: (id: string) => unknown;',
        'declare function require(id: string): unknown;',
        'import type { require } from "./Types";',
        'import { type require } from "./Types";',
      ]
    ) {
      const diagnostics = CompilerDependencies.validateSidecarImports({
        sourcePath: '/project/Sidecar.ts',
        sourceText: `${declaration}\nrequire(moduleName)`,
        requirements: [],
        ownerLabel: 'app Demo',
      })
      Expect(diagnostics.filter(diagnostic => diagnostic.code === 'computed-sidecar-import').map(item => item.range))
        .toEqual([{ start: { line: 1, character: 8 }, end: { line: 1, character: 18 } }])
    }
  })

  Test('accepts literal loaders and ignores local require functions and type queries', () => {
    const tick = String.fromCharCode(96)
    const sourceText = [
      "import type { Drawer } from './Drawer.tao'",
      "export { Drawer } from './Drawer.tao'",
      "void import('./Helper')",
      'void import(' + tick + './Helper' + tick + ')',
      "require('./Helper')",
      'type Module = import(moduleName)',
      'interface Api { first: string; second: import(moduleName) }',
      'const object = { require(name: string) { return name } }',
      'object.require(dynamicName)',
      'function local(require: (name: string) => unknown) { require(dynamicName) }',
      'function other() { const require = (name: string) => name; require(dynamicName) }',
      'const arrow = (require: (name: string) => unknown) => require(dynamicName)',
      'const short = require => require(dynamicName)',
      'import { require as localRequire } from "./Helper"',
      'require(dynamicName)',
    ].join('\n')
    const request = { sourcePath: '/project/Sidecar.ts', sourceText, requirements: [], ownerLabel: 'app Demo' }
    Expect(
      CompilerDependencies.validateSidecarImports(request).map(diagnostic => [
        diagnostic.code,
        diagnostic.range?.start.line,
      ]),
    ).toEqual([['computed-sidecar-import', 14]])
    Expect(CompilerDependencies.validateSidecarImports({
      ...request,
      sourceText: "import { require } from './Helper'\nrequire(dynamicName)",
    })).toEqual([])
  })

  Test('keeps named type and runtime intents for Tao sidecar imports', () => {
    const edges = CompilerDependencies.taoSidecarEdges({
      sourcePath: '/project/Widget.tsx',
      sourceText: [
        "import type { SidecarStoreConfig } from './PrivateTypes.tao'",
        "import { type OtherConfig, HapticKind as Kind } from './PrivateTypes.tao'",
        "export type { MoreConfig } from './PrivateTypes.tao'",
        "export { HapticKind } from './PrivateTypes.tao'",
        "void import('./PrivateTypes.tao')",
        "const ordinary = './PrivateTypes.tao'",
      ].join('\n'),
    })
    Expect(edges.map(edge => [edge.typeNames, edge.valueNames, edge.runtimeNamespace])).toEqual([
      [['SidecarStoreConfig'], [], false],
      [['OtherConfig'], ['HapticKind'], false],
      [['MoreConfig'], [], false],
      [[], ['HapticKind'], false],
      [[], [], true],
    ])
    Expect(edges.every(edge => edge.targetPath === '/project/PrivateTypes.tao')).toBe(true)
  })

  Test('reads template expressions without mistaking regexes or JSX text for loaders', () => {
    const tick = String.fromCharCode(96)
    const sourceText = [
      'const pattern = /require(path)|import(moduleName)/',
      'const view = <Text>require(path) import(moduleName)</Text>',
      'const value = ' + tick + '${import(moduleName)} ${require(path)} ${import("./Helper")}' + tick,
      'const active = <Text>{require(path)}</Text>',
    ].join('\n')
    const request = { sourcePath: '/project/Sidecar.tsx', sourceText, requirements: [], ownerLabel: 'app Demo' }
    Expect(CompilerDependencies.unresolvedSidecarImports(request).map(item => [item.form, item.range.start.line]))
      .toEqual([['dynamic', 2], ['require', 2], ['require', 3]])
    Expect(CompilerDependencies.sidecarImports(request).map(item => [item.specifier, item.form]))
      .toEqual([['./Helper', 'dynamic']])
    Expect(CompilerDependencies.validateSidecarImports(request).map(diagnostic => diagnostic.code))
      .toEqual(['computed-sidecar-import', 'computed-sidecar-import', 'computed-sidecar-import'])
  })

  Test('honors destructured, caught, and imported require bindings in their own scopes', () => {
    const request = { sourcePath: '/project/Sidecar.ts', requirements: [], ownerLabel: 'app Demo' }
    const sourceText = [
      'function local(loader: unknown) { const { require } = loader as any; require(path) }',
      'try { work() } catch (require) { require(path) }',
      'const Local = class require { method() { require(path) } }',
      'require(path)',
    ].join('\n')
    Expect(CompilerDependencies.unresolvedSidecarImports({ ...request, sourceText }).map(item => item.range.start.line))
      .toEqual([3])
    Expect(CompilerDependencies.unresolvedSidecarImports({
      ...request,
      sourceText: "import { loader as require } from './Helper'\nrequire(path)",
    })).toEqual([])
  })

  Test('retains literal import type queries as dependency edges', () => {
    const request = {
      sourcePath: '/project/Sidecar.ts',
      sourceText:
        "type Helper = import('./Helper').Helper\ntype External = typeof import('util/path')\ntype Unknown = import(moduleName)\nimport Legacy = require('./Legacy')",
    }
    Expect(CompilerDependencies.sidecarImports(request).map(item => [item.specifier, item.form]))
      .toEqual([['./Helper', 'dynamic'], ['util/path', 'dynamic'], ['./Legacy', 'require']])
    Expect(CompilerDependencies.unresolvedSidecarImports(request)).toEqual([])
  })

  Test('retains literal paths through parentheses and erased TypeScript assertions', () => {
    const request = {
      sourcePath: '/project/Sidecar.ts',
      sourceText:
        "void import(('./Helper')); require(('util')); void import(('./Helper' as const)); void import('./Helper' satisfies string)",
      requirements: [],
      ownerLabel: 'app Demo',
    }
    Expect(CompilerDependencies.sidecarImports(request).map(item => item.specifier))
      .toEqual(['./Helper', 'util', './Helper', './Helper'])
    Expect(CompilerDependencies.unresolvedSidecarImports(request)).toEqual([])
  })

  Test('copies a relative TypeScript helper reached through a literal template import', async () => {
    const tick = String.fromCharCode(96)
    await withTaoFiles('tao-compiler-template-import-', {
      '.tao/store/project.json': '{"id":"3c80c44c-0774-4a27-85ce-cb4453ca9d87"}',
      'Main.tao': `
        app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Main }
        view Main() { render Native() }
        view Native() from ./Native.tsx
      `,
      'Native.tsx': 'export async function Native() { await import(' + tick + './He\\u006cper' + tick
        + '); const text = ' + tick + '${await import("./Nested")}' + tick + '; return null }',
      'Helper.ts': 'export const value = 1',
      'Nested.ts': 'export const value = 2',
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao']!)
      Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['Helper.ts'])
      Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['Nested.ts'])
    })
  })
})
