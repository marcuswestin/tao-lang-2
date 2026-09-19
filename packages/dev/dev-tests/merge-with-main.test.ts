import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
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
  failMainPush?: boolean
  failSquash?: boolean
  featureHead: string
  featureRoot: string
  featureStatus: string
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
  const moves: Array<{ fromPath: string; toPath: string }> = []
  const lines: string[] = []
  const ancestorExitCodes = [...(repository.ancestorExitCodes ?? [])]
  const remoteMainSequence = [...(repository.remoteMainSequence ?? [])]
  let advertisedRemoteMain = repository.remoteMainHead

  const runner: MergeCommandRunner = async (command, spec) => {
    const args = [...(spec.args ?? [])]
    calls.push({ args, command, cwd: spec.cwd, stdio: spec.stdio })
    if (command === 'just') {
      return result(command, args, spec.cwd)
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
        spec.cwd === repository.mainRoot
          ? repository.mainStatus
          : repository.featureStatus,
      )
    }
    if (joined === 'diff --no-ext-diff --binary HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        spec.cwd === repository.mainRoot
          ? repository.mainStatus
          : repository.featureStatus,
      )
    }
    if (joined === 'rev-parse HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        `${spec.cwd === repository.mainRoot ? repository.mainHead : repository.featureHead}\n`,
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
          `worktree ${repository.mainRoot}`,
          `HEAD ${repository.mainHead}`,
          'branch refs/heads/main',
          '',
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
      repository.remoteMainHead = advertisedRemoteMain
      return result(command, args, spec.cwd)
    }
    if (joined === 'rev-parse origin/main') {
      return result(command, args, spec.cwd, `${repository.remoteMainHead}\n`)
    }
    if (args[0] === 'rev-parse' && args[1]?.endsWith('^{tree}')) {
      const tree = spec.cwd === repository.mainRoot && repository.mainHead.startsWith('commit')
        ? repository.committedTree ?? repository.tree
        : repository.tree
      return result(command, args, spec.cwd, `${tree}\n`)
    }
    if (joined === 'write-tree') {
      return result(command, args, spec.cwd, `${repository.stagedTree}\n`)
    }
    if (joined === 'rev-parse --git-path SQUASH_MSG') {
      return result(command, args, spec.cwd, `${repository.squashMessagePath}\n`)
    }
    if (joined.startsWith('merge --squash ')) {
      repository.mainStatus = repository.failSquash === true ? 'UU example.ts\n' : 'M  example.ts\n'
      return result(command, args, spec.cwd, '', repository.failSquash === true ? 1 : 0)
    }
    if (joined === 'merge --ff-only origin/main') {
      repository.mainHead = repository.remoteMainHead
      return result(command, args, spec.cwd)
    }
    if (joined === 'merge --no-edit origin/main') {
      if (repository.failFeatureMerge === true) {
        repository.featureStatus = 'UU example.ts\n'
        return result(command, args, spec.cwd, '', 1)
      }
      repository.featureHead = 'integrated-feature0000000000000000000000000'
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('commit -F ')) {
      repository.mainHead = 'commit00000000000000000000000000000000000'
      repository.mainStatus = ''
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('reset --hard ')) {
      if (spec.cwd === repository.mainRoot) {
        repository.mainHead = args[2]!
        repository.mainStatus = ''
      } else {
        repository.featureHead = args[2]!
        repository.featureStatus = ''
      }
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
    if (args[0] === 'push' && args.at(-1) === 'main:main' && repository.failMainPush === true) {
      return result(command, args, spec.cwd, '', 1)
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
    askConfirm: async () => true,
    exists: async path => files.has(path) || snapshots.has(path),
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
    writeJson: async (path, value) => {
      snapshots.set(path, structuredClone(value))
    },
    writeLine: line => lines.push(line),
    writeText: async (path, value) => {
      files.set(path, value)
    },
  }
  return { calls, dependencies, files, lines, moves, repository, snapshots }
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
      'status',
      'rev-parse',
      'ls-remote',
      'merge-base',
      'log',
    ])
    Expect(fake.calls.some(call => ['fetch', 'merge', 'commit', 'push', 'reset'].includes(call.args[0]!))).toBe(false)
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
      'PLAN  Run just verify --complete on the staged squash, because nothing else verified this branch.',
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
      'PLAN  Skip just verify --complete on the staged squash because --skip-all was passed; '
        + 'no lane will have verified these bytes.',
    )
    Expect(skipAll.lines).toContain('PLAN  Ask once, defaulting to No, whether to merge with nothing verified at all.')
    Expect(skipAll.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main --skip-all',
    )
  })

  Test('fails before mutation for a dirty main worktree or divergent remote main', async () => {
    const dirty = fakeDependencies({ mainStatus: 'M  local.ts\n' })
    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: dirty.repository.featureRoot }, dirty.dependencies),
    ).rejects.toThrow('The main worktree is not clean')
    Expect(dirty.calls.some(call => call.args[0] === 'fetch')).toBe(false)

    const stale = fakeDependencies({ remoteMainHead: 'new-main' })
    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: stale.repository.featureRoot }, stale.dependencies),
    ).rejects.toThrow('main worktree is not at origin/main')
    Expect(stale.calls.some(call => call.args[0] === 'fetch')).toBe(false)
    Expect(stale.snapshots.size).toBe(0)
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
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} main:main`,
    )
    Expect(operations).toContain(
      'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
    )
    Expect(operations).toContain('git branch -D feat/example')
    Expect(fake.repository.mainHead).toBe('commit00000000000000000000000000000000000')
    Expect(([...fake.snapshots.values()][0] as MergeSnapshot).phase).toBe('complete')
    // Exactly one lane, invoked without --no-cache, so it may reuse a green record for this tree.
    Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([['verify-full']])
  })

  Test('executes verification and pushes before preserving the invoking worktree and cleaning refs', async () => {
    const fake = fakeDependencies()
    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    const fullVerify = operations.indexOf('just verify-full')
    const squash = operations.findIndex(operation => operation.startsWith('git merge --squash'))
    const treeProof = operations.findIndex((operation, index) => index > squash && operation === 'git write-tree')
    // The staged squash is the tree full verification just proved, so it is not verified again.
    const verify = operations.indexOf('just verify --complete')
    const commit = operations.findIndex(operation => operation.startsWith('git commit -F'))
    const push = operations.indexOf(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} main:main`,
    )
    const archive = operations.indexOf(
      'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
    )
    const deleteRemote = operations.indexOf(
      `git push origin --force-with-lease=refs/heads/feat/example:${fake.repository.remoteFeatureHead}`
        + ' :refs/heads/feat/example',
    )
    const detach = operations.indexOf(`git switch --detach ${fake.repository.featureHead}`)
    const proveDetached = operations.indexOf('git symbolic-ref --quiet HEAD')
    const deleteBranch = operations.indexOf('git branch -D feat/example')
    const prune = operations.indexOf('git worktree prune')

    Expect(fullVerify).toBeGreaterThan(0)
    Expect(fake.calls[fullVerify]?.stdio).toBe('inherit')
    Expect(squash).toBeGreaterThan(fullVerify)
    Expect(treeProof).toBeGreaterThan(squash)
    Expect(verify).toBe(-1)
    Expect(fake.lines.some(line => line.includes('equals the fully verified feature tree'))).toBe(true)
    Expect(commit).toBeGreaterThan(treeProof)
    Expect(push).toBeGreaterThan(commit)
    Expect(archive).toBeGreaterThan(push)
    Expect(deleteRemote).toBeGreaterThan(archive)
    Expect(detach).toBeGreaterThan(deleteRemote)
    Expect(proveDetached).toBeGreaterThan(detach)
    Expect(deleteBranch).toBeGreaterThan(proveDetached)
    Expect(prune).toBeGreaterThan(deleteBranch)
    Expect(operations.some(operation => operation.startsWith('git worktree remove '))).toBe(false)
    Expect(outcome.mode).toBe('executed')
    Expect(outcome.lines).toEqual([
      "PASS  Merged 'feat/example' into main and archived it as merged/example.",
      'PASS  Preserved the clean invoking worktree at /repo-feature on detached HEAD; '
      + 'archive its owning task when you are ready to remove it.',
    ])
    Expect(outcome.snapshotPath).toMatch(
      /^\/repo-main\/\.artifacts\/merge\/2026-09-03T14-15-16-789Z-[0-9a-f]{8}\.json$/u,
    )
    const completedSnapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(completedSnapshot.phase).toBe('complete')
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
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} main:main`,
    )
  })

  Test('--skip-verify-full verifies the staged squash on main instead of the feature branch', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
      skipVerifyFull: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    // Nothing else verified this branch, so the staged squash is where verification happens.
    Expect(operations).not.toContain('just verify-full')
    Expect(operations.indexOf('just verify --complete')).toBeGreaterThan(
      operations.findIndex(operation => operation.startsWith('git merge --squash')),
    )
    Expect(operations.indexOf('just verify --complete')).toBeLessThan(
      operations.findIndex(operation => operation.startsWith('git commit -F')),
    )
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
    Expect(
      fake.calls.filter(call =>
        ['branch', 'commit', 'fetch', 'merge', 'push', 'reset', 'switch'].includes(call.args[0]!)
        || (call.args[0] === 'worktree' && call.args[1] === 'prune')
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

  Test('refuses a mismatched squash tree before verify or commit under every flag combination', async () => {
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
      Expect(fake.calls.some(call => call.command === 'just' && call.args[0] === 'verify')).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'commit')).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
      Expect(([...fake.snapshots.values()][0] as MergeSnapshot).phase).toBe('squashed')
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
    Expect(operations.indexOf('git merge --ff-only origin/main')).toBeGreaterThan(
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
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--squash')).toBe(false)
    Expect(([...fake.snapshots.values()].at(-1) as MergeSnapshot).phase).toBe('failed')
  })

  Test('refuses to adopt worktree changes that appear while validation is running', async () => {
    const fake = fakeDependencies()
    const run = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const outcome = await run(command, spec)
      if (command === 'just' && spec.args?.[0] === 'verify-full') {
        fake.repository.mainStatus = '?? someone-elses-file.ts\n'
      }
      return outcome
    }

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('changed while validation was running')

    const snapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(snapshot.phase).toBe('prepared')
    Expect(snapshot.currentMainStatus).toBe('')
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--squash')).toBe(false)
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
    }, fake.dependencies)).rejects.toThrow('committed main tree does not equal')
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
  })

  Test('keeps the archived recovery boundary when preserving the worktree fails', async () => {
    const fake = fakeDependencies({ failDetach: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)

    const snapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(snapshot.phase).toBe('archived')
    Expect(fake.calls.some(call => call.args[0] === 'branch' && call.args[1] === '-D')).toBe(false)
    Expect(fake.repository.branch).toBe('feat/example')
  })

  Test('records and aborts a failed feature integration without adopting the other worktree', async () => {
    const fake = fakeDependencies({ ancestorExitCodes: [0, 1], failFeatureMerge: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    const snapshot = stored as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentFeatureStatus).toBe('UU example.ts\n')
    Expect(snapshot.currentMainStatus).toBe('')

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
    Expect(snapshot.currentMainStatus).toBe('UU example.ts\n')

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.repository.mainStatus).toBe('')
  })

  Test('guarded abort restores only a snapshot whose recorded state still matches', async () => {
    const fake = fakeDependencies({
      featureHead: 'integrated-feature',
      mainHead: 'main-before',
      mainStatus: 'M  staged.ts\n',
      stagedTree: 'staged-tree',
    })
    const snapshotPath = '/repo-main/.artifacts/merge/snapshot.json'
    const snapshot: MergeSnapshot = {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: 'integrated-feature',
      currentFeatureStatus: '',
      currentMainDiff: 'M  staged.ts\n',
      currentMainHead: 'main-before',
      currentMainStatus: 'M  staged.ts\n',
      featureHead: 'feature-before',
      featureIndexTree: 'staged-tree',
      featureRoot: '/repo-feature',
      featureTree: 'staged-tree',
      mainHead: 'main-before',
      mainIndexTree: 'staged-tree',
      mainRoot: '/repo-main',
      mainTree: 'staged-tree',
      messageFile: '/message',
      phase: 'squashed',
      remoteMainHead: 'main-before',
      snapshotPath,
      stagedTree: 'staged-tree',
      version: 1,
    }
    fake.snapshots.set(snapshotPath, snapshot)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.calls.filter(call => call.args[0] === 'reset').map(call => call.args.slice(0, 3))).toEqual([
      ['reset', '--hard', 'main-before'],
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
        abortSnapshot: '/repo-main/.artifacts/merge/snapshot.json',
      }, fake.dependencies)).rejects.toThrow('--abort cannot be combined')
      Expect(fake.calls).toEqual([])
      Expect(fake.snapshots.size).toBe(0)
    }
  })

  Test('never auto-aborts after main was pushed', async () => {
    const fake = fakeDependencies()
    const snapshotPath = '/repo-main/.artifacts/merge/pushed.json'
    fake.snapshots.set(snapshotPath, {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: fake.repository.featureHead,
      currentFeatureStatus: '',
      currentMainDiff: '',
      currentMainHead: fake.repository.mainHead,
      currentMainStatus: '',
      featureHead: fake.repository.featureHead,
      featureIndexTree: fake.repository.tree,
      featureRoot: '/repo-feature',
      featureTree: fake.repository.tree,
      mainHead: fake.repository.mainHead,
      mainIndexTree: fake.repository.tree,
      mainRoot: '/repo-main',
      mainTree: fake.repository.tree,
      messageFile: '/message',
      phase: 'pushed',
      remoteMainHead: fake.repository.remoteMainHead,
      snapshotPath,
      version: 1,
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

      const dependencies: MergeWithMainDependencies = {
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
      Expect(await FS.exists(featureRoot)).toBe(true)
      Expect((await gitResult(featureRoot, ['status', '--porcelain'])).stdout).toBe('')
      Expect((await gitResult(featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/merged/integration']))
          .stdout.trim(),
      )
      Expect((await gitResult(featureRoot, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1)
      Expect((await gitResult(mainRoot, ['branch', '--list', 'feat/integration'])).stdout).toBe('')
      Expect((await gitResult(mainRoot, ['status', '--porcelain'])).stdout).toBe('')
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
