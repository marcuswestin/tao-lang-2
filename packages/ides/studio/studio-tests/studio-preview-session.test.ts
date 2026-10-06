import Runtime from '@expo-host'
import { ProjectTooling, type ProjectToolingResult } from '@project-tooling'
import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, settle, Test, testOverrideSlot, until, withTaoFiles } from '@shared/test'
import { StudioPreviewManifest } from '../studio-src/StudioPreviewManifest'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'
import { StudioServerTesting } from '../studio-src/StudioServer'

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
const runtimeGenerateAppSlot = testOverrideSlot({
  read: () => Runtime.generateApp,
  write: value => {
    Reflect.set(Runtime, 'generateApp', value)
  },
})
const timeoutSlot = testOverrideSlot({
  read: () => globalThis.setTimeout,
  write: value => {
    globalThis.setTimeout = value
  },
})
const clearTimeoutSlot = testOverrideSlot({
  read: () => globalThis.clearTimeout,
  write: value => {
    globalThis.clearTimeout = value
  },
})

function observeProjectTooling(root: string, beforeRefresh?: (refreshCount: number) => Promise<void>) {
  const originalWatch = ProjectTooling.watch
  let refreshes = 0
  let audits = 0
  let disposals = 0
  const restore = projectToolingWatchSlot.install(async (project, options) => {
    const watch = await originalWatch(project, options)
    if (FS.resolvePath(project) !== root) {
      return watch
    }
    return {
      get lastResult() {
        return watch.lastResult
      },
      async requestRefresh(refreshOptions) {
        refreshes += 1
        await beforeRefresh?.(refreshes)
        return await watch.requestRefresh(refreshOptions)
      },
      async auditPreview(sourceVersions, versionOfSource) {
        audits += 1
        return await watch.auditPreview?.(sourceVersions, versionOfSource) ?? false
      },
      async dispose() {
        disposals += 1
        await watch.dispose()
      },
    }
  })
  return {
    get audits() {
      return audits
    },
    get disposals() {
      return disposals
    },
    get refreshes() {
      return refreshes
    },
    restore,
  }
}

function observeSessionFullPassTimers() {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const pending = new Map<ReturnType<typeof setTimeout>, (...args: never[]) => void>()
  let fired = 0
  const observedSetTimeout = Object.assign(
    (callback: (...args: never[]) => void, delay?: number) => {
      const isSessionScheduler = delay === 10_000
        && new Errors.UnexpectedBehaviorError('Identify the Studio scheduler timeout.').stack
            ?.includes('StudioPreviewSession.ts') === true
      if (!isSessionScheduler) {
        return originalSetTimeout(callback, delay)
      }
      const handle = originalSetTimeout(() => {}, 60_000)
      handle.unref?.()
      pending.set(handle, callback)
      return handle
    },
    originalSetTimeout,
  )
  const restoreTimeout = timeoutSlot.install(observedSetTimeout)
  const restoreClearTimeout = clearTimeoutSlot.install(
    ((handle: ReturnType<typeof setTimeout>) => {
      pending.delete(handle)
      originalClearTimeout(handle)
    }) as typeof clearTimeout,
  )
  return {
    get fired() {
      return fired
    },
    get pendingCount() {
      return pending.size
    },
    firePending() {
      const scheduled = [...pending]
      for (const [handle, callback] of scheduled) {
        pending.delete(handle)
        originalClearTimeout(handle)
        fired += 1
        callback()
      }
    },
    restore() {
      restoreClearTimeout()
      restoreTimeout()
    },
  }
}

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

