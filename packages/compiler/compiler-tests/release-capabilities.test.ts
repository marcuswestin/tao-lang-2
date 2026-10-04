import { LSPWorkspace, Workspace } from '@compiler/workspace'
import { Langium } from '@parser'
import { ReleaseCapabilities } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler release eligibility', () => {
  Test('source overrides retain the selected release policy', async () => {
    await withTaoFiles('release-overrides-', {
      'Main.tao': 'let Label = "Original"',
      'Project.tao': 'project { id "release-overrides" name "Overrides" }',
    }, async (paths, root) => {
      const options = { sourceOverrides: { 'Main.tao': 'use Http from @tao/data/providers/http\ntype Remote is Http' } }
      const early = await Workspace.openProfile(root, ReleaseCapabilities.profile(1), options)
      const later = await Workspace.openProfile(root, ReleaseCapabilities.profile(2), options)
      const first = await early.validate(paths['Main.tao'])
      const second = await later.validate(paths['Main.tao'])
      Expect(first.diagnostics.some(d => d.code === 'release-capability')).toBe(true)
      Expect(second.diagnostics.filter(d => d.code === 'release-capability')).toEqual([])
    })
  })
  Test(
    'editor checks nested project pins before validation and completion while compiler development remains available',
    async () => {
      await withTaoFiles('release-editor-pin-', {
        'Nested/Main.tao': 'project { id "nested" name "Nested" }\nlet Label = "Hello"',
        'Nested/.tao-project/lock.jsonc': '{"toolchain":{"version":"0.1.1","releaseProfile":{"phase":1}}}',
      }, async (paths, root) => {
        const workspace = await LSPWorkspace.open(root)
        const document = workspace.services.shared.workspace.LangiumDocuments.getDocument(
          Langium.URI.file(paths['Nested/Main.tao']),
        )!
        await workspace.services.shared.workspace.DocumentBuilder.build([document], {
          validation: true,
          eagerLinking: true,
        })
        Expect(
          document.diagnostics?.some(d =>
            d.code === 'release-toolchain' && typeof d.message === 'string' && d.message.includes('pins Tao 0.1.1')
          ),
        ).toBe(true)
        const provider = workspace.services.language.lsp.CompletionProvider!
        await Expect(provider.getCompletion(document, {
          textDocument: { uri: document.uri.toString() },
          position: { line: 1, character: 0 },
        })).rejects.toThrow('pins Tao 0.1.1')
        const ordinary = await Workspace.open(root)
        const result = await ordinary.validate(paths['Nested/Main.tao'])
        Expect(result.diagnostics.filter(d => d.code === 'release-toolchain')).toEqual([])
      })
    },
  )
  Test('skipValidation cannot bypass capabilities and shared workspaces retain profile identity', async () => {
    await withTaoFiles('release-compiler-', {
      'Main.tao': `
        use Http from @tao/data/providers/http
        type Remote is Http
        app Demo { view Home }
        view Home() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Main.test.tao': 'use Demo from ./Main\ntest "Suite" { test "home" { run Demo expect text "Hello" } }',
      'Project.tao': 'project { id "release-compiler" name "Release" }',
    }, async (paths, root) => {
      const early = await Workspace.shared(root, ReleaseCapabilities.profile(1))
      const later = await Workspace.shared(root, ReleaseCapabilities.profile(2))
      Expect(early).not.toBe(later)
      Expect(await Workspace.shared(root, ReleaseCapabilities.profile(1))).toBe(early)
      await Expect(early.compileTestPlan(paths['Main.test.tao'], { skipValidation: true })).rejects.toThrow(
        'HTTP and multiple datasources is unavailable',
      )
      const plan = await later.compileTestPlan(paths['Main.test.tao'], { skipValidation: true })
      Expect(plan.suites[0]?.name).toBe('Suite')
      await Expect(early.compile(paths['Main.tao'])).rejects.toThrow('HTTP and multiple datasources is unavailable')
    })
  })
})
