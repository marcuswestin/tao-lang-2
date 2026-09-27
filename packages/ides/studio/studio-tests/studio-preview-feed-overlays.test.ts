import { Errors, FS } from '@shared'
import { Deferred, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

Test('Studio preview freezes Feed source and hashes before awaiting project files', async () => {
  await withTaoFiles('tao-studio-feed-preview-', {
    'Main.tao': 'app Preview { view Main } view Main() { render inject ```ts return null ``` }',
    '@/studio/Row.tao': 'public view OriginalRow() { render inject ```ts return null ``` }',
  }, async (paths, root) => {
    const row = paths['@/studio/Row.tao']!
    const sidecar = FS.resolvePath('@/studio/Row.test.tao', root)
    const rowSource = 'public view TransientRow() { render inject ```ts return null ``` }'
    const sidecarSource =
      'use TransientRow from ./Row\nscenarios TransientRow "feed" { device phone scenario "draft" { render TransientRow() } }'
    const overlays: Record<string, string> = { [row]: rowSource, [sidecar]: sidecarSource }
    const previewRuntimeRoot = FS.resolvePath('runtime', root)
    const preview = await openStudioPreviewSession({
      entryPath: paths['Main.tao']!,
      previewRuntimeRoot,
      projectRoot: root,
    })
    const captured = Deferred<void>()
    const releaseFiles = Deferred<void>()
    const files = preview.session.files.bind(preview.session)
    preview.session.feedSourceOverrides = () => {
      captured.resolve()
      return overlays
    }
    preview.session.files = async () => {
      await releaseFiles.promise
      return await files()
    }
    try {
      const completion = preview.session.compileInitial()
      await captured.promise
      overlays[row] = 'invalid replacement after compile started'
      delete overlays[sidecar]
      releaseFiles.resolve()
      const compiled = await completion
      if (compiled.status !== 'compiled') {
        Errors.throwUnexpected(compiled.message)
      }
      const manifest = preview.session.previewManifest()!
      Expect(manifest.subjects.some(subject => subject.kind === 'view' && subject.viewName === 'TransientRow')).toBe(
        true,
      )
      Expect(manifest.scenarios.map(scenario => scenario.label)).toEqual(['draft'])
      Expect(manifest.sourceVersions[row]).toBe(SourceActions.studioSourceVersion(rowSource))
      Expect(manifest.sourceVersions[sidecar]).toBe(SourceActions.studioSourceVersion(sidecarSource))
      Expect(await FS.readText(row)).toBe('public view OriginalRow() { render inject ```ts return null ``` }')
      Expect(await FS.exists(sidecar)).toBe(false)
      const publication = await FS.readText(FS.resolvePath('_gen_tao-app/TaoStudioPublication.ts', previewRuntimeRoot))
      Expect(publication).toContain(SourceActions.studioSourceVersion(rowSource))
      Expect(publication).toContain(SourceActions.studioSourceVersion(sidecarSource))
    } finally {
      releaseFiles.resolve()
      await preview.close()
    }
  })
})
