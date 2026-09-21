import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  facadeReachedMembers,
  moduleBoundNames,
  namespaceFacadeAliases,
  resolveTaoBindings,
  reviewUnusedExports,
  runDeadExports,
  type SourceFile,
  taoForeignBindings,
  typeImportedMembers,
  type UnusedExport,
  unusedExportsOf,
} from '../dev-src/repository-tests/DeadExports'

/** names lists what a scan bound, so a form's assertion reads as the export it should have found. */
function names(source: string): string[] {
  return taoForeignBindings(source).bindings.map(binding => binding.name)
}

/** paths lists the modules a scan bound, keeping path handling separate from name handling. */
function paths(source: string): string[] {
  return taoForeignBindings(source).bindings.map(binding => binding.path)
}

Describe('tao foreign binding forms', () => {
  Test('reads a foreign action, including its runs-latest and failure clauses', () => {
    Expect(names('action SyncDraft(Path text, Content text) runs latest from ./Actions.ts')).toEqual(['SyncDraft'])
    Expect(names('action ApplySourceAction(Envelope text) fails Conflict "It changed." from ./Actions.ts'))
      .toEqual(['ApplySourceAction'])
    Expect(names('public action OpenFile(Path text) from ./Host.tsx')).toEqual(['OpenFile'])
    Expect(names('action FetchRecipe(Link text) returns RecipeDraft from ./FetchRecipe.ts'))
      .toEqual(['FetchRecipe'])
    Expect(names('action FetchRecipe(Link text) returns { Title, Steps } from ./FetchRecipe.ts'))
      .toEqual(['FetchRecipe'])
    // Every type expression a return position accepts, so a name is never mistaken for the export.
    Expect(names('action Recent(Since time) returns list of Recipe from ./Recent.ts')).toEqual(['Recent'])
    Expect(names('action Find(Query text) returns Recipe? from ./Find.ts')).toEqual(['Find'])
  })

  Test('does not fold a data field that happens to be named after a tail keyword', () => {
    // A `fails` field is a field, not a continuation. Folding it would blank its line and graft it
    // onto the field above, so a `fails` line only continues a declaration when a sentence follows.
    const source = 'data Attempts / Attempt {\n'
      + '   Name text\n'
      + '   fails number (default 0)\n'
      + '}\n'
      + '\n'
      + 'action Retry(Attempt) from ./Retry.ts\n'
    Expect(names(source)).toEqual(['Retry'])
    Expect(taoForeignBindings(source).unreadable).toEqual([])
  })

  Test('reads a foreign action whose tails are laid out one per line', () => {
    const declaration = 'action FetchRecipe(Link text) returns RecipeDraft\n'
      + '   fails NotARecipe "No recipe was found on that page."\n'
      + '   fails Unreachable "That page could not be read."\n'
      + '   from ./FetchRecipe.ts\n'
    Expect(names(declaration)).toEqual(['FetchRecipe'])
    Expect(taoForeignBindings(declaration).unreadable).toEqual([])
  })

  Test('leaves a mid-line `from` alone rather than folding an unrelated line onto its predecessor', () => {
    const source = 'scene RecipeLibrary() {\n'
      + '   query Recipes from MyKitchen.Recipes { }\n'
      + '   draft Edit = Recipe from Recipe\n'
      + '}\n'
    Expect(names(source)).toEqual([])
    Expect(taoForeignBindings(source).unreadable).toEqual([])
  })

  Test('reads a foreign view through its responds, accepts, and slots clauses', () => {
    Expect(names('view StudioEditorSurface() from ./Host.tsx')).toEqual(['StudioEditorSurface'])
    Expect(names('view FilesPanelSurface() accepts content from ./Host.tsx')).toEqual(['FilesPanelSurface'])
    Expect(names('view ProductHostBoundary() accepts content slots @files, @editor from ./Host.tsx'))
      .toEqual(['ProductHostBoundary'])
    Expect(names('view Ask(Value text) responds Answer from ./Host.tsx')).toEqual(['Ask'])
  })

  Test('reads a nested parameter list rather than stopping at its first parenthesis', () => {
    Expect(names('view FileCreateBar(Path text, Change action(text), Create action()) from ./Host.tsx'))
      .toEqual(['FileCreateBar'])
  })

  Test('reads a configuration implementation, whose export name is written before the path', () => {
    Expect(names('   provider StudioServerProvider from ./StudioServerDataProvider.ts'))
      .toEqual(['StudioServerProvider'])
    Expect(names('   nav Stack from ./NavKinds.ts')).toEqual(['Stack'])
  })

  Test('reads a bridged expression as its called function or its bare reference', () => {
    Expect(names('   return StudioFolderIsExpanded(Collapsed, Path) from ./StudioFolderExpansion.ts'))
      .toEqual(['StudioFolderIsExpanded'])
    Expect(names('   Adapter item is HNAdapter from ./HNAdapter.ts')).toEqual(['HNAdapter'])
    Expect(names('   let BuildStamp is text = BuildStamp() from ./Shell.ts')).toEqual(['BuildStamp'])
  })

  Test('reads the Revolution inject form as a default export', () => {
    const scan = taoForeignBindings('action FetchRecipe(Link text) returns RecipeDraft = inject "./FetchRecipe.ts"')

    Expect(scan.bindings).toEqual([{ line: 1, name: 'default', path: './FetchRecipe.ts' }])
  })

  Test('binds every foreign declaration in a file, at the line it was written on', () => {
    const scan = taoForeignBindings('view One() from ./One.tsx\n\naction Two(A text) from ./Two.ts\n')

    Expect(scan.bindings.map(binding => binding.line)).toEqual([1, 3])
    Expect(scan.unreadable).toEqual([])
  })

  Test('reads a head that wraps before its from, which is how several fails clauses are written', () => {
    const scan = taoForeignBindings([
      'action Publish(Value text) returns text',
      '   fails Offline "Publishing is unavailable."',
      '   fails Rejected "Publishing was rejected."',
      '   from ./Api.ts',
    ].join('\n'))

    Expect(scan.bindings).toEqual([{ line: 4, name: 'Publish', path: './Api.ts' }])
    Expect(scan.unreadable).toEqual([])
  })

  Test('does not complete a wrapped head across a blank line, since no declaration spans one', () => {
    const scan = taoForeignBindings('action Publish(Value text)\n\n   from ./Api.ts')

    Expect(scan.bindings).toEqual([])
    Expect(scan.unreadable).toEqual([3])
  })

  Test('never completes a line that carries head text of its own from its neighbour', () => {
    const scan = taoForeignBindings('action Publish(Value text)\n   retries Twice from ./Api.ts')

    Expect(scan.bindings.map(binding => binding.name)).toEqual(['Twice'])
  })

  Test('refuses a wrapped head that does not reduce to a parameter list', () => {
    // Each of these walks back past a clause it could not strip, so without the parameter-list
    // requirement the last identifier on that line becomes the export name: the phrase a `fails`
    // sentence names, the word after an unrecognized `runs`, or an unrelated neighbouring binding.
    const cases = [
      'action Publish(Value text)\n   fails Offline InviteUsed\n   from ./Api.ts',
      'action Publish(Value text)\n   runs single\n   from ./Api.ts',
      'let Other = Thing\n   from ./Api.ts',
    ]

    for (const source of cases) {
      const scan = taoForeignBindings(source)

      Expect(scan.bindings).toEqual([])
      Expect(scan.unreadable.length).toBe(1)
    }
  })

  Test('still reads a same-line binding that has no parameter list', () => {
    Expect(names('nav Workspace from ./Workspace.ts')).toEqual(['Workspace'])
  })
})

