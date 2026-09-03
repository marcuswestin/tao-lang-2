import { Errors, FS, Time } from '@shared'
import { Expect, mkTestDir, Test, until, withTaoFiles } from '@shared/test'
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
          scenarios Main "states" {
            device phone
            scenario "phone" {
              network online
              render Main()
              press down #revertSave
              advance 600.ms
              press up #revertSave
              hover #revertSave
              focus #revertSave
            }
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
              Errors.throwUnexpected(compiled.message)
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
            Expect(manifest?.scenarios.map(scenario => [scenario.group, scenario.label])).toEqual([['states', 'phone']])
            Expect(manifest?.cells[0]?.cellId).toBe(`${manifest?.scenarios[0]?.scenarioId}#cell`)
            Expect(manifest?.cells[0]?.environment.viewport).toEqual({
              height: 844,
              presetId: 'phone',
              width: 390,
            })
            Expect(manifest?.fixtures).toEqual([])
            Expect(manifest?.scenarios[0]?.fixtureId).toBeUndefined()
            Expect(manifest?.scenarios[0]?.steps?.map(step => step.kind)).toEqual([
              'pressDown',
              'advance',
              'pressUp',
              'hover',
              'focus',
            ])

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

Test('Studio preview session rejects scenarios declared outside the selected app entry file', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-imported-scenario-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-imported-scenario-project-',
      {
        'Garden.tao': `
          use Imported from ./Imported.tao
          app Garden { view Main }
          view Main() { render Imported() }
        `,
        'Imported.tao': `
          use Text from @tao/ui
          workspace view Imported() { render Text("Imported") }
          fixture Empty { }
          scenarios Imported "imported" {
            fixture Empty
            device phone
            scenario "phone" { render Imported() }
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
          Expect(compiled.status).toBe('error')
          Expect(compiled.message).toContain('declared outside the selected app entry file')
          Expect(preview.session.previewManifest()).toBeUndefined()
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio preview session preserves compiler entity parameter semantics', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-entity-parameter-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-entity-parameter-project-',
      {
        'Music.tao': `
          workspace data Playlists / Playlist { Title text }
          app Music { view Main }
          view Main() { render Native() }
          view PlaylistRow(Playlist) { render Native() }
          view Native() { render inject \`\`\`ts return null \`\`\` }
          fixture Sketches { Featured = create Playlist { Title: "Focus" } }
          scenarios PlaylistRow "states" {
            fixture Sketches
            device phone
            scenario "featured" { render (Playlist: Featured) }
          }
        `,
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Music.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        try {
          const compiled = await preview.session.compileInitial()
          if (compiled.status !== 'compiled') {
            Errors.throwUnexpected(compiled.message)
          }
          const manifest = preview.session.previewManifest()!
          const subject = manifest.subjects.find(candidate =>
            candidate.kind === 'view' && candidate.viewName === 'PlaylistRow'
          )!

          Expect(manifest.parametersBySubject[subject.subjectId]).toEqual([{
            label: 'Playlist',
            parameterId: 'Playlist',
            required: true,
            type: { entity: 'Playlist', kind: 'json' },
          }])
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio preview session scopes app scenarios to the selected variant and keeps focused views', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-selected-app-scenarios-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-selected-app-scenarios-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { view Main }
          app GardenDark { view Main }
          view Main() { render Text("Garden") }
          fixture Empty { }
          scenarios Garden "garden app" {
            fixture Empty
            device phone
            scenario "garden" { }
          }
          scenarios GardenDark "dark app" {
            fixture Empty
            device phone
            scenario "dark" { }
          }
          scenarios Main "states" {
            fixture Empty
            device phone
            scenario "focused" { render Main() }
          }
        `,
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          appName: 'Garden',
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        try {
          const compiled = await preview.session.compileInitial()
          if (compiled.status !== 'compiled') {
            Errors.throwUnexpected(compiled.message)
          }
          Expect(compiled.status).toBe('compiled')
          Expect(preview.session.previewManifest()?.scenarios.map(scenario => scenario.label))
            .toEqual(['garden', 'focused'])
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio preview session rejects app destinations instead of silently running the default app', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-destination-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-destination-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { view Main }
          view Main() { render Text("Garden") }
          fixture Empty { }
          scenarios Garden "destinations" {
            fixture Empty
            device phone
            scenario "detail" { run at Detail() }
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
          Expect(compiled.status).toBe('error')
          Expect(compiled.message).toContain('cannot run Garden at destination Detail yet')
          Expect(preview.session.previewManifest()).toBeUndefined()
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

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
  await until(predicate, { description: 'the Studio file watcher' })
}
