import Runtime from '@expo-host'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('runtime preview source overlays', () => {
  Test('publishes transient sources without writing them into the project', async () => {
    await withTaoFiles('tao-runtime-overlay-', {
      'Main.tao':
        'app Preview { id "preview" version "1.0.0" name "Preview" view Main } view Main() { render inject ```ts return null ``` }',
    }, async (paths, root) => {
      const virtualPath = FS.resolvePath('@/studio/Card.tao', root)
      await FS.mkdir(FS.dirname(virtualPath))
      const source = 'public view TransientCard() { render inject ```ts return null ``` }'
      const runtimePackageRoot = FS.resolvePath('runtime', root)
      const generated = await Runtime.generateApp(paths['Main.tao']!, {
        runtimePackageRoot,
        preview: {
          project: root,
          revision: 1,
          sourceVersions: { '@/studio/Card.tao': 'transient-version' },
          sourceOverrides: {
            [virtualPath]: source,
            [paths['Main.tao']!]:
              'use TransientCard from @/studio\napp Preview { id "preview" version "1.0.0" name "Preview" view Main } view Main() { render TransientCard() }',
          },
        },
      })
      Expect(generated.studioManifest?.views.map(view => view.name)).toContain('TransientCard')
      Expect(await FS.exists(virtualPath)).toBe(false)
      Expect(await FS.readText(paths['Main.tao']!)).toBe(
        'app Preview { id "preview" version "1.0.0" name "Preview" view Main } view Main() { render inject ```ts return null ``` }',
      )
      await Runtime.resetStudioPreviewSession({ runtimePackageRoot })
    })
  })
})
