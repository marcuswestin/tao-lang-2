import { ProjectTooling, type ProjectToolingResult } from '@project-tooling'
import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, settle, Test, testOverrideSlot, until, withTaoFiles } from '@shared/test'
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
