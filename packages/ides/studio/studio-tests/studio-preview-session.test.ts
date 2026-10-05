import { ProjectTooling, type ProjectToolingResult } from '@project-tooling'
import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, settle, Test, testOverrideSlot, until, withTaoFiles } from '@shared/test'
import { startStudioFileWatcher, StudioFileWatcherTesting } from '../studio-src/StudioFileWatcher'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

const projectToolingWatchSlot = testOverrideSlot({
  read: () => ProjectTooling.watch,
  write: value => {
    Reflect.set(ProjectTooling, 'watch', value)
  },
})
const projectToolingRefreshSlot = testOverrideSlot({
  read: () => ProjectTooling.refresh,
  write: value => {
    Reflect.set(ProjectTooling, 'refresh', value)
  },
})

Test(
  'Studio consumes watched refresh receipts and still publishes a later tooling revision during acquisition',
  async () => {
    const previewRuntimeRoot = await mkTestDir('tao-studio-tooling-receipts-runtime-')
    try {
      await withTaoFiles(
        'tao-studio-tooling-receipts-project-',
        {
          'Garden.tao': `
          use Text from @tao/ui
          use PlantKind from ./Data
          app Garden { id "tao-studio-garden-receipts" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
        `,
          'Data.tao': 'public type PlantKind is one of Seed\n',
        },
        async (paths, root) => {
          const originalWatch = ProjectTooling.watch
          const originalRefresh = ProjectTooling.refresh
          const contractPath = FS.resolvePath('.tao-ts/Data.tao.ts', root)
          const acquired = Deferred<ProjectToolingResult>()
          const release = Deferred()
          const observed: ProjectToolingResult[] = []
          let watchRequests = 0
          let oneShotRequests = 0
          let publishToolingResult: (result: ProjectToolingResult) => void = () => {}
          let refreshWatchedInputs: () => Promise<ProjectToolingResult> = async () =>
            Errors.throwUnexpected('Expected the preview tooling watch to be open.')
          const restoreRefresh = projectToolingRefreshSlot.install(async (project, options) => {
            if (FS.resolvePath(project) === root) {
              oneShotRequests += 1
            }
            return await originalRefresh(project, options)
          })
          const restoreWatch = projectToolingWatchSlot.install(async (project, options) => {
            if (FS.resolvePath(project) !== root) {
              return await originalWatch(project, options)
            }
            // Keep the real watch and receipts; control callback delivery to cover both sides of
            // an acquisition without depending on the file watcher's debounce timing.
            const watch = await originalWatch(project, {
              ...options,
              onResult: result => observed.push(result),
            })
            // Startup may reread unchanged outputs after attaching dependency watchers. Establish
            // a real changed receipt after startup rather than relying on its latest receipt.
            let initialReceipt: ProjectToolingResult
            try {
              const baselineRevision = watch.lastResult.revision
              await FS.writeText(paths['Data.tao'], 'public type PlantKind is one of Seed, Flower\n')
              const requestedReceipt = await watch.requestRefresh({ force: true })
              Expect(requestedReceipt.revision).toBeGreaterThan(baselineRevision)
              const changedReceipt = observed.find(result =>
                result.revision > baselineRevision && result.changedOutputPaths.includes(contractPath)
              )
              Expect(changedReceipt).toBeDefined()
              if (changedReceipt === undefined) {
                Errors.throwUnexpected('Expected a real changed watch receipt after the initial enum edit.')
              }
              initialReceipt = changedReceipt
              // A later reread has no changed outputs; the older real notification must still
              // reach preview acquisition so its consumed-revision guard gets exercised.
              const latestReceipt = await watch.requestRefresh({ force: true })
              Expect(latestReceipt.revision).toBeGreaterThan(initialReceipt.revision)
              Expect(latestReceipt.changedOutputPaths).toEqual([])
            } catch (error) {
              await watch.dispose()
              throw error
            }
            publishToolingResult = result => options.onResult?.(result)
            refreshWatchedInputs = () => watch.requestRefresh({ force: true })
            return {
              get lastResult() {
                return watch.lastResult
              },
              async requestRefresh(requestOptions?: { force?: boolean }) {
                watchRequests += 1
                const receipt = await watch.requestRefresh(requestOptions)
                if (watchRequests === 1) {
                  Expect(initialReceipt.status).toBe('fresh')
                  Expect(initialReceipt.changedOutputPaths.length).toBeGreaterThan(0)
                  Expect(initialReceipt.changedOutputPaths).toContain(contractPath)
                  publishToolingResult(initialReceipt)
                }
                if (watchRequests === 2) {
                  acquired.resolve(receipt)
                  await release.promise
                }
                return receipt
              },
              dispose: () => watch.dispose(),
            }
          })
          try {
            const preview = await openStudioPreviewSession({
              entryPath: paths['Garden.tao'],
              previewRuntimeRoot,
              projectRoot: root,
            })
            try {
              const first = await preview.session.compileInitial()
              Expect({ status: first.status, error: first.status === 'error' ? first.message : undefined })
                .toEqual({ status: 'compiled', error: undefined })
              await settle()
              Expect(preview.session.compileSnapshot().compileRevision).toBe(1)
              Expect(watchRequests).toBe(1)
              Expect(oneShotRequests).toBe(0)
              Expect(await FS.readText(contractPath)).toContain('"Seed" | "Flower"')

              const second = preview.session.compileInitial()
              const consumed = await acquired.promise
              const file = await preview.session.readFile('Garden.tao')
              await FS.writeText(paths['Garden.tao'], file.content.replace('Before', 'After'))
              await FS.writeText(paths['Data.tao'], 'public type PlantKind is one of Seed, Flower, Tree\n')
              await refreshWatchedInputs()
              const changed = observed.find(result =>
                result.revision > consumed.revision && result.changedOutputPaths.length > 0
              )
              Expect(changed).toBeDefined()
              if (changed === undefined) {
                Errors.throwUnexpected('Expected the edited case contract to produce a changed watch receipt.')
              }
              Expect(changed.status).toBe('fresh')
              Expect(changed.changedOutputPaths).toContain(contractPath)
              Expect(await FS.readText(contractPath)).toContain('"Seed" | "Flower" | "Tree"')
              publishToolingResult(changed)
              release.resolve()
              Expect((await second).status).toBe('compiled')
              await until(() => {
                const snapshot = preview.session.compileSnapshot()
                return snapshot.compileRevision === 3 && snapshot.status === 'compiled'
              }, { description: 'the later tooling revision compile attempt' })
              Expect(watchRequests).toBe(3)
              Expect(oneShotRequests).toBe(0)
              const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
              Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot)))
                .toContain('"compileRevision":2')
              Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))).toContain('After')
            } finally {
              release.resolve()
              await preview.close()
            }
          } finally {
            release.resolve()
            restoreWatch()
            restoreRefresh()
          }
        },
      )
    } finally {
      await FS.remove(previewRuntimeRoot)
    }
  },
)

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
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
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
            const firstPublication = await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))
            const file = await preview.session.readFile('Garden.tao')
            const manifest = preview.session.previewManifest()

            Expect(stableRoot).toContain('TR.Studio.PreviewBridge')
            Expect(stableRoot).toContain('/api/preview/cell/bootstrap')
            Expect(firstPublication).toContain('"compileRevision":1')
            Expect(firstPublication).toContain(file.sourceVersion)
            Expect(manifest?.scenarios.map(scenario => [scenario.group, scenario.label])).toEqual([['states', 'phone']])
            Expect(manifest?.scenarios[0]?.steps?.map(step => step.kind)).toEqual([
              'pressDown',
              'advance',
              'pressUp',
              'hover',
              'focus',
            ])

            const unchanged = await preview.session.compileInitial()
            Expect(unchanged.status).toBe('compiled')
            Expect(unchanged.compileRevision).toBe(2)
            Expect(unchanged.publishedRevision).toBe(1)
            Expect(preview.session.previewManifest()).toEqual(manifest)
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))).toBe(firstPublication)

            const invalid = await preview.session.syncDraft({
              content: 'app Garden { id "tao-studio-garden" version "1.0.0" name "Garden" ',
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'invalid-draft',
            })
            Expect(invalid.saved).toBe(false)
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))).toBe(firstPublication)

            const valid = await preview.session.syncDraft({
              content: file.content.replace('Before', 'After'),
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'valid-draft',
            })
            const secondPublication = await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))

            Expect(valid.saved).toBe(true)
            Expect(valid.compile?.compileRevision).toBe(3)
            Expect(secondPublication).toContain('"compileRevision":3')
            Expect(secondPublication).toContain(valid.file.sourceVersion)

            const changedManifest = preview.session.previewManifest()
            const unchangedAfterEdit = await preview.session.compileInitial()
            Expect(unchangedAfterEdit.compileRevision).toBe(4)
            Expect(unchangedAfterEdit.publishedRevision).toBe(3)
            Expect(preview.session.previewManifest()).toEqual(changedManifest)
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))).toBe(secondPublication)

            await FS.writeText(paths['Garden.tao'], 'app Garden { id "garden" version "1.0.0" name "Garden"')
            const stale = await preview.session.noteWatchChanges([{ path: paths['Garden.tao'] }])
            Expect(stale.compile?.status).toBe('error')
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot))).toBe(secondPublication)

            await FS.writeText(paths['Garden.tao'], file.content.replace('Before', 'Recovered'))
            const recovered = await preview.session.noteWatchChanges([{ path: paths['Garden.tao'] }])
            Expect(recovered.compile?.status).toBe('compiled')
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', generatedRoot)))
              .toContain('"compileRevision":6')
          } finally {
            await preview.close()
          }

          const reopened = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewRuntimeRoot,
            projectRoot: root,
          })
          try {
            const fresh = await reopened.session.compileInitial()
            Expect(fresh.status).toBe('compiled')
            Expect(fresh.compileRevision).toBe(1)
            Expect(fresh.publishedRevision).toBe(undefined)
            Expect(reopened.session.previewManifest()?.compileRevision).toBe(1)
            const reopenedGeneratedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
            Expect(await FS.readText(FS.resolvePath('TaoStudioPublication.ts', reopenedGeneratedRoot)))
              .toContain('"compileRevision":1')
          } finally {
            await reopened.close()
          }
        },
      )
    } finally {
      await FS.remove(previewRuntimeRoot)
    }
  },
)

