import { FS } from '@shared'
import { describe, expect, test } from 'bun:test'
import { AST, Langium } from 'tao-parser'
import { createValidatorLspServices } from 'tao-validator/langium-services'

describe('Tao IDE extension smoke', () => {
  test('declares extension and language server entrypoint build inputs', async () => {
    const packageJson = await FS.readJson<IdeExtensionPackageJson>(
      FS.resolvePath(import.meta.dir, '../package.json'),
    )
    expect(packageJson.main).toBe('_gen-ide-extension/extension/main.cjs')

    const entrypoints = [
      '../ide-extension-src/extension/main.ts',
      '../ide-extension-src/language/main.ts',
      '../esbuild.config.ts',
      '../language-configuration.json',
    ]
    for (const entrypoint of entrypoints) {
      expect(await FS.isFile(FS.resolvePath(import.meta.dir, entrypoint))).toBe(true)
    }
  })

  test('generates the TextMate grammar for VS Code', async () => {
    const grammarPath = FS.resolvePath(
      import.meta.dir,
      '../ide-extension-syntaxes/_gen-syntaxes/tao-lang.tmLanguage.json',
    )
    expect(await FS.isFile(grammarPath)).toBe(true)
  })

  test('reports structural and Typir diagnostics through Langium services', async () => {
    const diagnostics = await validateWithLanguageServerServices(`
      alias Greeting = "Hello"
      app Demo {
        render Greeting
      }
      ui Counter Count number {
        render Text Count
      }
      ui Text Value text {
        render inject raw \`\`\`ts
          export const View = () => null
        \`\`\`
      }
    `)

    expect(diagnostics).toContain('Only root ui declarations are allowed in app Demo.')
    expect(
      diagnostics.some(diagnostic => diagnostic.includes("Argument for parameter 'Value' expects text, got number.")),
    ).toBe(true)
  })
})

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
