import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { WatchmanCommand } from '../dev-cli-src/doctor/WatchmanCommand'

Describe('Watchman management', () => {
  Test('uses the stable pinned client and never spawns for status or stop', async () => {
    const root = await mkTestDir('tao-watchman-command-')
    try {
      const client = FS.resolvePath('primary/.devenv/profile/bin/watchman', root)
      await FS.writeText(client, '')
      const calls: Array<{ command: string; args: string[] }> = []
      const invoke = (action: string, exitCode = 0) =>
        withCapturedOutput(() =>
          WatchmanCommand.run(action, {
            repositoryRoot: root,
            readFacts: async () => ({ repositoryRoot: root, stableClient: client }),
            run: async (command, spec) => {
              const args = [...spec?.args ?? []]
              calls.push({ args, command })
              return { args, command, exitCode, signal: null, stderr: '', stdout: '' }
            },
          })
        )
      Expect((await invoke('start')).result).toBe(0)
      Expect((await invoke('status')).result).toBe(0)
      const stopped = await invoke('stop')
      Expect(stopped.result).toBe(0)
      Expect(stopped.stderr).toContain('all worktree subscriptions will disconnect')
      Expect(calls).toEqual([
        { command: client, args: ['--no-local', 'version'] },
        { command: client, args: ['--no-spawn', '--no-local', 'watch-list'] },
        { command: client, args: ['--no-spawn', '--no-local', 'shutdown-server'] },
      ])
      Expect((await invoke('status', 7)).result).toBe(7)
      const count = calls.length
      for (const action of ['watch-del-all', 'toString', '']) {
        Expect((await invoke(action)).result).toBe(2)
      }
      await FS.remove(client)
      const missing = await invoke('start')
      Expect(missing.result).toBe(1)
      Expect(missing.stderr).toContain('Pinned Watchman is missing')
      Expect(calls).toHaveLength(count)
      let unknownPrimaryCalls = 0
      const unknownPrimary = await withCapturedOutput(() =>
        WatchmanCommand.run('start', {
          repositoryRoot: root,
          readFacts: async () => ({ repositoryRoot: root }),
          run: async command => {
            unknownPrimaryCalls++
            return { command, args: [], exitCode: 0, signal: null, stderr: '', stdout: '' }
          },
        })
      )
      Expect(unknownPrimary.result).toBe(1)
      Expect(unknownPrimaryCalls).toBe(0)
      Expect(unknownPrimary.stderr).toContain('Cannot locate the primary checkout')
    } finally {
      await FS.remove(root)
    }
  })

  Test('starts the daemon before a lane lowers its priority only off macOS and only when a gate needs it', async () => {
    const root = await mkTestDir('tao-watchman-priority-')
    try {
      const client = FS.resolvePath('primary/.devenv/profile/bin/watchman', root)
      await FS.writeText(client, '')
      const calls: Array<{ args: string[]; stdio: unknown }> = []
      const start = (needsWatchman: boolean, hostPlatform: string) =>
        WatchmanCommand.startBeforeLoweringPriority(needsWatchman, {
          hostPlatform,
          repositoryRoot: root,
          readFacts: async () => ({ repositoryRoot: root, stableClient: client }),
          run: async (command, spec) => {
            const args = [...spec?.args ?? []]
            calls.push({ args, stdio: spec?.stdio })
            return { args, command, exitCode: 0, signal: null, stderr: '', stdout: '' }
          },
        })
      Expect(await start(true, 'darwin')).toBeUndefined()
      Expect(await start(false, 'linux')).toBeUndefined()
      Expect(calls).toEqual([])
      Expect(await start(true, 'linux')).toBe(0)
      Expect(calls).toEqual([{ args: ['--no-local', 'version'], stdio: 'pipe' }])
    } finally {
      await FS.remove(root)
    }
  })
})
