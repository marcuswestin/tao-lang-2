import { BridgeMetadata } from '@compiler/bridge-metadata'
import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

const measureDeclaration = `type Measure is numeric with {
  units { Seconds 1 (default), Minutes 60 }
}`

Describe('project tooling quantity publication', () => {
  Test('publishes source quantity constructors and native contracts as one stable pair', async () => {
    await withTaoFiles('tao-tooling-quantity-pair-', {
      'Main.tao': `${measureDeclaration}
function Read() returns Measure {
  return Read() from ./Native.ts
}
`,
      'Native.ts': `import { types } from './Main.tao'
export function Read(): types.Measure { return types.Measure.Minutes(2) }
`,
    }, async (paths, root) => {
      const companion = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const leaf = FS.resolvePath('.tao-ts/Main.tao.quantities.ts', root)
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.diagnostics).toEqual([])
      Expect(first.status).toBe('fresh')
      Expect(first.contractPaths).toEqual([leaf, companion].sort())
      Expect(first.changedOutputPaths).toContain(companion)
      Expect(first.changedOutputPaths).toContain(leaf)
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(leaf)).toBe(true)
      const companionCode = await FS.readText(companion)
      const leafCode = await FS.readText(leaf)
      Expect(companionCode).toContain('./Main.tao.quantities')
      Expect(companionCode).toContain('types')
      Expect(companionCode).toContain('typeof Sidecar.Read')
      Expect(leafCode).toContain('unique symbol')
      Expect(leafCode).toContain('export namespace types')
      Expect(leafCode).toContain('export type Measure')
      Expect(leafCode).toContain('["Minutes"]')
      Expect(
        first.sourceMappings.some(mapping =>
          mapping.generatedPath === leaf && mapping.sourcePath === paths['Main.tao']
        ),
      ).toBe(true)
      Expect(nativeDiagnostics(root)).toEqual([])

      const repeated = await ProjectTooling.refresh(root, {})
      Expect(repeated.diagnostics).toEqual([])
      Expect(repeated.status).toBe('fresh')
      Expect(repeated.contractPaths).toEqual(first.contractPaths)
      Expect(repeated.changedOutputPaths).not.toContain(companion)
      Expect(repeated.changedOutputPaths).not.toContain(leaf)
      Expect(await FS.readText(companion)).toBe(companionCode)
      Expect(await FS.readText(leaf)).toBe(leafCode)
    })
  })

  Test('maps a native return from a same-labelled sibling quantity to its Tao boundary', async () => {
    await withTaoFiles('tao-tooling-quantity-nominal-', {
      '@left/Measure.tao': `public ${measureDeclaration}`,
      '@right/Measure.tao': `public ${measureDeclaration}`,
      'Main.tao': `use Measure from @left
function Read() returns Measure {
  return Read() from ./Native.ts
}
`,
      'Native.ts': `import { types } from './@left/Measure.tao'
export function Read(): types.Measure { return types.Measure.Seconds(1) }
`,
    }, async (paths, root) => {
      const matching = await ProjectTooling.refresh(root, {})
      Expect(matching.diagnostics).toEqual([])
      Expect(matching.status).toBe('fresh')
      const leftLeaf = FS.resolvePath('.tao-ts/@left/Measure.tao.quantities.ts', root)
      const rightLeaf = FS.resolvePath('.tao-ts/@right/Measure.tao.quantities.ts', root)
      Expect(matching.contractPaths).toContain(leftLeaf)
      Expect(matching.contractPaths).toContain(rightLeaf)
      Expect(await FS.isFile(leftLeaf)).toBe(true)
      Expect(await FS.isFile(rightLeaf)).toBe(true)
      Expect(nativeDiagnostics(root)).toEqual([])

      await FS.writeText(
        paths['Native.ts'],
        `import { types } from './@right/Measure.tao'
export function Read(): types.Measure { return types.Measure.Seconds(1) }
`,
      )
      const mismatch = await ProjectTooling.refresh(root, {})
      Expect(mismatch.status).toBe('stale')
      const nativeMismatch = nativeDiagnostics(root).filter(diagnostic => diagnostic.code === 2344)
      Expect(nativeMismatch.length).toBeGreaterThan(0)
      Expect(
        nativeMismatch.every(diagnostic => diagnostic.file?.fileName === FS.resolvePath('.tao-ts/Main.tao.ts', root)),
      ).toBe(true)
      const mapped = mismatch.diagnostics.filter(diagnostic => diagnostic.code === 'TS2344')
      Expect(mapped.length).toBeGreaterThan(0)
      Expect(
        mapped.every(diagnostic => diagnostic.filePath === paths['Main.tao'] && diagnostic.range?.start.line === 1),
      ).toBe(true)

      await FS.writeText(
        paths['Native.ts'],
        `import { types } from './@left/Measure.tao'
export function Read(): types.Measure { return types.Measure.Seconds(1) }
`,
      )
      const repaired = await ProjectTooling.refresh(root, {})
      Expect(repaired.status).toBe('fresh')
      Expect(repaired.diagnostics).toEqual([])
      Expect(nativeDiagnostics(root)).toEqual([])
    })
  })

  Test('forwards alias-only quantities from distinct canonical files without creating new owners', async () => {
    const native = `import { types, type First, type Second } from './Aliases.tao'
import { types as leftTypes } from './@left/Measure.tao'
import { types as rightTypes } from './@right/Measure.tao'
export const first: First = types.First.Seconds(1)
export const second: Second = types.Second.Minutes(2)
export const canonicalFirst: leftTypes.Measure = first
export const canonicalSecond: rightTypes.Measure = second
export const aliasFirst: First = leftTypes.Measure.Minutes(1)
export const aliasSecond: Second = rightTypes.Measure.Seconds(2)
export const namespaceFirst: types.First = first
export const namespaceSecond: types.Second = second
`
    await withTaoFiles('tao-tooling-quantity-aliases-', {
      '@left/Measure.tao': `public ${measureDeclaration}`,
      '@right/Measure.tao': `public ${measureDeclaration}`,
      'Aliases.tao': `use package @left as Left
use package @right as Right
type First = Left.Measure
type Second = Right.Measure
`,
      'Native.ts': native,
    }, async (paths, root) => {
      const companion = FS.resolvePath('.tao-ts/Aliases.tao.ts', root)
      const forwardingLeaf = FS.resolvePath('.tao-ts/Aliases.tao.quantities.ts', root)
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.diagnostics).toEqual([])
      Expect(first.status).toBe('fresh')
      Expect(first.contractPaths).toContain(companion)
      Expect(first.contractPaths).toContain(forwardingLeaf)
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(forwardingLeaf)).toBe(true)
      const forwarding = await FS.readText(forwardingLeaf)
      Expect(forwarding).toContain('./@left/Measure.tao.quantities')
      Expect(forwarding).toContain('./@right/Measure.tao.quantities')
      Expect(forwarding).not.toContain('unique symbol')
      Expect(forwarding).not.toContain('makeQuantityType')
      Expect(nativeDiagnostics(root)).toEqual([])

      await FS.writeText(paths['Native.ts'], `${native}export const mixed: First = second\n`)
      const mixed = await ProjectTooling.refresh(root, {})
      Expect(mixed.status).toBe('stale')
      const nativeMismatch = nativeDiagnostics(root).filter(diagnostic => diagnostic.code === 2719)
      Expect(nativeMismatch.length).toBeGreaterThan(0)
      Expect(nativeMismatch.every(diagnostic => diagnostic.file?.fileName === paths['Native.ts'])).toBe(true)
      Expect(
        nativeMismatch.some(diagnostic =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('[__q0Owner]')
        ),
      ).toBe(true)
      Expect(
        mixed.diagnostics.some(diagnostic =>
          diagnostic.code === 'TS2719' && diagnostic.filePath === paths['Native.ts']
        ),
      ).toBe(true)
    })
  })

  Test('preserves alias constructors when an erased native contract has the same name', async () => {
    await withTaoFiles('tao-tooling-quantity-alias-collision-', {
      '@left/Measure.tao': `public ${measureDeclaration}`,
      'Main.tao': `use package @left as Left
type Renamed = Left.Measure
function Renamed() returns Renamed {
  return Renamed() from ./Native.ts
}
`,
      'Native.ts': `import { types, type Renamed as ReadContract } from './Main.tao'
import { types as canonical } from './@left/Measure.tao'
export const Renamed: ReadContract = () => types.Renamed.Seconds(1)
export const value: canonical.Measure = Renamed()
export const reverse: types.Renamed = canonical.Measure.Minutes(2)
`,
    }, async (_paths, root) => {
      const companion = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const forwardingLeaf = FS.resolvePath('.tao-ts/Main.tao.quantities.ts', root)
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(result.contractPaths).toContain(companion)
      Expect(result.contractPaths).toContain(forwardingLeaf)
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(forwardingLeaf)).toBe(true)
      Expect(await FS.readText(companion)).toContain('export type Renamed =')
      Expect(await FS.readText(companion)).toContain('typeof Sidecar.Renamed')
      Expect(await FS.readText(forwardingLeaf)).toContain('./@left/Measure.tao.quantities')
      Expect(await FS.readText(forwardingLeaf)).not.toContain('unique symbol')
      Expect(await FS.readText(forwardingLeaf)).not.toContain('makeQuantityType')
      Expect(nativeDiagnostics(root)).toEqual([])
    })
  })

  Test('keeps a quantity named like the bridge helper compatible with a real native contract', async () => {
    await withTaoFiles('tao-tooling-quantity-helper-name-', {
      'Main.tao': `${measureDeclaration.replace('Measure', '__TaoBridgeCheck')}
function Read() returns __TaoBridgeCheck {
  return Read() from ./Native.ts
}
`,
      'Native.ts': `import { types } from './Main.tao'
export function Read(): types.__TaoBridgeCheck { return types.__TaoBridgeCheck.Seconds(1) }
`,
    }, async (_paths, root) => {
      const companion = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const leaf = FS.resolvePath('.tao-ts/Main.tao.quantities.ts', root)
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(result.contractPaths).toEqual([leaf, companion].sort())
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(leaf)).toBe(true)
      Expect(await FS.readText(companion)).toContain('typeof Sidecar.Read')
      Expect(await FS.readText(leaf)).toContain('export const __TaoBridgeCheck')
      Expect(nativeDiagnostics(root)).toEqual([])
    })
  })

  Test('reuses constructor objects and factories through mixed local and cross-file aliases', async () => {
    await withTaoFiles('tao-tooling-quantity-alias-identity-', {
      'Local.tao': `use package ./ as Local
type Before = Local.Measure
public ${measureDeclaration}
type After = Local.Measure
`,
      'Cross.tao': `use package ./ as Local
type Forwarded = Local.Measure
`,
      'Native.ts': `import { types } from './Local.tao'
import { types as cross } from './Cross.tao'
export const before: types.Measure = types.Before.Seconds(1)
export const after: types.Measure = types.After.Minutes(2)
export const forwarded: types.Measure = cross.Forwarded.Seconds(3)
export const reverse: cross.Forwarded = types.Measure.Minutes(4)
`,
    }, async (paths, root) => {
      const localLeaf = FS.resolvePath('.tao-ts/Local.tao.quantities.ts', root)
      const crossLeaf = FS.resolvePath('.tao-ts/Cross.tao.quantities.ts', root)
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(result.contractPaths).toContain(localLeaf)
      Expect(result.contractPaths).toContain(crossLeaf)
      Expect(await FS.isFile(localLeaf)).toBe(true)
      Expect(await FS.isFile(crossLeaf)).toBe(true)
      Expect(nativeDiagnostics(root)).toEqual([])

      const validation = await (await Workspace.open(root)).validateFiles([paths['Local.tao'], paths['Cross.tao']])
      Expect(validation.diagnostics).toEqual([])
      const localFile = validation.files.find(file => file.path === paths['Local.tao'])
      const crossFile = validation.files.find(file => file.path === paths['Cross.tao'])
      Assert.defined(localFile, 'the local quantity fixture has a validated source AST')
      Assert.defined(crossFile, 'the forwarding quantity fixture has a validated source AST')
      const localSurface = BridgeMetadata.quantitySurfaceFor(localFile.ast)
      const crossSurface = BridgeMetadata.quantitySurfaceFor(crossFile.ast)
      Assert.defined(localSurface, 'the local quantity fixture has publication metadata')
      Assert.defined(crossSurface, 'the forwarding quantity fixture has publication metadata')
      const before = quantityDeclaration(localSurface, 'Before')
      const owner = quantityDeclaration(localSurface, 'Measure')
      const after = quantityDeclaration(localSurface, 'After')
      const forwarded = quantityDeclaration(crossSurface, 'Forwarded')
      const localCode = await FS.readText(localLeaf)
      const crossCode = await FS.readText(crossLeaf)
      Expect(localCode.match(/: unique symbol/g)?.length).toBe(1)
      Expect(crossCode).not.toContain('unique symbol')
      Expect(crossCode).not.toContain('makeQuantityType')
      await writeRuntimeLeaves([localLeaf, crossLeaf])
      const consumer = [
        `import { ${localSurface.namespaceExport} as local, ${before.factoryExport} as BeforeFactory, ${owner.factoryExport} as OwnerFactory, ${after.factoryExport} as AfterFactory } from './.tao-ts/Local.tao.quantities.js'`,
        `import { ${crossSurface.namespaceExport} as cross, ${forwarded.factoryExport} as ForwardedFactory } from './.tao-ts/Cross.tao.quantities.js'`,
        `import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }`,
        'Platform.runtimeConsole.info(JSON.stringify({',
        `  beforeConstructors: local.${before.constructorMember} === local.${owner.constructorMember},`,
        `  afterConstructors: local.${after.constructorMember} === local.${owner.constructorMember},`,
        `  forwardedConstructors: cross.${forwarded.constructorMember} === local.${owner.constructorMember},`,
        '  beforeFactory: BeforeFactory === OwnerFactory,',
        '  afterFactory: AfterFactory === OwnerFactory,',
        '  forwardedFactory: ForwardedFactory === OwnerFactory,',
        `  read: OwnerFactory.read(cross.${forwarded.constructorMember}.Minutes(2)),`,
        '}))',
      ].join('\n')
      const consumerPath = FS.resolvePath('Identity.js', root)
      await FS.writeText(consumerPath, transpile(consumer))
      const run = await CLI.run(Platform.runtimeProcess.execPath, {
        cwd: root,
        args: [consumerPath],
        processPolicy: 'test',
      })
      Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(run.stdout)).toEqual({
        beforeConstructors: true,
        afterConstructors: true,
        forwardedConstructors: true,
        beforeFactory: true,
        afterFactory: true,
        forwardedFactory: true,
        read: { canonical: 120, unit: 'Minutes' },
      })
    })
  })

  Test('executes mutually forwarding quantity leaves from either ESM entry order', async () => {
    await withTaoFiles('tao-tooling-quantity-cycle-', {
      'Left.tao': `use package ./ as Local
public ${measureDeclaration.replace('Measure', 'LeftMeasure')}
type RightAlias = Local.RightMeasure
`,
      'Right.tao': `use package ./ as Local
public ${measureDeclaration.replace('Measure', 'RightMeasure')}
type LeftAlias = Local.LeftMeasure
`,
      'Native.ts': `import { types as left } from './Left.tao'
import { types as right } from './Right.tao'
export const first: left.LeftMeasure = right.LeftAlias.Minutes(2)
export const second: right.RightMeasure = left.RightAlias.Seconds(3)
`,
    }, async (paths, root) => {
      const result = await ProjectTooling.refresh(root, {})
      Expect(result.diagnostics).toEqual([])
      Expect(result.status).toBe('fresh')
      Expect(nativeDiagnostics(root)).toEqual([])
      const leaves = ['Left', 'Right'].map(name => FS.resolvePath(`.tao-ts/${name}.tao.quantities.ts`, root))
      const validation = await (await Workspace.open(root)).validateFiles([paths['Left.tao'], paths['Right.tao']])
      Expect(validation.diagnostics).toEqual([])
      const surfaceFor = (name: 'Left' | 'Right') => {
        const file = validation.files.find(file => file.path === paths[`${name}.tao`])
        Assert.defined(file, 'the cyclic quantity source has a validated AST')
        const surface = BridgeMetadata.quantitySurfaceFor(file.ast)
        Assert.defined(surface, 'the cyclic quantity source has publication metadata')
        return surface
      }
      const left = surfaceFor('Left')
      const right = surfaceFor('Right')
      const leftOwner = quantityDeclaration(left, 'LeftMeasure')
      const rightAlias = quantityDeclaration(left, 'RightAlias')
      const rightOwner = quantityDeclaration(right, 'RightMeasure')
      const leftAlias = quantityDeclaration(right, 'LeftAlias')
      for (const leaf of leaves) {
        Expect(result.contractPaths).toContain(leaf)
        const code = await FS.readText(leaf)
        Expect(code.match(/: unique symbol/g)?.length).toBe(1)
        Expect(code).not.toContain('.tao.ts')
      }
      await writeRuntimeLeaves(leaves)
      for (const entry of ['Left', 'Right']) {
        const other = entry === 'Left' ? 'Right' : 'Left'
        const consumer = [
          `import * as Platform from ${
            JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
          }`,
          `const ${entry.toLowerCase()} = await import('./.tao-ts/${entry}.tao.quantities.js')`,
          `const ${other.toLowerCase()} = await import('./.tao-ts/${other}.tao.quantities.js')`,
          'Platform.runtimeConsole.info(JSON.stringify({',
          `  rightConstructor: left.${left.namespaceExport}.${rightAlias.constructorMember} === right.${right.namespaceExport}.${rightOwner.constructorMember},`,
          `  leftConstructor: right.${right.namespaceExport}.${leftAlias.constructorMember} === left.${left.namespaceExport}.${leftOwner.constructorMember},`,
          `  rightFactory: left.${rightAlias.factoryExport} === right.${rightOwner.factoryExport},`,
          `  leftFactory: right.${leftAlias.factoryExport} === left.${leftOwner.factoryExport},`,
          `  rightEnumerable: Object.keys(left.${left.namespaceExport}).includes(${
            JSON.stringify(rightAlias.constructorMember)
          }),`,
          `  leftEnumerable: Object.keys(right.${right.namespaceExport}).includes(${
            JSON.stringify(leftAlias.constructorMember)
          }),`,
          `  leftRead: left.${leftOwner.factoryExport}.read(right.${right.namespaceExport}.${leftAlias.constructorMember}.Minutes(2)),`,
          `  rightRead: right.${rightOwner.factoryExport}.read(left.${left.namespaceExport}.${rightAlias.constructorMember}.Seconds(3)),`,
          `  differentOwners: !left.${leftOwner.factoryExport}.ownsPayload(right.${right.namespaceExport}.${rightOwner.constructorMember}.Seconds(1).jsValue),`,
          '}))',
        ].join('\n')
        const consumerPath = FS.resolvePath(`Cycle${entry}.js`, root)
        await FS.writeText(consumerPath, transpile(consumer))
        const run = await CLI.run(Platform.runtimeProcess.execPath, {
          cwd: root,
          args: [consumerPath],
          processPolicy: 'test',
        })
        Expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: '' })
        Expect(JSON.parse(run.stdout)).toEqual({
          rightConstructor: true,
          leftConstructor: true,
          rightFactory: true,
          leftFactory: true,
          rightEnumerable: true,
          leftEnumerable: true,
          leftRead: { canonical: 120, unit: 'Minutes' },
          rightRead: { canonical: 3, unit: 'Seconds' },
          differentOwners: true,
        })
      }
    })
  })

  Test('publishes private dependency quantities reached by value and type-only sidecar imports', async () => {
    for (const typeOnly of [false, true]) {
      await withTaoFiles('tao-tooling-private-quantity-', {
        'Library/.tao/.gitkeep': '',
        'Library/Package.tao': 'package { name "Widgets" version 1.0.0 includes @ui }',
        'Library/@ui/Widget.tao': 'public view Widget() from ./Widget.tsx',
        'Library/@ui/Widget.tsx': typeOnly
          ? `import type { types } from './Private.tao'
import { Read } from './Private.tao'
export function Widget(_props: unknown) {
  void (null as unknown as types.Measure)
  void (null as unknown as Read)
  return null
}
`
          : `import { types, Read } from './Private.tao'
export function Widget(_props: unknown) {
  void types.Measure.Minutes(2)
  void (null as unknown as Read)
  return null
}
`,
        'Library/@ui/Private.tao': `use package @owners as Canonical
type Measure = Canonical.Measure
function Read() returns Measure {
  return Read() from ./QuantityNative.ts
}
`,
        'Library/@ui/QuantityNative.ts': `import { types } from './Private.tao'
export function Read(): types.Measure { return types.Measure.Minutes(2) }
`,
        'Library/@owners/Owner.tao': `public ${measureDeclaration}
type UnusedSource is datasource with {
  StorageKey text
  supports { }
  provider MemoryProvider from ./Providers.ts
}
`,
        'Library/@owners/Providers.ts': "import 'undeclared-unused-package'\nexport const MemoryProvider = 42\n",
        'Consumer/.tao/.gitkeep': '',
        'Consumer/Main.tao': `use Widget from @widgets
package { version 1.0.0 requires "Widgets" from ../Library version ^1.0.0 { @ui as @widgets } }
view Home() { render Widget() }
`,
      }, async (paths, fixture) => {
        const root = FS.resolvePath('Consumer', fixture)
        const result = await ProjectTooling.refresh(root, {})
        Expect(result.diagnostics).toEqual([])
        Expect(result.status).toBe('fresh')
        const companion = result.contractPaths.find(path => path.endsWith('/@ui/Private.tao.ts'))
        const leaf = result.contractPaths.find(path => path.endsWith('/@ui/Private.tao.quantities.ts'))
        const ownerLeaf = result.contractPaths.find(path => path.endsWith('/@owners/Owner.tao.quantities.ts'))
        Assert.defined(companion, 'the private dependency quantity companion is published')
        Assert.defined(leaf, 'the private dependency quantity leaf is published')
        Assert.defined(ownerLeaf, 'the alias reaches its initially unselected canonical owner leaf')
        Expect(FS.pathIsWithin(companion, FS.resolvePath('.tao-ts/.dependencies', root))).toBe(true)
        Expect(FS.pathIsWithin(leaf, FS.resolvePath('.tao-ts/.dependencies', root))).toBe(true)
        Expect(await FS.isFile(companion)).toBe(true)
        Expect(await FS.isFile(leaf)).toBe(true)
        Expect(await FS.readText(companion)).toContain('./Private.tao.quantities')
        Expect(await FS.readText(leaf)).toContain('../@owners/Owner.tao.quantities')
        Expect(await FS.readText(leaf)).not.toContain('unique symbol')
        Expect(await FS.readText(leaf)).toContain('export type Measure')
        Expect(await FS.readText(companion)).toContain('../@owners/Owner.tao.quantities')
        Expect(await FS.readText(companion)).toContain('typeof Sidecar.Read')
        Expect(await FS.readText(ownerLeaf)).toContain('unique symbol')
        Expect(
          result.sourceMappings.some(mapping =>
            mapping.generatedPath === ownerLeaf && mapping.sourcePath === paths['Library/@owners/Owner.tao']
          ),
        ).toBe(true)
        Expect(
          result.sourceMappings.some(mapping =>
            mapping.generatedPath === leaf && mapping.sourcePath === paths['Library/@ui/Private.tao']
          ),
        ).toBe(true)
        Expect(result.changedOutputPaths.some(path => path.endsWith('/Providers.ts'))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('Library/.tao-ts/@ui/Private.tao.quantities.ts', fixture)))
          .toBe(false)
        Expect(nativeDiagnostics(root)).toEqual([])
      })
    }
  })

  Test('retains an invalid quantity pair and prunes it on valid unit removal or source deletion', async () => {
    const marker = 'type Marker is one of Present, Gone\n'
    const handwritten = 'export const handwritten = "preserved"\n'
    await withTaoFiles('tao-tooling-quantity-lifecycle-', {
      '.tao/.gitkeep': '',
      'Main.tao': `${measureDeclaration}\n${marker}`,
      '.tao-ts/Handwritten.ts': handwritten,
      'Hand.tao.ts': handwritten,
    }, async (paths, root) => {
      const companion = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const leaf = FS.resolvePath('.tao-ts/Main.tao.quantities.ts', root)
      const first = await ProjectTooling.refresh(root, {})
      Expect(first.diagnostics).toEqual([])
      Expect(first.status).toBe('fresh')
      Expect(first.contractPaths).toEqual([leaf, companion].sort())
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(leaf)).toBe(true)
      const companionCode = await FS.readText(companion)
      const leafCode = await FS.readText(leaf)

      await FS.writeText(paths['Main.tao'], 'type Measure is numeric with { units {\n')
      const invalid = await ProjectTooling.refresh(root, {})
      Expect(invalid.status).toBe('stale')
      Expect(invalid.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)
      Expect(invalid.contractPaths).toEqual(first.contractPaths)
      Expect(invalid.sourceMappings).toEqual(first.sourceMappings)
      Expect(invalid.changedOutputPaths).not.toContain(companion)
      Expect(invalid.changedOutputPaths).not.toContain(leaf)
      Expect(await FS.readText(companion)).toBe(companionCode)
      Expect(await FS.readText(leaf)).toBe(leafCode)

      await FS.writeText(paths['Main.tao'], `type Measure is numeric\n${marker}`)
      const withoutUnits = await ProjectTooling.refresh(root, {})
      Expect(withoutUnits.diagnostics).toEqual([])
      Expect(withoutUnits.status).toBe('fresh')
      Expect(withoutUnits.contractPaths).toEqual([companion])
      Expect(withoutUnits.changedOutputPaths).toContain(leaf)
      Expect(await FS.exists(leaf)).toBe(false)
      Expect(await FS.readText(companion)).toContain('export declare const Marker')
      Expect(await FS.readText(companion)).not.toContain('Main.tao.quantities')

      await FS.writeText(paths['Main.tao'], `${measureDeclaration}\n${marker}`)
      const restored = await ProjectTooling.refresh(root, {})
      Expect(restored.status).toBe('fresh')
      Expect(restored.diagnostics).toEqual([])
      Expect(restored.contractPaths).toEqual(first.contractPaths)
      Expect(await FS.isFile(companion)).toBe(true)
      Expect(await FS.isFile(leaf)).toBe(true)

      await FS.remove(paths['Main.tao'])
      const deleted = await ProjectTooling.refresh(root, {})
      Expect(deleted.status).toBe('fresh')
      Expect(deleted.diagnostics).toEqual([])
      Expect(deleted.contractPaths).toEqual([])
      Expect(deleted.changedOutputPaths).toContain(companion)
      Expect(deleted.changedOutputPaths).toContain(leaf)
      Expect(await FS.exists(companion)).toBe(false)
      Expect(await FS.exists(leaf)).toBe(false)
      Expect(await FS.readText(paths['.tao-ts/Handwritten.ts'])).toBe(handwritten)
      Expect(await FS.readText(paths['Hand.tao.ts'])).toBe(handwritten)
    }, { verbatim: true })
  })
})

function nativeDiagnostics(root: string): readonly ts.Diagnostic[] {
  const config = FS.resolvePath('tsconfig.json', root)
  const read = ts.readConfigFile(config, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, config)
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options))]
}

function quantityDeclaration(
  surface: NonNullable<ReturnType<typeof BridgeMetadata.quantitySurfaceFor>>,
  name: string,
) {
  const row = surface.declarations.find(candidate => candidate.declaration.name === name)
  Assert.defined(row, `the quantity fixture declares ${name}`)
  return row
}

async function writeRuntimeLeaves(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    let code = await FS.readText(path)
    for (const target of paths) {
      const relative = FS.relativePath(FS.dirname(path), target).replace(/\.ts$/, '')
      const specifier = relative.startsWith('.') ? relative : `./${relative}`
      code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(`${specifier}.js`))
    }
    await FS.writeText(path.replace(/\.ts$/, '.js'), transpile(code))
  }
}

function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
}
