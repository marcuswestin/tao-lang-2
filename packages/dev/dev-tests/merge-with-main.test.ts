import { CLI, Errors, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { MachineResourceBusyError } from '../dev-src/repository-tests/MachineLanes'
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
  failMainPush?: boolean
  failRemoteFetch?: boolean
  failSquash?: boolean
  failVerify?: boolean
  featureHead: string
  featureRoot: string
  featureStatus: string
  integrationExists: boolean
  integrationHead?: string
  integrationRoot?: string
  integrationStatus: string
  localMainHead?: string
  mainHead: string
  remoteFeatureHead?: string
  remoteMainSequence?: string[]
  remoteMergedHead?: string
  squashMessagePath: string
  stagedTree: string
  tree: string
}

function result(command: string, args: readonly string[], cwd: string | undefined, stdout = '', exitCode = 0) {
  return { args: [...args], command, cwd, error: undefined, exitCode, signal: null, stderr: '', stdout }
}

function fakeDependencies(overrides: Partial<FakeRepository> = {}) {
  const repository: FakeRepository = {
    branch: 'feat/example',
    featureHead: 'feature00000000000000000000000000000000000',
    featureRoot: '/repo-feature',
    featureStatus: '',
    integrationExists: false,
    integrationStatus: '',
    localMainHead: 'main000000000000000000000000000000000000',
    mainHead: 'main000000000000000000000000000000000000',
    remoteFeatureHead: 'feature00000000000000000000000000000000000',
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
  const moves: Array<{ fromPath: string; toPath: string }> = []
  const lines: string[] = []
  const leases: Array<{ released: boolean }> = []
  const ancestorExitCodes = [...(repository.ancestorExitCodes ?? [])]
  const remoteMainSequence = [...(repository.remoteMainSequence ?? [])]
  let advertisedMain = repository.mainHead

  const consumeRemoteMain = (): string => {
    advertisedMain = remoteMainSequence.shift() ?? advertisedMain
    return advertisedMain
  }

  const runner: MergeCommandRunner = async (command, spec) => {
    const args = [...(spec.args ?? [])]
    calls.push({ args, command, cwd: spec.cwd, stdio: spec.stdio })
    const cwd = spec.cwd
    const onIntegration = cwd !== undefined && cwd === repository.integrationRoot
    if (command === 'just') {
      if (repository.failVerify === true && (args[0] === 'full-verify' || args[0] === 'verify')) {
        return result(command, args, cwd, '', 1)
      }
      return result(command, args, cwd)
    }
    const joined = args.join(' ')
    if (joined === 'symbolic-ref --quiet --short HEAD') {
      return result(command, args, cwd, `${repository.branch}\n`)
    }
    if (joined === 'status --porcelain=v1 --untracked-files=all') {
      return result(command, args, cwd, onIntegration ? repository.integrationStatus : repository.featureStatus)
    }
    if (joined === 'diff --no-ext-diff --binary HEAD') {
      return result(command, args, cwd, onIntegration ? repository.integrationStatus : repository.featureStatus)
    }
    if (joined === 'rev-parse HEAD') {
      return result(command, args, cwd, `${onIntegration ? repository.integrationHead : repository.featureHead}\n`)
    }
    if (joined === 'worktree list --porcelain') {
      return result(
        command,
        args,
        cwd,
        [
          `worktree ${repository.featureRoot}`,
          `HEAD ${repository.featureHead}`,
          `branch refs/heads/${repository.branch}`,
          '',
        ].join('\n'),
      )
    }
    if (joined === `fetch --prune origin main`) {
      if (repository.failRemoteFetch === true) {
        return result(command, args, cwd, '', 1)
      }
      advertisedMain = consumeRemoteMain()
      return result(command, args, cwd)
    }
    if (joined === 'rev-parse origin/main') {
      return result(command, args, cwd, `${advertisedMain}\n`)
    }
    if (joined === 'rev-parse --verify --quiet refs/heads/main') {
      return repository.localMainHead === undefined
        ? result(command, args, cwd, '', 1)
        : result(command, args, cwd, `${repository.localMainHead}\n`)
    }
    if (args[0] === 'ls-remote') {
      const refs: string[] = []
      if (args.includes('refs/heads/main')) {
        refs.push(`${consumeRemoteMain()}\trefs/heads/main`)
      }
      if (args.includes(`refs/heads/${repository.branch}`) && repository.remoteFeatureHead !== undefined) {
        refs.push(`${repository.remoteFeatureHead}\trefs/heads/${repository.branch}`)
      }
      const archiveRef = `refs/heads/merged/${repository.branch.slice(5)}`
      if (args.includes(archiveRef) && repository.remoteMergedHead !== undefined) {
        refs.push(`${repository.remoteMergedHead}\t${archiveRef}`)
      }
      return result(command, args, cwd, refs.join('\n'))
    }
    if (args[0] === 'merge-base') {
      return result(command, args, cwd, '', ancestorExitCodes.shift() ?? 0)
    }
    if (joined === 'log -1 --format=%cI HEAD') {
      return result(command, args, cwd, '2026-09-03T12:00:00.000Z\n')
    }
    if (args[0] === 'rev-parse' && args[1]?.endsWith('^{tree}')) {
      const tree = onIntegration && repository.integrationHead?.startsWith('commit')
        ? repository.committedTree ?? repository.tree
        : repository.tree
      return result(command, args, cwd, `${tree}\n`)
    }
    if (joined === 'write-tree') {
      return result(command, args, cwd, `${onIntegration ? repository.stagedTree : repository.tree}\n`)
    }
    if (joined === 'rev-parse --git-path SQUASH_MSG') {
      return result(command, args, cwd, `${repository.squashMessagePath}\n`)
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      repository.integrationRoot = args[3]
      repository.integrationHead = args[4]
      repository.integrationExists = true
      repository.integrationStatus = ''
      return result(command, args, cwd)
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      repository.integrationExists = false
      return result(command, args, cwd)
    }
    if (joined === 'worktree prune') {
      return result(command, args, cwd)
    }
    if (joined.startsWith('merge --squash ')) {
      repository.integrationStatus = repository.failSquash === true ? 'UU example.ts\n' : 'M  example.ts\n'
      return result(command, args, cwd, '', repository.failSquash === true ? 1 : 0)
    }
    if (joined.startsWith('commit -F ')) {
      repository.integrationHead = 'commit00000000000000000000000000000000000'
      repository.integrationStatus = ''
      return result(command, args, cwd)
    }
    if (joined.startsWith('switch --detach ')) {
      if (repository.failDetach === true) {
        return result(command, args, cwd, '', 1)
      }
      repository.featureHead = args[2]!
      repository.featureStatus = ''
      repository.branch = ''
      return result(command, args, cwd)
    }
    if (joined === 'symbolic-ref --quiet HEAD') {
      return result(command, args, cwd, '', repository.branch === '' ? 1 : 0)
    }
    if (
      args[0] === 'push' && args.at(-1) === `${repository.integrationHead}:refs/heads/main`
      && repository.failMainPush === true
    ) {
      return result(command, args, cwd, '', 1)
    }
    if (
      args[0] === 'push'
      || joined.startsWith('branch -D ')
    ) {
      return result(command, args, cwd)
    }
    return result(command, args, cwd, '', 1)
  }

  const dependencies: MergeWithMainDependencies = {
    acquireLease: async () => {
      const lease = { released: false }
      leases.push(lease)
      return {
        owner: {
          command: 'merge-with-main',
          id: `lease-${leases.length}`,
          name: 'merge-with-main-landing',
          pid: 4242,
          repositoryRoot: repository.featureRoot,
          startedAt: '2026-09-03T14:00:00.000Z',
        },
        release: async () => {
          lease.released = true
        },
      }
    },
    askConfirm: async () => true,
    exists: async path => {
      if (path === repository.integrationRoot) {
        return repository.integrationExists
      }
      return files.has(path) || snapshots.has(path)
    },
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
    },
    run: runner,
    sleep: async () => {},
    writeJson: async (path, value) => {
      snapshots.set(path, structuredClone(value))
    },
    writeLine: line => lines.push(line),
    writeText: async (path, value) => {
      files.set(path, value)
    },
  }
  return { calls, dependencies, files, leases, lines, moves, repository, snapshots }
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

  Test(
    'dry run performs only read-only git operations, never touches the landing lease, and ends with the exact execute command',
    async () => {
      const fake = fakeDependencies()
      const result_ = await MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies)

      Expect(result_.mode).toBe('dry-run')
      Expect(fake.calls.some(call => ['merge', 'commit', 'push'].includes(call.args[0]!))).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] !== 'list')).toBe(false)
      Expect(fake.leases).toEqual([])
      Expect(fake.lines.at(-1)).toBe(
        'DRY RUN  No refs or worktrees changed. Execute with: ./dev merge-with-main --execute --yes',
      )
      Expect(fake.snapshots.size).toBe(0)
    },
  )

  Test(
    'fails before mutation for a dirty feature worktree or a local main branch that disagrees with origin',
    async () => {
      const dirty = fakeDependencies({ featureStatus: 'M  local.ts\n' })
      await Expect(
        MergeWithMainCommand.run({ repositoryRoot: dirty.repository.featureRoot }, dirty.dependencies),
      ).rejects.toThrow('The feature worktree is not clean')

      const stale = fakeDependencies({ localMainHead: 'stale-local-main' })
      await Expect(
        MergeWithMainCommand.run({ repositoryRoot: stale.repository.featureRoot }, stale.dependencies),
      ).rejects.toThrow("Local branch 'main'")
      Expect(stale.calls.some(call => call.args[0] === 'push')).toBe(false)
    },
  )

  Test('degrades a dry run honestly when the remote cannot be reached', async () => {
    const fake = fakeDependencies({ failRemoteFetch: true })
    const outcome = await MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies)

    Expect(outcome.mode).toBe('dry-run')
    Expect(outcome.lines).toContain('WARN  Could not reach origin to confirm main; execution requires network access.')
    Expect(outcome.lines).toContain(
      "WARN  Could not confirm 'feat/example' or its archive branch on origin because the remote was unreachable.",
    )
  })

  Test('refuses to execute when the remote cannot be reached', async () => {
    const fake = fakeDependencies({ failRemoteFetch: true })
    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('Cannot confirm origin/main')
    // The lease was still taken and released around the failed preflight.
    Expect(fake.leases).toHaveLength(1)
    Expect(fake.leases[0]?.released).toBe(true)
  })

  Test('requires both non-interactive confirmation and independent push authorization', async () => {
    const noConfirmation = fakeDependencies()
    noConfirmation.dependencies.isInteractive = () => false
    await Expect(MergeWithMainCommand.run({
      execute: true,
      repositoryRoot: noConfirmation.repository.featureRoot,
    }, noConfirmation.dependencies)).rejects.toThrow('requires --yes')

    const noPush = fakeDependencies()
    noPush.dependencies.isInteractive = () => false
    await Expect(MergeWithMainCommand.run({
      execute: true,
      repositoryRoot: noPush.repository.featureRoot,
      yes: true,
    }, noPush.dependencies)).rejects.toThrow('requires explicit --push')
    Expect(noPush.snapshots.size).toBe(0)
    Expect(noPush.leases[0]?.released).toBe(true)
  })

  Test('waits for a busy landing lease by default, printing the holder, then proceeds once free', async () => {
    const fake = fakeDependencies()
    const owner = {
      command: 'merge-with-main',
      id: 'other-lease',
      name: 'merge-with-main-landing',
      pid: 999,
      repositoryRoot: '/repo-other',
      startedAt: '2026-09-03T13:59:00.000Z',
    }
    let attempts = 0
    const realAcquire = fake.dependencies.acquireLease
    fake.dependencies.acquireLease = async (repositoryRoot, waitTimeoutMs) => {
      attempts += 1
      if (attempts < 3) {
        throw new MachineResourceBusyError(owner)
      }
      return await realAcquire(repositoryRoot, waitTimeoutMs)
    }
    const sleeps: number[] = []
    fake.dependencies.sleep = async ms => {
      sleeps.push(ms)
    }

    const outcome = await MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)

    Expect(outcome.mode).toBe('executed')
    Expect(attempts).toBe(3)
    Expect(sleeps).toEqual([5_000, 5_000])
    Expect(fake.lines.filter(line => line.includes('is next in line'))).toHaveLength(1)
    Expect(fake.lines.some(line => line.includes('/repo-other'))).toBe(true)
  })

  Test('refuses immediately instead of waiting when --refuse-if-busy is set', async () => {
    const fake = fakeDependencies()
    const owner = {
      command: 'merge-with-main',
      id: 'other-lease',
      name: 'merge-with-main-landing',
      pid: 999,
      repositoryRoot: '/repo-other',
      startedAt: '2026-09-03T13:59:00.000Z',
    }
    fake.dependencies.acquireLease = async () => {
      throw new MachineResourceBusyError(owner)
    }

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      refuseIfBusy: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(Errors.HostEnvironmentError)
    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      refuseIfBusy: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(/repo-other/)
    Expect(fake.calls).toEqual([])
  })

  Test(
    'executes verification and pushes before removing the integration worktree and preserving the invoking worktree',
    async () => {
      const fake = fakeDependencies()
      const outcome = await MergeWithMainCommand.run({
        execute: true,
        push: true,
        repositoryRoot: fake.repository.featureRoot,
        yes: true,
      }, fake.dependencies)

      const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
      const integrationCreate = operations.findIndex(operation => operation.startsWith('git worktree add --detach'))
      const fullVerify = operations.indexOf('just full-verify')
      const squash = operations.findIndex(operation => operation.startsWith('git merge --squash'))
      const commit = operations.findIndex(operation => operation.startsWith('git commit -F'))
      const push = operations.findIndex(operation =>
        operation.startsWith('git push origin --force-with-lease=refs/heads/main:')
      )
      const archive = operations.indexOf(
        'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
      )
      const deleteRemote = operations.indexOf(
        `git push origin --force-with-lease=refs/heads/feat/example:${fake.repository.remoteFeatureHead}`
          + ' :refs/heads/feat/example',
      )
      const integrationRemove = operations.findIndex(operation => operation.startsWith('git worktree remove --force'))
      const detach = operations.findIndex(operation => operation.startsWith('git switch --detach'))
      const proveDetached = operations.indexOf('git symbolic-ref --quiet HEAD')
      const deleteBranch = operations.indexOf('git branch -D feat/example')
      const prune = operations.indexOf('git worktree prune')

      Expect(integrationCreate).toBeGreaterThan(0)
      Expect(fullVerify).toBeGreaterThan(integrationCreate)
      Expect(squash).toBeGreaterThan(integrationCreate)
      Expect(squash).toBeLessThan(fullVerify)
      Expect(fake.calls[fullVerify]?.stdio).toBe('inherit')
      Expect(commit).toBeGreaterThan(fullVerify)
      Expect(fake.lines.some(line => line.includes('Verified the integration tree'))).toBe(true)
      Expect(push).toBeGreaterThan(commit)
      Expect(archive).toBeGreaterThan(push)
      Expect(deleteRemote).toBeGreaterThan(archive)
      Expect(integrationRemove).toBeGreaterThan(archive)
      Expect(detach).toBeGreaterThan(integrationRemove)
      Expect(proveDetached).toBeGreaterThan(detach)
      Expect(deleteBranch).toBeGreaterThan(proveDetached)
      Expect(prune).toBeGreaterThan(deleteBranch)
      Expect(outcome.mode).toBe('executed')
      Expect(outcome.lines).toEqual([
        "PASS  Merged 'feat/example' into main and archived it as merged/example.",
        'PASS  Preserved the clean invoking worktree at /repo-feature on detached HEAD; '
        + 'archive its owning task when you are ready to remove it.',
      ])
      Expect(outcome.snapshotPath).toMatch(
        /^\/repo-feature\/\.artifacts\/merge\/2026-09-03T14-15-16-789Z-[0-9a-f]{8}\.json$/u,
      )
      const completedSnapshot = [...fake.snapshots.values()][0] as MergeSnapshot
      Expect(completedSnapshot.phase).toBe('complete')
      Expect(completedSnapshot.currentFeatureHead).toBe(fake.repository.featureHead)
      Expect(completedSnapshot.currentFeatureStatus).toBe('')
      Expect(completedSnapshot.currentIntegrationHead).toBeUndefined()
      Expect(fake.moves.every(move => move.fromPath.endsWith('.tmp'))).toBe(true)
      Expect(fake.leases).toHaveLength(1)
      Expect(fake.leases[0]?.released).toBe(true)
      const commitMessage = [...fake.files.entries()].find(([path]) => path.endsWith('.commit-message'))?.[1]
      Expect(commitMessage).toContain('Land example\n\n- Add the example workflow.')
      Expect(commitMessage).toContain('Squashed commit of the following:')
    },
  )

  Test('does not publish a behind remote feature branch before verification', async () => {
    const fake = fakeDependencies({ remoteFeatureHead: 'stale00000000000000000000000000000000000' })

    const dryRun = await MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies)
    Expect(dryRun.lines).toContain(
      'PLAN  Keep the behind origin/feat/example unchanged until the verified archive replaces it.',
    )

    const outcome = await MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    const fullVerify = operations.indexOf('just full-verify')
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

  Test('refuses when the remote archive branch already exists', async () => {
    const fake = fakeDependencies({ remoteMergedHead: 'archived0000000000000000000000000000000000' })
    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow("archive branch 'merged/example' already exists")
  })

  Test('keeps verification output durable when merge execution has no terminal', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false

    await MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)

    const verificationCalls = fake.calls.filter(call =>
      call.command === 'just' && (call.args[0] === 'full-verify' || call.args[0] === 'verify')
    )
    Expect(verificationCalls.map(call => call.stdio)).toEqual(['stream'])
  })

  Test('runs verify --complete on the staged squash when full verification was explicitly skipped', async () => {
    const fake = fakeDependencies()

    await MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      skipFullVerify: true,
      yes: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(operations).not.toContain('just full-verify')
    Expect(operations.indexOf('just verify --complete')).toBeGreaterThan(
      operations.findIndex(operation => operation.startsWith('git merge --squash')),
    )
    Expect(operations.indexOf('just verify --complete')).toBeLessThan(
      operations.findIndex(operation => operation.startsWith('git commit -F')),
    )
  })

  Test('rebuilds the integration tree when main moves during verification and restarts verification', async () => {
    const originalMain = 'main000000000000000000000000000000000000'
    const movedMain = 'movedmain000000000000000000000000000000000'
    const fake = fakeDependencies({
      mainHead: originalMain,
      remoteMainSequence: [originalMain, movedMain, movedMain, movedMain],
    })

    await MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    Expect(operations.filter(operation => operation === 'just full-verify')).toHaveLength(2)
    Expect(operations.filter(operation => operation.startsWith('git worktree add --detach'))).toHaveLength(2)
    Expect(operations.filter(operation => operation.startsWith('git worktree remove --force'))).toHaveLength(2)
    Expect(fake.lines.some(line => line.includes('rebuilding the integration tree at the new head (pass 2/3)')))
      .toBe(true)
  })

  Test('stops after three verification restarts when remote main never stabilizes', async () => {
    const originalMain = 'main000000000000000000000000000000000000'
    const fake = fakeDependencies({
      mainHead: originalMain,
      remoteMainSequence: [
        originalMain,
        'main-1',
        'main-1',
        'main-2',
        'main-2',
        'main-3',
      ],
    })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('moved during 3 consecutive verification passes')

    Expect(fake.calls.filter(call => call.command === 'just' && call.args[0] === 'full-verify')).toHaveLength(3)
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
    Expect(([...fake.snapshots.values()].at(-1) as MergeSnapshot).phase).toBe('failed')
  })

  Test('refuses to adopt worktree changes that appear while validation is running', async () => {
    const fake = fakeDependencies()
    const run = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const outcome = await run(command, spec)
      if (command === 'just' && spec.args?.[0] === 'full-verify') {
        fake.repository.integrationStatus = '?? someone-elses-file.ts\n'
      }
      return outcome
    }

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('changed while validation was running')

    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('refuses an appendix with automated attribution before creating a commit', async () => {
    const fake = fakeDependencies()
    fake.files.set(
      fake.repository.squashMessagePath,
      'Squashed commit of the following:\n\ncommit abc\n\nCo-Authored-By: Bot <bot@example.test>\n',
    )

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('must not contain automated-author attribution')
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('rechecks the committed tree before push', async () => {
    const fake = fakeDependencies({ committedTree: 'wrong-committed-tree' })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('committed tree does not equal')
    Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
  })

  Test('records push-started before a failed push and will not auto-abort it', async () => {
    const fake = fakeDependencies({ failMainPush: true })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    Expect((stored as MergeSnapshot).phase).toBe('push-started')

    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, fake.dependencies))
      .rejects.toThrow('Refusing to rewrite pushed history')
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(false)
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
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('The remote was not changed; abort this snapshot')

    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    Expect((stored as MergeSnapshot).phase).toBe('committed')
    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
  })

  Test('keeps the archived recovery boundary when preserving the worktree fails', async () => {
    const fake = fakeDependencies({ failDetach: true })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    const snapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(snapshot.phase).toBe('archived')
    Expect(fake.calls.some(call => call.args[0] === 'branch' && call.args[1] === '-D')).toBe(false)
    Expect(fake.repository.branch).toBe('feat/example')
  })

  Test('a failed squash preparation leaves no integration worktree behind, and abort is then a no-op', async () => {
    const fake = fakeDependencies({ failSquash: true })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    // The worktree is disposed of immediately on failure, not left for `--abort` to clean up: a red
    // verification or a staging conflict is the ordinary outcome of a landing attempt that does not
    // succeed, and a stranded worktree would poison `git worktree list` for every worktree on the
    // machine, not just this one.
    Expect(fake.repository.integrationExists).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    const snapshot = stored as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentIntegrationHead).toBeUndefined()

    const removeCallsBeforeAbort = fake.calls
      .filter(call => call.args[0] === 'worktree' && call.args[1] === 'remove').length
    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    // Nothing left to remove: abort is a no-op on the worktree, not a second removal.
    Expect(fake.calls.filter(call => call.args[0] === 'worktree' && call.args[1] === 'remove'))
      .toHaveLength(removeCallsBeforeAbort)
    Expect(fake.calls.some(call => call.args[0] === 'reset')).toBe(false)
  })

  Test('a red verification lane leaves no integration worktree behind', async () => {
    const fake = fakeDependencies({ failVerify: true })

    await Expect(MergeWithMainCommand.run({
      execute: true,
      push: true,
      repositoryRoot: fake.repository.featureRoot,
      yes: true,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    Expect(fake.repository.integrationExists).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true)
    const snapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentIntegrationHead).toBeUndefined()
    Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
  })

  Test('guarded abort restores only a snapshot whose recorded state still matches', async () => {
    const fake = fakeDependencies({
      featureHead: 'integrated-feature',
      integrationExists: true,
      integrationHead: 'main-before',
      integrationRoot: '/repo-feature/.artifacts/merge/snapshot-integration',
      integrationStatus: 'M  staged.ts\n',
      stagedTree: 'staged-tree',
    })
    const snapshotPath = '/repo-feature/.artifacts/merge/snapshot.json'
    const snapshot: MergeSnapshot = {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: 'integrated-feature',
      currentFeatureStatus: '',
      currentIntegrationDiff: 'M  staged.ts\n',
      currentIntegrationHead: 'main-before',
      currentIntegrationStatus: 'M  staged.ts\n',
      featureHead: 'feature-before',
      featureIndexTree: 'staged-tree',
      featureRoot: '/repo-feature',
      featureTree: 'staged-tree',
      integrationRoot: '/repo-feature/.artifacts/merge/snapshot-integration',
      mainHead: 'main-before',
      mainTree: 'staged-tree',
      messageFile: '/message',
      phase: 'squashed',
      snapshotPath,
      stagedTree: 'staged-tree',
      version: 2,
    }
    fake.snapshots.set(snapshotPath, snapshot)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true)

    const changed = fakeDependencies({ featureHead: 'someone-else-worked-here' })
    changed.snapshots.set(snapshotPath, snapshot)
    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, changed.dependencies))
      .rejects.toThrow('no longer matches the merge snapshot')
    Expect(changed.calls.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(false)
  })

  Test('rejects merge-start flags combined with abort before reading the snapshot', async () => {
    const fake = fakeDependencies()

    await Expect(MergeWithMainCommand.run({
      abortSnapshot: '/repo-feature/.artifacts/merge/snapshot.json',
      execute: true,
      yes: true,
    }, fake.dependencies)).rejects.toThrow('--abort cannot be combined')
    Expect(fake.calls).toEqual([])
    Expect(fake.leases).toEqual([])
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
      integrationRoot: '/repo-feature/.artifacts/merge/pushed-integration',
      mainHead: fake.repository.mainHead,
      mainTree: fake.repository.tree,
      messageFile: '/message',
      phase: 'pushed',
      snapshotPath,
      version: 2,
    })

    await Expect(MergeWithMainCommand.run({ abortSnapshot: snapshotPath, yes: true }, fake.dependencies))
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

      const dependencies: MergeWithMainDependencies = {
        acquireLease: async () => ({
          owner: {
            command: 'merge-with-main',
            id: 'real-lease',
            name: 'merge-with-main-landing',
            pid: Platform.runtimeProcess.pid,
            repositoryRoot: featureRoot,
            startedAt: new Date().toISOString(),
          },
          release: async () => {},
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
        sleep: async () => {},
        writeJson: FS.writeJson,
        writeLine: () => {},
        writeText: FS.writeText,
      }
      const outcome = await MergeWithMainCommand.run({
        execute: true,
        push: true,
        repositoryRoot: featureRoot,
        skipFullVerify: true,
        yes: true,
      }, dependencies)

      Expect(outcome.mode).toBe('executed')
      Expect(await FS.exists(featureRoot)).toBe(true)
      Expect((await gitResult(featureRoot, ['status', '--porcelain'])).stdout).toBe('')
      Expect((await gitResult(featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/merged/integration']))
          .stdout.trim(),
      )
      Expect((await gitResult(featureRoot, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1)
      const integrationEntries = (await gitResult(featureRoot, ['worktree', 'list', '--porcelain'])).stdout
      Expect(integrationEntries).not.toContain('-integration')
      const mainHead = (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main'])).stdout
        .trim()
      Expect(mainHead).not.toBe('')
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