Describe('tao foreign binding exclusions', () => {
  Test('skips Tao package imports, which name a package rather than a module', () => {
    Expect(names('use SlotNav from @tao/nav')).toEqual([])
    Expect(names('use Title, Body from ./Packages/@cards/Title.tao')).toEqual([])
  })

  Test('skips comments and prose that merely contain the word from', () => {
    Expect(names('// a view imported from ./Somewhere.tsx under a local name')).toEqual([])
    Expect(names('   Text("Shared from Skillet")')).toEqual([])
    Expect(names('   Text("Fake from ./Somewhere.tsx")')).toEqual([])
    Expect(names('/*\n view Fake() from ./Somewhere.tsx\n*/\nview Real() from ./Real.tsx')).toEqual(['Real'])
  })

  Test('does not treat injection fences inside strings or comments as syntax', () => {
    const source = [
      'Text("```")',
      '// ```',
      '/* ``` */',
      'view Real() from ./Real.tsx',
    ].join('\n')

    Expect(names(source)).toEqual(['Real'])
  })

  Test('skips an inline TypeScript injection, which the compiler emits as its own module', () => {
    const source = 'render inject Value ```ts\nimport { Text } from ./react-native\nreturn <Text />\n```\n'

    Expect(taoForeignBindings(source).bindings).toEqual([])
  })

  Test('skips a package path, since only a relative path reaches a TypeScript sidecar', () => {
    Expect(paths('view Button(Title text) from @tao/ui')).toEqual([])
    Expect(paths('view Button(Title text) from ../shared/Button.tsx')).toEqual(['../shared/Button.tsx'])
  })

  Test('reports a binding whose export name it cannot read rather than guessing one', () => {
    const scan = taoForeignBindings('action Later(A text) retries 3 from ./Later.ts')

    Expect(scan.bindings).toEqual([])
    Expect(scan.unreadable).toEqual([1])
  })
})

