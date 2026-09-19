import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  DeveloperBranchCommand,
  type DeveloperWorkflowDependencies,
  parseDetachedWorktrees,
  SyncMainCommand,
} from '../dev-src/repository-tests/DeveloperWorkflow'

type FakeState = {
  branch: string
  conflicts: string[]
  existingBranches: string[]
  identity: string
  mainHead: string
  mergeExitCode: number
  mirrorHead?: string
  mirrorRoot?: string
  mirrorStatus?: string
  remoteMainHead: string
  /** Ancestry the fake honours: `${ancestor}..${descendant}` pairs that answer "is ancestor" yes. */
  ancestry: string[]
  status: string
  worktreeBranches: Array<{ branch: string; path: string }>
}

const ROOT = '/repo'

function fake(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    ancestry: [],
    branch: 'dev/ro',
    conflicts: [],
    existingBranches: ['main', 'dev/ro'],
    identity: 'Ro Example',
    mainHead: 'main00000000000000000000000000000000000000',
    mergeExitCode: 0,
    remoteMainHead: 'main00000000000000000000000000000000000000',
    status: '',
    worktreeBranches: [{ branch: 'dev/ro', path: ROOT }],
    ...overrides,
  }
  // A detached mirror keeps its own HEAD: main moving does not move it, which is the point of the
  // refresh this command performs.
  state.mirrorHead ??= state.mainHead
  const calls: Array<{ args: string[]; cwd?: string }> = []
  const lines: string[] = []
  const result = (args: readonly string[], cwd: string | undefined, stdout = '', exitCode = 0) => ({
    args: [...args],
    command: 'git',
    cwd,
    error: undefined,
    exitCode,
    signal: null,
    stderr: '',
    stdout,
  })
  const dependencies: DeveloperWorkflowDependencies = {
    repositoryRoot: ROOT,
    run: async (_command, spec) => {
      const args = [...(spec.args ?? [])]
      calls.push({ args, cwd: spec.cwd })
      const joined = args.join(' ')
      if (joined === 'symbolic-ref --quiet --short HEAD') {
        return result(args, spec.cwd, `${state.branch}\n`, state.branch === '' ? 1 : 0)
      }
      if (joined === 'status --porcelain=v1 --untracked-files=all') {
        return result(args, spec.cwd, spec.cwd === state.mirrorRoot ? state.mirrorStatus ?? '' : state.status)
      }
      if (joined === 'worktree list --porcelain') {
        return result(
          args,
          spec.cwd,
          [
            ...state.worktreeBranches.flatMap(entry => [
              `worktree ${entry.path}`,
              'HEAD 1111111111111111111111111111111111111111',
              `branch refs/heads/${entry.branch}`,
              '',
            ]),
            ...(state.mirrorRoot === undefined ? [] : [
              `worktree ${state.mirrorRoot}`,
              `HEAD ${state.mirrorHead}`,
              'detached',
              '',
            ]),
          ].join('\n'),
        )
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        const ref = args[3]!
        if (ref === 'refs/heads/main') {
          return result(args, spec.cwd, `${state.mainHead}\n`)
        }
        if (ref === 'refs/remotes/origin/main') {
          return result(args, spec.cwd, `${state.remoteMainHead}\n`)
        }
        const branch = ref.replace('refs/heads/', '')
        return state.existingBranches.includes(branch)
          ? result(args, spec.cwd, `${branch}-head\n`)
          : result(args, spec.cwd, '', 1)
      }
      if (args[0] === 'merge-base') {
        return result(args, spec.cwd, '', state.ancestry.includes(`${args[2]}..${args[3]}`) ? 0 : 1)
      }
      if (joined === 'config user.name') {
        return result(args, spec.cwd, `${state.identity}\n`)
      }
      if (args[0] === 'switch') {
        state.branch = args.at(-1) === 'main' ? args[args.length - 2]! : args.at(-1)!
        return result(args, spec.cwd)
      }
      if (args[0] === 'update-ref') {
        state.mainHead = args[4]!
        return result(args, spec.cwd)
      }
      if (args[0] === 'checkout' && args[1] === '--detach') {
        state.mirrorHead = args[2]!
        return result(args, spec.cwd)
      }
      if (args[0] === 'merge') {
        return result(args, spec.cwd, '', state.mergeExitCode)
      }
      if (joined === 'diff --name-only --diff-filter=U') {
        return result(args, spec.cwd, state.conflicts.join('\n'))
      }
      if (args[0] === 'fetch') {
        return result(args, spec.cwd)
      }
      return result(args, spec.cwd, '', 1)
    },
    writeLine: line => lines.push(line),
  }
  return { calls, dependencies, lines, state }
}

