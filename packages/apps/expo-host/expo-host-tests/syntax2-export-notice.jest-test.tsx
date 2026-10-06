import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { Assert, FS, Repo } from '@shared'
import { Describe, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Syntax2 mounted export notice journey', () => {
  Test('publishes the real adapter notice and renders it in the mounted book row', async () => {
    const appRoot = Repo.resolvePath('Apps/Syntax2')
    const sources: Record<string, string> = {}
    for await (
      const path of FS.walk(appRoot, {
        extensions: ['.tao', '.ts', '.tsx'],
        excludeDirectory: name => name.startsWith('_gen') || name === 'node_modules',
      })
    ) {
      if (!path.endsWith('.test.tao')) {
        sources[FS.relativePath(appRoot, path)] = await FS.readText(path)
      }
    }

    const viewsPath = 'library/BookViews.tao'
    const views = sources[viewsPath]
    Assert.defined(views, 'the actual app book row is part of the isolated source copy')
    const noticeSlot = '      Notice\n      Row {'
    Assert(views.includes(noticeSlot), 'the actual BookRow renders its export notice before its actions')
    const patchedViews = views.replace(
      noticeSlot,
      `      Notice
      // Test trigger calls the real adapter directly; it does not exercise export timing or native I/O.
      Button("Trigger export notice") {
         on press -> do NotifyExport(Book, 2 seconds)
      }
      Row {`,
    )
    ExpectSingleReplacement(views, patchedViews)
    sources[viewsPath] = patchedViews

    sources['ExportNotice.test.tao'] = `
      use LibraryApp from ./Main

      test "Syntax2 export notice" {
        test "renders the metadata-published notice in its book row" {
          run LibraryApp
          select #book[1] {
            expect missing label "Export complete book-001"
            expect missing text "Export completed in 2 seconds."
            press "Trigger export notice"
            expect label "Export complete book-001"
            expect text "Export completed in 2 seconds."
          }
        }
      }
    `

    await withTaoFiles('tao-syntax2-export-notice-', sources, async paths => {
      await RuntimeTesting.runTaoTestPlan(paths['ExportNotice.test.tao']!)
    })
  })
})

function ExpectSingleReplacement(original: string, replacement: string): void {
  Assert(original !== replacement, 'the one test-only export-notice trigger was inserted')
  Assert(original.split('      Notice\n      Row {').length === 2, 'the BookRow notice slot is unique')
}
