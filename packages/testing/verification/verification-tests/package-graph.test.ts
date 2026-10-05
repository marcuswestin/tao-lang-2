import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { PackageGraph } from '../verification-src/PackageGraph'

async function writeWorkspace(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await FS.writeText(FS.resolvePath(path, root), content)
  }
}

Describe('workspace package graph', () => {
  Test('reads alias, published-name, and relative cross-package imports from source', async () => {
    const root = await mkTestDir('tao-package-graph-')
    try {
      await writeWorkspace(root, {
        'packages/tsconfig.base.json': JSON.stringify({
          compilerOptions: {
            paths: {
              '@shared': ['./shared/shared-src/shared.ts'],
              '@shared/*': ['./shared/shared-src/*'],
              '@tao/editor': ['./editor/editor-src/editor.ts'],
              '@parser': ['./parser/parser-src/parser.ts'],
            },
          },
        }),
        'packages/shared/package.json': '{ "name": "tao-shared" }',
        'packages/shared/shared-src/shared.ts': 'export const shared = 1\n',
        'packages/parser/package.json': '{ "name": "tao-parser" }',
        'packages/parser/parser-src/parser.ts': `import { shared } from '${
          ['..', '..', 'shared', 'shared-src', 'shared'].join('/')
        }'\nimport type { X } from '@shared/core'\nexport const parser = shared\n`,
        // The manifest declares nothing; the import is what counts. A dynamic import and a scoped
        // npm package are in the same file so both branches are exercised.
        'packages/editor/package.json': '{ "name": "@tao/editor" }',
        'packages/editor/editor-src/editor.ts':
          "import { view } from '@codemirror/view'\nimport 'tao-parser/parser'\nexport async function load() { return import('@parser') }\n",
        'packages/editor/editor-tests/editor.test.ts': "import '@shared/test'\n",
      })

      const graph = await PackageGraph.load(root)

      Expect(graph.packages).toEqual(['editor', 'parser', 'shared'])
      Expect([...graph.imports.get('parser')!]).toEqual(['shared'])
      Expect([...graph.imports.get('editor')!].sort()).toEqual(['parser', 'shared'])
      Expect([...graph.imports.get('shared')!]).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('names a package nested two groups deep and follows its alias import', async () => {
    const root = await mkTestDir('tao-package-graph-')
    try {
      await writeWorkspace(root, {
        'packages/tsconfig.base.json': JSON.stringify({
          compilerOptions: { paths: { '@shared': ['./shared/shared-src/shared.ts'] } },
        }),
        'packages/shared/package.json': '{ "name": "tao-shared" }',
        'packages/shared/shared-src/shared.ts': 'export const shared = 1\n',
        'packages/apps/providers/icloud/package.json': '{ "name": "tao-icloud" }',
        'packages/apps/providers/icloud/icloud-src/icloud.ts':
          "import { shared } from '@shared'\nexport const icloud = shared\n",
      })

      const graph = await PackageGraph.load(root)

      Expect(graph.packages).toEqual(['apps/providers/icloud', 'shared'])
      Expect([...graph.imports.get('apps/providers/icloud')!]).toEqual(['shared'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('affected packages are the changed ones and their importers, nearest first', () => {
    const graph = {
      imports: new Map<string, ReadonlySet<string>>([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['b'])],
        ['d', new Set(['a', 'c'])],
        ['e', new Set()],
      ]),
      packages: ['a', 'b', 'c', 'd', 'e'],
    }

    Expect(PackageGraph.affected(graph, ['a'])).toEqual([
      { package: 'a', reason: 'changed directly' },
      { package: 'b', reason: 'imports a' },
      { package: 'd', reason: 'imports a' },
      { package: 'c', reason: 'imports b' },
    ])
    Expect(PackageGraph.affected(graph, ['e', 'c'])).toEqual([
      { package: 'e', reason: 'changed directly' },
      { package: 'c', reason: 'changed directly' },
      { package: 'd', reason: 'imports c' },
    ])
    Expect(PackageGraph.affected(graph, [])).toEqual([])
  })

  Test('the real workspace graph knows the imports the manifests forget', async () => {
    const graph = await PackageGraph.load()

    // `validator` and `parser` import `@compiler/workspace` without declaring it; `compiler` imports
    // `@runtime`. These are the edges Bun's own changed-file selection never follows.
    Expect(graph.imports.get('language/validator')!.has('compiler')).toBe(true)
    Expect(graph.imports.get('language/parser')!.has('compiler')).toBe(true)
    Expect(graph.imports.get('compiler')!.has('apps/runtime')).toBe(true)
    Expect([...graph.imports.get('ides/ide-extension')!].sort()).toEqual([
      'apps/native-bindings',
      'compiler',
      'language/formatter',
      'language/parser',
      'language/project-tooling',
      'language/source-actions',
      'shared',
    ])
    // `code-editor` merged into `studio`; the edge it carried is now studio's own.
    Expect(graph.imports.get('ides/studio')!.has('apps/runtime')).toBe(true)
    Expect(graph.imports.get('apps/stdlib')!.has('apps/providers/icloud')).toBe(true)
    // Shared re-exports the shipped, host-neutral Effects core instead of copying it.
    Expect([...graph.imports.get('shared')!]).toEqual(['apps/runtime'])
    const fromShared = PackageGraph.affected(graph, ['shared']).map(entry => entry.package)
    for (const name of ['compiler', 'cli/dev-cli', 'ides/studio', 'cli/tao-cli', 'apps/expo-host']) {
      Expect(fromShared).toContain(name)
    }
  })
})
