import { Errors, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  enclosingWatchRoot,
  readWatchmanServer,
  watchmanChecks,
  type WatchmanFacts,
} from '../verification-src/WatchmanHealth'

function facts(overrides: Partial<WatchmanFacts> = {}): WatchmanFacts {
  return {
    clientVersion: '2026.01.19.00',
    repositoryRoot: '/clone/worktrees/task',
    server: { roots: ['/clone/worktrees/task'], state: 'answering' },
    socket: '/home/.local/state/watchman/someone-state/sock',
    stableClient: '/clone/.devenv/profile/bin/watchman',
    ...overrides,
  }
}

function check(overrides: Partial<WatchmanFacts>, name: string) {
  return watchmanChecks(facts(overrides)).find(candidate => candidate.name === name)
}

Describe('Watchman health', () => {
  Test('passes a server that watches this checkout as its own root', () => {
    const checks = watchmanChecks(facts())

    Expect(checks.map(candidate => candidate.status)).toEqual(['pass', 'pass'])
  })

  Test('fails a denied socket and names the sandbox rule rather than a restart', () => {
    const watchman = check({ server: { state: 'denied' } }, 'watchman')

    Expect(watchman?.status).toBe('fail')
    Expect(watchman?.detail).toContain('sandbox denies')
    Expect(watchman?.remediation).toContain('.rulesync/permissions.jsonc')
    Expect(watchman?.remediation).not.toContain('shutdown-server')
  })

  Test('fails a stopped server with a start command that survives worktree cleanup', () => {
    const watchman = check({ server: { state: 'not-running' } }, 'watchman')

    Expect(watchman?.status).toBe('fail')
    Expect(watchman?.detail).toContain('EMFILE')
    Expect(watchman?.remediation).toContain('/clone/.devenv/profile/bin/watchman version')
  })

  Test('fails a watch root that encloses the checkout and names the one to remove', () => {
    const root = check({ server: { roots: ['/clone'], state: 'answering' } }, 'watchman root')

    Expect(root?.status).toBe('fail')
    Expect(root?.remediation).toContain('watchman watch-del /clone')
  })

  Test('treats only a strict ancestor as enclosing', () => {
    Expect(enclosingWatchRoot(['/clone/worktrees/task'], '/clone/worktrees/task')).toBeUndefined()
    Expect(enclosingWatchRoot(['/clone/worktrees/other', '/clone-b'], '/clone/worktrees/task'))
      .toBeUndefined()
    Expect(enclosingWatchRoot(['/clone-b', '/clone'], '/clone/worktrees/task')).toBe('/clone')
  })

  Test('warns when launchd would restart Watchman from a worktree that can disappear', () => {
    const inWorktree = check({
      launchAgent: {
        linkedWorktree: '/clone/worktrees/gone-soon',
        program: '/clone/worktrees/gone-soon/.devenv/profile/bin/watchman',
        programPresent: true,
      },
    }, 'watchman launch agent')
    const missing = check({
      launchAgent: { program: '/old/.devenv/profile/bin/watchman', programPresent: false },
    }, 'watchman launch agent')

    Expect(inWorktree?.status).toBe('warn')
    Expect(missing?.status).toBe('warn')
    Expect(missing?.remediation).toContain('/clone/.devenv/profile/bin/watchman version')
  })

  Test('tells a denied socket from a missing or abandoned one by whether the socket file exists', async () => {
    // A sandbox denial and a missing socket fail with the same code, so a real denial cannot be
    // staged here; the classification is what is under test, and the connection is injected.
    const directory = await FS.mkTmpDir('tao-watchman-')
    const present = FS.resolvePath('present.sock', directory)
    await FS.writeText(present, '')
    const failing = (code: string) => () =>
      Promise.reject(Object.assign(new Errors.HostEnvironmentError(code), { code }))
    try {
      Expect(
        await readWatchmanServer(
          present,
          (_, command) => Promise.resolve(command[0] === 'watch-list' ? { roots: ['/clone'] } : {}),
        ),
      )
        .toEqual({ roots: ['/clone'], state: 'answering' })
      Expect(await readWatchmanServer(present, failing('ENOENT'))).toEqual({ state: 'denied' })
      Expect(await readWatchmanServer(present, failing('ECONNREFUSED'))).toEqual({ state: 'not-running' })
      Expect(await readWatchmanServer(FS.resolvePath('absent.sock', directory), failing('ENOENT')))
        .toEqual({ state: 'not-running' })
      Expect(await readWatchmanServer(FS.resolvePath('absent.sock', directory))).toEqual({ state: 'not-running' })
    } finally {
      await FS.remove(directory)
    }
  })
})
