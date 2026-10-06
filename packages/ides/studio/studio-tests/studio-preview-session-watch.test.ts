import { FS } from '@shared'
import { Deferred, Expect, mkTestDir, Test, until, withTaoFiles } from '@shared/test'
import { startStudioFileWatcher, StudioFileWatcherTesting } from '../studio-src/StudioFileWatcher'
import { openStudioPreviewSession } from '../studio-src/StudioPreviewSession'

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
