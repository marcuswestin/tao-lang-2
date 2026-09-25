import { Describe, Expect, Test } from '@shared/test'
import {
  provisionWorktrees,
  removeWorktrees,
  type WorktreeDependencies,
} from '../dev-cli-src/performance/admission-worktrees'

function fakeDependencies(options: { failSetupAt?: number; failAddAt?: number; failRemove?: readonly string[] } = {}) {
  const calls: Array<{ args: readonly string[]; command: string }> = []
  let adds = 0
  let setups = 0
  const removedDirectories: string[] = []
  const dependencies: WorktreeDependencies = {
    now: () => new Date('2026-09-21T12:00:00.000Z'),
    removeDirectory: async path => {
      removedDirectories.push(path)
    },
    run: async (command, spec) => {
      const args = [...(spec.args ?? [])]
      calls.push({ args, command })
      let exitCode = 0
      if (args[0] === 'worktree' && args[1] === 'add') {
        adds += 1
        exitCode = adds === options.failAddAt ? 1 : 0
      }
      if (args[0] === 'setup') {
        setups += 1
        exitCode = setups === options.failSetupAt ? 1 : 0
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        exitCode = (options.failRemove ?? []).includes(args[3] ?? '') ? 1 : 0
      }
      return { args, command, cwd: spec.cwd, error: undefined, exitCode, signal: null, stderr: 'boom', stdout: '' }
    },
    sourceRoot: () => '/repo',
    writeLine: () => {},
  }
  return { calls, dependencies, removedDirectories }
}

Describe('admission worktrees', () => {
  Test('creates one detached checkout per lane and sets each up', async () => {
    const fake = fakeDependencies()

    const provisioned = await provisionWorktrees(3, fake.dependencies)

    Expect(provisioned.repositoryRoots.length).toBe(3)
    Expect(provisioned.repositoryRoots.every(root => root.startsWith(provisioned.runRoot))).toBe(true)
    Expect(fake.calls.filter(call => call.args[0] === 'setup').length).toBe(3)
  })

  // A half-provisioned run leaves checkouts nothing remembers, and once the process is gone no later
  // run can tell them from a worktree somebody is working in.
  Test('removes what it made when setup fails partway', async () => {
    const fake = fakeDependencies({ failSetupAt: 2 })

    await Expect(provisionWorktrees(3, fake.dependencies)).rejects.toThrow('Setup failed')

    const removals = fake.calls.filter(call => call.args[1] === 'remove')
    Expect(removals.length).toBe(2)
  })

  Test('names a worktree left after partial provisioning and failed cleanup', async () => {
    const fake = fakeDependencies({
      failSetupAt: 2,
      failRemove: ['/private/tmp/tao-admission/2026-09-21T12-00-00-000Z/lane-1'],
    })

    await Expect(provisionWorktrees(3, fake.dependencies)).rejects.toThrow(
      'Cleanup could not remove /private/tmp/tao-admission/2026-09-21T12-00-00-000Z/lane-1',
    )
    Expect(fake.removedDirectories).toEqual([])
  })

  Test('removes what it made when the checkout itself cannot be created', async () => {
    const fake = fakeDependencies({ failAddAt: 3 })

    await Expect(provisionWorktrees(4, fake.dependencies)).rejects.toThrow('Could not create')

    Expect(fake.calls.filter(call => call.args[1] === 'remove').length).toBe(2)
  })

  // The boundary that matters: this machine carries thirty-odd worktrees belonging to other agents,
  // so a path outside the run's own root is refused rather than skipped quietly.
  Test('refuses to remove a path outside the run root', async () => {
    const fake = fakeDependencies()

    await Expect(
      removeWorktrees(
        { repositoryRoots: ['/Users/someone/code/tao-lang-2/worktrees/busy'], runRoot: '/private/tmp/x' },
        fake.dependencies,
      ),
    ).rejects.toThrow('not under this run')
    Expect(fake.calls.length).toBe(0)
  })

  Test('reports the checkouts it could not remove instead of swallowing them', async () => {
    const provisioned = {
      repositoryRoots: ['/private/tmp/x/lane-1', '/private/tmp/x/lane-2'],
      runRoot: '/private/tmp/x',
    }
    const fake = fakeDependencies({ failRemove: ['/private/tmp/x/lane-2'] })

    const left = await removeWorktrees(provisioned, fake.dependencies)

    Expect(left).toEqual(['/private/tmp/x/lane-2'])
    // The run root stays while anything is still inside it, so a leaked checkout keeps its parent.
    Expect(fake.removedDirectories).toEqual([])
  })

  // `git worktree remove` takes the checkout and leaves the directory that held it, so a clean run
  // would otherwise leave one empty stamped directory behind every time.
  Test('removes its own run root once every checkout is gone', async () => {
    const fake = fakeDependencies()

    await removeWorktrees(
      { repositoryRoots: ['/private/tmp/x/lane-1'], runRoot: '/private/tmp/x' },
      fake.dependencies,
    )

    Expect(fake.removedDirectories).toEqual(['/private/tmp/x'])
  })
})
