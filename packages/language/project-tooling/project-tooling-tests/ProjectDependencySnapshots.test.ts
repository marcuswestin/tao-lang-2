import { BridgeMetadata, type BridgeModule } from '@compiler/bridge-metadata'
import type { ModuleOrigin } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { collectProjectDependencySnapshots } from '../project-tooling-src/ProjectDependencySnapshots'

Describe('dependency TypeScript snapshots', () => {
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
