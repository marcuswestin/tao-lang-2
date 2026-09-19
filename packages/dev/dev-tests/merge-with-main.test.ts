import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { MachineResourceBusyError, type MachineResourceLease } from '../dev-src/repository-tests/MachineLanes'
import {
  type MergeCommandRunner,
  type MergeSnapshot,
  MergeWithMainCommand,
  type MergeWithMainDependencies,
  parseWorktrees,
  validateMergeMessage,
} from '../dev-src/repository-tests/MergeWithMain'

type FakeRepository = {
  ancestorExitCodes?: number[]
  branch: string
  committedTree?: string
  failDetach?: boolean
  failFeatureMerge?: boolean
  failFetch?: boolean
  /** Whether the post-push fast-forward of a checked-out local main is refused. */
  failLocalMainRefresh?: boolean
  failMainPush?: boolean
  failSquash?: boolean
  failVerify?: boolean
  featureHead: string
  featureRoot: string
  featureStatus: string
  /** Set by the fake when the command creates its disposable integration worktree. */
  integrationHead?: string
  integrationRoot?: string
  /** Whether a worktree has main checked out; false models a machine with no checkout on main. */
  hasMainWorktree?: boolean
  /** Whether a local `main` ref exists at all. */
  hasLocalMain?: boolean
  mainHead: string
  mainRoot: string
  mainStatus: string
  remoteFeatureHead?: string
  remoteMainHead: string
  remoteMainSequence?: string[]
  squashMessagePath: string
  stagedTree: string
  tree: string
}

function result(command: string, args: readonly string[], cwd: string | undefined, stdout = '', exitCode = 0) {
  return { args: [...args], command, cwd, error: undefined, exitCode, signal: null, stderr: '', stdout }
}

/** A lease the tests can watch without touching the machine-wide registry. */
type FakeLease = {
  acquisitions: Array<{ command: string; repositoryRoot: string; waitTimeoutMs?: number }>
  releases: number
}