Test(
  'Studio admits one current editor save with a registered preview and close flushes and cancels its full pass',
  async () => {
    const previewRuntimeRoot = await mkTestDir('tao-studio-preview-first-runtime-')
    try {
      await withTaoFiles(
        'tao-studio-preview-first-project-',
        {
          'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-preview-first" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
        `,
        },
        async (paths, root) => {
          const tooling = observeProjectTooling(root)
          let closed = false
          let timers: ReturnType<typeof observeSessionFullPassTimers> | undefined
          try {
            const preview = await openStudioPreviewSession({
              entryPath: paths['Garden.tao'],
              previewFirst: true,
              previewRuntimeRoot,
              projectRoot: root,
            })
            try {
              const initial = await preview.session.compileInitial()
              Expect(initial.status).toBe('compiled')
              Expect(tooling.refreshes).toBe(1)
              preview.session.registerPreview({ previewInstanceId: 'existing-preview' })

              const file = await preview.session.readFile('Garden.tao')
              timers = observeSessionFullPassTimers()
              const saved = await preview.session.syncDraft({
                content: file.content.replace('Before', 'After'),
                path: file.path,
                sourceVersion: file.sourceVersion,
                writeId: 'preview-first-save',
              })
              Expect(saved.saved).toBe(true)
              Expect(saved.compile?.status).toBe('compiled')
              Expect(saved.compile?.compileRevision).toBe(2)
              Expect(tooling.audits).toBeGreaterThan(0)
              Expect(tooling.refreshes).toBe(1)
              Expect(timers.pendingCount).toBe(1)
              const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
              const publicationPath = FS.resolvePath('TaoStudioPublication.ts', generatedRoot)
              Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))).toContain('After')
              Expect(await FS.readText(publicationPath)).toContain('"compileRevision":2')
              Expect(await FS.readText(publicationPath)).toContain(saved.file.sourceVersion)

              await preview.close()
              closed = true
              Expect(preview.session.compileSnapshot().compileRevision).toBe(3)
              Expect(tooling.refreshes).toBe(2)
              Expect(tooling.disposals).toBe(1)
              Expect(timers.pendingCount).toBe(0)
              Expect(timers.fired).toBe(0)
            } finally {
              if (!closed) {
                await preview.close()
              }
            }
          } finally {
            timers?.restore()
            tooling.restore()
          }
        },
      )
    } finally {
      await FS.remove(previewRuntimeRoot)
    }
  },
)

Test('Studio does not publish a failed fast compile and recovers it through an authoritative compile', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-preview-first-recovery-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-preview-first-recovery-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-preview-first-recovery" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
        `,
      },
      async (paths, root) => {
        const tooling = observeProjectTooling(root)
        const originalGenerateApp = Runtime.generateApp
        const recoveryStarted = Deferred<void>()
        const releaseRecovery = Deferred<void>()
        let failedFastCompile = false
        const restoreGenerate = runtimeGenerateAppSlot.install(async (entryPath, options) => {
          if (options?.preview?.revision === 2 && !failedFastCompile) {
            failedFastCompile = true
            return Errors.throwUnexpected('Synthetic fast compile failure for the Studio recovery test.')
          }
          if (options?.preview?.revision === 3) {
            recoveryStarted.resolve()
            await releaseRecovery.promise
          }
          return await originalGenerateApp(entryPath, options)
        })
        let closed = false
        try {
          const preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewFirst: true,
            previewRuntimeRoot,
            projectRoot: root,
          })
          try {
            const initial = await preview.session.compileInitial()
            Expect(initial.status).toBe('compiled')
            preview.session.registerPreview({ previewInstanceId: 'recovery-preview' })
            const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
            const publicationPath = FS.resolvePath('TaoStudioPublication.ts', generatedRoot)
            const baselinePublication = await FS.readText(publicationPath)
            const file = await preview.session.readFile('Garden.tao')
            const failed = await preview.session.syncDraft({
              content: file.content.replace('Before', 'Recovered'),
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'preview-first-failed-save',
            })

            Expect(failedFastCompile).toBe(true)
            Expect(failed.compile?.status).toBe('error')
            Expect(failed.compile?.compileRevision).toBe(2)
            await recoveryStarted.promise
            Expect(tooling.refreshes).toBe(2)
            Expect(await FS.readText(publicationPath)).toBe(baselinePublication)
            Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))).toContain('Before')

            releaseRecovery.resolve()
            await until(() => {
              const snapshot = preview.session.compileSnapshot()
              return snapshot.compileRevision === 3 && snapshot.status === 'compiled'
            }, { description: 'the authoritative recovery after a failed fast Studio compile' })
            Expect(await FS.readText(publicationPath)).toContain('"compileRevision":3')
            Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))).toContain('Recovered')
          } finally {
            releaseRecovery.resolve()
            await preview.close()
            closed = true
          }
        } finally {
          releaseRecovery.resolve()
          restoreGenerate()
          tooling.restore()
          Expect(closed).toBe(true)
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio rejects a stale source snapshot before publishing generated output', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-stale-snapshot-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-stale-snapshot-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-stale-snapshot" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
        `,
      },
      async (paths, root) => {
        const originalGenerateApp = Runtime.generateApp
        let changedAtGenerate = false
        const restoreGenerate = runtimeGenerateAppSlot.install(async (entryPath, options) => {
          if (options?.preview?.revision === 2) {
            changedAtGenerate = true
            await FS.writeText(
              paths['Garden.tao'],
              (await FS.readText(paths['Garden.tao'])).replace('After', 'External'),
            )
          }
          return await originalGenerateApp(entryPath, options)
        })
        try {
          const preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewFirst: true,
            previewRuntimeRoot,
            projectRoot: root,
          })
          try {
            const initial = await preview.session.compileInitial()
            Expect(initial.status).toBe('compiled')
            const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
            const publicationPath = FS.resolvePath('TaoStudioPublication.ts', generatedRoot)
            const baselinePublication = await FS.readText(publicationPath)
            const file = await preview.session.readFile('Garden.tao')
            const stale = await preview.session.syncDraft({
              content: file.content.replace('Before', 'After'),
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'stale-source-save',
            })

            Expect(changedAtGenerate).toBe(true)
            Expect(stale.compile?.status).toBe('error')
            Expect(await FS.readText(publicationPath)).toBe(baselinePublication)
            Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', generatedRoot))).toContain('Before')
            Expect(await FS.readText(paths['Garden.tao'])).toContain('External')
          } finally {
            await preview.close()
          }
        } finally {
          restoreGenerate()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio publishes a direct design overlay before registering a new preview instance', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-design-admission-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-design-admission-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          use Theme from ./Design
          app Garden { id "tao-studio-design-admission" version "1.0.0" name "Garden" Design Theme view Main }
          view Main() { render Text("Garden") [compact] }
        `,
        'Design.tao': 'public design Theme { styles { compact [pad 8, radius 4] } }\n',
      },
      async (paths, root) => {
        const preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewFirst: true,
          previewPublication: 'off',
          previewRuntimeRoot,
          projectRoot: root,
        })
        const timers = observeSessionFullPassTimers()
        let designDeliveryObserved = false
        const unsubscribe = preview.session.subscribe(event => {
          if (event.type === 'design-padding' && event.padding === 12) {
            designDeliveryObserved = true
          }
        })
        try {
          const initial = await preview.session.compileInitial()
          Expect(initial.status).toBe('compiled')
          preview.session.registerPreview({ previewInstanceId: 'existing-design-preview' })
          const generatedRoot = FS.resolvePath('_gen_tao-app', previewRuntimeRoot)
          const publicationPath = FS.resolvePath('TaoStudioPublication.ts', generatedRoot)
          const baselinePublication = await FS.readText(publicationPath)
          const designModulePath = await generatedDesignModulePath(generatedRoot)
          const baselineDesignModule = await FS.readText(designModulePath)
          const file = await preview.session.readFile('Design.tao')
          const delivered = await preview.session.syncDraft({
            content: file.content.replace('pad 8', 'pad 12'),
            path: file.path,
            sourceVersion: file.sourceVersion,
            writeId: 'design-padding-update',
          })

          Expect(delivered.saved).toBe(true)
          Expect(delivered.compile?.status).toBe('compiled')
          Expect(delivered.compile?.compileRevision).toBe(2)
          Expect(designDeliveryObserved).toBe(true)
          Expect(await FS.readText(publicationPath)).toBe(baselinePublication)
          Expect(await FS.readText(designModulePath)).toBe(baselineDesignModule)

          const url = new URL('http://127.0.0.1:5678/api/preview/instance')
          const response = await StudioServerTesting.handleRequest(
            preview.session,
            {} as never,
            new Request(url, {
              body: JSON.stringify({ previewInstanceId: 'new-design-preview' }),
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            }),
            url,
            {},
          )
          Expect(response.status).toBe(200)
          Expect(preview.session.compileSnapshot().previewInstanceId).toBe('new-design-preview')
          Expect(preview.session.compileSnapshot().compileRevision).toBe(3)
          const publishedManifest = preview.session.previewManifest()
          Expect(publishedManifest?.compileRevision).toBe(3)
          Expect(Object.values(publishedManifest?.sourceVersions ?? {})).toContain(delivered.file.sourceVersion)
          const publishedDesignModule = await FS.readText(designModulePath)
          Expect(publishedDesignModule).not.toBe(baselineDesignModule)
          Expect(publishedDesignModule).toContain('12')
        } finally {
          unsubscribe()
          try {
            await preview.close()
          } finally {
            timers.restore()
          }
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio keeps full refresh pending until the last current cell preview unregisters', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-preview-consumer-release-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-preview-consumer-release-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-preview-consumer-release" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
          scenarios Main "states" {
            device phone
            scenario "phone" { network online render Main() }
          }
        `,
      },
      async (paths, root) => {
        const tooling = observeProjectTooling(root)
        const timers = observeSessionFullPassTimers()
        let closed = false
        try {
          const preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewFirst: true,
            previewRuntimeRoot,
            projectRoot: root,
          })
          try {
            const initial = await preview.session.compileInitial()
            Expect(initial.status).toBe('compiled')
            const initialManifest = preview.session.previewManifest()
            const initialCell = initialManifest?.cells[0]
            Expect(initialCell).toBeDefined()
            if (initialManifest === undefined || initialCell === undefined) {
              Errors.throwUnexpected('Expected an initial compiled preview cell for the consumer release test.')
            }
            const initialIdentity = StudioPreviewManifest.cellIdentity(initialManifest, initialCell)
            preview.session.registerCellPreview({ ...initialIdentity, previewInstanceId: 'initial-cell-one' })
            preview.session.registerCellPreview({ ...initialIdentity, previewInstanceId: 'initial-cell-two' })
            Expect(preview.session.hasPreviewConsumers()).toBe(true)
            const file = await preview.session.readFile('Garden.tao')
            const saved = await preview.session.syncDraft({
              content: file.content.replace('Before', 'After'),
              path: file.path,
              sourceVersion: file.sourceVersion,
              writeId: 'release-last-preview-save',
            })
            Expect(saved.saved).toBe(true)
            Expect(saved.compile?.status).toBe('compiled')
            Expect(saved.compile?.compileRevision).toBe(2)
            Expect(tooling.refreshes).toBe(1)

            // Fast publication rebases cell identities. Register two consumers against the
            // current revision so later unregistrations exercise the true-to-false transition.
            const manifest = preview.session.previewManifest()
            const cell = manifest?.cells[0]
            Expect(cell).toBeDefined()
            if (manifest === undefined || cell === undefined) {
              Errors.throwUnexpected('Expected a current compiled preview cell for the consumer release test.')
            }
            const identity = StudioPreviewManifest.cellIdentity(manifest, cell)
            preview.session.registerCellPreview({ ...identity, previewInstanceId: 'current-cell-one' })
            preview.session.registerCellPreview({ ...identity, previewInstanceId: 'current-cell-two' })
            Expect(preview.session.hasPreviewConsumers()).toBe(true)
            Expect(timers.pendingCount).toBe(1)

            // An obsolete registration id and removal of one real consumer leave one live
            // consumer, so neither transition may drain the pending authoritative pass.
            preview.session.unregisterCellPreview('obsolete-after-rebase')
            Expect(preview.session.hasPreviewConsumers()).toBe(true)
            preview.session.unregisterCellPreview('current-cell-one')
            Expect(preview.session.hasPreviewConsumers()).toBe(true)
            Expect(tooling.refreshes).toBe(1)
            Expect(preview.session.compileSnapshot().compileRevision).toBe(2)

            preview.session.unregisterCellPreview('current-cell-two')
            Expect(preview.session.hasPreviewConsumers()).toBe(false)
            await until(() => {
              const snapshot = preview.session.compileSnapshot()
              return snapshot.compileRevision === 3 && snapshot.status === 'compiled'
            }, { description: 'the authoritative refresh after the final current cell preview unregisters' })
            Expect(tooling.refreshes).toBe(2)
            Expect(await FS.readText(FS.resolvePath('TaoApp.tsx', FS.resolvePath('_gen_tao-app', previewRuntimeRoot))))
              .toContain('After')
          } finally {
            await preview.close()
            closed = true
          }
        } finally {
          timers.restore()
          tooling.restore()
          Expect(closed).toBe(true)
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

async function generatedDesignModulePath(generatedRoot: string): Promise<string> {
  for await (const path of FS.walk(generatedRoot, { extensions: ['.ts', '.tsx'] })) {
    const source = await FS.readText(path)
    if (source.includes('TR.Design.Declaration') && source.includes('Design.tao')) {
      return path
    }
  }
  return Errors.throwUnexpected('Expected a generated Design declaration module for the Studio overlay test.')
}

Test('Studio close waits for an already released authoritative refresh before disposing its watch', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-close-in-flight-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-close-in-flight-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-close-in-flight" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Before") }
        `,
      },
      async (paths, root) => {
        const refreshStarted = Deferred<void>()
        const releaseRefresh = Deferred<void>()
        const tooling = observeProjectTooling(root, async refreshCount => {
          if (refreshCount === 2) {
            refreshStarted.resolve()
            await releaseRefresh.promise
          }
        })
        const timers = observeSessionFullPassTimers()
        let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
        let closed = false
        try {
          preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewFirst: true,
            previewRuntimeRoot,
            projectRoot: root,
          })
          const initial = await preview.session.compileInitial()
          Expect(initial.status).toBe('compiled')
          preview.session.registerPreview({ previewInstanceId: 'close-in-flight-preview' })
          const file = await preview.session.readFile('Garden.tao')
          const saved = await preview.session.syncDraft({
            content: file.content.replace('Before', 'After'),
            path: file.path,
            sourceVersion: file.sourceVersion,
            writeId: 'close-in-flight-save',
          })
          Expect(saved.saved).toBe(true)
          Expect(saved.compile?.status).toBe('compiled')
          Expect(tooling.refreshes).toBe(1)
          Expect(timers.pendingCount).toBe(1)

          timers.firePending()
          await refreshStarted.promise
          const close = preview.close().then(() => {
            closed = true
          })
          await settle()
          Expect(closed).toBe(false)
          Expect(tooling.disposals).toBe(0)

          releaseRefresh.resolve()
          await close
          Expect(closed).toBe(true)
          Expect(preview.session.compileSnapshot().compileRevision).toBe(3)
          Expect(tooling.refreshes).toBe(2)
          Expect(tooling.disposals).toBe(1)
          Expect(timers.pendingCount).toBe(0)
          Expect(timers.fired).toBe(1)
        } finally {
          releaseRefresh.resolve()
          if (!closed) {
            // The close promise above is the owner of the in-flight pass; when the test body
            // fails early, closing still drains it before restoring the global watch wrapper.
            await preview?.close()
          }
          timers.restore()
          tooling.restore()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})

