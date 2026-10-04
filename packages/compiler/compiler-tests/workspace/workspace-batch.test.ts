import { Packages } from '@ast-utils'
import { AST, type ParseResult } from '@parser'
import { type Diagnostic, Diagnostics, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import Validator from '@validator'
import { Workspace } from '../../compiler-src/workspace/index'

// `parseFiles` builds a workspace's entries once instead of once per entry. It is only allowed to be
// faster: every entry keeps the graph it alone reaches, and no file comes to see a declaration it
// would not see as an entry of its own.
Describe('parsing a workspace batch with one build', () => {
  Test('gives each entry its own graph while reading a shared file once', async () => {
    await withTaoFiles(
      'tao-workspace-batch-graphs-',
      {
        'First.tao': `
          use Shared from @lib
          let FromFirst = Shared
        `,
        'Second.tao': `
          use Shared from @lib
          let FromSecond = Shared
        `,
        'Alone.tao': 'let Unrelated = "alone"',
        '@lib/Shared.tao': 'workspace let Shared = "shared"',
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const [first, second, alone] = await workspace.parseFiles([
          paths['First.tao']!,
          paths['Second.tao']!,
          paths['Alone.tao']!,
        ])
        const onePerEntry = await (await Workspace.open(rootDir)).parse(paths['First.tao']!)

        Expect(first!.files.map(file => file.path)).toEqual(onePerEntry.files.map(file => file.path))
        Expect(alone!.files.map(file => file.path)).not.toContain(paths['@lib/Shared.tao'])
        Expect(alone!.files.map(file => file.path)).not.toContain(paths['First.tao'])

        const sharedIn = (parsed: ParseResult) => parsed.files.find(file => file.path === paths['@lib/Shared.tao'])
        Expect(sharedIn(first!)?.document).toBeDefined()
        Expect(sharedIn(second!)?.document).toBe(sharedIn(first!)!.document)
        Expect(Diagnostics.errorMessages([...first!.diagnostics, ...second!.diagnostics, ...alone!.diagnostics]))
          .toEqual([])
      },
    )
  })

  // The loader never puts a test sidecar in an app file's graph, so in a build of its own an app file
  // cannot see what its sidecar declares. A batch holds both, and folder scope reads the documents the
  // workspace holds, so the scope provider has to keep the sidecar out itself.
  Test('keeps a test sidecar out of its app file siblings folder scope', async () => {
    await withTaoFiles(
      'tao-workspace-batch-sidecar-scope-',
      {
        'Main.tao': `
          folder let Visible = "sibling"
          let FromSidecar = OnlyInSidecar
        `,
        'Main.test.tao': `
          folder let OnlyInSidecar = "sidecar"
          let FromSibling = Visible
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const [main, sidecar] = await workspace.parseFiles([paths['Main.tao']!, paths['Main.test.tao']!])
        const aliasTarget = (parsed: ParseResult, name: string) => {
          const alias = parsed.entry.ast.statements.find(statement =>
            AST.isAliasDeclaration(statement) && statement.name === name
          )
          Expect.Is(alias, AST.isAliasDeclaration)
          Expect.Is(alias.value, AST.isValueReference)
          const target = alias.value.target.ref
          return AST.isAliasDeclaration(target) ? target.name : undefined
        }

        Expect(aliasTarget(sidecar!, 'FromSibling')).toBe('Visible')
        Expect(aliasTarget(main!, 'FromSidecar')).toBeUndefined()
        Expect(AST.visibleValueDeclarations(main!.entry.ast, AST.isDeclaration).map(declaration => declaration.name))
          .not.toContain('OnlyInSidecar')
        Expect(Diagnostics.errorMessages(main!.diagnostics).join('\n')).toContain('OnlyInSidecar')
      },
    )
  })

  // The reference is what `validateFiles` did before it built once: a fresh build per entry, each
  // validated against its own graph. The Navigation app is the one to hold to it, because its
  // validators read the whole of an entry's graph — reachability, selection keys — and fourteen
  // entries share most of their files.
  // REMOVAL CANDIDATE: Real-app parity repeats many validators and entry builds; focused graph/isolation tests survive, but this protects whole-graph diagnostics across a larger shared batch.
  Test('reports exactly what a build per entry reports, on an app whose validators read the whole graph', async () => {
    const root = Repo.resolvePath('Apps/Test Apps/Navigation')
    const entryFiles = (await Repo.filesUnder(root)).filter(path => path.endsWith('.tao')).sort()
    Expect(entryFiles.length).toBeGreaterThan(10)

    const oneBuild = (await (await Workspace.open(root)).validateFiles(entryFiles)).diagnostics

    const packagesContext = await Packages.createContext(root)
    const reference = await Workspace.open(root)
    const parsedEntries: ParseResult[] = []
    const batch = new Map<string, AST.TaoFile>()
    for (const entryFile of entryFiles) {
      const parsed = await reference.parse(entryFile)
      parsedEntries.push(parsed)
      parsed.files.forEach(file => batch.set(file.path, file.ast))
    }
    const perEntry: Diagnostic[] = []
    for (const parsed of parsedEntries) {
      const validation = await Validator.validateParseResult(
        parsed,
        Validator.createContext(
          packagesContext,
          parsed.files.map(file => file.ast),
          parsed.entry.path,
          [...batch.values()],
        ),
      )
      perEntry.push(...validation.diagnostics)
    }

    const comparable = (diagnostics: readonly Diagnostic[]) =>
      Diagnostics.unique(diagnostics)
        .map(diagnostic =>
          JSON.stringify([diagnostic.filePath, diagnostic.range, diagnostic.severity, diagnostic.message])
        )
        .sort()
    Expect(comparable(oneBuild)).toEqual(comparable(perEntry))
    Expect(comparable(oneBuild).length).toBeGreaterThan(0)
  })
})
