import { Packages } from '@ast-utils'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

Describe('project tooling disk refresh', () => {
  Test('initializes a missing project identity and reports an invalid existing one', async () => {
    const root = await mkTestDir('tao-tooling-project-identity-', { location: 'host' })
    try {
      await FS.mkdir(FS.resolvePath('.tao', root))
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.status).toBe('fresh')
      const marker = FS.resolvePath('.tao/project.json', root)
      const saved = await FS.readText(marker)
      Expect(JSON.parse(saved).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      await ProjectTooling.refresh(root, {})
      Expect(await FS.readText(marker)).toBe(saved)

      await FS.writeText(marker, '{"id":"broken"}\n')
      const invalid = await ProjectTooling.refresh(root, {})
      Expect(invalid.status).toBe('stale')
      Expect(invalid.diagnostics.map(diagnostic => diagnostic.message).join('\n'))
        .toContain('Invalid Tao project identity')
      Expect(await FS.readText(marker)).toBe('{"id":"broken"}\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains external config inputs across stale and recovered refreshes', async () => {
    const fixture = await mkTestDir('tao-tooling-external-config-', { location: 'host' })
    try {
      const root = FS.resolvePath('Project', fixture)
      const external = FS.resolvePath('Shared/config.json', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(FS.resolvePath('Main.ts', root), 'export const answer: number = 42\n')
      await ProjectTooling.refresh(root, {})
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":["./.tao/typescript/tsconfig.json","../Shared/config.json"]}\n',
      )

      const missing = await ProjectTooling.refresh(root, {})
      Expect(missing.status).toBe('stale')
      Expect(missing.configInputPaths).toContain(external)

      await FS.writeText(external, '{}\n')
      const recovered = await ProjectTooling.refresh(root, {})
      Expect(recovered.status).toBe('fresh')
      Expect(recovered.configInputPaths).toContain(external)
      const identityPath = FS.resolvePath('.tao/project.json', root)
      const identity = await FS.readText(identityPath)
      await FS.writeText(identityPath, '{"id":"broken"}\n')
      const invalidIdentity = await ProjectTooling.refresh(root, {})
      Expect(invalidIdentity.status).toBe('stale')
      Expect(invalidIdentity.configInputPaths).toContain(external)
      await FS.writeText(identityPath, identity)

      await FS.remove(external)
      const removed = await ProjectTooling.refresh(root, {})
      Expect(removed.status).toBe('stale')
      Expect(removed.configInputPaths).toContain(external)
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('reports standalone external sidecar inputs and retains them through stale refreshes', async () => {
    await withTaoFiles('tao-tooling-external-sidecar-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao': 'view Widget() from ../Host/Widget.tsx\n',
      'Host/Widget.tsx': "import { value } from './Helper'\nvoid value\nexport function Widget() { return null }\n",
      'Host/Helper.ts': 'export const value: number = 1\n',
      'Unused.ts': 'export const unused = 1\n',
    }, async (paths, fixture) => {
      const root = FS.resolvePath('Project', fixture)
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.status).toBe('fresh')
      Expect(first.externalSidecarInputPaths).toEqual([
        paths['Host/Helper.ts'],
        paths['Host/Widget.tsx'],
      ])
      Expect(first.sidecarOwnershipInputPaths).toContain(FS.resolvePath('Host/.tao', fixture))

      await FS.remove(paths['Host/Helper.ts'])
      const missing = await ProjectTooling.refresh(root, {})
      Expect(missing.status).toBe('stale')
      Expect(missing.externalSidecarInputPaths).toContain(paths['Host/Helper.ts'])

      await FS.remove(paths['Project/Main.tao'])
      const invalidIdentityPath = FS.resolvePath('Project/.tao/project.json', fixture)
      const savedIdentity = await FS.readText(invalidIdentityPath)
      await FS.writeText(invalidIdentityPath, '{"id":"broken"}\n')
      const invalidIdentity = await ProjectTooling.refresh(root, {})
      Expect(invalidIdentity.status).toBe('stale')
      Expect(invalidIdentity.externalSidecarInputPaths).toEqual(first.externalSidecarInputPaths)
      Expect(invalidIdentity.sidecarOwnershipInputPaths).toEqual(first.sidecarOwnershipInputPaths)
      await FS.writeText(invalidIdentityPath, savedIdentity)

      const removed = await ProjectTooling.refresh(root, {})
      Expect(removed.status).toBe('fresh')
      Expect(removed.externalSidecarInputPaths).toEqual([])
    }, { location: 'host', verbatim: true })
  })

  Test('marks a requester project stale when a declared npm alias has the wrong installed identity', async () => {
    await withTaoFiles('tao-tooling-direct-install-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'package { version 0.1.0 requires ts npm:real-util version ^2.0.0 as util }',
      'node_modules/util/package.json': '{"name":"other","version":"2.1.0"}\n',
    }, async (paths, root) => {
      const wrong = await ProjectTooling.refresh(root, {})
      Expect(wrong.status).toBe('stale')
      Expect(wrong.diagnostics.some(diagnostic => diagnostic.message.includes('but real-util was declared')))
        .toBe(true)

      await FS.writeText(paths['node_modules/util/package.json'], '{"name":"real-util","version":"2.1.0"}\n')
      const corrected = await ProjectTooling.refresh(root, {})
      Expect(corrected.status).toBe('fresh')
    }, { location: 'host', verbatim: true })
  })

  Test('keeps a last-good contract through invalid Tao and removes it after source deletion', async () => {
    await withTaoFiles('tao-tooling-refresh-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async (paths, root) => {
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.diagnostics).toEqual([])
      Expect(first.status).toBe('fresh')
      Expect(first.contractPaths).toEqual([FS.resolvePath('.tao-ts/Main.tao.ts', root)])
      const contract = await FS.readText(first.contractPaths[0]!)
      Expect(contract).toContain('CountWords satisfies CountWords')

      await FS.writeText(paths['Main.tao'], 'function CountWords( {\n')
      const stale = await ProjectTooling.refresh(root, {})
      Expect(stale.status).toBe('stale')
      Expect(stale.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)
      Expect(stale.contractPaths).toEqual(first.contractPaths)
      Expect(await FS.readText(first.contractPaths[0]!)).toBe(contract)

      await FS.remove(paths['Main.tao'])
      const afterDelete = await ProjectTooling.refresh(root, {})
      Expect(afterDelete.status).toBe('fresh')
      Expect(afterDelete.contractPaths).toEqual([])
      Expect(await FS.exists(first.contractPaths[0]!)).toBe(false)
    }, { location: 'host' })
  })

  Test('maps a generated contract error back to the Tao declaration', async () => {
    await withTaoFiles('tao-tooling-diagnostic-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': 'export function CountWords(value: string): string { return value }\n',
    }, async (paths, root) => {
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.status).toBe('stale')
      Expect(result.contractPaths).toEqual([FS.resolvePath('.tao-ts/Main.tao.ts', root)])
      const mapped = result.diagnostics.find(diagnostic =>
        diagnostic.filePath === paths['Main.tao'] && diagnostic.message.startsWith('TypeScript:')
      )
      Expect(mapped?.code).toBe('TS1360')
      Expect(mapped?.range?.start.line).toBe(0)
    }, { location: 'host' })
  })

  Test('removes legacy adjacent contracts before checking a sidecar against the hidden contract', async () => {
    const legacy = '// Generated by Tao. Edit the .tao source or its handwritten TypeScript sidecar instead.\n'
    const handwritten = 'export type Hand = { source: "authored" }\n'
    await withTaoFiles('tao-tooling-legacy-contract-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts':
        "import type { CountWords as Declared } from './Main.tao'\nexport const CountWords: Declared = (value: number) => value\n",
      'Main.tao.ts': `${legacy}export type CountWords = (value: number) => number\n`,
      'Hand.tao.ts': handwritten,
      'Orphan.tao.ts': `${legacy}export type Orphan = number\n`,
    }, async (paths, root) => {
      const originalHandwritten = await FS.readText(paths['Hand.tao.ts'])
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.status).toBe('stale')
      Expect(
        result.diagnostics.some(diagnostic =>
          diagnostic.filePath === paths['Words.ts'] && diagnostic.code === 'TS2322'
        ),
      ).toBe(true)
      Expect(result.contractPaths).toEqual([FS.resolvePath('.tao-ts/Main.tao.ts', root)])
      Expect(result.changedOutputPaths).toContain(paths['Main.tao.ts'])
      Expect(result.changedOutputPaths).toContain(paths['Orphan.tao.ts'])
      Expect(await FS.exists(paths['Main.tao.ts'])).toBe(false)
      Expect(await FS.exists(paths['Orphan.tao.ts'])).toBe(false)
      Expect(await FS.readText(paths['Hand.tao.ts'])).toBe(originalHandwritten)
      Expect(await FS.isFile(FS.resolvePath('.tao-ts/Main.tao.ts', root))).toBe(true)

      const authoredAdjacent = 'export type CountWords = (value: number) => number\n'
      await FS.writeText(paths['Main.tao.ts'], authoredAdjacent)
      await ProjectTooling.refresh(root, {})
      Expect(await FS.readText(paths['Main.tao.ts'])).toBe(authoredAdjacent)
    }, { location: 'host' })
  })

  Test('diagnoses an incompatible authored rootDir without rewriting the config', async () => {
    await withTaoFiles('tao-tooling-root-dir-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async (_paths, root) => {
      const configPath = FS.resolvePath('tsconfig.json', root)
      const authored = '{"compilerOptions":{"rootDir":"./src"}}\n'
      await FS.writeText(configPath, authored)

      const result = await ProjectTooling.refresh(root, {})

      Expect(result.status).toBe('stale')
      Expect(result.diagnostics.some(diagnostic => diagnostic.message.includes('rootDir'))).toBe(true)
      Expect(await FS.readText(configPath)).toBe(authored)
    }, { location: 'host' })
  })

  Test('keeps private Tao types available to a published sidecar without checking unused implementations', async () => {
    const privateType = `type UnusedCase is one of Light, Heavy
type SidecarStore is datasource with {
  StorageKey text
  supports { }
  provider MemoryProvider from ./Providers.ts
}`
    const unusedProvider = "import 'undeclared-unused-package'\nexport const MemoryProvider = 42\n"
    for (const sameFile of [true, false]) {
      await withTaoFiles('tao-tooling-private-sidecar-type-', {
        'Library/.tao/.gitkeep': '',
        'Library/Package.tao': 'package { version 1.0.0 includes @ui }',
        'Library/@ui/Widget.tao': `public view Widget() from ./Widget.tsx\n${sameFile ? privateType : ''}`,
        ...(sameFile ? {} : { 'Library/PrivateTypes.tao': privateType }),
        'Library/@ui/Widget.tsx': `
import type { SidecarStoreConfig } from '${sameFile ? './Widget.tao' : '../PrivateTypes.tao'}'
export function Widget(_props: unknown) {
  const config: SidecarStoreConfig | undefined = undefined
  return config ?? null
}
`,
        'Library/@ui/Providers.ts': unusedProvider,
        'Library/Providers.ts': unusedProvider,
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `
use Widget from @widgets
package { version 1.0.0 requires ../Library version ^1.0.0 { @ui as @widgets } }
view Home() { render Widget() }
`,
      }, async (_paths, root) => {
        const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
        Expect(result.diagnostics).toEqual([])
        Expect(result.status).toBe('fresh')
        const contracts = await Promise.all(result.contractPaths.map(path => FS.readText(path)))
        Expect(contracts.join('\n')).toContain('SidecarStoreConfig')
        Expect(contracts.join('\n')).toContain('export declare const UnusedCase')
        Expect(result.changedOutputPaths.some(path => path.endsWith('/Providers.ts'))).toBe(false)
      }, { location: 'host' })
    }
  })

  Test('publishes private case values imported by a dependency sidecar without unused implementations', async () => {
    for (const namespace of [false, true]) {
      await withTaoFiles('tao-tooling-private-case-', {
        'Library/.tao/.gitkeep': '',
        'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
        'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
        'Library/@ui/Widget.tsx': `
${namespace ? "import * as PrivateTypes from './PrivateTypes.tao'" : "import { HapticKind } from './PrivateTypes.tao'"}
import type { SidecarStoreConfig } from './PrivateTypes.tao'
export function Widget(_props: unknown) {
  void ${namespace ? 'PrivateTypes.HapticKind.Light' : 'HapticKind.Light'}
  void (null as unknown as SidecarStoreConfig)
  return null
}
`,
        'Library/@ui/PrivateTypes.tao': `
type HapticKind is one of Light, Heavy
type SidecarStore is datasource with {
  StorageKey text
  supports { }
  provider MemoryProvider from ./Providers.ts
}
data Secrets / Secret { Name text }
`,
        'Library/@ui/Providers.ts': "import 'undeclared-unused-package'\nexport const MemoryProvider = 42\n",
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `
use Widget from @widgets
package { version 1.0.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
view Home() { render Widget() }
`,
      }, async (paths, root) => {
        const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
        Expect(result.diagnostics).toEqual([])
        Expect(result.status).toBe('fresh')
        const privateContract = result.contractPaths.find(path => path.endsWith('/PrivateTypes.tao.ts'))
        Expect(privateContract).toBeDefined()
        const content = await FS.readText(privateContract!)
        Expect(content).toContain('export declare const HapticKind')
        Expect(content).toContain('export type SidecarStoreConfig')
        Expect(result.changedOutputPaths).not.toContain(paths['Library/@ui/Providers.ts'])
        Expect(result.changedOutputPaths.some(path => path.endsWith('/Providers.ts'))).toBe(false)
      }, { location: 'host' })
    }
  })

  Test('keeps a private case declaration available to type-only sidecar imports', async () => {
    await withTaoFiles('tao-tooling-case-type-query-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
      'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
      'Library/@ui/Widget.tsx': `
import type { HapticKind } from './PrivateTypes.tao'
type KindMap = typeof HapticKind
type QueriedKindMap = typeof import('./PrivateTypes.tao').HapticKind
export function Widget(_props: unknown) {
  void (null as unknown as KindMap | QueriedKindMap)
  return null
}
`,
      'Library/@ui/PrivateTypes.tao': 'type HapticKind is one of Light, Heavy',
      'Library/@ui/Providers.ts': "import 'undeclared-unused-package'\nexport const Unused = 42\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
use Widget from @widgets
package { version 1.0.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
view Home() { render Widget() }
`,
    }, async (_paths, root) => {
      const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      const privateContract = result.contractPaths.find(path => path.endsWith('/PrivateTypes.tao.ts'))
      Expect(privateContract).toBeDefined()
      Expect(await FS.readText(privateContract!)).toContain('export declare const HapticKind')
      Expect(result.changedOutputPaths.some(path => path.endsWith('/Providers.ts'))).toBe(false)
    }, { location: 'host' })
  })

  Test('keeps an inherited standard datasource provider outside a selected dependency snapshot', async () => {
    await withTaoFiles('tao-tooling-inherited-stdlib-provider-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Sources" version 1.0.0 includes @data }',
      'Library/@data/Data.tao': `
use Memory from @tao/data/providers/memory
public type LaterSource is Memory with { }
`,
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `
use LaterSource from @sources
package { version 1.0.0 requires "Sources" from ../Library version ^1.0.0 { @data as @sources } }
datasource Store = LaterSource { }
`,
    }, async (_paths, root) => {
      const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      const contract = result.contractPaths.find(path => path.endsWith('/@data/Data.tao.ts'))
      Expect(contract).toBeDefined()
      Expect(await FS.readText(contract!)).toContain('LaterSourceConfig')
      Expect(result.changedOutputPaths.some(path => path.endsWith('/Memory.ts'))).toBe(false)
    }, { location: 'host' })
  })

  Test('rejects dependency TypeScript roots and helpers inside a nested project', async () => {
    for (const direct of [false, true]) {
      await withTaoFiles('tao-tooling-nested-helper-', {
        'Library/.tao/.gitkeep': '',
        'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
        'Library/@ui/Widget.tao': `public view Widget() from ${direct ? '../Nested/Widget.tsx' : './Widget.tsx'}`,
        'Library/@ui/Widget.tsx':
          "import { secret } from '../Nested/Secret'\nexport function Widget() { return secret }\n",
        'Library/Nested/.tao/.gitkeep': '',
        'Library/Nested/Widget.tsx': 'export function Widget() { return null }\n',
        'Library/Nested/Secret.ts': 'export const secret = null\n',
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `
use Widget from @widgets
package { version 1.0.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
view Home() { render Widget() }
`,
      }, async (paths, root) => {
        const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
        Expect(result.status).toBe('stale')
        Expect(
          result.diagnostics.some(diagnostic =>
            diagnostic.filePath === paths[direct ? 'Library/@ui/Widget.tao' : 'Library/@ui/Widget.tsx']
            && diagnostic.message.includes('leaves its project root')
            && diagnostic.range?.start.line === 0
          ),
        ).toBe(true)
        Expect(result.changedOutputPaths.some(path => path.endsWith('/Nested/Secret.ts'))).toBe(false)
        Expect(result.changedOutputPaths.some(path => path.endsWith('/Nested/Widget.tsx'))).toBe(false)
      }, { location: 'host' })
    }
  })

  Test('publishes private dependency contracts and sidecar snapshots', async () => {
    await withTaoFiles('tao-tooling-dependency-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widget Package" version 2.0.0 includes @widgets }',
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts':
        "import { suffix } from './Helper'\nexport function CountWords(value: string): number { return (value + suffix).length }\n",
      'Library/@widgets/Helper.ts': "export const suffix = '!'\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
    }, async (paths, root) => {
      const consumer = FS.resolvePath('Consumer', root)
      const workspace = await Workspace.open(consumer)
      const validation = await workspace.validateFiles([paths['Consumer/Main.tao']])
      Expect(AST.workspaceFilesFor(validation.files[0]!.ast).map(file => AST.getDocument(file).uri.path))
        .toContain(paths['Library/@widgets/Widget.tao'])
      const context = await Packages.createContext(consumer)
      const graph = Packages.createResolver(context).projectGraph({
        fromFilePath: paths['Consumer/Main.tao'],
        workspaceFiles: validation.files.map(file => file.ast),
      })
      Expect(graph.requirements[0]?.selectedPublication?.publicDeclarations.length).toBe(1)
      Expect(graph.requirements[0]?.selectedPublication?.sourceFiles.map(file => AST.getDocument(file).uri.path))
        .toEqual([paths['Library/@widgets/Widget.tao']])
      const libraryIdentity = FS.resolvePath('Library/.tao/project.json', root)
      await FS.remove(libraryIdentity)
      const result = await ProjectTooling.refresh(consumer, {})
      Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(await FS.isFile(libraryIdentity)).toBe(true)
      Expect(result.dependencyRoots).toEqual([FS.resolvePath('Library', root)])
      Expect(result.contractPaths.some(path => path.includes('.tao-ts/.dependencies/'))).toBe(true)
      const snapshotPaths = [...result.changedOutputPaths].filter(path => path.includes('.tao-ts/.dependencies/'))
      Expect(snapshotPaths.some(path => path.endsWith('/Words.ts'))).toBe(true)
      Expect(snapshotPaths.some(path => path.endsWith('/Helper.ts'))).toBe(true)

      await FS.writeText(libraryIdentity, '{"id":"broken"}\n')
      const invalid = await ProjectTooling.refresh(consumer, {})
      Expect(invalid.status).toBe('stale')
      Expect(invalid.diagnostics.map(diagnostic => diagnostic.message).join('\n'))
        .toContain('Invalid Tao project identity')
      Expect(invalid.dependencyRoots).toEqual(result.dependencyRoots)
      Expect(await FS.readText(libraryIdentity)).toBe('{"id":"broken"}\n')
    }, { location: 'host', verbatim: true })
  })

  Test('includes a selected publication’s transitive private source and watch root', async () => {
    await withTaoFiles('tao-tooling-transitive-', {
      'Leaf/.tao/.gitkeep': '',
      'Leaf/Package.tao': 'package { name "Leaf Package" version 1.0.0 includes @leaf }',
      'Leaf/@leaf/Leaf.tao': `public function LeafLength(Value text) returns number {
  return LeafLength(Value) from ./Leaf.ts
}
`,
      'Leaf/@leaf/Leaf.ts': 'export function LeafLength(value: string): number { return value.length }\n',
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': `package {
  name "Widget Package"
  version 2.0.0
  includes @widgets
  requires "Leaf Package" from ../Leaf version ^1.0.0 { @leaf as @leaf }
}`,
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
    }, async (_paths, root) => {
      const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
      Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(result.dependencyRoots.toSorted()).toEqual([
        FS.resolvePath('Leaf', root),
        FS.resolvePath('Library', root),
      ])
      Expect(result.contractPaths.some(path => path.endsWith('/Leaf.tao.ts'))).toBe(true)
      Expect(result.changedOutputPaths.some(path => path.endsWith('/Leaf.ts'))).toBe(true)
    }, { location: 'host', verbatim: true })
  })

  Test('snapshots a selected child project without checking unrelated child TypeScript', async () => {
    await withTaoFiles('tao-tooling-nested-dependency-', {
      '.tao/.gitkeep': '',
      'Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Child Package" from ./Child version ^2.0.0 { @widgets as @parts } }
`,
      'Child/.tao/.gitkeep': '',
      'Child/Package.tao': `package {
  name "Child Package"
  version 2.0.0
  includes @widgets
  requires ts npm:real-util version ^2.0.0 as widget-util
}`,
      'Child/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Child/@widgets/Words.ts':
        "import { count } from 'widget-util'\nexport function CountWords(value: string): number { return count(value) }\n",
      'Child/Broken.ts': 'export const broken: number = "wrong"\n',
    }, async (paths, root) => {
      const child = FS.resolvePath('Child', root)
      const namespace = BridgeMetadata.dependencyNamespace(child)
      const modulesRoot = FS.resolvePath(`.tao/install/origins/${namespace}/node_modules`, root)
      await FS.writeText(
        FS.resolvePath('widget-util/package.json', modulesRoot),
        '{"name":"real-util","version":"2.1.0","types":"index.d.ts"}\n',
      )
      await FS.writeText(
        FS.resolvePath('widget-util/index.d.ts', modulesRoot),
        'export declare function count(value: string): number\n',
      )
      await FS.symlink(modulesRoot, FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, root))

      const workspace = await Workspace.open(root)
      const validation = await workspace.validateFiles([paths['Main.tao']!])
      const graph = Packages.createResolver(await Packages.createContext(root)).projectGraph({
        fromFilePath: paths['Main.tao']!,
        workspaceFiles: validation.files.map(file => file.ast),
      })
      Expect(graph.requirements[0]?.targetProjectRoot).toBe(child)
      Expect(graph.requirements[0]?.selectedPublication?.sourceFiles.map(file => AST.getDocument(file).uri.path))
        .toContain(paths['Child/@widgets/Widget.tao'])

      const result = await ProjectTooling.refresh(root, {})
      Expect(result.contractPaths).toContain(FS.resolvePath(
        `.tao-ts/.dependencies/${namespace}/@widgets/Widget.tao.ts`,
        root,
      ))
      Expect(result.status).toBe('fresh')
      Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      Expect(result.dependencyRoots).toContain(child)
      Expect(result.contractPaths).toContain(FS.resolvePath(
        `.tao-ts/.dependencies/${namespace}/@widgets/Widget.tao.ts`,
        root,
      ))
      Expect(result.changedOutputPaths).toContain(FS.resolvePath(
        `.tao-ts/.dependencies/${namespace}/@widgets/Words.ts`,
        root,
      ))
      Expect(result.sourceMappings.some(mapping => mapping.sourcePath === paths['Child/@widgets/Widget.tao']))
        .toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao-ts/@widgets/Widget.tao.ts', child))).toBe(false)
    }, { location: 'host', verbatim: true })
  })

  Test('rejects a dependency sidecar import absent from its publication requirements', async () => {
    await withTaoFiles('tao-tooling-import-permission-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': 'package { name "Widget Package" version 2.0.0 includes @widgets }',
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts':
        "import pad from 'left-pad'\nexport function CountWords(value: string): number { return pad(value, 2).length }\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
    }, async (paths, root) => {
      const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
      Expect(result.status).toBe('stale')
      Expect(result.diagnostics.some(diagnostic =>
        diagnostic.filePath === paths['Library/@widgets/Words.ts']
        && diagnostic.code === 'undeclared-npm-import'
        && diagnostic.range?.start.line === 0
      )).toBe(true)
    }, { location: 'host', verbatim: true })
  })

  Test('checks overlapping publications against each publication’s own npm requirements', async () => {
    await withTaoFiles('tao-tooling-overlap-import-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': `package {
  name "Allowed"
  version 1.0.0
  includes @widgets
  requires ts npm:left-pad version 1.3.0 as left-pad
}
package { name "Denied" version 1.0.0 includes @widgets }
`,
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts':
        "import pad from 'left-pad'\nexport function CountWords(value: string): number { return pad(value, 2).length }\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @allowed
package {
  version 0.1.0
  requires "Allowed" from ../Library version ^1.0.0 { @widgets as @allowed }
  requires "Denied" from ../Library version ^1.0.0 { @widgets as @denied }
}
`,
    }, async (paths, root) => {
      const result = await ProjectTooling.refresh(FS.resolvePath('Consumer', root), {})
      Expect(result.status).toBe('stale')
      Expect(result.diagnostics.some(diagnostic =>
        diagnostic.filePath === paths['Library/@widgets/Words.ts']
        && diagnostic.code === 'undeclared-npm-import'
        && diagnostic.message.includes('Denied')
      )).toBe(true)
    }, { location: 'host', verbatim: true })
  })

  Test('resolves a declared sidecar alias only from its origin’s managed environment', async () => {
    await withTaoFiles('tao-tooling-managed-import-', {
      'Library/.tao/.gitkeep': '',
      'Library/Package.tao': `package {
  name "Widget Package"
  version 2.0.0
  includes @widgets
  requires ts npm:real-util version ^2.0.0 as widget-util
}`,
      'Library/@widgets/Widget.tao': `public function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Library/@widgets/Words.ts':
        "import { count } from 'widget-util'\nexport function CountWords(value: string): number { return count(value) }\n",
      'Consumer/.tao/.gitkeep': '',
      'Consumer/Main.tao': `use CountWords from @parts
package { version 0.1.0 requires "Widget Package" from ../Library version ^2.0.0 { @widgets as @parts } }
`,
    }, async (_paths, root) => {
      const consumer = FS.resolvePath('Consumer', root)
      const library = FS.resolvePath('Library', root)
      const namespace = BridgeMetadata.dependencyNamespace(library)
      const modulesRoot = FS.resolvePath(`.tao/install/origins/${namespace}/node_modules`, consumer)
      await FS.writeText(
        FS.resolvePath('widget-util/package.json', modulesRoot),
        '{"name":"real-util","version":"2.1.0","types":"index.d.ts"}\n',
      )
      await FS.writeText(
        FS.resolvePath('widget-util/index.d.ts', modulesRoot),
        'export declare function count(value: string): number\n',
      )
      await FS.symlink(modulesRoot, FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, consumer))

      const result = await ProjectTooling.refresh(consumer, {})
      Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      Expect(result.status).toBe('fresh')
      const config = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(
        FS.resolvePath('.tao/typescript/tsconfig.json', consumer),
      )
      Expect(config.compilerOptions.paths['widget-util']).toBeUndefined()
    }, { location: 'host', verbatim: true })
  })

  Test('checks each app’s reachable sidecar closure against only its own npm requirements', async () => {
    await withTaoFiles('tao-tooling-app-import-', {
      '.tao/.gitkeep': '',
      'Main.tao': `
        app Selected {
          id "com.tao.selected"
          version "1.0.0"
          name "Selected"
          requires ts npm:real-util version 1.0.0 as widget-util
          view SelectedView
        }
        app Sibling {
          id "com.tao.sibling"
          version "1.0.0"
          name "Sibling"
          view SiblingView
        }
        view SelectedView() from ./Selected.tsx
        view SiblingView() from ./Sibling.tsx
      `,
      'Selected.tsx': "import { count } from './Helper'\nexport function SelectedView() { return count('selected') }\n",
      'Sibling.tsx': "import { count } from './Helper'\nexport function SiblingView() { return count('sibling') }\n",
      'Helper.ts': "import { size } from 'widget-util'\nexport const count = (value: string) => size(value)\n",
      'node_modules/widget-util/package.json': '{"name":"real-util","version":"1.0.0","types":"index.d.ts"}\n',
      'node_modules/widget-util/index.d.ts': 'export declare function size(value: string): number\n',
    }, async (paths, root) => {
      const result = await ProjectTooling.refresh(root, {})
      const imports = result.diagnostics.filter(diagnostic => diagnostic.code === 'undeclared-npm-import')
      Expect(imports.map(diagnostic => [diagnostic.filePath, diagnostic.message])).toEqual([[
        paths['Helper.ts'],
        "TypeScript import 'widget-util' used by app Sibling requires a declared npm dependency.",
      ]])
      Expect(imports[0]?.range?.start.line).toBe(0)
    }, { location: 'host', verbatim: true })
  })
})
