import { Errors, FS } from '@shared'
import { TaoFileIcon } from '@shared/core'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { LSPWorkspace } from 'tao-compiler/workspace'
import { TaoFormatter } from 'tao-formatter'
import { AST, Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { publishIdeExtensionOutputs } from '../esbuild.config'
import { workspaceServerPlan, workspaceServerRoots } from '../ide-extension-src/extension/workspace-server-roots'
import { mergeTaoTextMateGrammar } from '../ide-extension-src/syntax/textmate-grammar'

Describe('Tao IDE extension smoke', () => {
  Test('keeps multi-root workspaces in independent language-server package contexts', () => {
    Expect(workspaceServerRoots(['/work/First', '/work/Second', '/work/First'], '/fallback')).toEqual([
      '/work/First',
      '/work/Second',
    ])
    Expect(workspaceServerRoots([], '/fallback')).toEqual(['/fallback'])
    Expect(workspaceServerPlan(['/work/First', '/work/Old'], ['/work/First', '/work/Second'], '/fallback'))
      .toEqual({
        add: ['/work/Second'],
        remove: ['/work/Old'],
        roots: ['/work/First', '/work/Second'],
      })
  })
  Test('points the extension manifest at its built entrypoint and language configuration', async () => {
    const packageJson = await FS.readJson<IdeExtensionPackageJson>(
      FS.resolvePath('../package.json', import.meta.dir),
    )
    Expect(packageJson.main).toBe('_gen_ide-extension/extension/main.cjs')
    Expect(packageJson.contributes.languages[0]?.configuration).toBe('./language-configuration.json')
    Expect(await FS.isFile(FS.resolvePath('../language-configuration.json', import.meta.dir))).toBe(true)
    const icon = packageJson.contributes.languages[0]?.icon
    Expect(icon).toEqual({ light: './icons/tao-light.svg', dark: './icons/tao-dark.svg' })
    for (const theme of ['light', 'dark'] as const) {
      Expect(await FS.readText(FS.resolvePath(`../${icon?.[theme]}`, import.meta.dir)))
        .toBe(TaoFileIcon.svg(TaoFileIcon.colors[theme]))
    }
    Expect(packageJson.files).toContain('icons/')
    Expect(await FS.readText(FS.resolvePath('../LICENSE', import.meta.dir)))
      .toBe(await FS.readText(FS.resolvePath('../../../../LICENSE', import.meta.dir)))
  })

  Test('restores both persistent IDE output roots after an injected failure', async () => {
    const root = await mkTestDir('tao-ide-publication-failure-')
    const stagingPackageRoot = FS.resolvePath('staging/packages/ides/ide-extension', root)
    const packageRoot = FS.resolvePath('persistent/packages/ides/ide-extension', root)
    const generatedRoot = FS.resolvePath('_gen_ide-extension', packageRoot)
    const syntaxRoot = FS.resolvePath('ide-extension-syntaxes/_gen_syntaxes', packageRoot)
    await FS.writeText(
      FS.resolvePath('_gen_ide-extension/extension/main.cjs', stagingPackageRoot),
      'new extension bytes',
    )
    await FS.writeText(
      FS.resolvePath('ide-extension-syntaxes/_gen_syntaxes/tao.tmLanguage.json', stagingPackageRoot),
      'new grammar bytes',
    )
    await FS.writeText(FS.resolvePath('extension/main.cjs', generatedRoot), 'old extension bytes')
    await FS.writeText(FS.resolvePath('tao.tmLanguage.json', syntaxRoot), 'old grammar bytes')
    await FS.writeText(FS.resolvePath('stale.json', syntaxRoot), 'old stale bytes')
    const before = await persistentOutputIdentity([generatedRoot, syntaxRoot])
    let injected = false

    await Expect(publishIdeExtensionOutputs(stagingPackageRoot, packageRoot, {
      beforeRemove: async path => {
        if (!injected && FS.basename(path) === 'stale.json') {
          injected = true
          Errors.throwHostEnvironment('injected IDE publication failure')
        }
      },
      boundaryPath: root,
    })).rejects.toThrow('injected IDE publication failure')

    Expect(injected).toBe(true)
    Expect(await persistentOutputIdentity([generatedRoot, syntaxRoot])).toBe(before)
  })

  Test('merges Tao syntax highlighting with embedded TypeScript fences', async () => {
    const generatedGrammar = await FS.readJson<Record<string, unknown>>(
      FS.resolvePath('../ide-extension-syntaxes/_gen_syntaxes/tao.tmLanguage.json', import.meta.dir),
    )
    const overlayGrammar = await FS.readJson<Record<string, unknown>>(
      FS.resolvePath('../ide-extension-syntaxes/tao.tmLanguage.overlay.json', import.meta.dir),
    )
    const merged = mergeTaoTextMateGrammar(generatedGrammar, overlayGrammar)

    // TextMate convention names a language's root scope and every token's suffix after its short
    // language id, which is `tao` here as it is for VS Code's language and the `.tao` extension.
    Expect(merged['scopeName']).toBe('source.tao')
    Expect(JSON.stringify(merged)).not.toContain('tao-lang')
    Expect(JSON.stringify(merged)).toContain('meta.embedded.block.ts.tao')
    Expect(JSON.stringify(merged)).toContain('source.tsx')
    Expect(JSON.stringify(merged)).toContain('meta.template.expression.tao')
    Expect(JSON.stringify(merged)).toContain('constant.character.escape.tao')
    Expect(JSON.stringify(merged)).toContain('constant.numeric.tao')
    Expect(JSON.stringify(merged)).toContain('constant.other.tag.tao')
    Expect(JSON.stringify(merged)).toContain('constant.other.color.tao')
    // A keyed name, a declared name, and a referenced type each carry their own scope so a theme
    // can tell `@home`, `WordFlowerNavigator`, and `SelectionNav` apart.
    Expect(JSON.stringify(merged)).toContain('entity.other.attribute-name.tao')
    Expect(JSON.stringify(merged)).toContain('entity.name.function.tao')
    Expect(JSON.stringify(merged)).toContain('entity.name.type.tao')
    Expect(mergeTaoTextMateGrammar(merged, overlayGrammar)).toEqual(merged)
  })

  Test('contributes Tao command-palette source actions', async () => {
    const packageJson = await FS.readJson<IdeExtensionPackageJson>(
      FS.resolvePath('../package.json', import.meta.dir),
    )
    const commands = packageJson.contributes.commands.map(command => command.title)

    Expect(commands).toEqual([
      'Tao: Fix Source',
      'Tao: Organize Source',
      'Tao: Remove Unused Imports',
      'Tao: Move Renders Last',
      'Tao: Show Tooling',
      'Tao: Open TypeScript Config',
    ])
    Expect(packageJson.contributes.grammars[0]?.embeddedLanguages).toEqual({
      'meta.embedded.block.ts.tao': 'typescriptreact',
    })
  })

  Test('reports binding declaration-order diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      app Demo { id "demo-order" version "1.0.0" name "Demo order"
        view MainView
      }
      let First = Second
      let Second = First
      view MainView() {
        render Text(First)
      }
      view Text(Value text) { }
    `)

    Expect(diagnostics).toContain(
      "Binding 'First' cannot reference 'Second' because it is not declared before the binding.",
    )
  })

  Test('formats documents with canonical Tao indentation regardless of editor tab size', async () => {
    const { formatter, document, cleanup } = await buildFormatterFixture('view   MainView() {  render  Stack(){   } }')
    try {
      const edits = await formatter!.formatDocument(document, {
        textDocument: { uri: document.textDocument.uri },
        options: { tabSize: 4, insertSpaces: true },
      })

      Expect(applyEdits(document, edits)).toBe('view MainView() {\n   render Stack() { }\n}\n')
    } finally {
      await cleanup()
    }
  })

  Test('formats embedded TypeScript fences through the language server', async () => {
    const { formatter, document, cleanup } = await buildFormatterFixture(
      `view MainView() { render inject \`\`\`ts\nconst message = "hi";\nreturn <RN.Text accessibilityLabel='greeting'>{ message }</RN.Text>;\n\`\`\` }`,
    )
    try {
      const edits = await formatter!.formatDocument(document, {
        textDocument: { uri: document.textDocument.uri },
        options: { tabSize: 4, insertSpaces: true },
      })

      Expect(applyEdits(document, edits)).toBe(
        'view MainView() {\n'
          + '   render inject ```ts\n'
          + "      const message = 'hi'\n"
          + '      return <RN.Text accessibilityLabel="greeting">{message}</RN.Text>\n'
          + '   ```\n'
          + '}\n',
      )
    } finally {
      await cleanup()
    }
  })

  Test('serves the organize use statements source action through the language server', async () => {
    const fixture = await buildCodeActionFixture(
      'app MyApp { id "source-actions" version "1.0.0" name "Source actions" view MainView }\nuse Text from @tao/ui\nview MainView() { render Text("hi") }\n',
    )
    try {
      const { provider, document } = fixture
      const actions = await provider.getCodeActions(document, {
        textDocument: { uri: document.textDocument.uri },
        range: fullRange(document),
        context: { diagnostics: [], only: ['source.organizeImports'] },
      })
      const organize = actions?.find(action => 'title' in action && action.title === 'Tao: Organize Use Statements')

      Expect(organize && 'kind' in organize ? organize.kind : undefined).toBe('source.organizeImports')
      const edits = organize && 'edit' in organize ? organize.edit?.changes?.[document.textDocument.uri] : undefined
      Expect(edits?.[0]?.newText).toBe(
        'use Text from @tao/ui\n\napp MyApp {\n   id "source-actions"\n   version "1.0.0"\n   name "Source actions"\n   view MainView\n}\n\nview MainView() {\n   render Text("hi")\n}\n',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  Test('serves the move-render quick fix for render-not-last diagnostics', async () => {
    const fixture = await buildCodeActionFixture(
      'view MainView() {\n   render Text(Greeting)   let Greeting = "hi"\n}\n',
    )
    try {
      const { provider, document } = fixture
      const actions = await provider.getCodeActions(document, {
        textDocument: { uri: document.textDocument.uri },
        range: fullRange(document),
        context: {
          diagnostics: [{ range: fullRange(document), message: 'render', code: 'tao-render-not-last' }],
          only: ['quickfix'],
        },
      })
      const moveRender = actions?.find(action => 'title' in action && action.title === 'Tao: Move render to end')

      const edits = moveRender && 'edit' in moveRender
        ? moveRender.edit?.changes?.[document.textDocument.uri]
        : undefined
      Expect(edits?.[0]?.newText).toBe('view MainView() {\n   let Greeting = "hi"\n   render Text(Greeting)\n}\n')
    } finally {
      await fixture.cleanup()
    }
  })

  Test('reports duplicate visible declarations through Langium services', async () => {
    const diagnostics = await validateFilesWithLanguageServerServices({
      'First.tao': `
        project let Shared = "First"
      `,
      'Second.tao': `
        project let Shared = "Second"
      `,
    })

    Expect(
      diagnostics.some(diagnostic => diagnostic.includes("Visible declaration 'Shared' is declared more than once")),
    ).toBe(true)
  })

  Test('resolves same-project imports through Langium services', async () => {
    const diagnostics = await validateOnDiskFileWithLanguageServerServices('Main.tao', {
      'Main.tao': `
        use MainView from ./views
        app PackageApp { id "package-app" version "1.0.0" name "Package app" view MainView }
      `,
      'views/Main.tao': `
        project view MainView() {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
    })

    Expect(diagnostics).toEqual([])
  })
})

async function buildCodeActionFixture(source: string): Promise<{
  provider: Langium.CodeActionProvider
  document: AST.Document
  cleanup: () => Promise<void>
}> {
  const rootDir = await mkTestDir('tao-ide-actions-')
  await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
  const workspace = await LSPWorkspace.open(rootDir, Langium.NodeFileSystem, {
    lspCodeActionProvider: () => new TaoCodeActionProvider(),
  })
  const services = workspace.services
  const uri = Langium.URI.file(FS.resolvePath(`ide-actions-${++codeActionFixtureId}.tao`, rootDir))
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: false,
  })
  const provider = services.language.lsp.CodeActionProvider
  Expect(provider).toBeInstanceOf(TaoCodeActionProvider)
  return { provider: provider!, document, cleanup: async () => await FS.remove(rootDir) }
}

async function buildFormatterFixture(source: string): Promise<{
  formatter: Langium.Formatter | undefined
  document: AST.Document
  cleanup: () => Promise<void>
}> {
  const rootDir = await mkTestDir('tao-ide-format-')
  await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
  const workspace = await LSPWorkspace.open(rootDir, Langium.NodeFileSystem, {
    lspFormatter: () => new TaoFormatter(),
  })
  const services = workspace.services
  const uri = Langium.URI.file(FS.resolvePath('ide-format.tao', rootDir))
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: false,
  })
  return {
    formatter: services.language.lsp.Formatter,
    document,
    cleanup: async () => await FS.remove(rootDir),
  }
}

let codeActionFixtureId = 0

function fullRange(document: AST.Document): { start: Langium.Position; end: Langium.Position } {
  return {
    start: { line: 0, character: 0 },
    end: document.textDocument.positionAt(document.textDocument.getText().length),
  }
}

function applyEdits(document: AST.Document, edits: readonly Langium.TextEdit[]): string {
  const textDocument = document.textDocument
  const sorted = [...edits].sort(
    (a, b) => textDocument.offsetAt(b.range.start) - textDocument.offsetAt(a.range.start),
  )
  let text = textDocument.getText()
  for (const edit of sorted) {
    text = text.slice(0, textDocument.offsetAt(edit.range.start))
      + edit.newText
      + text.slice(textDocument.offsetAt(edit.range.end))
  }
  return text
}

/** LSP 3.18 allows MarkupContent diagnostic messages; these assertions compare plain text. */
function diagnosticMessageText(message: string | { value: string }): string {
  return typeof message === 'string' ? message : message.value
}

async function validateWithLanguageServerServices(source: string): Promise<string[]> {
  const rootDir = await mkTestDir('tao-ide-lsp-')
  try {
    await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const uri = Langium.URI.file(FS.resolvePath('ide-smoke.tao', rootDir))
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
    services.shared.workspace.LangiumDocuments.addDocument(document)

    await services.shared.workspace.DocumentBuilder.build([document], {
      eagerLinking: true,
      validation: true,
    })

    return (document.diagnostics ?? []).map(diagnostic => diagnosticMessageText(diagnostic.message))
  } finally {
    await FS.remove(rootDir)
  }
}

async function validateFilesWithLanguageServerServices(sources: Record<string, string>): Promise<string[]> {
  const rootDir = await mkTestDir('tao-ide-lsp-')
  try {
    await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const documents = Object.entries(sources).map(([path, source]) => {
      const workspacePath = FS.resolvePath(path, rootDir)
      const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
        source,
        Langium.URI.file(workspacePath),
      )
      services.shared.workspace.LangiumDocuments.addDocument(document)
      return document
    })

    await services.shared.workspace.DocumentBuilder.build(documents, {
      eagerLinking: true,
      validation: true,
    })

    return documents.flatMap(document =>
      (document.diagnostics ?? []).map(diagnostic => diagnosticMessageText(diagnostic.message))
    )
  } finally {
    await FS.remove(rootDir)
  }
}

async function validateOnDiskFileWithLanguageServerServices(
  entryFile: string,
  sources: Record<string, string>,
): Promise<string[]> {
  const rootDir = await mkTestDir('tao-ide-lsp-')
  try {
    await FS.writeText(FS.resolvePath('.tao/.gitkeep', rootDir), '')
    for (const [path, source] of Object.entries(sources)) {
      await FS.writeText(FS.resolvePath(path, rootDir), source)
    }
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const entryPath = FS.resolvePath(entryFile, rootDir)
    const document = Array.from(services.shared.workspace.LangiumDocuments.all)
      .find(document => document.uri.path === entryPath) as AST.Document | undefined

    Expect(document).toBeDefined()
    await services.shared.workspace.DocumentBuilder.build([document!], {
      eagerLinking: true,
      validation: true,
    })

    return (document!.diagnostics ?? []).map(diagnostic => diagnosticMessageText(diagnostic.message))
  } finally {
    await FS.remove(rootDir)
  }
}

async function persistentOutputIdentity(roots: readonly string[]): Promise<string> {
  const entries: Array<readonly [string, string]> = []
  for (const [index, root] of roots.entries()) {
    if (!await FS.isDirectory(root)) {
      continue
    }
    for await (const path of FS.walk(root, { includeHidden: true })) {
      entries.push([`${index}/${FS.relativePath(root, path)}`, path])
    }
  }
  return await FS.filesIdentity(entries)
}

type IdeExtensionPackageJson = {
  main: string
  files: string[]
  contributes: {
    commands: {
      command: string
      title: string
    }[]
    grammars: {
      embeddedLanguages?: Record<string, string>
    }[]
    languages: {
      configuration: string
      icon?: { light: string; dark: string }
    }[]
  }
}