Describe('tao binding resolution against TypeScript', () => {
  const actions: SourceFile = {
    path: 'packages/studio/studio-src/Actions.ts',
    source: 'export function SyncDraft() {}\nexport function CreateFile() {}\n',
  }
  const host: SourceFile = { path: 'packages/studio/studio-src/Host.tsx', source: 'export function CreateFile() {}\n' }

  Test('keys a binding by the module it names, not by the export name alone', () => {
    const tao: SourceFile = {
      path: 'packages/studio/studio-src/Client.tao',
      source: 'action SyncDraft(Path text) from ./Actions.ts\naction CreateFile(Path text) from ./Host.tsx\n',
    }
    const resolved = resolveTaoBindings([tao], [actions, host])

    Expect([...resolved.keys].sort()).toEqual([
      'packages/studio/studio-src/Actions.ts#SyncDraft',
      'packages/studio/studio-src/Host.tsx#CreateFile',
    ])
    Expect(resolved.staleness).toEqual([])
  })

  Test('follows an entry that republishes the bound name from a sibling module', () => {
    const entry: SourceFile = {
      path: 'packages/studio/studio-src/Entry.tsx',
      source: "export { CreateFile } from './parts/Files'\nexport { type Draft, SaveDraft } from './parts/Drafts'\n",
    }
    const files: SourceFile = {
      path: 'packages/studio/studio-src/parts/Files.ts',
      source: 'export function CreateFile() {}\n',
    }
    const drafts: SourceFile = {
      path: 'packages/studio/studio-src/parts/Drafts.ts',
      source: 'export function SaveDraft() {}\n',
    }
    const tao: SourceFile = {
      path: 'packages/studio/studio-src/Client.tao',
      source: 'action CreateFile(Path text) from ./Entry.tsx\naction SaveDraft(Path text) from ./Entry.tsx\n',
    }
    const resolved = resolveTaoBindings([tao], [entry, files, drafts])

    Expect([...resolved.keys].sort()).toEqual([
      'packages/studio/studio-src/Entry.tsx#CreateFile',
      'packages/studio/studio-src/Entry.tsx#SaveDraft',
      'packages/studio/studio-src/parts/Drafts.ts#SaveDraft',
      'packages/studio/studio-src/parts/Files.ts#CreateFile',
    ])
    Expect(resolved.staleness).toEqual([])
  })

  Test('reports a binding naming a symbol its module does not declare', () => {
    const tao: SourceFile = {
      path: 'packages/studio/studio-src/Client.tao',
      source: 'action RenameFile(Path text) from ./Actions.ts\n',
    }
    const resolved = resolveTaoBindings([tao], [actions])

    Expect([...resolved.keys]).toEqual([])
    Expect(resolved.staleness.length).toBe(1)
    Expect(resolved.staleness[0]).toContain('binds RenameFile')
  })

  Test('reports an unresolved module in a .tao source and allows one in a tranche source', () => {
    const current: SourceFile = { path: 'Apps/App/App.tao', source: 'view Shell() from ./Shell.tsx\n' }
    const tranche: SourceFile = {
      path: 'Apps/App/App.tao-revolution',
      source: 'view Shell() from ./Shell.tsx\n',
    }

    Expect(resolveTaoBindings([current], []).staleness.length).toBe(1)
    Expect(resolveTaoBindings([tranche], []).staleness).toEqual([])
  })
})