Describe('developer workflow', () => {
  Test('parses only the detached, non-prunable worktrees', () => {
    Expect(parseDetachedWorktrees(
      [
        'worktree /feature\nHEAD aaa\nbranch refs/heads/feat/example\n',
        'worktree /mirror\nHEAD bbb\ndetached\n',
        'worktree /gone\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location\n',
      ].join('\n'),
    )).toEqual([{ head: 'bbb', path: '/mirror' }])
  })

  Test('creates the dev branch from main the first time and switches to it afterwards', async () => {
    const first = fake({ branch: 'local/primary', existingBranches: ['main'], worktreeBranches: [] })
    await DeveloperBranchCommand.run('', first.dependencies)
    Expect(first.calls.map(call => call.args.join(' '))).toContain('switch --create dev/ro main')
    Expect(first.lines).toContain("PASS  Created 'dev/ro' from main and switched to it.")

    const again = fake({ branch: 'local/primary' })
    await DeveloperBranchCommand.run('', again.dependencies)
    Expect(again.calls.map(call => call.args.join(' '))).toContain('switch dev/ro')
  })

  Test('names the branch from the argument, the environment, then the Git identity', async () => {
    const named = fake({ branch: 'local/primary', existingBranches: ['main'], worktreeBranches: [] })
    await DeveloperBranchCommand.run('Spike Two', named.dependencies)
    Expect(named.calls.map(call => call.args.join(' '))).toContain('switch --create dev/spike-two main')

    const prefixed = fake({ branch: 'local/primary', existingBranches: ['main'], worktreeBranches: [] })
    await DeveloperBranchCommand.run('dev/keep-as-is', prefixed.dependencies)
    Expect(prefixed.calls.map(call => call.args.join(' '))).toContain('switch --create dev/keep-as-is main')
  })

  Test('says so rather than switching when the branch lives in another worktree', async () => {
    const taken = fake({
      branch: 'local/primary',
      worktreeBranches: [{ branch: 'dev/ro', path: '/elsewhere' }],
    })
    await Expect(DeveloperBranchCommand.run('', taken.dependencies)).rejects.toThrow('checked out in /elsewhere')
    Expect(taken.calls.some(call => call.args[0] === 'switch')).toBe(false)
  })

  Test('reports the uncommitted work it carried onto the branch', async () => {
    const dirty = fake({ branch: 'local/primary', status: ' M notes.md\n' })
    await DeveloperBranchCommand.run('', dirty.dependencies)
    Expect(dirty.lines).toContain("NOTE  Uncommitted changes came with you onto 'dev/ro'.")
  })

  Test('fast-forwards main, moves a clean mirror behind it, and merges into the branch', async () => {
    const moved = fake({
      ancestry: ['main00000000000000000000000000000000000000..new-main', 'new-main..HEAD-not-really'],
      mirrorRoot: '/mirror',
      remoteMainHead: 'new-main',
    })
    const outcome = await SyncMainCommand.run(moved.dependencies)

    Expect(outcome.conflicted).toBe(false)
    Expect(moved.calls.map(call => call.args.join(' '))).toContain(
      'update-ref -m sync-main: fast-forward to origin refs/heads/main new-main main00000000000000000000000000000000000000',
    )
    Expect(moved.state.mirrorHead).toBe('new-main')
    Expect(moved.lines).toContain('PASS  Moved the main mirror at /mirror to new-main.')
    Expect(moved.lines).toContain("PASS  Merged main into 'dev/ro'.")
  })

  Test('leaves a mirror someone is working in alone', async () => {
    const busy = fake({
      ancestry: ['main00000000000000000000000000000000000000..new-main'],
      mirrorRoot: '/mirror',
      mirrorStatus: ' M scratch.md\n',
      remoteMainHead: 'new-main',
    })
    await SyncMainCommand.run(busy.dependencies)
    Expect(busy.calls.some(call => call.args[0] === 'checkout')).toBe(false)
  })

  Test('refuses to fast-forward a local main that holds commits origin lacks', async () => {
    const diverged = fake({ remoteMainHead: 'other-main' })
    await Expect(SyncMainCommand.run(diverged.dependencies)).rejects.toThrow('Reconcile them deliberately')
    Expect(diverged.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
  })

  Test('names the conflicted files and the command that finishes the merge', async () => {
    const conflicted = fake({ conflicts: ['AGENTS.md', 'packages/dev/README.md'], mergeExitCode: 1 })
    const outcome = await SyncMainCommand.run(conflicted.dependencies)

    Expect(outcome.conflicted).toBe(true)
    Expect(conflicted.lines).toContain("FAIL  main conflicts with 'dev/ro' in 2 file(s):")
    Expect(conflicted.lines).toContain('      packages/dev/README.md')
    Expect(conflicted.lines.at(-1)).toContain('just my-resolve')
  })

  Test('refuses to sync a checkout that is on main or detached', async () => {
    await Expect(SyncMainCommand.run(fake({ branch: 'main' }).dependencies)).rejects.toThrow('which nothing may hold')
    await Expect(SyncMainCommand.run(fake({ branch: '' }).dependencies)).rejects.toThrow('detached HEAD')
  })

  Test('syncs and branches in a disposable real repository', async () => {
    const root = await FS.realPath(await mkTestDir('tao-developer-workflow-'))
    const remoteRoot = FS.resolvePath('remote.git', root)
    const checkout = FS.resolvePath('checkout', root)
    const mirror = FS.resolvePath('mirror', root)
    try {
      await git(root, ['init', '--bare', remoteRoot])
      await git(root, ['clone', remoteRoot, checkout])
      await git(checkout, ['config', 'user.name', 'Ro Example'])
      await git(checkout, ['config', 'user.email', 'ro@example.test'])
      await FS.writeText(FS.resolvePath('base.txt', checkout), 'base\n')
      await git(checkout, ['add', 'base.txt'])
      await git(checkout, ['commit', '-m', 'Base'])
      await git(checkout, ['branch', '-M', 'main'])
      await git(checkout, ['push', '-u', 'origin', 'main'])
      await git(checkout, ['worktree', 'add', '--detach', mirror, 'main'])
      // Another landing moved main on the remote while this checkout was on its own branch.
      const clone = FS.resolvePath('lander', root)
      await git(root, ['clone', remoteRoot, clone])
      await git(clone, ['config', 'user.name', 'Other Agent'])
      await git(clone, ['config', 'user.email', 'other@example.test'])
      await FS.writeText(FS.resolvePath('landed.txt', clone), 'landed\n')
      await git(clone, ['add', 'landed.txt'])
      await git(clone, ['commit', '-m', 'Landed elsewhere'])
      await git(clone, ['push', 'origin', 'HEAD:main'])

      const lines: string[] = []
      const dependencies: DeveloperWorkflowDependencies = {
        repositoryRoot: checkout,
        run: async (command, spec) => await CLI.run(command, { ...spec, stdio: 'pipe' }),
        writeLine: line => lines.push(line),
      }
      await DeveloperBranchCommand.run('', dependencies)
      Expect((await gitResult(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()).toBe('dev/ro')

      await FS.writeText(FS.resolvePath('mine.txt', checkout), 'mine\n')
      await git(checkout, ['add', 'mine.txt'])
      await git(checkout, ['commit', '-m', 'My work'])

      const outcome = await SyncMainCommand.run(dependencies)
      Expect(outcome.conflicted).toBe(false)
      const mainHead = (await gitResult(checkout, ['rev-parse', 'refs/heads/main'])).stdout.trim()
      Expect((await gitResult(checkout, ['rev-parse', 'refs/remotes/origin/main'])).stdout.trim()).toBe(mainHead)
      // The mirror followed main, and the branch now contains both sides.
      Expect((await gitResult(mirror, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(mainHead)
      Expect(await FS.exists(FS.resolvePath('landed.txt', checkout))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('mine.txt', checkout))).toBe(true)
      Expect((await gitResult(checkout, ['status', '--porcelain'])).stdout).toBe('')
    } finally {
      await FS.remove(root)
    }
  })
})

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const outcome = await gitResult(cwd, args)
  if (outcome.exitCode !== 0) {
    throw new Errors.CommandExecutionError(outcome)
  }
}

async function gitResult(cwd: string, args: readonly string[]) {
  return await CLI.run('git', { args, cwd, stdio: 'pipe' })
}
