import type { ProjectToolingOptions, ProjectToolingResult, ProjectToolingWatch } from '@project-tooling'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  hideToolingPatterns,
  originCommandUri,
  originMappingsForPath,
  showToolingPatterns,
  toolingExplorerPatterns,
} from '../ide-extension-src/extension/project-tooling-presentation'
import { createProjectToolingSession } from '../ide-extension-src/extension/project-tooling-session'

Describe('editor project tooling integration', () => {
  Test('watches independent roots, reports stale errors, and disposes removed and remaining roots', async () => {
    const watches = new Map<
      string,
      { options: ProjectToolingOptions; disposeCount: number; result: ProjectToolingResult }
    >()
    const received: ProjectToolingResult[] = []
    const removed: string[] = []
    const errors: string[] = []
    const session = createProjectToolingSession(
      async (root, options): Promise<ProjectToolingWatch> => {
        const entry = { options, disposeCount: 0, result: toolingResult(root, 'fresh', 1) }
        watches.set(root, entry)
        return {
          get lastResult() {
            return entry.result
          },
          async requestRefresh() {
            return entry.result
          },
          async dispose() {
            entry.disposeCount++
          },
        }
      },
      result => received.push(result),
      root => removed.push(root),
      (root, error) => {
        errors.push(`${root}: ${String(error)}`)
      },
    )

    await session.reconcile(['/work/First', '/work/Second', '/work/First'])
    Expect([...watches.keys()]).toEqual(['/work/First', '/work/Second'])
    Expect(received.map(result => [result.root, result.status])).toEqual([
      ['/work/First', 'fresh'],
      ['/work/Second', 'fresh'],
    ])

    const first = watches.get('/work/First')!
    first.result = toolingResult('/work/First', 'stale', 2)
    first.options.onResult?.(first.result)
    Expect(session.result('/work/First')?.status).toBe('stale')
    Expect(received.at(-1)?.diagnostics[0]?.message).toBe('Current Tao error')
    Expect(received.at(-1)?.status).toBe('stale')

    await session.reconcile(['/work/Second'])
    Expect(first.disposeCount).toBe(1)
    Expect(removed).toEqual(['/work/First'])
    Expect(session.result('/work/First')).toBeUndefined()
    first.options.onResult?.(toolingResult('/work/First', 'fresh', 3))
    Expect(received.at(-1)?.revision).toBe(2)
    await session.reconcile(['/work/First', '/work/Second'])
    first.options.onResult?.(toolingResult('/work/First', 'fresh', 4))
    Expect(received.at(-1)?.revision).toBe(1)
    await session.dispose()
    Expect(watches.get('/work/Second')?.disposeCount).toBe(1)
    Expect(watches.get('/work/First')?.disposeCount).toBe(1)
    watches.get('/work/Second')?.options.onError?.('late failure')
    Expect(errors).toEqual([])
  })

  Test('keeps folder Explorer overrides and reveals only selected tooling', () => {
    const patterns = toolingExplorerPatterns('/work', '/work/Nested')
    Expect(patterns).toEqual(['Nested/tsconfig.json', 'Nested/node_modules'])
    Expect(toolingExplorerPatterns('/work', '/elsewhere')).toEqual([])
    const existing = { '**/.git': true, 'Nested/tsconfig.json': false }
    const hidden = hideToolingPatterns(existing, patterns)
    Expect(hidden).toEqual({
      '**/.git': true,
      'Nested/tsconfig.json': false,
      'Nested/node_modules': true,
    })
    Expect(existing).toEqual({ '**/.git': true, 'Nested/tsconfig.json': false })
    Expect(showToolingPatterns(hidden, patterns)).toEqual({
      '**/.git': true,
      'Nested/tsconfig.json': false,
      'Nested/node_modules': false,
    })
    Expect(toolingExplorerPatterns('/work/Nested', '/work/Nested')).toEqual(['tsconfig.json', 'node_modules'])
  })

  Test('links only the exact generated declaration span to its Tao source span', () => {
    const mapping = {
      generatedPath: '/work/.tao-ts/Main.tao.ts',
      generatedRange: {
        start: { line: 4, character: 7 },
        end: { line: 4, character: 17 },
      },
      sourcePath: '/work/Main.tao',
      sourceRange: {
        start: { line: 1, character: 9 },
        end: { line: 1, character: 19 },
      },
    }
    Expect(originMappingsForPath('/work/.tao-ts/Main.tao.ts', [
      mapping,
      { ...mapping, generatedPath: '/work/.tao-ts/Other.tao.ts' },
    ])).toEqual([mapping])
    Expect(originMappingsForPath('/work/.tao-ts/Unknown.tao.ts', [mapping])).toEqual([])
    Expect(FS.relativePath('/work', mapping.sourcePath)).toBe('Main.tao')
    const target = originCommandUri(mapping.sourcePath, mapping.sourceRange)
    Expect(target.startsWith('command:tao.openSourceOrigin?')).toBe(true)
    Expect(JSON.parse(decodeURIComponent(target.slice('command:tao.openSourceOrigin?'.length)))).toEqual([
      '/work/Main.tao',
      {
        start: { line: 1, character: 9 },
        end: { line: 1, character: 19 },
      },
    ])
  })
})

function toolingResult(root: string, status: ProjectToolingResult['status'], revision: number): ProjectToolingResult {
  return {
    root,
    status,
    revision,
    diagnostics: status === 'stale'
      ? [{
        filePath: FS.resolvePath('Main.tao', root),
        message: 'Current Tao error',
        severity: 'error',
        source: 'parser',
      }]
      : [],
    contractPaths: [FS.resolvePath('.tao-ts/Main.tao.ts', root)],
    sourceMappings: [],
    dependencyRoots: [],
    configInputPaths: [],
    externalSidecarInputPaths: [],
    sidecarOwnershipInputPaths: [],
    changedOutputPaths: [],
  }
}