Describe('namespace facade reachability', () => {
  const files: SourceFile[] = [
    {
      path: 'packages/shared/shared-src/FS.ts',
      source: 'export function readText() {}\nexport function unusedHelper() {}\n',
    },
    {
      path: 'packages/shared/shared-src/shared.ts',
      source: "import * as FS from './FS'\nexport { FS }\n",
    },
    {
      path: 'packages/dev/dev-src/Consumer.ts',
      source: "import { FS } from '@shared'\nawait FS.readText('x')\n",
    },
  ]

  Test('finds a module published as a namespace object under the name it is re-exported as', () => {
    Expect([...namespaceFacadeAliases(files)]).toEqual([['packages/shared/shared-src/FS.ts', new Set(['FS'])]])
  })

  Test('keeps only the members another module actually reaches through the facade', () => {
    Expect([...facadeReachedMembers(files, namespaceFacadeAliases(files))])
      .toEqual(['packages/shared/shared-src/FS.ts#readText'])
  })

  Test('ignores a namespace import the importing module never re-exports', () => {
    const local: SourceFile[] = [
      { path: 'packages/shared/shared-src/FS.ts', source: 'export function readText() {}\n' },
      { path: 'packages/shared/shared-src/Repo.ts', source: "import * as FS from './FS'\nFS.readText()\n" },
    ]

    Expect([...namespaceFacadeAliases(local)]).toEqual([])
  })

  // Matching `FS.member` anywhere kept a genuinely dead export alive whenever some unrelated file
  // happened to own an `FS` of its own, or merely named one in a comment or a fixture string.
  Test('ignores a facade member name in a file that never imports the facade', () => {
    const local: SourceFile[] = [
      ...files.slice(0, 2),
      {
        path: 'packages/dev/dev-src/Unrelated.ts',
        source: 'const FS = { unusedHelper() {} }\n'
          + 'FS.unusedHelper()\n'
          + '// the shared facade spells this FS.readText\n'
          + "const fixture = 'FS.readText(path)'\n",
      },
    ]

    Expect([...facadeReachedMembers(local, namespaceFacadeAliases(local))]).toEqual([])
  })

  // `import * as Shared from '@shared'` then `Shared.FS.readText` is how two of this repository's
  // own modules reach a facade, and dropping it would call a live export dead.
  Test('counts a facade reached through a namespace import of the package that publishes it', () => {
    const local: SourceFile[] = [
      ...files.slice(0, 2),
      {
        path: 'packages/dev/dev-src/Namespaced.ts',
        source: "import * as Shared from '@shared'\nawait Shared.FS.readText('x')\n",
      },
    ]

    Expect([...facadeReachedMembers(local, namespaceFacadeAliases(local))])
      .toEqual(['packages/shared/shared-src/FS.ts#readText'])
  })

  // Naming a member in prose is not using it. Counting those mentions kept dead exports out of the
  // report, which is the whole output of this tool.
  Test('ignores a member named only in a comment or a quoted string', () => {
    const local: SourceFile[] = [
      ...files.slice(0, 2),
      {
        path: 'packages/dev/dev-src/Prose.ts',
        source: "import * as Shared from '@shared'\n"
          + '// Shared.FS.readText is what this used to call.\n'
          + '/* See Shared.FS.writeText for the other half. */\n'
          + "const message = 'call Shared.FS.remove when done'\n"
          + 'await Shared.FS.exists(message)\n',
      },
    ]

    Expect([...facadeReachedMembers(local, namespaceFacadeAliases(local))])
      .toEqual(['packages/shared/shared-src/FS.ts#exists'])
  })

  // `${…}` holes hold real code, so masking a template literal would call a live export dead.
  Test('counts a member reached inside a template literal hole', () => {
    const local: SourceFile[] = [
      ...files.slice(0, 2),
      {
        path: 'packages/dev/dev-src/Template.ts',
        source: "import * as Shared from '@shared'\n"
          + 'const label = `read ${await Shared.FS.readText(path)}`\n',
      },
    ]

    Expect([...facadeReachedMembers(local, namespaceFacadeAliases(local))])
      .toEqual(['packages/shared/shared-src/FS.ts#readText'])
  })
})

Describe('module binding names', () => {
  Test('reads every import and re-export form a module binds a name under', () => {
    const source = [
      "import { FS, type Diagnostic } from '@shared'",
      "import * as Repo from './Repo'",
      "import Validator, { type ValidationResult } from '@validator'",
      "import { Original as Renamed } from './Other'",
      "export { HCI } from '@shared'",
      'import {',
      '  Wrapped,',
      "} from './Wrapped'",
      "export * from './Everything'",
      "import './side-effect'",
    ].join('\n')

    Expect([...moduleBoundNames(source)].sort()).toEqual([
      'Diagnostic',
      'FS',
      'HCI',
      'Renamed',
      'Repo',
      'ValidationResult',
      'Validator',
      'Wrapped',
    ])
  })

  Test('binds nothing for a name a module declares itself or only mentions', () => {
    const source = 'const FS = { readText() {} }\n// FS.readText is imported from @shared elsewhere\n'

    Expect([...moduleBoundNames(source)]).toEqual([])
  })
})