Test('Studio preview session resolves a package created after its first compile', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-new-package-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-new-package-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-garden-new-package" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Garden") }
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
          // The preview reuses its workspace between compiles, and a workspace indexes `@` packages
          // when it opens; one created later must still resolve.
          const dataPath = FS.resolvePath('@model/Data.tao', root)
          await FS.mkdir(FS.dirname(dataPath))
          await FS.writeText(dataPath, 'public data Plants / Plant { Name text }\n')
          await preview.session.noteWatchChanges([{ path: dataPath }])
          const file = await preview.session.readFile('Garden.tao')
          const saved = await preview.session.syncDraft({
            content: `use Plant from @model\n${file.content}\nfixture Seed { Fern = create Plant { Name: "Fern" } }\n`,
            path: file.path,
            sourceVersion: file.sourceVersion,
            writeId: 'use-new-package',
          })
          if (saved.compile?.status !== 'compiled') {
            Errors.throwUnexpected(`Draft using the new package did not compile: ${saved.compile?.message}`)
          }
          Expect(saved.compile.status).toBe('compiled')
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio preview session keeps design and consumer source epochs distinct across edits and a revert', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-design-epochs-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-design-epochs-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          use StackNav from @tao/nav
          use Theme from ./Theme
          app Garden { id "tao-studio-garden-design-epochs" version "1.0.0" name "Garden" Navigator StackNav { Initial Main } Design Theme }
          scene Main() { Title "Main" render Text("Before") [title] }
        `,
        'Theme.tao': 'public design Theme { ink #111 title [fg ink] }\n',
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
        const generatedConsumer = () => FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))
        const generatedDesign = () => FS.readText(FS.resolvePath('modules/Theme.tao.tsx', generatedRoot))
        try {
          const initial = await preview.session.compileInitial()
          if (initial.status !== 'compiled') {
            Errors.throwUnexpected(initial.message)
          }
          Expect(initial.compileRevision).toBe(1)
          const initialConsumer = await generatedConsumer()
          const initialDesign = await generatedDesign()
          Expect(initialConsumer).toContain('Before')
          Expect(initialConsumer).toContain('const __tao_design_cohort__ = TR.Design.Cohort({')
          Expect(initialDesign).toContain('"ink": "#111"')
          const initialDesignMetadata = emittedDesignDeclarationMetadata(initialDesign)
          Expect(initialDesignMetadata.path).toBe(paths['Theme.tao'])
          Expect(initialDesignMetadata.epoch).toBe(1)
          Expect(initialDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(1)
          const initialRenderSource = emittedRenderDesignSource(initialConsumer, paths['Garden.tao'])
          Expect(initialRenderSource.epoch).toBe(1)
          Expect(initialRenderSource.designEpochs[paths['Theme.tao']]).toBe(1)

          const consumer = await preview.session.readFile('Garden.tao')
          const consumerEdit = await preview.session.syncDraft({
            content: consumer.content.replace('Before', 'After'),
            path: consumer.path,
            sourceVersion: consumer.sourceVersion,
            writeId: 'change-consumer',
          })
          Expect(consumerEdit.saved).toBe(true)
          Expect(consumerEdit.compile?.compileRevision).toBe(2)
          const changedConsumer = await generatedConsumer()
          const unchangedDesign = await generatedDesign()
          Expect(changedConsumer).toContain('After')
          Expect(changedConsumer).not.toBe(initialConsumer)
          Expect(unchangedDesign).toBe(initialDesign)
          const changedRenderSource = emittedRenderDesignSource(changedConsumer, paths['Garden.tao'])
          Expect(changedRenderSource.epoch).toBe(2)
          Expect(changedRenderSource.designEpochs[paths['Theme.tao']]).toBe(1)

          const design = await preview.session.readFile('Theme.tao')
          const designEdit = await preview.session.syncDraft({
            content: design.content.replace('#111', '#222'),
            path: design.path,
            sourceVersion: design.sourceVersion,
            writeId: 'change-design',
          })
          Expect(designEdit.saved).toBe(true)
          Expect(designEdit.compile?.compileRevision).toBe(3)
          const changedDesign = await generatedDesign()
          Expect(await generatedConsumer()).toBe(changedConsumer)
          Expect(changedDesign).toContain('"ink": "#222"')
          Expect(changedDesign).not.toBe(initialDesign)
          const changedDesignMetadata = emittedDesignDeclarationMetadata(changedDesign)
          Expect(changedDesignMetadata.epoch).toBe(3)
          Expect(changedDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(2)

          const reverted = await preview.session.syncDraft({
            content: design.content,
            path: designEdit.file.path,
            sourceVersion: designEdit.file.sourceVersion,
            writeId: 'revert-design',
          })
          Expect(reverted.saved).toBe(true)
          Expect(reverted.compile?.compileRevision).toBe(4)
          Expect(reverted.file.sourceVersion).toBe(design.sourceVersion)
          const revertedDesign = await generatedDesign()
          Expect(revertedDesign).toContain('"ink": "#111"')
          Expect(revertedDesign).not.toBe(initialDesign)
          Expect(await generatedConsumer()).toBe(changedConsumer)
          const revertedDesignMetadata = emittedDesignDeclarationMetadata(revertedDesign)
          Expect(revertedDesignMetadata.epoch).toBe(4)
          Expect(revertedDesignMetadata.epoch).toBeGreaterThan(initialDesignMetadata.epoch)
          Expect(revertedDesignMetadata.sourceEpochs[paths['Garden.tao']]).toBe(2)
        } finally {
          await preview.close()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

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

Test('Studio file watching compiles an external Tao source edit', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-watch-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-watch-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
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
          await FS.writeText(paths['Garden.tao'], file.content.replace('Before', 'External'))
          await waitFor(() => {
            const snapshot = preview.session.compileSnapshot()
            return snapshot.compileRevision === 2 && snapshot.status === 'compiled'
          })
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

Test('Studio file watcher reconciles files created between the initial scan and watcher readiness', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-watch-reconcile-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-watch-reconcile-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-garden" version "1.0.0" name "Garden"  view Main }
          view Main() { render Text("Garden") }
        `,
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        await FS.writeText(FS.resolvePath('Missed.tao', root), 'view Missed() { render Text("Found") }\n')
        const watcher = await startStudioFileWatcher(preview.session, {
          batchDelayMs: 5,
          reconcileIntervalMs: 0,
        })
        try {
          Expect((await preview.session.files()).map(file => file.path)).toContain('Missed.tao')
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

Test('Studio file watcher preserves event order while an older hash is still pending', async () => {
  const oldHash = Deferred<void>()
  const hashing = Deferred<void>()
  const applied: Array<[string, boolean]> = []
  const lane = StudioFileWatcherTesting.createChangeLane(async (path, exists) => {
    if (exists) {
      hashing.resolve()
      await oldHash.promise
    }
    applied.push([path, exists])
  })

  lane.note('/project/App.tao', true)
  lane.note('/project/App.tao', false)
  try {
    await hashing.promise
    Expect(applied).toEqual([])
    oldHash.resolve()
    await lane.drain()

    Expect(applied).toEqual([
      ['/project/App.tao', true],
      ['/project/App.tao', false],
    ])
  } finally {
    oldHash.resolve()
    await lane.drain()
  }
})

async function waitFor(predicate: () => boolean): Promise<void> {
  await until(predicate, { description: 'the Studio file watcher' })
}

function emittedDesignDeclarationMetadata(code: string): {
  path: string
  epoch: number
  sourceEpochs: Record<string, number>
} {
  const match = code.match(
    /TR\.Design\.Declaration\([\s\S]*?,\s*\{\s*path:\s*("(?:\\.|[^"\\])*"),\s*epoch:\s*(\d+),\s*sourceEpochs:\s*(\{[^}]*\})/u,
  )
  if (match === null) {
    Errors.throwUnexpected('Expected generated Design declaration source metadata.')
  }
  return { path: JSON.parse(match[1]!), epoch: Number(match[2]), sourceEpochs: JSON.parse(match[3]!) }
}

function emittedRenderDesignSource(code: string, sourcePath: string): {
  epoch: number
  designEpochs: Record<string, number>
} {
  const sources = code.matchAll(
    /path:\s*("(?:\\.|[^"\\])*"),\s*cohort:\s*__tao_design_cohort__,\s*epoch:\s*(\d+),\s*designEpochs:\s*(\{[^}]*\})/gu,
  )
  const match = [...sources].find(source => JSON.parse(source[1]!) === sourcePath)
  if (match === undefined) {
    Errors.throwUnexpected(`Expected generated render Design source metadata for ${sourcePath}.`)
  }
  return { epoch: Number(match[2]), designEpochs: JSON.parse(match[3]!) }
}
