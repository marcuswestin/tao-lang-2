import { BridgeMetadata, type BridgeModule } from '@compiler/bridge-metadata'
import type { ModuleOrigin } from '@parser'
import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { collectProjectDependencySnapshots } from '../project-tooling-src/ProjectDependencySnapshots'

Describe('dependency TypeScript snapshots', () => {
  Test(
    'copies only reached verified native bytes while preserving their relative Tao and TypeScript imports',
    async () => {
      const fixture = await mkTestDir('tao-native-snapshots-')
      try {
        const dependencyRoot = FS.resolvePath('stdlib', fixture)
        const requestRoot = FS.resolvePath('consumer', fixture)
        await FS.mkdir(FS.resolvePath('.tao', dependencyRoot))
        const sourcePath = FS.resolvePath('@tao/device/files/Bindings.tao', dependencyRoot)
        const nativeRoot = FS.resolvePath('.tao-ts/native-bindings/files', dependencyRoot)
        const sidecar = FS.resolvePath('Bindings.ts', nativeRoot)
        const helper = FS.resolvePath('references.ts', nativeRoot)
        const unrelated = FS.resolvePath('unreached.ts', nativeRoot)
        const manifestPath = FS.resolvePath('maintained.json', nativeRoot)
        await FS.writeText(sourcePath, 'struct Asset { Name text }')
        await FS.writeText(
          sidecar,
          'import type { Asset } from "../../../@tao/device/files/Bindings.tao"\n'
            + 'import { name } from "./references.ts"\nexport const value: Asset = { Name: name }\n',
        )
        await FS.writeText(helper, 'export const name = "file"\n')
        await FS.writeText(unrelated, 'export const unrelated = true\n')
        const paths = [sidecar, helper, unrelated]
        await FS.writeJson(manifestPath, {
          outputs: await Promise.all(paths.map(async path => ({
            path: `typescript/${FS.relativePath(nativeRoot, path)}`,
            hash: Platform.sha256Hex(await FS.readText(path)),
          }))),
        })
        const origin: ModuleOrigin = { projectRoot: dependencyRoot, modulePath: dependencyRoot }
        const module: BridgeModule = {
          path: `${BridgeMetadata.dependencySnapshotPath(requestRoot, sourcePath, origin)}.ts`,
          code: '',
          sourcePath,
          sourceMappings: [],
          implementationPaths: [{
            sourcePath: sidecar,
            path: BridgeMetadata.dependencySnapshotPath(requestRoot, sidecar, origin),
          }],
        }
        const inspected = {
          status: 'fresh' as const,
          diagnostics: [],
          inputPaths: [],
          outputPaths: [...paths, manifestPath],
          identity: 'verified-native-fixture',
        }
        const result = await collectProjectDependencySnapshots(
          requestRoot,
          [module],
          new Map([[sourcePath, origin]]),
          inspected,
        )
        Expect(result.diagnostics).toEqual([])
        Expect(result.outputs.map(output => output.sourcePath).sort()).toEqual([helper, sidecar].sort())
        Expect(result.outputs.find(output => output.sourcePath === sidecar)?.content)
          .toContain('from "../../../@tao/device/files/Bindings.tao"')
        Expect(result.outputs.find(output => output.sourcePath === sidecar)?.content).toContain(
          'from "./references.ts"',
        )
        Expect(result.outputs.every(output => output.nativeBindingProvenance?.identity === 'verified-native-fixture'))
          .toBe(true)
        Expect(result.taoTypeSources.has(sourcePath)).toBe(true)
        await FS.writeText(sidecar, 'export const corrupted = true\n')
        const changed = await collectProjectDependencySnapshots(
          requestRoot,
          [module],
          new Map([[sourcePath, origin]]),
          inspected,
        )
        Expect(changed.outputs).toEqual([])
        Expect(changed.diagnostics[0]?.message).toContain('does not match a fresh native binding inspection')
      } finally {
        await FS.remove(fixture)
      }
    },
  )

  Test('copies the relative private source closure beside the dependency contract', async () => {
    const fixture = await mkTestDir('tao-project-snapshots-')
    try {
      const requestRoot = FS.resolvePath('request', fixture)
      const dependencyRoot = FS.resolvePath('dependency', fixture)
      const sourcePath = FS.resolvePath('Library/Widget.tao', dependencyRoot)
      const sidecar = FS.resolvePath('Library/Widget.ts', dependencyRoot)
      const helper = FS.resolvePath('Library/helper.ts', dependencyRoot)
      const data = FS.resolvePath('Library/data.json', dependencyRoot)
      await FS.mkdir(FS.resolvePath('.tao', dependencyRoot))
      await FS.writeText(
        sidecar,
        'import { label } from "./helper"\nimport data from "./data.json"\nexport const Widget = label + data.name\n',
      )
      await FS.writeText(helper, 'export const label = "Widget"\n')
      await FS.writeText(data, '{"name":"Card"}\n')
      const origin: ModuleOrigin = {
        projectRoot: dependencyRoot,
        modulePath: FS.resolvePath('Library', dependencyRoot),
      }
      const destination = BridgeMetadata.dependencySnapshotPath(requestRoot, sidecar, origin)
      const module: BridgeModule = {
        path: BridgeMetadata.dependencySnapshotPath(requestRoot, sourcePath, origin),
        code: '',
        sourcePath,
        sourceMappings: [],
        implementationPaths: [{ sourcePath: sidecar, path: destination }],
      }

      const result = await collectProjectDependencySnapshots(requestRoot, [module], new Map([[sourcePath, origin]]))
      Expect(result.diagnostics).toEqual([])
      Expect(result.outputs.map(output => output.sourcePath).sort()).toEqual([data, helper, sidecar].sort())
      const copiedSidecar = result.outputs.find(output => output.sourcePath === sidecar)
      Expect(copiedSidecar?.path).toBe(destination)
      Expect(copiedSidecar?.content).toContain('import { label } from "./helper"')
      Expect(copiedSidecar?.sourceMappings[0]?.generatedRange.start.line).toBe(1)
      Expect(copiedSidecar?.sourceMappings[0]?.sourceRange.start.line).toBe(0)
      Expect(result.outputs.find(output => output.sourcePath === data)?.content).toBe('{"name":"Card"}\n')
    } finally {
      await FS.remove(fixture)
    }
  })
})
