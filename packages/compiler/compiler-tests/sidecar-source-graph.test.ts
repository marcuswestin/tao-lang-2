import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { inspectSidecarSourceGraph } from '../compiler-src/sidecar-source-graph'

Describe('sidecar source graph', () => {
  Test('walks only resolved relative modules and records missing candidates in resolution order', async () => {
    const root = await mkTestDir('tao-sidecar-graph-')
    try {
      const entry = FS.resolvePath('Widget.tsx', root)
      const helper = FS.resolvePath('Helper.ts', root)
      await FS.writeText(
        entry,
        [
          "import { helper } from './Helper'",
          "import type { Config } from './Types.tao'",
          "import { missing } from './Missing'",
          'export const Widget = helper',
        ].join('\n'),
      )
      await FS.writeText(helper, 'export const helper = 1')
      const graph = inspectSidecarSourceGraph(entry)
      Expect([...graph.sourceTexts]).toEqual([
        [
          entry,
          "import { helper } from './Helper'\nimport type { Config } from './Types.tao'\nimport { missing } from './Missing'\nexport const Widget = helper",
        ],
        [helper, 'export const helper = 1'],
      ])
      Expect(graph.sourcePaths).toEqual([entry, helper])
      Expect(graph.unresolvedCandidatePaths).toEqual([
        ...['.ts', '.tsx', '.js', '.jsx', '.json'].map(extension => FS.resolvePath(`Missing${extension}`, root)),
        ...['.ts', '.tsx', '.js', '.jsx', '.json'].map(extension => FS.resolvePath(`Missing/index${extension}`, root)),
      ])
      Expect(graph.diagnostics.map(item => [item.message, item.range?.start])).toEqual([
        ["Sidecar relative import './Missing' could not be resolved.", { line: 2, character: 24 }],
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves a missing root for the compiler synthetic-file diagnostic', async () => {
    const root = await mkTestDir('tao-missing-sidecar-root-')
    try {
      const path = FS.resolvePath('Missing.tsx', root)
      Expect(inspectSidecarSourceGraph(path)).toEqual({
        sourceTexts: new Map(),
        sourcePaths: [path],
        unresolvedCandidatePaths: [path],
        ownershipInputPaths: [],
        diagnostics: [],
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves a missing sidecar after its indexed owner root disappears', async () => {
    const root = await mkTestDir('tao-missing-sidecar-owner-')
    try {
      const projectRoot = FS.resolvePath('App', root)
      await FS.writeText(FS.resolvePath('App/.tao/.gitkeep', root), '')
      const index = (await Packages.createContext(projectRoot)).index
      await FS.remove(projectRoot)
      const path = FS.resolvePath('App/Missing.tsx', root)
      const graph = inspectSidecarSourceGraph(path, { projectRoot, index, allowUnmarkedOutside: false })
      Expect(graph.sourcePaths).toEqual([path])
      Expect(graph.unresolvedCandidatePaths).toEqual([path])
      Expect(graph.diagnostics).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not traverse a TS-only nested Tao project', async () => {
    const root = await mkTestDir('tao-nested-sidecar-graph-')
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      const entry = FS.resolvePath('Widget.tsx', root)
      const nested = FS.resolvePath('Nested/Helper.ts', root)
      await FS.writeText(entry, "import { helper } from './Nested/Helper'\nexport const Widget = helper")
      await FS.writeText(FS.resolvePath('Nested/.tao/.gitkeep', root), '')
      await FS.writeText(nested, 'export const helper = 1')
      const index = (await Packages.createContext(root)).index
      const ownership = { projectRoot: root, index, allowUnmarkedOutside: false }
      const graph = inspectSidecarSourceGraph(entry, ownership)
      Expect(graph.sourcePaths).toEqual([entry])
      Expect(graph.unresolvedCandidatePaths).toEqual([])
      Expect(graph.ownershipInputPaths).toContain(FS.resolvePath('Nested/.tao', root))
      Expect(graph.diagnostics.map(item => item.message)).toEqual([
        "Sidecar relative import './Nested/Helper' crosses a Tao project boundary.",
      ])
      const blockedRoot = inspectSidecarSourceGraph(nested, ownership)
      Expect(blockedRoot.ownershipInputPaths).toContain(FS.resolvePath('Nested/.tao', root))
      Expect(blockedRoot.diagnostics.map(item => item.message)).toEqual([
        `Sidecar implementation '${nested}' crosses a Tao project boundary.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('records external ownership markers even when a binding is rejected', async () => {
    const root = await mkTestDir('tao-external-sidecar-watch-', { location: 'host' })
    try {
      const projectRoot = FS.resolvePath('App', root)
      const externalPath = FS.resolvePath('Host/Widget.tsx', root)
      await FS.writeText(FS.resolvePath('App/.tao/.gitkeep', root), '')
      await FS.writeText(externalPath, 'export function Widget() { return null }')
      const index = (await Packages.createContext(projectRoot)).index
      const marker = FS.resolvePath('Host/.tao', root)
      const allowed = inspectSidecarSourceGraph(externalPath, { projectRoot, index, allowUnmarkedOutside: true })
      Expect(allowed.sourcePaths).toEqual([externalPath])
      Expect(allowed.ownershipInputPaths).toContain(marker)
      const rejected = inspectSidecarSourceGraph(externalPath, { projectRoot, index, allowUnmarkedOutside: false })
      Expect(rejected.sourcePaths).toEqual([])
      Expect(rejected.ownershipInputPaths).toContain(marker)
      Expect(rejected.diagnostics[0]?.message).toContain('crosses a Tao project boundary')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a lexical project path symlinked into another marked Tao project', async () => {
    const root = await mkTestDir('tao-symlink-sidecar-boundary-')
    try {
      const projectRoot = FS.resolvePath('App', root)
      const foreignRoot = FS.resolvePath('Other', root)
      await FS.writeText(FS.resolvePath('App/.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('Other/.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('Other/src/Widget.tsx', root), 'export function Widget() { return null }')
      await FS.symlink(FS.resolvePath('Other/src', root), FS.resolvePath('App/HostLink', root))
      const index = (await Packages.createContext(projectRoot)).index
      const ownership = { projectRoot, index, allowUnmarkedOutside: true }
      const linked = FS.resolvePath('App/HostLink/Widget.tsx', root)
      const graph = inspectSidecarSourceGraph(linked, ownership)
      Expect(graph.sourcePaths).toEqual([])
      Expect(graph.diagnostics[0]?.message).toContain('crosses a Tao project boundary')
      Expect(graph.ownershipInputPaths).toContain(FS.resolvePath('.tao', foreignRoot))
      const missing = inspectSidecarSourceGraph(FS.resolvePath('App/HostLink/Missing.tsx', root), ownership)
      Expect(missing.sourcePaths).toEqual([])
      Expect(missing.ownershipInputPaths).toContain(FS.resolvePath('.tao', foreignRoot))
    } finally {
      await FS.remove(root)
    }
  })

  Test('accepts a same-project symlink and a local unmarked host link', async () => {
    const root = await mkTestDir('tao-symlink-sidecar-parity-', { location: 'host' })
    try {
      const projectRoot = FS.resolvePath('App', root)
      await FS.writeText(FS.resolvePath('App/.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('App/Shared/Local.tsx', root), 'export const Local = 1')
      await FS.writeText(FS.resolvePath('Host/Widget.tsx', root), 'export const Widget = 1')
      await FS.symlink(FS.resolvePath('App/Shared', root), FS.resolvePath('App/LocalLink', root))
      await FS.symlink(FS.resolvePath('Host', root), FS.resolvePath('App/HostLink', root))
      const index = (await Packages.createContext(projectRoot)).index
      const ownership = { projectRoot, index, allowUnmarkedOutside: true }
      const local = FS.resolvePath('App/LocalLink/Local.tsx', root)
      const host = FS.resolvePath('App/HostLink/Widget.tsx', root)
      Expect(inspectSidecarSourceGraph(local, ownership).sourcePaths).toEqual([local])
      Expect(inspectSidecarSourceGraph(host, ownership).sourcePaths).toEqual([host])
      Expect(inspectSidecarSourceGraph(host, { ...ownership, allowUnmarkedOutside: false }).diagnostics[0]?.message)
        .toContain('crosses a Tao project boundary')
    } finally {
      await FS.remove(root)
    }
  })
})
