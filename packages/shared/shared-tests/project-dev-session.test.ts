import { CLI, FS, ProjectDevSession } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'

Describe('project development session ownership', () => {
  Test('refuses a second process and retains a secret-free completed record', async () => {
    const root = await mkTestDir('tao-dev-owner-')
    const modulePath = FS.resolvePath('../shared-src/ProjectDevSession.ts', import.meta.dir)
    const source = `import { ProjectDevSession } from ${JSON.stringify(modulePath)};`
      + `await ProjectDevSession.acquire(${JSON.stringify(root)}, 'cli');`
      + `console.log('READY'); setInterval(() => {}, 1000);`
    let output = ''
    const child = CLI.start('bun', {
      args: ['-e', source],
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      stdio: 'pipe',
    })
    try {
      await until(() => output.includes('READY') ? true : undefined, {
        description: 'the child to claim the project',
      })
      await Expect(ProjectDevSession.acquire(root, 'studio'))
        .rejects.toThrow('already owned by cli session')
      const owner = await FS.readJson<{ id: string }>(FS.resolvePath('.tao/sessions/owner.json', root))
      child.kill('SIGKILL')
      await child.waitForClose()
      const recovered = await ProjectDevSession.acquire(root, 'studio')
      await recovered.release()
      const interrupted = await FS.readJson<{ status: string }>(FS.resolvePath(`.tao/sessions/${owner.id}.json`, root))
      const completed = await FS.readJson<{ status: string }>(
        FS.resolvePath(`.tao/sessions/${recovered.record.id}.json`, root),
      )
      Expect(interrupted.status).toBe('interrupted')
      Expect(completed.status).toBe('completed')
      Expect(await FS.isFile(FS.resolvePath('.tao/sessions/owner.json', root))).toBe(false)
      const recordText = await FS.readText(FS.resolvePath(`.tao/sessions/${recovered.record.id}.json`, root))
      Expect(recordText).not.toContain('capability')
      Expect(recordText).not.toContain('token')
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })
})
