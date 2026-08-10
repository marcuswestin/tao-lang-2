import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TaoFormatter } from 'tao-formatter'
import { AST, Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { LSPWorkspace } from 'tao-workspace'
import { mergeTaoTextMateGrammar } from '../ide-extension-src/syntax/textmate-grammar'

Describe('Tao IDE extension smoke', () => {
  Test('declares extension and language server entrypoint build inputs', async () => {
    const packageJson = await FS.readJson<IdeExtensionPackageJson>(
      FS.resolvePath('../package.json', import.meta.dir),
    )
    Expect(packageJson.main).toBe('_gen_ide-extension/extension/main.cjs')

    const entrypoints = [
      '../ide-extension-src/extension/main.ts',
      '../ide-extension-src/language/main.ts',
      '../esbuild.config.ts',
      '../language-configuration.json',
    ]
    for (const entrypoint of entrypoints) {
      Expect(await FS.isFile(FS.resolvePath(entrypoint, import.meta.dir))).toBe(true)
    }
  })

  Test('generates the TextMate grammar for VS Code', async () => {
    const grammarPath = FS.resolvePath(
      '../ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
      import.meta.dir,
    )
    Expect(await FS.isFile(grammarPath)).toBe(true)
  })

  Test('merges Tao syntax highlighting with embedded TypeScript fences', async () => {
    const generatedGrammar = await FS.readJson<Record<string, unknown>>(
      FS.resolvePath('../ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json', import.meta.dir),
    )
    const overlayGrammar = await FS.readJson<Record<string, unknown>>(
      FS.resolvePath('../ide-extension-syntaxes/tao-lang.tmLanguage.overlay.json', import.meta.dir),
    )
    const merged = mergeTaoTextMateGrammar(generatedGrammar, overlayGrammar)

    Expect(JSON.stringify(merged)).toContain('meta.embedded.block.ts.tao-lang')
    Expect(JSON.stringify(merged)).toContain('source.tsx')
    Expect(JSON.stringify(merged)).toContain('meta.template.expression.tao-lang')
    Expect(JSON.stringify(merged)).toContain('constant.numeric.tao-lang')
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
    ])
    Expect(packageJson.contributes.grammars[0]?.embeddedLanguages).toEqual({
      'meta.embedded.block.ts.tao-lang': 'typescriptreact',
    })
  })

  Test('reports structural and Typir diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      alias Greeting = "Hello"
      app Demo {
        render Greeting()
      }
      view Counter Count is number {
        render Text(Count)
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)

    Expect(diagnostics).toContain('Only root view declarations are allowed in app Demo.')
    Expect(
      diagnostics.some(diagnostic =>
        diagnostic.includes('Render of Text has an argument that does not match any unbound parameter by type.')
      ),
    ).toBe(true)
  })

  Test('reports alias declaration-order diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      app Demo {
        view MainView
      }
      alias First = Second
      alias Second = First
      view MainView {
        render Text(First)
      }
      view Text Value is text { }
    `)

    Expect(diagnostics).toContain(
      "Alias 'First' cannot reference 'Second' because it is not declared before the alias.",
    )
  })

  Test('formats documents with canonical Tao indentation regardless of editor tab size', async () => {
    const { formatter, document, cleanup } = await buildFormatterFixture('view   MainView {  render  Stack ()  {   } }')
    try {
      Expect(formatter).toBeInstanceOf(TaoFormatter)
      const edits = await formatter!.formatDocument(document, {
        textDocument: { uri: document.textDocument.uri },
        options: { tabSize: 4, insertSpaces: true },
      })

      Expect(applyEdits(document, edits)).toBe('view MainView {\n   render Stack() { }\n}\n')
    } finally {
      await cleanup()
    }
  })

  Test('formats embedded TypeScript fences through the language server', async () => {
    const { formatter, document, cleanup } = await buildFormatterFixture(
      `view MainView { render inject \`\`\`ts\nconst message = "hi";\nreturn <RN.Text accessibilityLabel='greeting'>{ message }</RN.Text>;\n\`\`\` }`,
    )
    try {
      Expect(formatter).toBeInstanceOf(TaoFormatter)
      const edits = await formatter!.formatDocument(document, {
        textDocument: { uri: document.textDocument.uri },
        options: { tabSize: 4, insertSpaces: true },
      })

      Expect(applyEdits(document, edits)).toBe(
        'view MainView {\n'
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
      'app MyApp { view MainView }\nuse Text from @tao/ui\nview MainView { render Text("hi") }\n',
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
        'use Text from @tao/ui\n\napp MyApp {\n   view MainView\n}\n\nview MainView {\n   render Text("hi")\n}\n',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  Test('serves the move-render quick fix for render-not-last diagnostics', async () => {
    const fixture = await buildCodeActionFixture(
      'view MainView {\n   render Text(Greeting)\n   alias Greeting = "hi"\n}\n',
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
      Expect(edits?.[0]?.newText).toBe('view MainView {\n   alias Greeting = "hi"\n   render Text(Greeting)\n}\n')
    } finally {
      await fixture.cleanup()
    }
  })

  Test('reports duplicate visible declarations through Langium services', async () => {
    const diagnostics = await validateFilesWithLanguageServerServices({
      '/__tao__/First.tao': `
        project alias Shared = "First"
      `,
      '/__tao__/Second.tao': `
        package alias Shared = "Second"
      `,
    })

    Expect(
      diagnostics.some(diagnostic => diagnostic.includes("Visible declaration 'Shared' is declared more than once")),
    ).toBe(true)
  })

  Test('resolves on-disk package imports through Langium services', async () => {
    const diagnostics = await validateOnDiskFileWithLanguageServerServices('Main.tao', {
      'Main.tao': `
        use MainView from @bar/views
        app PackageApp { view MainView }
      `,
      'packages/@bar/views/Main.tao': `
        project view MainView {
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

async function validateWithLanguageServerServices(source: string): Promise<string[]> {
  const rootDir = await mkTestDir('tao-ide-lsp-')
  try {
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const uri = Langium.URI.file(FS.resolvePath('ide-smoke.tao', rootDir))
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
    services.shared.workspace.LangiumDocuments.addDocument(document)

    await services.shared.workspace.DocumentBuilder.build([document], {
      eagerLinking: true,
      validation: true,
    })

    return (document.diagnostics ?? []).map(diagnostic => diagnostic.message)
  } finally {
    await FS.remove(rootDir)
  }
}

async function validateFilesWithLanguageServerServices(sources: Record<string, string>): Promise<string[]> {
  const rootDir = await mkTestDir('tao-ide-lsp-')
  try {
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const documents = Object.entries(sources).map(([path, source]) => {
      const workspacePath = path.startsWith('/__tao__/')
        ? FS.resolvePath(path.slice('/__tao__/'.length), rootDir)
        : FS.resolvePath(path, rootDir)
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

    return documents.flatMap(document => (document.diagnostics ?? []).map(diagnostic => diagnostic.message))
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

    return (document!.diagnostics ?? []).map(diagnostic => diagnostic.message)
  } finally {
    await FS.remove(rootDir)
  }
}

type IdeExtensionPackageJson = {
  main: string
  contributes: {
    commands: {
      command: string
      title: string
    }[]
    grammars: {
      embeddedLanguages?: Record<string, string>
    }[]
  }
}
