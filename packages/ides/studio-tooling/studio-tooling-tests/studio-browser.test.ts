import { type CLI, Errors, type Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioBrowser } from '../studio-tooling-src/StudioBrowser'

Describe('Studio Chrome launch', () => {
  const url = 'http://127.0.0.1:8081/app?title=one%20two&literal=$(touch%20ignored)#screen'

  Test('opens Chrome explicitly on macOS and preserves the URL as one argument', async () => {
    const calls: unknown[] = []
    await StudioBrowser.open(url, {
      platform: 'darwin',
      run: async (command, options) => {
        calls.push({ command, options })
        return { exitCode: 0 } as CLI.CommandResult
      },
    })
    Expect(calls).toEqual([{ command: '/usr/bin/open', options: { args: ['-a', 'Google Chrome', url] } }])
  })

  Test('reports launcher failures instead of claiming that Chrome opened', async () => {
    for (
      const result of [{ exitCode: 1 }, { error: new Errors.HostEnvironmentError('spawn failed'), exitCode: null }]
    ) {
      await Expect(StudioBrowser.open(url, {
        platform: 'darwin',
        run: async () => result as CLI.CommandResult,
      })).rejects.toThrow('Could not open Google Chrome.')
    }
  })

  Test('launches the Chrome executable on Linux and Windows without waiting for browser exit', async () => {
    for (
      const [platform, expectedCommand] of [
        ['linux', 'google-chrome'],
        ['win32', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
      ] as const
    ) {
      const calls: unknown[] = []
      let unreferenced = false
      await StudioBrowser.open(url, {
        env: { PROGRAMFILES: 'C:\\Program Files' },
        exists: async path => path === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        platform,
        spawn: (command, options) => {
          calls.push({ command, options })
          return {
            once(event: string, listener: () => void) {
              if (event === 'spawn') {
                queueMicrotask(listener)
              }
              return this
            },
            unref() {
              unreferenced = true
            },
          } as ReturnType<typeof Platform.spawn>
        },
      })
      Expect(calls).toEqual([{ command: expectedCommand, options: { args: [url], detached: true, stdio: 'ignore' } }])
      Expect(unreferenced).toBe(true)
    }
  })

  Test('rejects a missing Chrome executable without trying another browser', async () => {
    const commands: string[] = []
    await Expect(StudioBrowser.open(url, {
      platform: 'linux',
      spawn: command => {
        commands.push(command)
        return {
          once(event: string, listener: (error: Error) => void) {
            if (event === 'error') {
              queueMicrotask(() => listener(new Errors.HostEnvironmentError('Chrome executable not found')))
            }
            return this
          },
        } as ReturnType<typeof Platform.spawn>
      },
    })).rejects.toThrow('Could not open Google Chrome.')
    Expect(commands).toEqual(['google-chrome'])
  })
})