function fakeDependencies(overrides: Partial<FakeRepository> = {}) {
  const repository: FakeRepository = {
    branch: 'feat/example',
    featureHead: 'feature00000000000000000000000000000000000',
    featureRoot: '/repo-feature',
    featureStatus: '',
    mainHead: 'main000000000000000000000000000000000000',
    mainRoot: '/repo-main',
    mainStatus: '',
    remoteFeatureHead: 'feature00000000000000000000000000000000000',
    remoteMainHead: 'main000000000000000000000000000000000000',
    squashMessagePath: '/git/SQUASH_MSG',
    stagedTree: 'tree000000000000000000000000000000000000',
    tree: 'tree000000000000000000000000000000000000',
    ...overrides,
  }
  const calls: Array<{ args: string[]; command: string; cwd?: string; stdio?: CLI.CommandStdio }> = []
  const files = new Map<string, string>([
    [
      '/repo-feature/.artifacts/merge/feat/example.msg',
      'Land example\n\n- Add the example workflow.\n- Prove its safety.\n',
    ],
    [repository.squashMessagePath, 'Squashed commit of the following:\n\ncommit abc\n\n    Add example\n'],
    [
      '/repo-feature/.artifacts/testing/ledger.json',
      JSON.stringify({ lastFullRunStartedAt: '2026-09-03T13:00:00.000Z' }),
    ],
  ])
  const snapshots = new Map<string, unknown>()
  const directories = new Set<string>()
  const moves: Array<{ fromPath: string; toPath: string }> = []
  const lines: string[] = []
  const lease: FakeLease = { acquisitions: [], releases: 0 }
  const ancestorExitCodes = [...(repository.ancestorExitCodes ?? [])]
  const remoteMainSequence = [...(repository.remoteMainSequence ?? [])]
  let advertisedRemoteMain = repository.remoteMainHead

  const runner: MergeCommandRunner = async (command, spec) => {
    const args = [...(spec.args ?? [])]
    calls.push({ args, command, cwd: spec.cwd, stdio: spec.stdio })
    const inIntegration = spec.cwd !== undefined && spec.cwd === repository.integrationRoot
    if (command === 'just') {
      return result(command, args, spec.cwd, '', repository.failVerify === true ? 1 : 0)
    }
    const joined = args.join(' ')
    if (joined === 'symbolic-ref --quiet --short HEAD') {
      return result(command, args, spec.cwd, `${repository.branch}\n`)
    }
    if (joined === 'status --porcelain=v1 --untracked-files=all') {
      return result(
        command,
        args,
        spec.cwd,
        spec.cwd === repository.mainRoot ? repository.mainStatus : repository.featureStatus,
      )
    }
    if (joined === 'diff --no-ext-diff --binary HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        spec.cwd === repository.mainRoot ? repository.mainStatus : repository.featureStatus,
      )
    }
    if (joined === 'rev-parse HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        `${inIntegration ? repository.integrationHead ?? repository.mainHead : repository.featureHead}\n`,
      )
    }
    if (joined === 'worktree list --porcelain') {
      return result(
        command,
        args,
        spec.cwd,
        [
          `worktree ${repository.featureRoot}`,
          `HEAD ${repository.featureHead}`,
          `branch refs/heads/${repository.branch}`,
          '',
          ...(repository.hasMainWorktree === false ? [] : [
            `worktree ${repository.mainRoot}`,
            `HEAD ${repository.mainHead}`,
            'branch refs/heads/main',
            '',
          ]),
          ...(repository.integrationRoot === undefined ? [] : [
            `worktree ${repository.integrationRoot}`,
            `HEAD ${repository.integrationHead ?? repository.mainHead}`,
            'detached',
            '',
          ]),
        ].join('\n'),
      )
    }
    if (args[0] === 'ls-remote') {
      advertisedRemoteMain = remoteMainSequence.shift() ?? advertisedRemoteMain
      return result(
        command,
        args,
        spec.cwd,
        [
          `${advertisedRemoteMain}\trefs/heads/main`,
          repository.remoteFeatureHead === undefined
            ? ''
            : `${repository.remoteFeatureHead}\trefs/heads/${repository.branch}`,
        ].filter(Boolean).join('\n'),
      )
    }
    if (args[0] === 'merge-base') {
      return result(command, args, spec.cwd, '', ancestorExitCodes.shift() ?? 0)
    }
    if (joined === 'log -1 --format=%cI HEAD') {
      return result(command, args, spec.cwd, '2026-09-03T12:00:00.000Z\n')
    }
    if (joined === 'fetch --prune origin') {
      if (repository.failFetch === true) {
        return { ...result(command, args, spec.cwd, '', 128), stderr: 'could not resolve host: github.com' }
      }
      repository.remoteMainHead = advertisedRemoteMain
      return result(command, args, spec.cwd)
    }
    if (joined === 'rev-parse --verify --quiet refs/heads/main') {
      // The ref, not a checkout's HEAD: landing needs no worktree on main, only a ref that agrees
      // with origin/main, so a repository with no checkout on main answers the same as one that has.
      return repository.hasLocalMain === false
        ? result(command, args, spec.cwd, '', 1)
        : result(command, args, spec.cwd, `${repository.mainHead}\n`)
    }
    if (joined === 'rev-parse origin/main') {
      return result(command, args, spec.cwd, `${repository.remoteMainHead}\n`)
    }
    if (args[0] === 'rev-parse' && args[1]?.endsWith('^{tree}')) {
      const tree = inIntegration && (repository.integrationHead ?? '').startsWith('commit')
        ? repository.committedTree ?? repository.tree
        : repository.tree
      return result(command, args, spec.cwd, `${tree}\n`)
    }
    if (joined === 'write-tree') {
      return result(command, args, spec.cwd, `${inIntegration ? repository.stagedTree : repository.tree}\n`)
    }
    if (joined === 'rev-parse --git-path SQUASH_MSG') {
      return result(command, args, spec.cwd, `${repository.squashMessagePath}\n`)
    }
    if (joined.startsWith('merge --squash ')) {
      return result(command, args, spec.cwd, '', repository.failSquash === true ? 1 : 0)
    }
    if (joined === 'merge --no-edit origin/main') {
      if (repository.failFeatureMerge === true) {
        repository.featureStatus = 'UU example.ts\n'
        return result(command, args, spec.cwd, '', 1)
      }
      repository.featureHead = 'integrated-feature0000000000000000000000000'
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('merge --ff-only ')) {
      if (repository.failLocalMainRefresh === true) {
        return result(command, args, spec.cwd, '', 1)
      }
      repository.mainHead = args[2]!
      return result(command, args, spec.cwd)
    }
    if (args[0] === 'update-ref') {
      repository.mainHead = args[2]!
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('commit -F ')) {
      repository.integrationHead = 'commit00000000000000000000000000000000000'
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('reset --hard ')) {
      repository.featureHead = args[2]!
      repository.featureStatus = ''
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('switch --detach ')) {
      if (repository.failDetach === true) {
        return result(command, args, spec.cwd, '', 1)
      }
      repository.featureHead = args[2]!
      repository.featureStatus = ''
      repository.branch = ''
      return result(command, args, spec.cwd)
    }
    if (joined === 'symbolic-ref --quiet HEAD') {
      return result(command, args, spec.cwd, '', repository.branch === '' ? 1 : 0)
    }
    if (args[0] === 'push' && args.at(-1) === 'HEAD:refs/heads/main' && repository.failMainPush === true) {
      return result(command, args, spec.cwd, '', 1)
    }
    if (joined.startsWith('worktree add ')) {
      // `worktree add --detach <path> <sha>`: the disposable integration checkout from here on.
      repository.integrationRoot = args[3]!
      repository.integrationHead = args[4]!
      directories.add(args[3]!)
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('worktree remove ')) {
      directories.delete(args.at(-1)!)
      repository.integrationRoot = undefined
      repository.integrationHead = undefined
      return result(command, args, spec.cwd)
    }
    if (
      args[0] === 'push'
      || joined === 'worktree prune'
      || joined.startsWith('branch -D ')
    ) {
      return result(command, args, spec.cwd)
    }
    return result(command, args, spec.cwd, '', 1)
  }

  const dependencies: MergeWithMainDependencies = {
    acquireLease: async options => {
      lease.acquisitions.push({
        command: options.command,
        repositoryRoot: options.repositoryRoot,
        waitTimeoutMs: options.waitTimeoutMs,
      })
      return {
        owner: {
          command: options.command,
          id: 'lease-id',
          name: options.name,
          pid: 4242,
          repositoryRoot: options.repositoryRoot,
          startedAt: '2026-09-03T14:15:16.789Z',
        },
        release: async () => {
          lease.releases += 1
        },
      } satisfies MachineResourceLease
    },
    askConfirm: async () => true,
    exists: async path => files.has(path) || snapshots.has(path) || directories.has(path),
    isInteractive: () => true,
    move: async (fromPath, toPath) => {
      moves.push({ fromPath, toPath })
      if (snapshots.has(fromPath)) {
        snapshots.set(toPath, snapshots.get(fromPath))
        snapshots.delete(fromPath)
        return
      }
      if (files.has(fromPath)) {
        files.set(toPath, files.get(fromPath)!)
        files.delete(fromPath)
        return
      }
      Errors.throwUnexpected(`Missing fake move source: ${fromPath}`)
    },
    now: () => new Date('2026-09-03T14:15:16.789Z'),
    readJson: async <ValueT>(path: string) => {
      if (snapshots.has(path)) {
        return snapshots.get(path) as ValueT
      }
      return JSON.parse(files.get(path)!) as ValueT
    },
    readText: async path => files.get(path)!,
    remove: async path => {
      files.delete(path)
      snapshots.delete(path)
      directories.delete(path)
    },
    run: runner,
    writeJson: async (path, value) => {
      snapshots.set(path, structuredClone(value))
    },
    writeLine: line => lines.push(line),
    writeText: async (path, value) => {
      files.set(path, value)
    },
  }
  return { calls, dependencies, directories, files, lease, lines, moves, repository, snapshots }
}

/** The one snapshot this command keeps, read back the way a person or `--abort` would. */
function onlySnapshot(fake: ReturnType<typeof fakeDependencies>): MergeSnapshot {
  return [...fake.snapshots.values()][0] as MergeSnapshot
}

