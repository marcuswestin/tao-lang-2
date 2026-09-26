import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('native process completion', () => {
  async function probe(mode: string): Promise<void> {
    const root = await mkTestDir('tao-process-completion-')
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/process-completion.ts', import.meta.dir), mode, root],
      processPolicy: 'test',
      timeoutMs: 40_000,
    })
    Expect(result.stderr).toBe('')
    Expect(result.exitCode).toBe(0)
    Expect(JSON.parse(result.stdout)).toEqual({ mode, ownedGroupsGone: true })
  }

  Test('CLI drains both descendant output tails when aggregate close is missing', async () => {
    await probe('cli')
  })
  Test('Studio retains its artifact and both descendant output tails when aggregate close is missing', async () => {
    await probe('studio')
  })
  Test('Studio exit-only completion leaves descendant pipe draining to the close observer', async () => {
    await probe('exit')
  })
  Test('completes ignored and inherited output and reports a failed spawn', async () => {
    await probe('stdio')
  })
})
