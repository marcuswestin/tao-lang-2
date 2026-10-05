import { reportPostLandingResources } from '@cli-kit/ResourceCommands'
import { Errors, FS, type ResourceInventory } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'

Describe('post-landing resource review', () => {
  Test('saves the full inventory and offers review without stdout pollution or cleanup', async () => {
    const root = await mkTestDir('land-resource-report-')
    const sentinel = FS.resolvePath('keep-resource', root)
    const report: ResourceInventory.Report = {
      version: 1,
      entries: [{ id: 'running-task', kind: 'process', classification: 'active', path: sentinel }],
      warnings: ['one ownership record remains unverified'],
    }
    try {
      await FS.writeText(sentinel, 'preserve')
      const captured = await withCapturedOutput(() =>
        reportPostLandingResources(root, async options => {
          Expect(options).toEqual({ checkout: root, mode: 'full' })
          return report
        })
      )
      Expect(captured.stdout).toBe('')
      Expect(captured.stderr).toContain('active: 1')
      Expect(captured.stderr).toContain('Review this task’s resources with the Developer before cleanup')
      Expect(captured.stderr).toContain('one ownership record remains unverified')
      Expect(await FS.readJson(FS.resolvePath('.artifacts/resources/after-land.json', root))).toEqual(report)
      Expect(await FS.readText(sentinel)).toBe('preserve')
    } finally {
      await FS.remove(root)
    }
  })

  Test('a failed resource audit preserves the successful landing result and gives a retry', async () => {
    const captured = await withCapturedOutput(() =>
      reportPostLandingResources('/unused', async () => {
        Errors.throwHostEnvironment('identity inspection denied')
      })
    )
    Expect(captured.result).toBeUndefined()
    Expect(captured.stdout).toBe('')
    Expect(captured.stderr).toContain('Landing completed; resource inspection failed:')
    Expect(captured.stderr).toContain('Run tao resources to retry.')
  })
})