Describe('import-type query references', () => {
  Test('reads a declaration-merged namespace republishing a type by import query', () => {
    const files: SourceFile[] = [
      { path: 'packages/ast-utils/ast-utils-src/invocations.ts', source: 'export type ActionInvocationPair = {}\n' },
      {
        path: 'packages/ast-utils/ast-utils-src/ast-utils.ts',
        source: "export namespace ASTUtils {\n  export type Pair = import('./invocations').ActionInvocationPair\n}\n",
      },
    ]

    Expect([...typeImportedMembers(files)])
      .toEqual(['packages/ast-utils/ast-utils-src/invocations.ts#ActionInvocationPair'])
  })

  Test('ignores an import query naming a module outside the scanned files', () => {
    const files: SourceFile[] = [
      { path: 'packages/a/a-src/a.ts', source: "type T = import('./missing').Gone\n" },
    ]

    Expect([...typeImportedMembers(files)]).toEqual([])
  })
})

Describe('unused export review', () => {
  const unused: readonly UnusedExport[] = [
    { file: 'packages/studio/studio-src/Actions.ts', line: 4, name: 'CreateFile' },
    { file: 'packages/studio/studio-src/Host.tsx', line: 9, name: 'CreateFile' },
    { file: 'packages/shared/shared-src/FS.ts', line: 12, name: 'readText' },
  ]

  Test('reports a same-named export in a module no .tao source binds', () => {
    const review = reviewUnusedExports(
      unused,
      new Set(['packages/studio/studio-src/Host.tsx#CreateFile']),
      new Set(['packages/shared/shared-src/FS.ts#readText']),
      new Set(),
    )

    Expect(review.reported).toEqual([{ file: 'packages/studio/studio-src/Actions.ts', line: 4, name: 'CreateFile' }])
    Expect(review.taoBound).toBe(1)
    Expect(review.facadeReached).toBe(1)
  })

  Test('reports every entry when nothing explains it', () => {
    const review = reviewUnusedExports(unused, new Set(), new Set(), new Set())

    Expect(review.reported.length).toBe(3)
    Expect(review.taoBound).toBe(0)
    Expect(review.facadeReached).toBe(0)
    Expect(review.typeImported).toBe(0)
  })

  Test('counts an export republished only by an import-type query as explained', () => {
    const review = reviewUnusedExports(
      unused,
      new Set(),
      new Set(),
      new Set(['packages/shared/shared-src/FS.ts#readText']),
    )

    Expect(review.reported.length).toBe(2)
    Expect(review.typeImported).toBe(1)
  })
})

Describe('knip report parsing', () => {
  Test('reads every unused export list knip reports, sorted by file and line', () => {
    const entries = unusedExportsOf({
      issues: [
        { file: 'b.ts', types: [{ line: 3, name: 'Second' }] },
        { exports: [{ line: 9, name: 'Third' }], file: 'a.ts', types: [{ line: 2, name: 'First' }] },
      ],
    })

    Expect(entries).toEqual([
      { file: 'a.ts', line: 2, name: 'First' },
      { file: 'a.ts', line: 9, name: 'Third' },
      { file: 'b.ts', line: 3, name: 'Second' },
    ])
  })

  Test('rejects output that is not a knip report rather than reporting nothing found', () => {
    Expect(() => unusedExportsOf({})).toThrow('knip produced no JSON report')
  })
})