Describe('merge-with-main', () => {
  Test('validates the exact human squash-message shape', () => {
    Expect(
      validateMergeMessage(
        'Land verification lanes\r\n\r\n- Add safe dry runs.\r\n- Preserve the squash appendix.\r\n',
      ),
    )
      .toBe('Land verification lanes\n\n- Add safe dry runs.\n- Preserve the squash appendix.')

    Expect(() => validateMergeMessage('No bullets')).toThrow(Errors.UserInputError)
    Expect(() => validateMergeMessage('Summary\n\n- Good\n\n- Split')).toThrow(Errors.UserInputError)
    // A bullet may wrap. Demanding one physical line per bullet only produced lines too long to
    // read in a diff, and the message is prose for a human, not a record anything parses.
    Expect(validateMergeMessage('Summary\n\n- A bullet that runs on\n  and wraps once\n- A second one'))
      .toBe('Summary\n\n- A bullet that runs on\n  and wraps once\n- A second one')
    // The block still has to start with a bullet, and a continuation still has to be indented.
    Expect(() => validateMergeMessage('Summary\n\n  leading continuation\n- Late bullet'))
      .toThrow(Errors.UserInputError)
    Expect(() => validateMergeMessage('Summary\n\n- Good\nunindented prose')).toThrow(Errors.UserInputError)
    Expect(() => validateMergeMessage('Summary\n\n- Good\n\nCo-Authored-By: Bot <bot@example.test>'))
      .toThrow(Errors.UserInputError)
    Expect(() => validateMergeMessage('Summary\n\n- Good\nGenerated-By: Example automation'))
      .toThrow(Errors.UserInputError)
    Expect(validateMergeMessage('Summary\n\n- Refresh machine-generated parser sources'))
      .toContain('machine-generated parser sources')
    Expect(() => validateMergeMessage('Summary\n\n- Good\nSquashed commit of the following:'))
      .toThrow(Errors.UserInputError)
  })

  Test('parses branch names and detached worktrees from porcelain output', () => {
    Expect(parseWorktrees([
      'worktree /one',
      'HEAD abc',
      'branch refs/heads/feat/one',
      '',
      'worktree /two',
      'HEAD def',
      'detached',
      '',
    ].join('\n'))).toEqual([
      { branch: 'feat/one', head: 'abc', path: '/one' },
      { branch: undefined, head: 'def', path: '/two' },
    ])
  })

  Test('ignores prunable worktree records without mutating them during preflight', () => {
    Expect(parseWorktrees([
      'worktree /gone',
      'HEAD old',
      'branch refs/heads/main',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /live',
      'HEAD current',
      'branch refs/heads/main',
      '',
    ].join('\n'))).toEqual([{ branch: 'main', head: 'current', path: '/live' }])
  })

  Test('lands with no checkout on main at all, because it builds its own', async () => {
    // Landing stages, verifies and commits in a disposable worktree of its own, so how many
    // checkouts happen to have main is not this command's business. It used to be a precondition.
    const fake = fakeDependencies({ hasMainWorktree: false })

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(outcome.mode).toBe('executed')
    Expect(fake.calls.filter(call => call.args[0] === 'worktree' && call.args[1] === 'add')).toHaveLength(1)
    // Nothing has main checked out, so the ref is moved directly rather than fast-forwarded.
    Expect(fake.calls.filter(call => call.args[0] === 'update-ref').map(call => call.args.slice(0, 2)))
      .toEqual([['update-ref', 'refs/heads/main']])
    Expect(fake.repository.mainHead).toBe('commit00000000000000000000000000000000000')
  })

  Test('takes the machine-wide landing lease for the whole run and releases it on success', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(outcome.mode).toBe('executed')
    Expect(fake.lease.acquisitions).toEqual([{
      command: 'merge-with-main feat/example',
      repositoryRoot: '/repo-feature',
      waitTimeoutMs: 0,
    }])
    Expect(fake.lease.releases).toBe(1)
    // The lease is taken before any state is written, so nothing this command owns exists without it.
    Expect(fake.snapshots.size).toBe(1)
  })

  Test('names the worktree holding the landing lease and waits for it rather than racing', async () => {
    const fake = fakeDependencies()
    let attempt = 0
    const acquire = fake.dependencies.acquireLease
    fake.dependencies.acquireLease = async options => {
      attempt += 1
      if (attempt === 1) {
        throw new MachineResourceBusyError({
          command: 'merge-with-main feat/other',
          id: 'peer',
          name: options.name,
          pid: 9001,
          repositoryRoot: '/repo-other',
          startedAt: '2026-09-03T13:45:16.789Z',
        })
      }
      return await acquire(options)
    }

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(outcome.mode).toBe('executed')
    Expect(fake.lines).toContain(
      "WARN  Landing lease held by 'merge-with-main feat/other' in /repo-other (PID 9001), held for 30m.",
    )
    Expect(fake.lines).toContain('WARN  Waiting for it to free; landings run one at a time on this machine.')
    // The second request waits; there is no takeover and no flag that skips the wait.
    Expect(fake.lease.acquisitions.map(acquisition => acquisition.waitTimeoutMs)).toEqual([6 * 60 * 60 * 1_000])
    Expect(fake.lease.releases).toBe(1)
  })

  Test('releases the landing lease when the landing fails', async () => {
    const fake = fakeDependencies({ failSquash: true })

    await Expect(MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )).rejects.toThrow(Errors.CommandExecutionError)

    Expect(fake.lease.releases).toBe(1)
  })

  Test('--dry-run performs only read-only git operations and ends with the exact landing command', async () => {
    const fake = fakeDependencies()
    const result = await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(result.mode).toBe('dry-run')
    Expect(fake.calls.map(call => call.args[0])).toEqual([
      'symbolic-ref',
      'status',
      'rev-parse',
      'worktree',
      'rev-parse',
      'ls-remote',
      'merge-base',
      'log',
    ])
    Expect(fake.calls.some(call => ['fetch', 'merge', 'commit', 'push', 'reset'].includes(call.args[0]!))).toBe(false)
    // A dry run takes no lease either; it is the one way to see the plan without queueing behind one.
    Expect(fake.lease.acquisitions).toEqual([])
    Expect(fake.lines).toContain(
      'PLAN  Wait for the machine-wide landing lease, so this landing does not race another.',
    )
    Expect(fake.lines).toContain(
      'PLAN  Create a disposable integration worktree at origin/main, squash the feature branch onto it, and prove '
        + 'the staged tree equals the feature tree.',
    )
    Expect(fake.lines).toContain('PLAN  Run just verify-full on the feature branch.')
    Expect(fake.lines).toContain(
      "PLAN  Accept that tree equality as the staged squash's evidence; full verification proved the same bytes.",
    )
    Expect(fake.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main',
    )
    Expect(fake.snapshots.size).toBe(0)
  })

  Test('--dry-run names the flag that will skip each verification phase', async () => {
    const skipFull = fakeDependencies()
    await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: skipFull.repository.featureRoot, skipVerifyFull: true },
      skipFull.dependencies,
    )
    Expect(skipFull.lines).toContain(
      'PLAN  Skip just verify-full on the feature branch because --skip-verify-full was passed.',
    )
    Expect(skipFull.lines).toContain(
      'PLAN  Run just verify --complete on the feature branch instead, because nothing else verified this branch.',
    )
    Expect(skipFull.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main --skip-verify-full',
    )

    const skipAll = fakeDependencies()
    await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: skipAll.repository.featureRoot, skipAll: true },
      skipAll.dependencies,
    )
    Expect(skipAll.lines).toContain(
      'PLAN  Skip just verify-full on the feature branch because --skip-all was passed.',
    )
    Expect(skipAll.lines).toContain(
      'PLAN  Skip just verify --complete because --skip-all was passed; no lane will have verified these bytes.',
    )
    Expect(skipAll.lines).toContain('PLAN  Ask once, defaulting to No, whether to merge with nothing verified at all.')
    Expect(skipAll.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main --skip-all',
    )
  })

  Test('fails before mutation for a divergent remote main or a dirty feature worktree', async () => {
    const dirty = fakeDependencies({ featureStatus: 'M  local.ts\n' })
    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: dirty.repository.featureRoot }, dirty.dependencies),
    ).rejects.toThrow('The feature worktree is not clean')
    Expect(dirty.calls.some(call => call.args[0] === 'fetch')).toBe(false)

    const stale = fakeDependencies({ remoteMainHead: 'new-main' })
    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: stale.repository.featureRoot }, stale.dependencies),
    ).rejects.toThrow('Local main is not at origin/main')
    Expect(stale.calls.some(call => call.args[0] === 'fetch')).toBe(false)
    Expect(stale.snapshots.size).toBe(0)
    Expect(stale.lease.acquisitions).toEqual([])
  })

  Test('reports that the remote could not be confirmed when the fetch fails', async () => {
    // `git fetch` has no network inside the agent sandbox. Treating local state as authoritative
    // there would build the squash on whatever tip this checkout last saw.
    const fake = fakeDependencies({ failFetch: true })

    await Expect(MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )).rejects.toThrow('so the remote is unconfirmed')
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'add')).toBe(false)
    Expect(fake.lease.releases).toBe(1)
  })

  Test('a flagless invocation lands and pushes without asking for confirmation', async () => {
    const fake = fakeDependencies()
    fake.dependencies.askConfirm = async message => {
      Errors.throwUnexpected(`A flagless landing must not prompt; it asked: ${message}`)
    }

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(outcome.mode).toBe('executed')
    Expect(operations).toContain('just verify-full')
    Expect(operations.some(operation => operation.startsWith('git merge --squash'))).toBe(true)
    Expect(operations.some(operation => operation.startsWith('git commit -F'))).toBe(true)
    Expect(operations).toContain(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} HEAD:refs/heads/main`,
    )
    Expect(operations).toContain(
      'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
    )
    Expect(operations).toContain('git branch -D feat/example')
    Expect(onlySnapshot(fake).phase).toBe('complete')
    // Exactly one lane, invoked without --no-cache, so it may reuse a green record for this tree.
    Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([['verify-full']])
  })

  Test('verifies the feature branch, then stages, commits and pushes from the integration worktree', async () => {
    const fake = fakeDependencies()
    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    const add = operations.findIndex(operation => operation.startsWith('git worktree add --detach '))
    const squash = operations.findIndex(operation => operation.startsWith('git merge --squash'))
    const treeProof = operations.findIndex((operation, index) => index > squash && operation === 'git write-tree')
    const fullVerify = operations.indexOf('just verify-full')
    const commit = operations.findIndex(operation => operation.startsWith('git commit -F'))
    const push = operations.indexOf(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} HEAD:refs/heads/main`,
    )
    const archive = operations.indexOf(
      'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
    )
    const detach = operations.indexOf(`git switch --detach ${fake.repository.featureHead}`)
    const remove = operations.findIndex(operation => operation.startsWith('git worktree remove --force '))

    // The lane runs in the invoking worktree, where the toolchain and the green records are. Only
    // then is the disposable worktree built, staged, committed and pushed from.
    Expect(fullVerify).toBeGreaterThan(0)
    Expect(add).toBeGreaterThan(fullVerify)
    Expect(squash).toBeGreaterThan(add)
    Expect(treeProof).toBeGreaterThan(squash)
    Expect(commit).toBeGreaterThan(treeProof)
    Expect(push).toBeGreaterThan(commit)
    Expect(archive).toBeGreaterThan(push)
    Expect(detach).toBeGreaterThan(archive)
    Expect(remove).toBeGreaterThan(detach)
    const integrationRoot = fake.calls.find(call => call.args[1] === 'add')?.args[3]
    Expect(integrationRoot).toMatch(
      /^\/repo-feature\/\.artifacts\/merge\/integration-2026-09-03T14-15-16-789Z-[0-9a-f]{8}$/u,
    )
    Expect(fake.calls[fullVerify]?.cwd).toBe(fake.repository.featureRoot)
    for (const operation of ['merge --squash', 'commit -F']) {
      Expect(fake.calls.find(call => call.args.join(' ').startsWith(operation))?.cwd).toBe(integrationRoot)
    }
    Expect(fake.calls[fullVerify]?.stdio).toBe('inherit')
    // The squash is never verified a second time; the tree equality is what carries the evidence.
    Expect(operations).not.toContain('just verify --complete')
    Expect(fake.lines.some(line => line.includes('equals the fully verified feature tree'))).toBe(true)
    Expect(outcome.mode).toBe('executed')
    Expect(outcome.lines).toEqual([
      "PASS  Merged 'feat/example' into main and archived it as merged/example.",
      'PASS  Preserved the clean invoking worktree at /repo-feature on detached HEAD; '
      + 'archive its owning task when you are ready to remove it.',
    ])
    // The snapshot lives in the worktree this command preserves, never in one it disposes of.
    Expect(outcome.snapshotPath).toMatch(
      /^\/repo-feature\/\.artifacts\/merge\/2026-09-03T14-15-16-789Z-[0-9a-f]{8}\.json$/u,
    )
    const completedSnapshot = onlySnapshot(fake)
    Expect(completedSnapshot.phase).toBe('complete')
    Expect(completedSnapshot.integrationRoot).toBeUndefined()
    Expect(completedSnapshot.currentFeatureHead).toBe(fake.repository.featureHead)
    Expect(completedSnapshot.currentFeatureStatus).toBe('')
    Expect(fake.moves.every(move => move.fromPath.endsWith('.tmp'))).toBe(true)
    const commitMessage = [...fake.files.entries()].find(([path]) => path.endsWith('.commit-message'))?.[1]
    Expect(commitMessage).toContain('Land example\n\n- Add the example workflow.')
    Expect(commitMessage).toContain('Squashed commit of the following:')
  })

  Test('does not publish a behind remote feature branch before verification', async () => {
    const fake = fakeDependencies({ remoteFeatureHead: 'stale00000000000000000000000000000000000' })

    const dryRun = await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )
    Expect(dryRun.lines).toContain(
      'PLAN  Keep the behind origin/feat/example unchanged until the verified archive replaces it.',
    )

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    const fullVerify = operations.indexOf('just verify-full')
    const deleteRemote = operations.indexOf(
      'git push origin --force-with-lease=refs/heads/feat/example:stale00000000000000000000000000000000000'
        + ' :refs/heads/feat/example',
    )

    Expect(operations.filter(operation => operation.includes('feat/example:refs/heads/feat/example'))).toEqual([])
    Expect(deleteRemote).toBeGreaterThan(fullVerify)
    Expect(outcome.mode).toBe('executed')
  })

  Test('refuses to land when the remote feature branch holds commits this worktree lacks', async () => {
    const fake = fakeDependencies({
      ancestorExitCodes: [1],
      remoteFeatureHead: 'ahead000000000000000000000000000000000000',
    })

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow('is not contained in this worktree')
    Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
  })

  Test('a flagless invocation lands with no terminal and keeps verification output durable', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const verificationCalls = fake.calls.filter(call =>
      call.command === 'just' && (call.args[0] === 'verify-full' || call.args[0] === 'verify')
    )
    Expect(verificationCalls.map(call => call.stdio)).toEqual(['stream'])
    Expect(outcome.mode).toBe('executed')
    Expect(fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)).toContain(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} HEAD:refs/heads/main`,
    )
  })

  Test('--skip-verify-full runs just verify --complete on the feature branch instead', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
      skipVerifyFull: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    // Nothing else verifies this branch, so that pass is the evidence the squash stands on. It runs
    // before the squash is staged, and the tree equality is what binds the two.
    Expect(operations).not.toContain('just verify-full')
    Expect(operations.indexOf('just verify --complete')).toBeLessThan(
      operations.findIndex(operation => operation.startsWith('git merge --squash')),
    )
    Expect(fake.calls.find(call => call.command === 'just')?.cwd).toBe(fake.repository.featureRoot)
    Expect(
      fake.lines.some(line =>
        line.startsWith('PASS  Staged squash tree ')
        && line.endsWith('equals the feature tree just verify --complete proved.')
      ),
    ).toBe(true)
    Expect(fake.lines).toContain(
      "WARN  Skipped just verify-full on 'feat/example' because --skip-verify-full "
        + 'was passed.',
    )
    Expect(outcome.mode).toBe('executed')
    // Exactly one lane, invoked without --no-cache, so it may reuse a green record for this tree.
    Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([[
      'verify',
      '--complete',
    ]])
  })

  Test('--skip-verify alone still fully verifies the branch and still proves the squash tree', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
      skipVerify: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(operations).toContain('just verify-full')
    Expect(operations).not.toContain('just verify --complete')
    Expect(fake.lines.some(line => line.includes('equals the fully verified feature tree'))).toBe(true)
    Expect(outcome.mode).toBe('executed')

    // The tree-equality assertion is a correctness check, not an optimization, so --skip-verify
    // cannot make a divergent squash land.
    const divergent = fakeDependencies({ stagedTree: 'different-tree' })
    await Expect(MergeWithMainCommand.run({
      repositoryRoot: divergent.repository.featureRoot,
      skipVerify: true,
    }, divergent.dependencies)).rejects.toThrow('staged squash tree does not equal')
    Expect(divergent.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('--skip-all refuses without an interactive terminal and changes nothing', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    fake.dependencies.askConfirm = async () => true

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
      skipAll: true,
    }, fake.dependencies)).rejects.toThrow('--skip-all needs an interactive terminal')

    Expect(fake.snapshots.size).toBe(0)
    Expect(fake.lease.acquisitions).toEqual([])
    Expect(
      fake.calls.filter(call =>
        ['branch', 'commit', 'fetch', 'merge', 'push', 'reset', 'switch'].includes(call.args[0]!)
        || call.args[0] === 'worktree' && call.args[1] !== 'list'
      ),
    ).toEqual([])
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.repository.mainHead).toBe('main000000000000000000000000000000000000')
  })

  Test('--skip-all answered No changes nothing, and answered Yes lands with no lane at all', async () => {
    const refused = fakeDependencies()
    const asked: string[] = []
    refused.dependencies.askConfirm = async message => {
      asked.push(message)
      return false
    }

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: refused.repository.featureRoot,
      skipAll: true,
    }, refused.dependencies)).rejects.toThrow('Merge cancelled before changing repository state')

    Expect(asked).toHaveLength(1)
    Expect(asked[0]).toContain('Really merge with nothing checked at all?')
    Expect(asked[0]).toContain("no just verify-full on 'feat/example'")
    Expect(asked[0]).toContain('whose linear history is the product of squashing')
    Expect(refused.snapshots.size).toBe(0)
    Expect(refused.lease.acquisitions).toEqual([])
    Expect(refused.calls.some(call => ['commit', 'fetch', 'merge', 'push', 'reset'].includes(call.args[0]!)))
      .toBe(false)

    const accepted = fakeDependencies()
    const confirmations: string[] = []
    accepted.dependencies.askConfirm = async message => {
      confirmations.push(message)
      return true
    }

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: accepted.repository.featureRoot,
      skipAll: true,
    }, accepted.dependencies)

    const operations = accepted.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(confirmations).toHaveLength(1)
    Expect(operations.some(operation => operation.startsWith('just '))).toBe(false)
    Expect(operations.some(operation => operation.startsWith('git merge --squash'))).toBe(true)
    Expect(operations.some(operation => operation.startsWith('git commit -F'))).toBe(true)
    Expect(accepted.lines.some(line => line.includes('which no lane verified'))).toBe(true)
    Expect(outcome.mode).toBe('executed')
  })

  // Verification now precedes staging under every flag, so the assertion this guards is no longer
  // "before verify" but "before commit": a squash that is not the verified tree never becomes one.
  Test('refuses a mismatched squash tree before commit under every flag combination', async () => {
    for (
      const options of [
        {},
        { skipVerifyFull: true },
        { skipVerify: true },
        { skipAll: true },
        { skipVerifyFull: true, skipVerify: true },
      ]
    ) {
      const fake = fakeDependencies({ stagedTree: 'different-tree' })
      await Expect(MergeWithMainCommand.run({
        ...options,
        repositoryRoot: fake.repository.featureRoot,
      }, fake.dependencies)).rejects.toThrow('staged squash tree does not equal')
      Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
      Expect(onlySnapshot(fake).phase).toBe('squashed')
    }
  })

  Test('integrates a main update discovered after verification and restarts full verification', async () => {
    const originalMain = 'main000000000000000000000000000000000000'
    const movedMain = 'movedmain000000000000000000000000000000000'
    const fake = fakeDependencies({
      ancestorExitCodes: [0, 0, 1],
      mainHead: originalMain,
      remoteMainHead: originalMain,
      remoteMainSequence: [originalMain, movedMain, movedMain],
    })

    await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(operations.filter(operation => operation === 'just verify-full')).toHaveLength(2)
    Expect(operations.indexOf('git merge --no-edit origin/main')).toBeGreaterThan(
      operations.indexOf('just verify-full'),
    )
    Expect(operations.findLastIndex(operation => operation === 'just verify-full')).toBeGreaterThan(
      operations.indexOf('git merge --no-edit origin/main'),
    )
    // Nothing is staged until the tip holds still, so a restart builds no worktree it must then
    // throw away: there is exactly one, created after the last lane.
    Expect(operations.filter(operation => operation.startsWith('git worktree add '))).toHaveLength(1)
    Expect(operations.findIndex(operation => operation.startsWith('git worktree add '))).toBeGreaterThan(
      operations.findLastIndex(operation => operation === 'just verify-full'),
    )
    Expect(fake.lines.some(line => line.includes('restarting full verification (pass 2/3)'))).toBe(true)
  })

  Test('stops after three verification restarts when remote main never stabilizes', async () => {
    const originalMain = 'main000000000000000000000000000000000000'
    const fake = fakeDependencies({
      ancestorExitCodes: [0, 1, 1, 1],
      mainHead: originalMain,
      remoteMainHead: originalMain,
      remoteMainSequence: [originalMain, 'main-1', 'main-2', 'main-3'],
    })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('moved during 3 consecutive verification passes')

    Expect(fake.calls.filter(call => call.command === 'just' && call.args[0] === 'verify-full')).toHaveLength(3)
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
    Expect(onlySnapshot(fake).phase).toBe('failed')
  })

  Test('a red lane fails before anything is staged, so there is no worktree to strand', async () => {
    const fake = fakeDependencies({ failVerify: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'add')).toBe(false)
    Expect(fake.lines.some(line => line.startsWith('WARN  The integration worktree is left at'))).toBe(false)
    Expect(onlySnapshot(fake).phase).toBe('failed')
    Expect(fake.lease.releases).toBe(1)
  })

  Test('a failed landing keeps its integration worktree and says where it is', async () => {
    // The worktree holds the staged squash or the conflict that explains the failure, and the
    // snapshot alone cannot reproduce either. An earlier version disposed of it and lost the evidence.
    const fake = fakeDependencies({ failSquash: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    const integrationRoot = fake.calls.find(call => call.args[1] === 'add')?.args[3]
    Expect(integrationRoot).toBeDefined()
    Expect(fake.directories.has(integrationRoot!)).toBe(true)
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(false)
    Expect(fake.lines).toContain(
      `WARN  The integration worktree is left at ${integrationRoot} so its state can be inspected; it holds `
        + 'the staged squash this landing failed on.',
    )
    Expect(fake.lines).toContain(
      `WARN  Remove it when you are done: git worktree remove --force ${integrationRoot}`,
    )
    Expect(onlySnapshot(fake).integrationRoot).toBe(integrationRoot)
    Expect(fake.lease.releases).toBe(1)
  })

  Test('refuses to adopt worktree changes that appear while validation is running', async () => {
    const fake = fakeDependencies()
    const run = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const outcome = await run(command, spec)
      if (command === 'just' && spec.args?.[0] === 'verify-full') {
        fake.repository.featureStatus = '?? someone-elses-file.ts\n'
      }
      return outcome
    }

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('changed while validation was running')

    const snapshot = onlySnapshot(fake)
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentFeatureStatus).toBe('')
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('refuses an appendix with automated attribution before creating a commit', async () => {
    const fake = fakeDependencies()
    fake.files.set(
      fake.repository.squashMessagePath,
      'Squashed commit of the following:\n\ncommit abc\n\nCo-Authored-By: Bot <bot@example.test>\n',
    )

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('must not contain automated-author attribution')
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('rechecks the committed tree before push', async () => {
    const fake = fakeDependencies({ committedTree: 'wrong-committed-tree' })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('committed integration tree does not equal')
    Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
  })

  Test('records push-started before a failed push and will not auto-abort it', async () => {
    const fake = fakeDependencies({ failMainPush: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    Expect((stored as MergeSnapshot).phase).toBe('push-started')
    const resetCallsBeforeAbort = fake.calls.filter(call => call.args[0] === 'reset').length

    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies))
      .rejects.toThrow('Refusing to rewrite pushed history')
    Expect(fake.calls.filter(call => call.args[0] === 'reset')).toHaveLength(resetCallsBeforeAbort)
  })

  Test('restores abort recovery when the main push lease proves main moved', async () => {
    const movedMain = 'movedmain000000000000000000000000000000000'
    const fake = fakeDependencies({
      failMainPush: true,
      remoteMainSequence: [
        'main000000000000000000000000000000000000',
        'main000000000000000000000000000000000000',
        movedMain,
      ],
    })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('The remote was not changed; abort this snapshot')

    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    Expect((stored as MergeSnapshot).phase).toBe('committed')
    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    // An abort is the one place the integration worktree is deliberately discarded: the person asked
    // for the state it holds to be undone, which is the opposite of keeping it to read.
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true)
  })

  Test('keeps the archived recovery boundary when preserving the worktree fails', async () => {
    const fake = fakeDependencies({ failDetach: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    const snapshot = onlySnapshot(fake)
    Expect(snapshot.phase).toBe('archived')
    Expect(fake.calls.some(call => call.args[0] === 'branch' && call.args[1] === '-D')).toBe(false)
    Expect(fake.repository.branch).toBe('feat/example')
  })

  Test('records and aborts a failed feature integration without disposing of the evidence', async () => {
    const fake = fakeDependencies({ ancestorExitCodes: [0, 1], failFeatureMerge: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    const snapshot = stored as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentFeatureStatus).toBe('UU example.ts\n')
    // The merge failed before any integration worktree existed, so there is nothing to name.
    Expect(snapshot.integrationRoot).toBeUndefined()
    Expect(fake.lines.some(line => line.startsWith('WARN  The integration worktree is left at'))).toBe(false)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.repository.featureStatus).toBe('')
  })

  Test('records and aborts a failed squash preparation', async () => {
    const fake = fakeDependencies({ failSquash: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    const snapshot = stored as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.integrationRoot).toBeDefined()

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true)
    Expect(fake.repository.featureStatus).toBe('')
  })

  Test('moves local main onto the pushed commit, and only ever warns when it cannot', async () => {
    const checkedOut = fakeDependencies()
    await MergeWithMainCommand.run({ repositoryRoot: checkedOut.repository.featureRoot }, checkedOut.dependencies)
    // A branch some worktree has checked out must be fast-forwarded from inside that worktree;
    // update-ref there would leave its index at the old commit and report the whole difference.
    const fastForward = checkedOut.calls.find(call => call.args[0] === 'merge' && call.args[1] === '--ff-only')
    Expect(fastForward?.cwd).toBe(checkedOut.repository.mainRoot)
    Expect(checkedOut.calls.some(call => call.args[0] === 'update-ref')).toBe(false)

    const dirty = fakeDependencies({ mainStatus: 'M  someone-elses-edit.ts\n' })
    const dirtyOutcome = await MergeWithMainCommand.run(
      { repositoryRoot: dirty.repository.featureRoot },
      dirty.dependencies,
    )
    Expect(dirtyOutcome.mode).toBe('executed')
    Expect(dirty.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--ff-only')).toBe(false)
    Expect(
      dirty.lines.some(line =>
        line.startsWith('WARN  Local main is checked out at /repo-main, which is not clean')
        && line.includes('git -C /repo-main merge --ff-only commit00000000000000000000000000000000000')
      ),
    ).toBe(true)

    const refused = fakeDependencies({ failLocalMainRefresh: true })
    const refusedOutcome = await MergeWithMainCommand.run(
      { repositoryRoot: refused.repository.featureRoot },
      refused.dependencies,
    )
    // The push already happened, so a landing that succeeded is never reported as failed.
    Expect(refusedOutcome.mode).toBe('executed')
    Expect(
      refused.lines.some(line =>
        line.startsWith('WARN  Could not fast-forward local main at /repo-main')
        && line.includes('git -C /repo-main merge --ff-only commit00000000000000000000000000000000000')
      ),
    ).toBe(true)
  })

  Test('guarded abort restores only a snapshot whose recorded state still matches', async () => {
    const fake = fakeDependencies({ featureHead: 'integrated-feature' })
    const snapshotPath = '/repo-feature/.artifacts/merge/snapshot.json'
    const snapshot: MergeSnapshot = {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: 'integrated-feature',
      currentFeatureStatus: '',
      featureHead: 'feature-before',
      featureIndexTree: 'staged-tree',
      featureRoot: '/repo-feature',
      featureTree: 'staged-tree',
      mainHead: 'main-before',
      messageFile: '/message',
      phase: 'squashed',
      remoteMainHead: 'main-before',
      snapshotPath,
      stagedTree: 'staged-tree',
      version: 2,
    }
    fake.snapshots.set(snapshotPath, snapshot)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.calls.filter(call => call.args[0] === 'reset').map(call => call.args.slice(0, 3))).toEqual([
      ['reset', '--hard', 'feature-before'],
    ])

    const changed = fakeDependencies({ featureHead: 'someone-else-worked-here' })
    changed.snapshots.set(snapshotPath, snapshot)
    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, changed.dependencies))
      .rejects.toThrow('no longer matches the merge snapshot')
    Expect(changed.calls.some(call => call.args[0] === 'reset')).toBe(false)
  })

  Test('rejects merge-start flags combined with abort before reading the snapshot', async () => {
    for (
      const options of [
        { dryRun: true },
        { messageFile: '/elsewhere.msg' },
        { skipAll: true },
        { skipVerifyFull: true },
        { skipVerify: true },
      ]
    ) {
      const fake = fakeDependencies()
      await Expect(MergeWithMainCommand.run({
        ...options,
        abortSnapshot: '/repo-feature/.artifacts/merge/snapshot.json',
      }, fake.dependencies)).rejects.toThrow('--abort cannot be combined')
      Expect(fake.calls).toEqual([])
      Expect(fake.snapshots.size).toBe(0)
    }
  })

  Test('never auto-aborts after main was pushed', async () => {
    const fake = fakeDependencies()
    const snapshotPath = '/repo-feature/.artifacts/merge/pushed.json'
    fake.snapshots.set(snapshotPath, {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: fake.repository.featureHead,
      currentFeatureStatus: '',
      featureHead: fake.repository.featureHead,
      featureIndexTree: fake.repository.tree,
      featureRoot: '/repo-feature',
      featureTree: fake.repository.tree,
      mainHead: fake.repository.mainHead,
      messageFile: '/message',
      phase: 'pushed',
      remoteMainHead: fake.repository.remoteMainHead,
      snapshotPath,
      version: 2,
    })

    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies))
      .rejects.toThrow('Refusing to rewrite pushed history')
    Expect(fake.calls).toEqual([])
  })

  Test('lands safely in disposable real Git worktrees', async () => {
    const root = await FS.realPath(await mkTestDir('tao-merge-with-main-'))
    const remoteRoot = FS.resolvePath('remote.git', root)
    const mainRoot = FS.resolvePath('main', root)
    const featureRoot = FS.resolvePath('feature', root)
    try {
      await gitCommand(root, ['init', '--bare', remoteRoot])
      await gitCommand(root, ['clone', remoteRoot, mainRoot])
      await gitCommand(mainRoot, ['config', 'user.name', 'Tao Test'])
      await gitCommand(mainRoot, ['config', 'user.email', 'tao@example.test'])
      await FS.writeText(FS.resolvePath('.gitignore', mainRoot), '.artifacts/\n')
      await FS.writeText(FS.resolvePath('base.txt', mainRoot), 'base\n')
      await gitCommand(mainRoot, ['add', '.gitignore', 'base.txt'])
      await gitCommand(mainRoot, ['commit', '-m', 'Base'])
      await gitCommand(mainRoot, ['branch', '-M', 'main'])
      await gitCommand(mainRoot, ['push', '-u', 'origin', 'main'])
      await gitCommand(mainRoot, ['worktree', 'add', '-b', 'feat/integration', featureRoot])
      await FS.writeText(FS.resolvePath('feature.txt', featureRoot), 'feature\n')
      await gitCommand(featureRoot, ['add', 'feature.txt'])
      await gitCommand(featureRoot, ['commit', '-m', 'Feature'])
      await gitCommand(featureRoot, ['push', '-u', 'origin', 'feat/integration'])
      await FS.writeText(
        FS.resolvePath('.artifacts/merge/feat/integration.msg', featureRoot),
        'Land integration fixture\n\n- Add the disposable feature.\n',
      )

      let released = 0
      const dependencies: MergeWithMainDependencies = {
        // The real lease is machine-wide; a test must not queue behind another worktree's landing.
        acquireLease: async options => ({
          owner: {
            command: options.command,
            id: 'test-lease',
            name: options.name,
            pid: 1,
            repositoryRoot: options.repositoryRoot,
            startedAt: '2026-09-03T14:15:16.789Z',
          },
          release: async () => {
            released += 1
          },
        }),
        askConfirm: async () => true,
        exists: FS.exists,
        isInteractive: () => false,
        move: FS.move,
        now: () => new Date('2026-09-03T14:15:16.789Z'),
        readJson: FS.readJson,
        readText: FS.readText,
        remove: FS.remove,
        run: async (command, spec) =>
          command === 'just'
            ? result(command, spec.args ?? [], spec.cwd)
            : await CLI.run(command, { ...spec, stdio: 'pipe' }),
        writeJson: FS.writeJson,
        writeLine: () => {},
        writeText: FS.writeText,
      }
      const outcome = await MergeWithMainCommand.run({
        repositoryRoot: featureRoot,
        skipVerifyFull: true,
      }, dependencies)

      Expect(outcome.mode).toBe('executed')
      Expect(released).toBe(1)
      Expect(await FS.exists(featureRoot)).toBe(true)
      Expect((await gitResult(featureRoot, ['status', '--porcelain'])).stdout).toBe('')
      Expect((await gitResult(featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/merged/integration']))
          .stdout.trim(),
      )
      Expect((await gitResult(featureRoot, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1)
      Expect((await gitResult(mainRoot, ['branch', '--list', 'feat/integration'])).stdout).toBe('')
      Expect((await gitResult(mainRoot, ['status', '--porcelain'])).stdout).toBe('')
      // The disposable worktree is gone, and local main was fast-forwarded onto what was pushed.
      Expect(
        (await gitResult(featureRoot, ['worktree', 'list', '--porcelain'])).stdout,
      ).not.toContain('/integration-')
      const mainHead = (await gitResult(mainRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      Expect((await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main'])).stdout.trim())
        .toBe(mainHead)
      Expect(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/merged/integration']))
          .exitCode,
      ).toBe(0)
      Expect(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', '--verify', 'refs/heads/feat/integration']))
          .exitCode,
      ).toBe(128)
    } finally {
      await FS.remove(root)
    }
  })
})

async function gitCommand(cwd: string, args: readonly string[]): Promise<void> {
  const commandResult = await gitResult(cwd, args)
  if (commandResult.exitCode !== 0) {
    throw new Errors.CommandExecutionError(commandResult)
  }
}

async function gitResult(cwd: string, args: readonly string[]) {
  return await CLI.run('git', { args, cwd, stdio: 'pipe' })
}