Test('Studio close drains queued initial compiles before flushing or disposing the tooling watch', async () => {
  const previewRuntimeRoot = await mkTestDir('tao-studio-close-queued-compiles-runtime-')
  try {
    await withTaoFiles(
      'tao-studio-close-queued-compiles-project-',
      {
        'Garden.tao': `
          use Text from @tao/ui
          app Garden { id "tao-studio-close-queued-compiles" version "1.0.0" name "Garden" view Main }
          view Main() { render Text("Queued") }
        `,
      },
      async (paths, root) => {
        const firstRefreshStarted = Deferred<void>()
        const releaseFirstRefresh = Deferred<void>()
        const tooling = observeProjectTooling(root, async refreshCount => {
          if (refreshCount === 1) {
            firstRefreshStarted.resolve()
            await releaseFirstRefresh.promise
          }
        })
        let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
        let closePromise: Promise<void> | undefined
        const compiles: Promise<unknown>[] = []
        let closed = false
        try {
          preview = await openStudioPreviewSession({
            entryPath: paths['Garden.tao'],
            previewFirst: true,
            previewRuntimeRoot,
            projectRoot: root,
          })
          const firstCompile = preview.session.compileInitial()
          compiles.push(firstCompile)
          await firstRefreshStarted.promise
          const secondCompile = preview.session.compileInitial()
          compiles.push(secondCompile)
          closePromise = preview.close().then(() => {
            closed = true
          })

          await settle()
          Expect(closed).toBe(false)
          Expect(tooling.disposals).toBe(0)
          Expect(tooling.refreshes).toBe(1)

          releaseFirstRefresh.resolve()
          const [first, second] = await Promise.all([firstCompile, secondCompile])
          await closePromise

          Expect(first.status).toBe('compiled')
          Expect(first.compileRevision).toBe(1)
          Expect(second.status).toBe('compiled')
          Expect(second.compileRevision).toBe(2)
          Expect(preview.session.compileSnapshot().compileRevision).toBe(2)
          Expect(tooling.refreshes).toBe(2)
          Expect(tooling.disposals).toBe(1)
          Expect(closed).toBe(true)
        } finally {
          releaseFirstRefresh.resolve()
          await Promise.allSettled(compiles)
          if (closePromise !== undefined) {
            await closePromise
          } else if (preview !== undefined) {
            await preview.close()
          }
          tooling.restore()
        }
      },
    )
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
})
