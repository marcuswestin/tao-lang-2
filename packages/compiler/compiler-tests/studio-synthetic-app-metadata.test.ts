import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '../compiler-src/workspace'

Describe('compiler: Studio scenario app metadata', () => {
  Test('uses effective derived app identity and version for a focused view', async () => {
    const fence = String.fromCharCode(96, 96, 96)
    await withTaoFiles('tao-studio-synthetic-metadata-', {
      'Main.tao': `
        app Base { id "com.tao.base" version "1.0.0" name "Base" view Home }
        app Variant = Base with { id "com.tao.variant", version "2.0.0-beta.1", name "Variant" }
        view Home() { render inject ${fence}ts return null ${fence} }
        scenarios Home "states" {
          device phone
          scenario "focused" { render Home() }
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao']!, { studio: true, appName: 'Variant' })
      Expect(compiled.appId).toBe('com.tao.variant')
      Expect(compiled.appVersion).toBe('2.0.0-beta.1')
      Expect(compiled.code).toContain('id: _TaoAppDefinition_Variant.definition.id,')
      Expect(compiled.code).toContain('version: _TaoAppDefinition_Variant.definition.version,')
      Expect(compiled.studioManifest?.selectedAppName).toBe('Variant')
    })
  })
})