Describe('recorded kept exports', () => {
  /**
   * A record of exports kept on purpose is one named file per package per reason, declared an entry
   * point by its own path rather than by a pattern. A path that no longer resolves is how such a
   * record rots into a list nobody can account for: the file is renamed or deleted, the entry line
   * stays, and the next symbol that lands under the old name is spared silently.
   */
  Test('names every entry point by a path that resolves in some package it covers', async () => {
    const config = await FS.readJson<{ workspaces: Record<string, { entry?: readonly string[] }> }>(
      Repo.resolvePath('config/knip.json'),
    )

    const packages = await FS.listDir(Repo.resolvePath('packages'))
    const nestedPackages: string[] = []
    for (const name of packages) {
      if (
        !await FS.isFile(Repo.resolvePath(`packages/${name}/package.json`))
        && await FS.isDirectory(Repo.resolvePath(`packages/${name}`))
      ) {
        for (const nested of await FS.listDir(Repo.resolvePath(`packages/${name}`))) {
          nestedPackages.push(`${name}/${nested}`)
        }
      }
    }
    const unresolved: string[] = []
    for (const [workspace, { entry = [] }] of Object.entries(config.workspaces)) {
      if (!workspace.startsWith('packages/')) {
        continue
      }
      const covered = workspace === 'packages/*'
        ? packages
        : workspace === 'packages/*/*'
        ? nestedPackages
        : [workspace.slice('packages/'.length)]
      for (const pattern of entry) {
        if (/[*?{}[\]]/.test(pattern)) {
          continue
        }
        const resolves = covered.some(name => FS.existsSync(Repo.resolvePath(`packages/${name}/${pattern}`)))
        if (!resolves) {
          unresolved.push(`${workspace} -> ${pattern}`)
        }
      }
    }
    Expect(unresolved).toEqual([])
  })

  Test('declares the one carve-out record this repository keeps', async () => {
    const config = await FS.readJson<{ workspaces: Record<string, { entry?: readonly string[] }> }>(
      Repo.resolvePath('config/knip.json'),
    )

    Expect(config.workspaces['packages/*/*']?.entry).toContain('cli-src/subprocess-test-api.ts')
    Expect(FS.existsSync(Repo.resolvePath('packages/cli/tao-cli/cli-src/subprocess-test-api.ts'))).toBe(true)
  })
})

Describe('dead export run', () => {
  /** repository builds a checkout with one Tao binding, one dead export, and one live namesake. */
  async function repository(): Promise<string> {
    const root = await mkTestDir('tao-dead-exports-')
    const source = 'packages/studio/studio-src'
    await FS.writeText(
      FS.resolvePath(`${source}/Client.tao`, root),
      'action SyncDraft(Path text) runs latest from ./Actions.ts\n',
    )
    await FS.writeText(FS.resolvePath(`${source}/Actions.ts`, root), 'export function SyncDraft() {}\n')
    await FS.writeText(FS.resolvePath(`${source}/Host.tsx`, root), 'export function SyncDraft() {}\n')
    return root
  }

  const report = {
    issues: [
      { exports: [{ line: 1, name: 'SyncDraft' }], file: 'packages/studio/studio-src/Actions.ts' },
      { exports: [{ line: 1, name: 'SyncDraft' }], file: 'packages/studio/studio-src/Host.tsx' },
    ],
  }

  Test('fails on the namesake in the unbound module while hiding the bound export', async () => {
    const root = await repository()
    try {
      const captured = await withCapturedOutput(async () =>
        await runDeadExports({ readKnipReport: async () => report, repositoryRoot: root })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stderr).toContain('packages/studio/studio-src/Host.tsx:1 SyncDraft')
      Expect(captured.stderr).not.toContain('Actions.ts:1 SyncDraft')
      Expect(captured.stderr).toContain('config/knip.json')
      Expect(captured.stdout).toContain('1 unused, 1 bound from .tao sources')
    } finally {
      await FS.remove(root)
    }
  })

  Test('passes with nothing to report, and says so without a remedy nobody needs', async () => {
    const root = await repository()
    try {
      const captured = await withCapturedOutput(async () =>
        await runDeadExports({ readKnipReport: async () => ({ issues: [] }), repositoryRoot: root })
      )

      Expect(captured.result).toBe(0)
      Expect(captured.stderr).toBe('')
      Expect(captured.stdout).toContain('0 unused, 0 bound from .tao sources')
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails when a Tao source binds in a form the scanner cannot read', async () => {
    const root = await repository()
    try {
      await FS.writeText(
        FS.resolvePath('packages/studio/studio-src/Client.tao', root),
        'action SyncDraft(Path text) retries 3 from ./Actions.ts\n',
      )
      const captured = await withCapturedOutput(async () =>
        await runDeadExports({ readKnipReport: async () => report, repositoryRoot: root })
      )

      Expect(captured.result).toBe(1)
      Expect(captured.stderr).toContain('a form this check cannot read')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reads every Tao binding in this repository', async () => {
    const captured = await withCapturedOutput(async () =>
      await runDeadExports({ readKnipReport: async () => ({ issues: [] }), repositoryRoot: Repo.getRoot() })
    )

    Expect(captured.stderr).toBe('')
    Expect(captured.result).toBe(0)
  })
})
