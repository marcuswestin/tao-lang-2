import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

Test('Studio preview session publishes a generated sketch scenario after creation', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-sketch-preview-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-sketch-preview-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
          view Main() { render Text("Garden") }
          scenarios Main "states" {
            device phone
            scenario "initial" { render Main() }
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
          const initial = await preview.session.compileInitial()
          if (initial.status !== 'compiled') {
            Errors.throwUnexpected(initial.message)
          }
          const created = await preview.session.applySketchAction({
            action: {
              height: 76,
              id: 'sketch-1',
              kind: 'create-sketch',
              project: preview.session.identity().project,
              rects: [],
              width: 360,
            },
            expectedRevision: 0,
            requestId: 'create-sketch',
          })
          const manifest = preview.session.previewManifest()!
          const sketchScenario = manifest.scenarios.find(scenario => scenario.group === 'sketch')
          const sketchSubject = manifest.subjects.find(subject => subject.subjectId === sketchScenario?.subjectId)

          Expect(created.compile?.status).toBe('compiled')
          Expect(sketchScenario?.label).toBe('draft')
          Expect(sketchSubject).toMatchObject({ kind: 'view', viewName: 'View1' })
          Expect(manifest.cells.some(cell => cell.scenarioId === sketchScenario?.scenarioId)).toBe(true)
          Expect(
            await FS.readText(
              FS.resolvePath('_gen_tao-app/TaoApp.tsx', previewRuntimeRoot),
            ),
          ).toContain("import './modules/@/studio/View1.tao'")
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test(
  'Studio preview session supports focused-view scenarios declared outside the selected app entry file',
  async () => {
    const previewRuntimeRoot = await mkTestDir('tao-studio-imported-scenario-runtime-')
    try {
      await withTaoFiles(
        'tao-studio-imported-scenario-project-',
        {
          'Garden.tao': `
          use Imported from ./Imported.tao
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
          view Main() { render Imported() }
        `,
          'Imported.tao': `
          use Text from @tao/ui
          project view Imported() { render Text("Imported") }
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
            if (compiled.status !== 'compiled') {
              Errors.throwUnexpected(compiled.message)
            }
            const manifest = preview.session.previewManifest()!
            const scenario = manifest.scenarios.find(candidate => candidate.label === 'phone')
            const subject = manifest.subjects.find(candidate => candidate.subjectId === scenario?.subjectId)

            Expect(scenario?.group).toBe('imported')
            Expect(subject).toMatchObject({ kind: 'view', viewName: 'Imported' })
            Expect(manifest.cells.some(cell => cell.scenarioId === scenario?.scenarioId)).toBe(true)
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

Test('Studio preview session preserves compiler entity parameter and fixture account semantics', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-entity-parameter-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-entity-parameter-project-',
      {
        'Music.tao': `
          data Accounts / Account { DisplayName text }
          project data Playlists / Playlist { Title text }
          app Music { id "tao-studio-music" version "1.0.0" name "Music"  view Main }
          view Main() { render Native() }
          view PlaylistRow(Playlist) { render Native() }
          view Native() { render inject \`\`\`ts return null \`\`\` }
          fixture Sketches {
            account Alice { DisplayName: "Alice" }
            signed in as Alice
            Featured = create Playlist { Title: "Focus" }
          }
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
          Expect(manifest.fixtures.map(fixture => fixture.plan)).toEqual([{
            accounts: [{ fields: { DisplayName: 'Alice' }, name: 'Alice' }],
            creates: [{ account: 'Alice', entity: 'Playlist', fields: { Title: 'Focus' }, name: 'Featured' }],
            signedIn: 'Alice',
          }])
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
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
          app GardenDark { id "tao-studio-gardendark" version "1.0.0" name "GardenDark"  view Main }
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
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
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
