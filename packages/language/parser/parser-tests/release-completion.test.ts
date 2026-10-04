import { Packages } from '@ast-utils'
import { ReleaseCapabilities } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { codeProjectRoot, Parser } from '../parser-src/parser'

Describe('release-aware completion', () => {
  Test('syntax suggestions hide access and advanced design while keeping basic colors and text types', async () => {
    async function labels(source: string, phase: 1 | 3 | 'development') {
      const context = Parser.createLspContext({ releaseProfile: ReleaseCapabilities.profile(phase) })
      const parsed = await Parser.parseSource(context, source, { validation: false })
      const provider = context.services.language.lsp.CompletionProvider!
      const completion = await provider.getCompletion(parsed.entry.document, {
        textDocument: { uri: parsed.entry.document.uri.toString() },
        position: { line: 0, character: source.length },
      })
      return completion?.items.map(item => item.label) ?? []
    }
    Expect(await labels('', 'development')).toContain('access')
    Expect(await labels('', 1)).not.toContain('access')
    const fullDesign = await labels('design Theme { ', 3)
    Expect(fullDesign).toContain('sizes')
    Expect(fullDesign).toContain('text')
    const coreDesign = await labels('design Theme { ', 1)
    Expect(coreDesign).toContain('colors')
    Expect(coreDesign).toContain('styles')
    Expect(coreDesign).not.toContain('sizes')
    Expect(coreDesign).not.toContain('text')
    Expect(coreDesign).not.toContain('screens')
    Expect(await labels('data Rows / Row { Value ', 1)).toContain('text')
  })
  Test('restricted resolved providers disappear from suggestions while remaining linkable', async () => {
    const packages = await Packages.createContext(codeProjectRoot)
    async function labels(phase: 1 | 2) {
      const context = Parser.createLspContext({
        packages: Packages.createResolver(packages),
        releaseProfile: ReleaseCapabilities.profile(phase),
        releaseStdlibRoot: packages.stdlibRoot,
      })
      const source = 'use Http from @tao/data/providers/http\ntype HttpAlias is Http\nlet Provider = H'
      const parsed = await Parser.parseSource(context, source, { validation: false })
      const provider = context.services.language.lsp.CompletionProvider
      Expect(provider).toBeDefined()
      const completion = await provider!.getCompletion(parsed.entry.document, {
        textDocument: { uri: parsed.entry.document.uri.toString() },
        position: { line: 2, character: 'let Provider = H'.length },
      })
      return completion?.items.map(item => item.label) ?? []
    }
    Expect(await labels(2)).toContain('Http')
    Expect(await labels(2)).toContain('HttpAlias')
    Expect(await labels(1)).not.toContain('Http')
    Expect(await labels(1)).not.toContain('HttpAlias')
  })
})
