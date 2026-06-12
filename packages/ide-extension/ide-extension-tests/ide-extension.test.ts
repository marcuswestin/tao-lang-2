import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { TaoFormatter } from 'tao-formatter'
import { AST, Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { createValidatorLspServices } from 'tao-validator/langium-services'

Describe('Tao IDE extension smoke', () => {
  Test('declares extension and language server entrypoint build inputs', async () => {
    const packageJson = await FS.readJson<IdeExtensionPackageJson>(
      FS.resolvePath('../package.json', { cwd: import.meta.dir }),
    )
    Expect(packageJson.main).toBe('_gen_ide-extension/extension/main.cjs')

    const entrypoints = [
      '../ide-extension-src/extension/main.ts',
      '../ide-extension-src/language/main.ts',
      '../esbuild.config.ts',
      '../language-configuration.json',
    ]
    for (const entrypoint of entrypoints) {
      Expect(await FS.isFile(FS.resolvePath(entrypoint, { cwd: import.meta.dir }))).toBe(true)
    }
  })

  Test('generates the TextMate grammar for VS Code', async () => {
    const grammarPath = FS.resolvePath(
      '../ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
      { cwd: import.meta.dir },
    )
    Expect(await FS.isFile(grammarPath)).toBe(true)
  })

  Test('reports structural and Typir diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      alias Greeting = "Hello"
      app Demo {
        render Greeting
      }
      ui Counter Count number {
        render Text Count
      }
      ui Text Value text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)

    Expect(diagnostics).toContain('Only root ui declarations are allowed in app Demo.')
    Expect(
      diagnostics.some(diagnostic => diagnostic.includes("Argument for parameter 'Value' expects text, got number.")),
    ).toBe(true)
  })

  Test('reports alias declaration-order diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      app Demo {
        ui MainView
      }
      alias First = Second
      alias Second = First
      ui MainView {
        render Text First
      }
      ui Text Value text { }
    `)

    Expect(diagnostics).toContain(
      "Alias 'First' cannot reference 'Second' because it is not declared before the alias.",
    )
  })

  Test('formats documents with canonical Tao indentation regardless of editor tab size', async () => {
    const services = createValidatorLspServices(Langium.NodeFileSystem, {
      lspFormatter: () => new TaoFormatter(),
    })
    const uri = Langium.URI.file('/__tao__/ide-format.tao')
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'ui   MainView {  render  Stack {   } }',
      uri,
    )
    services.shared.workspace.LangiumDocuments.addDocument(document)
    await services.shared.workspace.DocumentBuilder.build([document], {
      eagerLinking: true,
      validation: false,
    })

    const formatter = services.language.lsp.Formatter
    Expect(formatter).toBeInstanceOf(TaoFormatter)
    const edits = await formatter!.formatDocument(document, {
      textDocument: { uri: document.textDocument.uri },
      options: { tabSize: 4, insertSpaces: true },
    })

    Expect(applyEdits(document, edits)).toBe('ui MainView {\n   render Stack { }\n}\n')
  })

  Test('serves the organize use statements source action through the language server', async () => {
    const { provider, document } = await buildCodeActionFixture(
      'app MyApp { ui MainView }\nuse Text from @tao/ui\nui MainView { render Text "hi" }\n',
    )
    const actions = await provider.getCodeActions(document, {
      textDocument: { uri: document.textDocument.uri },
      range: fullRange(document),
      context: { diagnostics: [], only: ['source.organizeImports'] },
    })
    const organize = actions?.find(action => 'title' in action && action.title === 'tao: Organize Use Statements')

    Expect(organize && 'kind' in organize ? organize.kind : undefined).toBe('source.organizeImports')
    const edits = organize && 'edit' in organize ? organize.edit?.changes?.[document.textDocument.uri] : undefined
    Expect(edits?.[0]?.newText).toBe(
      'use Text from @tao/ui\n\napp MyApp {\n   ui MainView\n}\n\nui MainView {\n   render Text "hi"\n}\n',
    )
  })

  Test('serves the move-render quick fix for render-not-last diagnostics', async () => {
    const { provider, document } = await buildCodeActionFixture(
      'ui MainView {\n   render Text Greeting\n   alias Greeting = "hi"\n}\n',
    )
    const actions = await provider.getCodeActions(document, {
      textDocument: { uri: document.textDocument.uri },
      range: fullRange(document),
      context: {
        diagnostics: [{ range: fullRange(document), message: 'render', code: 'tao-render-not-last' }],
        only: ['quickfix'],
      },
    })
    const moveRender = actions?.find(action => 'title' in action && action.title === 'tao: Move render to end')

    const edits = moveRender && 'edit' in moveRender ? moveRender.edit?.changes?.[document.textDocument.uri] : undefined
    Expect(edits?.[0]?.newText).toBe('ui MainView {\n   alias Greeting = "hi"\n   render Text Greeting\n}\n')
  })
})

async function buildCodeActionFixture(source: string): Promise<{
  provider: Langium.CodeActionProvider
  document: AST.Document
}> {
  const services = createValidatorLspServices(Langium.NodeFileSystem, {
    lspCodeActionProvider: () => new TaoCodeActionProvider(),
  })
  const uri = Langium.URI.file(`/__tao__/ide-actions-${++codeActionFixtureId}.tao`)
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: false,
  })
  const provider = services.language.lsp.CodeActionProvider
  Expect(provider).toBeInstanceOf(TaoCodeActionProvider)
  return { provider: provider!, document }
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
  const services = createValidatorLspServices()
  const uri = Langium.URI.file('/__tao__/ide-smoke.tao')
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
  services.shared.workspace.LangiumDocuments.addDocument(document)

  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: true,
  })

  return (document.diagnostics ?? []).map(diagnostic => diagnostic.message)
}

type IdeExtensionPackageJson = {
  main: string
}
