import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST, Langium } from 'tao-parser'
import { LSPWorkspace } from 'tao-workspace'

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
})

async function validateWithLanguageServerServices(source: string): Promise<string[]> {
  const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-ide-lsp-', { cwd: FS.tmpdir() }))
  try {
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const uri = Langium.URI.file(FS.resolvePath('ide-smoke.tao', { cwd: rootDir }))
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
  const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-ide-lsp-', { cwd: FS.tmpdir() }))
  try {
    const workspace = await LSPWorkspace.open(rootDir)
    const services = workspace.services
    const documents = Object.entries(sources).map(([path, source]) => {
      const workspacePath = path.startsWith('/__tao__/')
        ? FS.resolvePath(path.slice('/__tao__/'.length), { cwd: rootDir })
        : FS.resolvePath(path, { cwd: rootDir })
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

type IdeExtensionPackageJson = {
  main: string
}
