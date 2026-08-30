import { FS, Time } from '@shared'
import { Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { startStudioFileWatcher } from '../studio-src/StudioFileWatcher'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

Test(
  'Studio preview session publishes successful revisions and keeps invalid drafts off the runtime graph',
  async () => {
    const previewRuntimeRoot = await mkTestDir('tao-studio-preview-runtime-')
    try {
      await withTaoFiles(
        'tao-studio-preview-project-',
        {
          'Garden.tao': `
          use Text from @tao/ui
          app Garden { view Main }
          view Main() { render Text("Before") }
          fixture Empty { }
          scenario Main.phone {
            fixture Empty
            render Main()
            device phone
            network online
          }
        `,
        },
        async (paths, root) => {
          const preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewRuntimeRoot,
            projectRoot: root,
          })

          try {
            const compiled = await preview.session.compileInitial()
            if (compiled.status !== 'compiled') {
              throw new Error(compiled.message)
            }
            const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
            const stableRoot = await FS.readText(FS.resolvePath('App.tsx', generatedRoot))
            const firstRevision = await FS.readText(FS.resolvePath('TaoStudioRevision.ts', generatedRoot))
            const file = await preview.session.readFile('Garden.tao')
            const manifest = preview.session.previewManifest()

            Expect(compiled.status).toBe('compiled')
            Expect(stableRoot).toContain('TR.Studio.PreviewBridge')
            Expect(stableRoot).toContain('/api/preview/cell/bootstrap')
            Expect(firstRevision).toContain('"compileRevision":1')
            Expect(firstRevision).toContain(file.sourceVersion)
            Expect(manifest?.scenarios.map(scenario => scenario.label)).toEqual(['Main.phone'])
            Expect(manifest?.cells[0]?.cellId).toBe(`${manifest?.scenarios[0]?.scenarioId}#cell`)
            Expect(manifest?.cells[0]?.environment.viewport).toEqual({
              height: 844,
              presetId: 'phone',
              width: 390,
            })
            Expect(manifest?.fixtures.map(fixture => fixture.label)).toEqual(['Empty'])

            const invalid = await preview.session.syncDraft({
              content: 'app Garden {',
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'invalid-draft',
            })
            Expect(invalid.saved).toBe(false)
            Expect(await FS.readText(FS.resolvePath('TaoStudioRevision.ts', generatedRoot))).toBe(firstRevision)

            const valid = await preview.session.syncDraft({
              content: file.content.replace('Before', 'After'),
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'valid-draft',
            })
            const secondRevision = await FS.readText(FS.resolvePath('TaoStudioRevision.ts', generatedRoot))

            Expect(valid.saved).toBe(true)
            Expect(valid.compile?.compileRevision).toBe(2)
            Expect(secondRevision).toContain('"compileRevision":2')
            Expect(secondRevision).toContain(valid.file.sourceVersion)
          } finally {
            await preview.close()
          }
        },
      )
    } finally {
      await FS.remove(previewRuntimeRoot)
    }
  },
)

Test('Studio file watching acknowledges its own write once and compiles later external changes', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-watch-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-watch-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { view Main }
          view Main() { render Text("Before") }
        `,
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        const watcher = await startStudioFileWatcher(preview.session, { batchDelayMs: 5 })
        try {
          await preview.session.compileInitial()
          const file = await preview.session.readFile('Garden.tao')
          const studioWrite = await preview.session.syncDraft({
            content: file.content.replace('Before', 'Studio'),
            path: file.path,
            sourceVersion: file.sourceVersion,
            writeId: 'studio-write',
          })
          await Time.sleep(100)

          Expect(studioWrite.compile?.compileRevision).toBe(2)
          Expect(preview.session.compileSnapshot().compileRevision).toBe(2)

          await FS.writeText(paths['Garden.tao'], studioWrite.file.content.replace('Studio', 'External'))
          await waitFor(() => {
            const snapshot = preview.session.compileSnapshot()
            return snapshot.compileRevision === 3 && snapshot.status === 'compiled'
          })

          Expect(preview.session.compileSnapshot().status).toBe('compiled')
        } finally {
          await watcher.close()
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await Time.sleep(10)
  }
  throw new Error('Timed out waiting for the Studio file watcher.')
}
