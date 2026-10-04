import { Workspace } from '@compiler/workspace'
import { Diagnostics, FS, ReleaseCapabilities, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import Validator from '../validator-src/validator'
import { releaseCapabilitiesValidationMessages } from '../validator-src/validators/release-capabilities-validator'

async function releaseErrors(source: string, phase: 1 | 2 | 3 | 4 | 5 | 'development') {
  const result = await Validator.validateCode(source, ReleaseCapabilities.profile(phase))
  Expect(result.diagnostics.filter(d => d.source === 'parser' || d.source === 'lexer')).toEqual([])
  return result.diagnostics.filter(d => d.code === 'release-capability')
}

Describe('release capability language policy', () => {
  Test('phase one supports the complete first-app tutorial', async () => {
    const root = Repo.getRoot()
    const tutorial = await FS.readText(FS.resolvePath('Docs/Tutorials/Your First Tao App.md', root))
    const source = /```tao final\n([\s\S]*?)\n```/u.exec(tutorial)?.[1]
    Expect(source).toBeDefined()
    const tutorialResult = await Validator.validateCode(source!, ReleaseCapabilities.profile(1))
    Expect(Diagnostics.errorMessages(tutorialResult.diagnostics)).toEqual([])
  })
  Test('phase one core app permits Prelude implementation references to auth', async () => {
    const result = await Validator.validateCode(
      `
      use Text from @tao/ui
      app Demo { id "demo" version "1.0.0" name "Demo" view Home }
      view Home() { render Text("Hello") }
    `,
      ReleaseCapabilities.profile(1),
    )
    Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
  })

  Test('resolved HTTP references require phase two and remain allowed in development', async () => {
    const source = 'use Http from @tao/data/providers/http\ntype Feed is Http'
    const errors = await releaseErrors(source, 1)
    Expect(errors.length).toBeGreaterThan(0)
    Expect(errors[0]!.message).toBe(
      releaseCapabilitiesValidationMessages.unavailable('http-data', ReleaseCapabilities.profile(1)),
    )
    Expect(await releaseErrors(source, 2)).toEqual([])
    Expect(await releaseErrors(source, 'development')).toEqual([])
  })

  Test('private CloudKit sync starts at phase four while hosted data stays deferred', async () => {
    const source = 'use CloudKit from @tao/data/providers/cloudkit\ntype Synced is CloudKit'
    Expect((await releaseErrors(source, 3)).length).toBeGreaterThan(0)
    Expect(await releaseErrors(source, 4)).toEqual([])
    Expect((await releaseErrors('use AuthProvider from @tao/auth\ntype Session is AuthProvider', 5)).length)
      .toBeGreaterThan(0)
  })

  Test('basic colors and styles remain available, families and derived values start at phase three', async () => {
    Expect(await releaseErrors('design Theme { colors { cream #fff } styles { card [pad 4] } }', 1)).toEqual([])
    const advanced = 'design Theme { colors { cream #fff { 20 #eee } } sizes { sm 4.px } styles { Text [ink cream] } }'
    Expect((await releaseErrors(advanced, 2)).length).toBeGreaterThan(0)
    Expect(await releaseErrors(advanced, 3)).toEqual([])
  })

  Test('user declarations with provider names are not mistaken for restricted providers', async () => {
    Expect(await releaseErrors('type Http is text\ntype Example is Http', 1)).toEqual([])
  })

  Test('multiple local stores and cross-store references start at phase two', async () => {
    const source = `
      use Memory from @tao/data/providers/memory
      data Stories / Story { Id number (unique) }
      data Pins / Pin { Story (reference) }
      datasource Feed = Memory { Data { Stories } }
      datasource Personal = Memory { Data { Pins } }
      app Demo { id "demo" version "1.0.0" name "Demo" view Home Datasource { Feed, Personal } }
      view Home() { render inject \`\`\`ts return null \`\`\` }
    `
    const errors = await releaseErrors(source, 1)
    Expect(errors.length).toBeGreaterThan(0)
    Expect(errors.every(d => d.message.includes('HTTP and multiple datasources'))).toBe(true)
    Expect(await releaseErrors(source, 2)).toEqual([])
  })

  Test('app automation and auth remain deferred through constructed app variants', async () => {
    const source = `
      app Demo { id "demo" version "1.0.0" name "Demo" view Home }
      app Derived = Demo with { version "1.0.1" AgentCommands {} Auth none }
      view Home() { render inject \`\`\`ts return null \`\`\` }
    `
    const errors = await releaseErrors(source, 5)
    Expect(errors.some(d => d.message.includes('App automation commands'))).toBe(true)
    Expect(errors.some(d => d.message.includes('Authentication'))).toBe(true)
    Expect(await releaseErrors(source, 'development')).toEqual([])
  })

  Test('transitive user libraries retain positioned eligibility errors', async () => {
    await withTaoFiles('release-transitive-', {
      'Main.tao': 'use Remote from ./Library\ntype Feed is Remote',
      'Library.tao': 'use Http from @tao/data/providers/http\npublic type Remote is Http',
      '.tao/.gitkeep': '',
    }, async paths => {
      const workspace = await Workspace.openProfile(FS.dirname(paths['Main.tao']), ReleaseCapabilities.profile(1))
      const result = await workspace.validate(paths['Main.tao'])
      const errors = result.diagnostics.filter(d => d.code === 'release-capability')
      Expect(errors.length).toBeGreaterThan(0)
      Expect(errors.some(d => d.filePath === paths['Library.tao'])).toBe(true)
    })
  })
})
