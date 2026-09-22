import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import type { MachineResourceOwner } from '../verification-src/MachineLanes'
import {
  landedReport,
  LandingIntegrationConflictError,
  type MergeCommandRunner,
  type MergeSnapshot,
  MergeWithMainCommand,
  type MergeWithMainDependencies,
  parseWorktrees,
  validateMergeMessage,
} from '../verification-src/MergeWithMain'
import { buildSummary, formatGateSummary } from '../verification-src/RunSummary'
import { WorkGraph, type WorkNode, type WorkState } from '../verification-src/WorkGraph'

type FakeRepository = {
  ancestorExitCodes?: number[]
  branch: string
  failDetach?: boolean
  failFeatureMerge?: boolean
  failMainPush?: boolean
  failRemoteQuery?: { exitCode?: number; stderr: string }
  featureHead: string
  featureRoot: string
  featureStatus: string
  /** Whether a local `main` ref exists at all. */
  hasLocalMain?: boolean
  /** A worktree that still has main checked out, which a landing must refuse. */
  mainWorktreeRoot?: string
  /** A detached mirror worktree: its path, the commit it sits at, and whether it is clean. */
  mirrorRoot?: string
  mirrorHead?: string
  mirrorStatus?: string
  failMirrorMove?: boolean
  /** Where `refs/heads/main` points. No worktree holds it. */
  mainHead: string
  /** The commit `commit-tree` produces, and the tree it is asked to carry. */
  builtHead: string
  builtTree?: string
  remoteFeatureHead?: string
  remoteMainHead: string
  remoteMainSequence?: string[]
  tree: string
}

function result(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  stdout = '',
  exitCode = 0,
  stderr = '',
) {
  return { args: [...args], command, cwd, error: undefined, exitCode, signal: null, stderr, stdout }
}

/** A `just verify-full` node, standing in for what `./dev gates` reports for one of its own. */
function laneState(node: Partial<WorkNode> & { name: string }, outcome: Partial<WorkState> = {}): WorkState {
  return {
    ...WorkGraph.createState({ run: { args: [], command: 'true' }, ...node }),
    elapsedMs: 1_000,
    exitCode: 0,
    status: 'passed',
    ...outcome,
  }
}

/** What a passing `just verify-full` prints, real enough to exercise `extractLaneReport` against. */
function verifyFullPassingOutput(): string {
  const summary = buildSummary({
    elapsedMs: 58_200,
    lane: 'verify-full',
    logRoot: '/repo/.artifacts/logs/verify-full/stamp',
    states: [laneState({ name: '_typecheck' })],
  })
  return formatGateSummary(summary)
}

/** What a failing `just verify-full` prints, with one Bun test failure `extractLaneReport` can name. */
function verifyFullFailingOutput(): string {
  const summary = buildSummary({
    elapsedMs: 12_000,
    lane: 'verify-full',
    logRoot: '/repo/.artifacts/logs/verify-full/stamp',
    states: [
      laneState({ name: '_typecheck' }),
      laneState({ name: 'shared' }, {
        exitCode: 1,
        fullOutput: 'error: expect(received).toBe(expected)\n(fail) renders the board [12.00ms]',
        status: 'failed',
      }),
    ],
  })
  return formatGateSummary(summary)
}

const realOwner: MachineResourceOwner = {
  command: 'merge-with-main feat/integration',
  id: 'landing-fixture',
  name: 'merge-with-main-landing',
  pid: 4242,
  repositoryRoot: '/repo-feature',
  startedAt: '2026-09-19T12:00:00.000Z',
}

/** A landing lease the tests drive: it counts acquisitions and releases so both can be asserted. */
function fakeLeases() {
  const state = { acquired: 0, released: 0 }
  const take = () => {
    state.acquired += 1
    return {
      owner: realOwner,
      release: async () => {
        state.released += 1
      },
    }
  }
  return { state, take }
}

function fakeDependencies(overrides: Partial<FakeRepository> = {}) {
  const leases = fakeLeases()
  const repository: FakeRepository = {
    branch: 'feat/example',
    builtHead: 'commit00000000000000000000000000000000000',
    featureHead: 'feature00000000000000000000000000000000000',
    featureRoot: '/repo-feature',
    featureStatus: '',
    mainHead: 'main000000000000000000000000000000000000',
    remoteFeatureHead: 'feature00000000000000000000000000000000000',
    remoteMainHead: 'main000000000000000000000000000000000000',
    tree: 'tree000000000000000000000000000000000000',
    ...overrides,
  }
  // A mirror is detached, so its HEAD is a commit of its own: it stays where it is when main moves,
  // exactly as a real detached worktree does, until something checks a new commit out in it.
  repository.mirrorHead ??= repository.mainHead
  const calls: Array<{ args: string[]; command: string; cwd?: string; stdio?: CLI.CommandStdio }> = []
  const files = new Map<string, string>([
    [
      '/repo-feature/.artifacts/merge/feat/example.msg',
      'Land example\n\n- Add the example workflow.\n- Prove its safety.\n',
    ],
    [
      '/repo-feature/.artifacts/testing/ledger.json',
      JSON.stringify({ lastFullRunStartedAt: '2026-09-03T13:00:00.000Z' }),
    ],
  ])
  const snapshots = new Map<string, unknown>()
  const moves: Array<{ fromPath: string; toPath: string }> = []
  const lines: string[] = []
  const successLines: string[] = []
  /** The phases the landing reported, in order, which is what the lock exposes to the board. */
  const phases: string[] = []
  const lockState = { durableClaimsEnded: 0, phasesEnded: 0 }
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
    const inMirror = spec.cwd === repository.mirrorRoot
    if (joined === 'symbolic-ref --quiet --short HEAD') {
      return result(command, args, spec.cwd, `${repository.branch}\n`)
    }
    if (joined === 'status --porcelain=v1 --untracked-files=all' || joined === 'diff --no-ext-diff --binary HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        inMirror ? repository.mirrorStatus ?? '' : repository.featureStatus,
      )
    }
    if (joined === 'rev-parse HEAD') {
      return result(
        command,
        args,
        spec.cwd,
        `${inMirror ? repository.mirrorHead : repository.featureHead}\n`,
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
          ...(repository.mainWorktreeRoot === undefined ? [] : [
            `worktree ${repository.mainWorktreeRoot}`,
            `HEAD ${repository.mainHead}`,
            'branch refs/heads/main',
            '',
          ]),
          ...(repository.mirrorRoot === undefined ? [] : [
            `worktree ${repository.mirrorRoot}`,
            `HEAD ${repository.mirrorHead}`,
            'detached',
            '',
          ]),
        ].join('\n'),
      )
    }
    if (args[0] === 'ls-remote') {
      if (repository.failRemoteQuery !== undefined) {
        return result(
          command,
          args,
          spec.cwd,
          '',
          repository.failRemoteQuery.exitCode ?? 128,
          repository.failRemoteQuery.stderr,
        )
      }
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
    if (joined === 'diff --name-only --diff-filter=U') {
      // What a conflicted merge leaves behind, derived from the same status the fake already keeps,
      // so a test cannot set one without the other.
      return result(
        command,
        args,
        spec.cwd,
        repository.featureStatus.split('\n').filter(Boolean)
          .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU'))
          .map(line => line.slice(3))
          .join('\n'),
      )
    }
    if (joined === 'log -1 --format=%cI HEAD') {
      return result(command, args, spec.cwd, '2026-09-03T12:00:00.000Z\n')
    }
    if (args[0] === 'log' && args.length === 2) {
      return result(command, args, spec.cwd, 'commit abc\nAuthor: A <a@example.com>\n\n    Add example\n')
    }
    if (joined === 'fetch --prune origin') {
      repository.remoteMainHead = advertisedRemoteMain
      return result(command, args, spec.cwd)
    }
    if (joined === 'rev-parse --verify --quiet refs/heads/main') {
      return repository.hasLocalMain === false
        ? result(command, args, spec.cwd, '', 1)
        : result(command, args, spec.cwd, `${repository.mainHead}\n`)
    }
    if (joined === 'rev-parse refs/heads/main') {
      return result(command, args, spec.cwd, `${repository.mainHead}\n`)
    }
    if (joined === 'rev-parse origin/main') {
      return result(command, args, spec.cwd, `${repository.remoteMainHead}\n`)
    }
    if (args[0] === 'rev-parse' && args[1]?.endsWith('^{tree}')) {
      const of = args[1]!.slice(0, -'^{tree}'.length)
      return result(
        command,
        args,
        spec.cwd,
        `${of === repository.builtHead ? repository.builtTree ?? repository.tree : repository.tree}\n`,
      )
    }
    if (joined === 'write-tree') {
      return result(command, args, spec.cwd, `${repository.tree}\n`)
    }
    if (args[0] === 'commit-tree') {
      return result(command, args, spec.cwd, `${repository.builtHead}\n`)
    }
    if (args[0] === 'update-ref') {
      // The compare-and-swap Git itself performs: refuse unless main is still where it was.
      const [next, expected] = [args[4]!, args[5]!]
      if (expected !== repository.mainHead) {
        return result(command, args, spec.cwd, '', 1)
      }
      repository.mainHead = next
      return result(command, args, spec.cwd)
    }
    if (args[0] === 'checkout' && args[1] === '--detach') {
      if (repository.failMirrorMove === true) {
        return result(command, args, spec.cwd, '', 1)
      }
      repository.mirrorHead = args[2]!
      return result(command, args, spec.cwd)
    }
    if (joined.startsWith('merge --no-edit ')) {
      if (repository.failFeatureMerge === true) {
        repository.featureStatus = 'UU example.ts\n'
        return result(command, args, spec.cwd, '', 1)
      }
      repository.featureHead = 'integrated-feature0000000000000000000000000'
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
    acquireLease: async () => leases.take(),
    askConfirm: async () => true,
    beginPhase: async (_repositoryRoot, name) => {
      phases.push(name)
    },
    endDurableClaim: async () => {
      lockState.durableClaimsEnded += 1
    },
    endPhases: async () => {
      lockState.phasesEnded += 1
    },
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
    writeLine: (line, kind) => {
      lines.push(line)
      if (kind === 'success') {
        successLines.push(line)
      }
    },
    writeText: async (path, value) => {
      files.set(path, value)
    },
  }
  return {
    calls,
    dependencies,
    files,
    leases: leases.state,
    lines,
    lockState,
    moves,
    phases,
    repository,
    snapshots,
    successLines,
  }
}

Describe('merge-with-main', () => {
  Test('landed report reads the broker archive instead of stale local refs', async () => {
    const fake = fakeDependencies()
    const queried: string[][] = []
    fake.dependencies.inspectRemote = async (_root, branches) => {
      queried.push([...branches])
      return { refs: new Map([['merged/example', fake.repository.featureHead]]) }
    }

    Expect(await landedReport('feat/example', fake.dependencies, fake.repository.featureRoot)).toEqual({
      archive: 'merged/example',
      branch: 'feat/example',
      landed: true,
    })
    Expect(queried).toEqual([['merged/example']])
    Expect(fake.calls).toEqual([])

    fake.dependencies.inspectRemote = async () => ({ refs: new Map() })
    Expect((await landedReport('feat/example', fake.dependencies, fake.repository.featureRoot)).landed).toBe(false)
  })

  Test('landed report does not mistake an unavailable remote for an absent archive', async () => {
    const fake = fakeDependencies({ failRemoteQuery: { stderr: 'credential denied' } })
    await Expect(landedReport('feat/example', fake.dependencies, fake.repository.featureRoot))
      .rejects.toThrow(Errors.CommandExecutionError)
  })

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

  Test('plans the landing when no checkout has main, and creates nothing to say so', async () => {
    const fake = fakeDependencies()
    const result = await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(result.mode).toBe('dry-run')
    Expect(
      fake.lines.some(line =>
        line.startsWith('PASS  No worktree has main checked out;') && line.includes('local main is at ')
      ),
    ).toBe(true)
    Expect(fake.lines).toContain('PASS  Local main is already at origin/main.')
    Expect(fake.lines).toContain('PASS  origin/main is an ancestor of the feature branch.')
    // The plan says the lock is taken once and that everything after it is one process, because that
    // boundary is the whole shape of the command and a dry run is where a reader learns it.
    Expect(
      fake.lines.some(line =>
        line.startsWith('PLAN  Take the machine-wide landing lock')
        && line.includes('inside one process, under that lock')
      ),
    ).toBe(true)
    Expect(fake.lines.some(line => line.startsWith('PLAN  Run the cheap-gate barrier'))).toBe(true)
    Expect(fake.lines.some(line => line.startsWith('PLAN  Build the squash commit with git commit-tree'))).toBe(true)
    // A dry run says what it would do and does none of it.
    Expect(fake.calls.some(call => call.args[0] === 'commit-tree' || call.args[0] === 'update-ref')).toBe(false)
  })

  Test('refuses to land while any worktree has main checked out', async () => {
    // A checked-out branch promises that a worktree's files match it, and a landing moves the ref
    // out from under that promise. Worse, a shared checkout is where another agent's commit once
    // picked up a landing's staged squash and put it on main as its own.
    const fake = fakeDependencies({ mainWorktreeRoot: '/repo-main' })

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow("No worktree may have 'main' checked out while landing")
    Expect(fake.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
  })

  Test('moves a clean detached mirror forward with main', async () => {
    const fake = fakeDependencies({ mirrorRoot: '/repo-main-mirror' })

    const result = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(result.mode).toBe('executed')
    Expect(fake.repository.mirrorHead).toBe(fake.repository.builtHead)
    Expect(fake.lines.some(line => line.startsWith('PASS  Moved the main mirror at /repo-main-mirror'))).toBe(true)
  })

  Test('leaves a mirror alone once someone has worked in it, and still lands', async () => {
    const fake = fakeDependencies({ mirrorRoot: '/repo-main-mirror', mirrorStatus: ' M notes.md\n' })

    const result = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(result.mode).toBe('executed')
    Expect(fake.repository.mirrorHead).toBe('main000000000000000000000000000000000000')
    Expect(fake.calls.some(call => call.args[0] === 'checkout')).toBe(false)
  })

  Test('reports a mirror it could not move without failing the landing', async () => {
    const fake = fakeDependencies({ failMirrorMove: true, mirrorRoot: '/repo-main-mirror' })

    const result = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(result.mode).toBe('executed')
    Expect(
      fake.lines.some(line => line.startsWith('WARN  Could not move the main mirror at /repo-main-mirror')),
    ).toBe(true)
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
    Expect(fake.lines).toContain('PLAN  Run just verify-full on the feature branch.')
    Expect(fake.lines).toContain(
      'PLAN  Land the verified feature tree itself; full verification proved exactly those bytes.',
    )
    Expect(fake.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main',
    )
    Expect(fake.snapshots.size).toBe(0)
  })

  Test('reports a sandbox-denied remote query as an environment failure with its recovery', async () => {
    const fake = fakeDependencies({
      failRemoteQuery: {
        stderr: 'hostkeys_foreach failed for /Users/example/.ssh/known_hosts: Operation not permitted',
      },
    })
    let failure: unknown
    try {
      await MergeWithMainCommand.run(
        { dryRun: true, repositoryRoot: fake.repository.featureRoot },
        fake.dependencies,
      )
    } catch (error) {
      failure = error
    }

    Expect(failure).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.messageOf(failure)).toContain('sandbox denied')
    Expect(Errors.messageOf(failure)).toContain('just landing-setup')
    Expect(fake.calls.some(call => call.args[0] === 'fetch')).toBe(false)
    Expect(fake.snapshots.size).toBe(0)
  })

  Test('preserves an ordinary remote failure as a command failure', async () => {
    const fake = fakeDependencies({
      failRemoteQuery: { stderr: 'fatal: Could not read from remote repository.' },
    })

    await Expect(MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )).rejects.toThrow(Errors.CommandExecutionError)
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
      'PLAN  Run just verify --complete on the feature branch, because nothing else verified it.',
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
      'PLAN  Skip just verify --complete because --skip-all was passed; '
        + 'no lane will have verified these bytes.',
    )
    Expect(skipAll.lines).toContain('PLAN  Ask once, defaulting to No, whether to merge with nothing verified at all.')
    Expect(skipAll.lines.at(-1)).toBe(
      'DRY RUN  No refs or worktrees changed. Land it with: ./dev merge-with-main --skip-all',
    )
  })

  Test('lands a branch whose local main is behind the remote, catching up inside the lock', async () => {
    // This used to be a refusal: preflight required local main to equal origin/main, so a landing
    // that had already paid for a full verification lost the race to whoever moved main first. The
    // catching-up is now the landing's own work, done under the lock where it cannot go stale.
    const stale = fakeDependencies({ remoteMainHead: 'new-main' })

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: stale.repository.featureRoot },
      stale.dependencies,
    )

    Expect(outcome.mode).toBe('executed')
    // The fetch happens after the lock, not before it: nothing this landing learned can be stale.
    Expect(stale.calls.some(call => call.args[0] === 'fetch')).toBe(true)
    Expect(stale.lines.some(line => line.startsWith('PASS  Landing lock held for'))).toBe(true)
  })

  Test('reports a behind local main and an unintegrated main as plan rather than refusal', async () => {
    const stale = fakeDependencies({ ancestorExitCodes: [1], remoteMainHead: 'new-main' })

    const result = await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: stale.repository.featureRoot },
      stale.dependencies,
    )

    Expect(result.mode).toBe('dry-run')
    Expect(stale.lines).toContain('PLAN  Fast-forward local main to origin/main (new-main) inside the lock.')
    Expect(stale.lines).toContain("PLAN  Merge origin/main into 'feat/example' inside the lock, before any gate runs.")
  })

  Test('takes the landing lock before moving any ref and releases it on success', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(outcome.mode).toBe('executed')
    Expect(fake.leases.acquired).toBe(1)
    Expect(fake.leases.released).toBe(1)
    Expect(fake.lines.some(line => line.includes('Landing lock held for'))).toBe(true)
    // Every phase the lock was spent on, in order, is what makes a hold's length readable on the
    // board instead of something a person has to reconstruct from what an agent said it was doing.
    Expect(fake.phases).toEqual(['integrating', 'cheap gates', 'repository tests', 'push', 'cleanup'])
    // And the open phase is closed when the transaction ends, so a finished landing does not read
    // as one still in `cleanup` forever.
    Expect(fake.lockState.phasesEnded).toBe(1)
    Expect(fake.lockState.durableClaimsEnded).toBe(0)
  })

  Test('releases the landing lease when the landing fails', async () => {
    const fake = fakeDependencies({ failMainPush: true })

    await Expect(MergeWithMainCommand.run(
      { repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )).rejects.toThrow()

    Expect(fake.leases.acquired).toBe(1)
    Expect(fake.leases.released).toBe(1)
  })

  Test('takes no landing lease for a dry run, which moves nothing', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run(
      { dryRun: true, repositoryRoot: fake.repository.featureRoot },
      fake.dependencies,
    )

    Expect(outcome.mode).toBe('dry-run')
    Expect(fake.leases.acquired).toBe(0)
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
    Expect(operations.some(operation => operation.startsWith('git commit-tree '))).toBe(true)
    Expect(operations.some(operation => operation.startsWith('git update-ref '))).toBe(true)
    Expect(operations).toContain(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} main:main`,
    )
    Expect(operations).toContain(
      'git push origin --force-with-lease=refs/heads/merged/example: feat/example:refs/heads/merged/example',
    )
    Expect(operations).toContain('git branch -D feat/example')
    Expect(fake.repository.mainHead).toBe('commit00000000000000000000000000000000000')
    Expect(([...fake.snapshots.values()][0] as MergeSnapshot).phase).toBe('complete')
    // The cheap-gate barrier first, then exactly one expensive lane, both invoked without
    // --no-cache so either may reuse a green record for this tree.
    Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([
      ['land-barrier'],
      ['verify-full'],
    ])
  })

  Test(
    'runs the cheap-gate barrier before the expensive lane and releases without running it when it fails',
    async () => {
      const fake = fakeDependencies()
      const underlying = fake.dependencies.run
      fake.dependencies.run = async (command, spec) => {
        if (command === 'just' && spec.args?.[0] === 'land-barrier') {
          await underlying(command, spec)
          return {
            args: [...(spec.args ?? [])],
            command,
            cwd: spec.cwd,
            error: undefined,
            exitCode: 1,
            signal: null,
            stderr: '',
            stdout: '',
          }
        }
        return await underlying(command, spec)
      }

      await Expect(MergeWithMainCommand.run(
        { repositoryRoot: fake.repository.featureRoot },
        fake.dependencies,
      )).rejects.toThrow()

      // The point of the barrier: a red cheap gate costs ~30s, and the suites behind it are never
      // started to learn the same thing.
      Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([['land-barrier']])
      Expect(fake.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
      // And the lock goes back, because a failed landing that keeps it blocks the whole machine.
      Expect(fake.leases.released).toBe(1)
      Expect(fake.phases).toEqual(['integrating', 'cheap gates'])
    },
  )

  Test('executes verification and pushes before preserving the invoking worktree and cleaning refs', async () => {
    const fake = fakeDependencies()
    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    const fullVerify = operations.indexOf('just verify-full')
    // The landed tree is the tree full verification just proved, so it is not verified again.
    const verify = operations.indexOf('just verify --complete')
    const build = operations.findIndex(operation => operation.startsWith('git commit-tree '))
    const commit = operations.findIndex(operation => operation.startsWith('git update-ref '))
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
    Expect(build).toBeGreaterThan(fullVerify)
    Expect(verify).toBe(-1)
    Expect(fake.lines.some(line => line.includes('Landing the fully verified feature tree'))).toBe(true)
    Expect(commit).toBeGreaterThan(build)
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
    Expect(fake.successLines).toEqual(outcome.lines)
    Expect(outcome.snapshotPath).toMatch(
      /^\/repo-feature\/\.artifacts\/merge\/2026-09-03T14-15-16-789Z-[0-9a-f]{8}\.json$/u,
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
    // `stream` used to forward a nested lane's own output live, which a non-interactive landing has
    // no terminal to show as it arrives; `pipe` still captures every byte for `extractLaneReport`.
    Expect(verificationCalls.map(call => call.stdio)).toEqual(['pipe'])
    Expect(outcome.mode).toBe('executed')
    Expect(fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)).toContain(
      `git push origin --force-with-lease=refs/heads/main:${fake.repository.remoteMainHead} main:main`,
    )
  })

  Test("a non-interactive landing reports a passing lane's verdict instead of its raw output", async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'verify-full') {
        return { ...await underlying(command, spec), stdout: verifyFullPassingOutput() }
      }
      return await underlying(command, spec)
    }

    await MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies)

    Expect(fake.lines).toContain('verify-full: PASSED in 58.2s')
    Expect(fake.lines.some(line => line.startsWith('Logs: ') && line.endsWith('verify-full/stamp'))).toBe(true)
    Expect(fake.lines.some(line => line.startsWith('Summary: ') && line.endsWith('verify-full/stamp/summary.json')))
      .toBe(true)
    // The full rollup — every gate's own line, warnings, the schedule — is exactly what streaming it
    // live used to flood a non-interactive caller's own output with; none of it belongs here.
    Expect(fake.lines.some(line => line.includes('_typecheck: passed'))).toBe(false)
  })

  Test("a non-interactive landing repeats the failed lane's Failed: block in its own error", async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'verify-full') {
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: 1,
          signal: null,
          stderr: '',
          stdout: verifyFullFailingOutput(),
        }
      }
      return await underlying(command, spec)
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow()

    Expect(fake.lines).toContain('verify-full: FAILED in 12.0s — first failure: shared')
    Expect(fake.lines).toContain('Failed:')
    Expect(fake.lines.some(line => line.includes('shared › renders the board'))).toBe(true)
    // The rollup and the raw tail are what the flood used to consist of; still absent here.
    Expect(fake.lines.some(line => line.includes('_typecheck: passed'))).toBe(false)
  })

  Test('a non-interactive landing names the spawn error a nested lane itself failed with', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    const spawnError = new Errors.HostEnvironmentError('spawn just ENOENT')
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'land-barrier') {
        await underlying(command, spec)
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: spawnError,
          exitCode: null,
          signal: null,
          stderr: '',
          stdout: '',
        }
      }
      return await underlying(command, spec)
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow()

    // Before this fix, only `result.stdout` was read — empty here — so a landing that never even
    // spawned `just` printed nothing at all before `Command failed: just land-barrier`.
    Expect(fake.lines.some(line => line.includes('Spawn error: spawn just ENOENT'))).toBe(true)
  })

  Test("a non-interactive landing shows a nested lane's stderr when it never wrote to stdout", async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'land-barrier') {
        await underlying(command, spec)
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: 1,
          signal: null,
          stderr: 'error: Recipe `land-barrier` was not found.\n',
          stdout: '',
        }
      }
      return await underlying(command, spec)
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow()

    // `result.stdout` alone — what this read before the fix — was empty here; only `result.stderr`
    // named the reason, and nothing printed it.
    Expect(fake.lines.some(line => line.includes('Recipe `land-barrier` was not found'))).toBe(true)
  })

  Test('a non-interactive landing still names context for a lane that dies before its own verdict', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'land-barrier') {
        await underlying(command, spec)
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: null,
          signal: 'SIGKILL',
          stderr: '',
          stdout: 'Checking dprint...\nChecking Tao source...\nChecking repo-lint...\n',
        }
      }
      return await underlying(command, spec)
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow()

    // No PASSED/FAILED verdict and no Failed: block ever arrived, so this is the raw-tail fallback;
    // it still names the last thing the lane was doing rather than nothing.
    Expect(fake.lines.some(line => line.includes('Checking repo-lint'))).toBe(true)
  })

  Test('a non-interactive landing names a dead-exports issue line from the cheap-gate barrier', async () => {
    const fake = fakeDependencies()
    fake.dependencies.isInteractive = () => false
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'just' && spec.args?.[0] === 'land-barrier') {
        await underlying(command, spec)
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: 1,
          signal: null,
          stderr: '',
          stdout: [
            'Checking dprint...',
            'Checking Tao source...',
            "dead exports: packages/testing/verification/verification-src/Example.ts:42 export 'unused' is never imported",
          ].join('\n'),
        }
      }
      return await underlying(command, spec)
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow()

    // `dead-exports` runs as a raw script rather than through `./dev gates`, so its output matches
    // none of `extractLaneReport`'s structured formats and falls back to the same raw tail every
    // other failed log's reader gets — which still has to name at least one issue.
    Expect(fake.lines.some(line => line.startsWith('dead exports: '))).toBe(true)
  })

  Test('uses the credential-isolated broker for every remote read and one atomic landing', async () => {
    const fake = fakeDependencies()
    const pushes: unknown[] = []
    fake.dependencies.inspectRemote = async (_root, branches) => ({
      refs: new Map(branches.flatMap(branch => {
        if (branch === 'main') {
          return [[branch, fake.repository.remoteMainHead]]
        }
        if (branch === fake.repository.branch) {
          return [[branch, fake.repository.remoteFeatureHead!]]
        }
        return []
      })),
    })
    fake.dependencies.pushRemote = async (_root, push) => {
      pushes.push(push)
      return {
        refs: new Map([
          ['main', fake.repository.builtHead],
          ['merged/example', fake.repository.featureHead],
        ]),
      }
    }

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)

    Expect(outcome.mode).toBe('executed')
    Expect(pushes).toHaveLength(1)
    Expect(pushes[0]).toMatchObject({
      branch: 'feat/example',
      expectedRemoteFeatureHead: fake.repository.remoteFeatureHead,
      expectedRemoteMainHead: fake.repository.remoteMainHead,
      featureHead: fake.repository.featureHead,
      landedHead: fake.repository.builtHead,
    })
    Expect(fake.calls.some(call => call.args[0] === 'ls-remote' || call.args[0] === 'fetch')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
  })

  Test('--skip-verify-full verifies the staged squash on main instead of the feature branch', async () => {
    const fake = fakeDependencies()

    const outcome = await MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
      skipVerifyFull: true,
    }, fake.dependencies)

    const operations = fake.calls.map(call => `${call.command} ${call.args.join(' ')}`)
    // Nothing else verified this branch, so this is where verification happens — on the feature
    // worktree, which is the only checkout a landing involves.
    Expect(operations).not.toContain('just verify-full')
    Expect(fake.calls.find(call => call.command === 'just')?.cwd).toBe(fake.repository.featureRoot)
    Expect(operations.indexOf('just verify --complete')).toBeLessThan(
      operations.findIndex(operation => operation.startsWith('git commit-tree')),
    )
    Expect(fake.lines).toContain(
      "WARN  Skipped just verify-full on 'feat/example' because --skip-verify-full "
        + 'was passed.',
    )
    Expect(outcome.mode).toBe('executed')
    // The barrier still runs, because skipping the expensive lane does not make a broken tree
    // landable; then exactly one lane, without --no-cache, so it may reuse a green record.
    Expect(fake.calls.filter(call => call.command === 'just').map(call => call.args)).toEqual([
      ['land-barrier'],
      ['verify', '--complete'],
    ])
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
    Expect(fake.lines.some(line => line.includes('Landing the fully verified feature tree'))).toBe(true)
    Expect(outcome.mode).toBe('executed')

    // The built commit must carry the tree that was verified, and that is checked before the ref
    // moves rather than trusted.
    const divergent = fakeDependencies({ builtTree: 'different-tree' })
    await Expect(MergeWithMainCommand.run({
      repositoryRoot: divergent.repository.featureRoot,
      skipVerify: true,
    }, divergent.dependencies)).rejects.toThrow('does not carry the verified tree')
    Expect(divergent.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
  })

  Test('stops before building anything when a peer moves main during verification', async () => {
    const fake = fakeDependencies()
    const runner = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const outcome = await runner(command, spec)
      if (command === 'just' && spec.args?.[0] === 'verify-full') {
        fake.repository.mainHead = 'peer00000000000000000000000000000000000000'
      }
      return outcome
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow('changed while validation was running')
    Expect(fake.calls.some(call => call.args[0] === 'commit-tree')).toBe(false)
    Expect(fake.repository.mainHead).toBe('peer00000000000000000000000000000000000000')
  })

  Test('refuses to move main when a peer landed between building the commit and moving the ref', async () => {
    // Two agents landing at once is the ordinary case on this machine. The expected old value in
    // update-ref makes the loser a clean refusal rather than a racing write, and the built commit
    // is simply never referenced by anything.
    const fake = fakeDependencies()
    const runner = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const outcome = await runner(command, spec)
      if (command === 'git' && spec.args?.[0] === 'commit-tree') {
        fake.repository.mainHead = 'peer00000000000000000000000000000000000000'
      }
      return outcome
    }

    await Expect(
      MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies),
    ).rejects.toThrow('while this landing was verifying')
    Expect(fake.repository.mainHead).toBe('peer00000000000000000000000000000000000000')
    Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
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
    Expect(operations.some(operation => operation.startsWith('git commit-tree '))).toBe(true)
    Expect(operations.some(operation => operation.startsWith('git update-ref '))).toBe(true)
    Expect(accepted.lines.some(line => line.includes('no lane verified these bytes'))).toBe(true)
    Expect(outcome.mode).toBe('executed')
  })

  Test('refuses a built commit whose tree is not the verified one, under every flag combination', async () => {
    for (
      const options of [
        {},
        { skipVerifyFull: true },
        { skipVerify: true },
        { skipAll: true },
        { skipVerifyFull: true, skipVerify: true },
      ]
    ) {
      const fake = fakeDependencies({ builtTree: 'different-tree' })
      await Expect(MergeWithMainCommand.run({
        ...options,
        repositoryRoot: fake.repository.featureRoot,
      }, fake.dependencies)).rejects.toThrow('does not carry the verified tree')
      Expect(fake.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'push')).toBe(false)
      Expect(fake.repository.mainHead).toBe('main000000000000000000000000000000000000')
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
    Expect(operations.indexOf(`git merge --no-edit ${movedMain}`)).toBeGreaterThan(
      operations.indexOf('just verify-full'),
    )
    Expect(operations.findLastIndex(operation => operation === 'just verify-full')).toBeGreaterThan(
      operations.indexOf(`git merge --no-edit ${movedMain}`),
    )
    // Main is a ref now, so catching up with the remote is a compare-and-swap, not a checkout.
    Expect(operations.findIndex(operation => operation.startsWith('git update-ref'))).toBeGreaterThan(
      operations.findLastIndex(operation => operation === 'just verify-full'),
    )
    Expect(fake.lines.some(line => line.includes('restarting full verification (pass 2/2)'))).toBe(true)
    // The restart re-runs the barrier too: a re-integrated tree is a different tree, and proving it
    // cheap before proving it expensively is the whole point of the barrier.
    Expect(operations.filter(operation => operation === 'just land-barrier')).toHaveLength(2)
  })

  Test('stops after the second verification restart when remote main never stabilizes', async () => {
    // Two, not three. Inside the lock main can only move by an outside push, so one restart absorbs
    // that and a second means main is moving faster than the machine can verify — which is a
    // situation to hand back rather than to keep paying a full expensive lane for.
    const originalMain = 'main000000000000000000000000000000000000'
    const fake = fakeDependencies({
      ancestorExitCodes: [0, 1, 1, 1],
      mainHead: originalMain,
      remoteMainHead: originalMain,
      remoteMainSequence: [originalMain, 'main-1', 'main-2', 'main-3'],
    })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('moved during 2 consecutive verification passes')

    Expect(fake.calls.filter(call => call.command === 'just' && call.args[0] === 'verify-full')).toHaveLength(2)
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--squash')).toBe(false)
    Expect(([...fake.snapshots.values()].at(-1) as MergeSnapshot).phase).toBe('failed')
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

    const snapshot = [...fake.snapshots.values()][0] as MergeSnapshot
    Expect(snapshot.phase).toBe('prepared')
    Expect(snapshot.currentFeatureStatus).toBe('')
    Expect(fake.calls.some(call => call.args[0] === 'commit-tree')).toBe(false)
  })

  Test('refuses an appendix with automated attribution before creating a commit', async () => {
    const fake = fakeDependencies()
    const run = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      const args = spec.args ?? []
      if (command === 'git' && args[0] === 'log' && args.length === 2) {
        return {
          args: [...args],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: 'commit abc\n\n    Add example\n\n    Co-Authored-By: Bot <bot@example.test>\n',
        }
      }
      return await run(command, spec)
    }

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('must not contain automated-author attribution')
    Expect(fake.calls.some(call => call.args[0] === 'commit-tree')).toBe(false)
  })

  Test('builds the squash message from the human file and the landed commits', async () => {
    const fake = fakeDependencies()

    await MergeWithMainCommand.run({ repositoryRoot: fake.repository.featureRoot }, fake.dependencies)

    const commitTree = fake.calls.find(call => call.args[0] === 'commit-tree')
    Expect(commitTree?.args.slice(0, 4)).toEqual([
      'commit-tree',
      fake.repository.tree,
      '-p',
      'main000000000000000000000000000000000000',
    ])
    const message = fake.files.get(commitTree!.args.at(-1)!)
    Expect(message?.startsWith('Land example\n\n- Add the example workflow.')).toBe(true)
    Expect(message).toContain('\n\nSquashed commit of the following:\n\ncommit abc\n')
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

  Test('a conflicting integration ends the lock and hands the conflicted worktree back', async () => {
    // Resolving a conflict is model turns, and holding the machine-wide lock through them would put
    // the long hold straight back inside the transaction it was moved out of. So the landing stops,
    // the lock goes back — durable claim included, since `release` alone survives one by design —
    // and the conflicted worktree is left exactly as Git wrote it.
    const fake = fakeDependencies({ ancestorExitCodes: [0, 1], failFeatureMerge: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(LandingIntegrationConflictError)

    Expect(fake.lockState.durableClaimsEnded).toBe(1)
    Expect(fake.leases.released).toBe(1)
    // Nothing expensive was started, and no ref moved.
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'update-ref' || call.args[0] === 'commit-tree')).toBe(false)

    const [snapshotPath, stored] = [...fake.snapshots.entries()][0]!
    const snapshot = stored as MergeSnapshot
    Expect(snapshot.phase).toBe('failed')
    Expect(snapshot.currentFeatureStatus).toBe('UU example.ts\n')
    Expect(snapshot.currentMainHead).toBe(fake.repository.mainHead)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    Expect(fake.repository.featureStatus).toBe('')
  })

  Test('names the conflicting paths and says the resolution happens unlocked', async () => {
    const fake = fakeDependencies({ ancestorExitCodes: [0, 1], failFeatureMerge: true })

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow('- example.ts')
    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fakeDependencies({ ancestorExitCodes: [0, 1], failFeatureMerge: true }).dependencies))
      .rejects.toThrow('Resolve them here, unlocked')
  })

  Test('a failed integration that recorded no conflict is not treated as one', async () => {
    // A merge the sandbox denied part-way leaves no unmerged entries. Calling that a conflict would
    // send its reader looking for something that is not there, and would end a durable lock claim
    // over a failure that has nothing to do with conflict resolution.
    const fake = fakeDependencies({ ancestorExitCodes: [0, 1] })
    const underlying = fake.dependencies.run
    fake.dependencies.run = async (command, spec) => {
      if (command === 'git' && spec.args?.[0] === 'merge') {
        return {
          args: [...(spec.args ?? [])],
          command,
          cwd: spec.cwd,
          error: undefined,
          exitCode: 1,
          signal: null,
          stderr: 'denied',
          stdout: '',
        }
      }
      return await underlying(command, spec)
    }

    await Expect(MergeWithMainCommand.run({
      repositoryRoot: fake.repository.featureRoot,
    }, fake.dependencies)).rejects.toThrow(Errors.CommandExecutionError)
    Expect(fake.lockState.durableClaimsEnded).toBe(0)
  })

  Test('guarded abort restores only a snapshot whose recorded state still matches', async () => {
    const fake = fakeDependencies({
      featureHead: 'integrated-feature',
      mainHead: 'main-before',
    })
    const snapshotPath = '/repo-feature/.artifacts/merge/snapshot.json'
    const snapshot: MergeSnapshot = {
      branch: 'feat/example',
      createdAt: '2026-09-03T14:15:16.789Z',
      currentFeatureDiff: '',
      currentFeatureHead: 'integrated-feature',
      currentFeatureStatus: '',
      currentMainHead: 'main-before',
      featureHead: 'feature-before',
      featureIndexTree: 'staged-tree',
      featureRoot: '/repo-feature',
      featureTree: 'staged-tree',
      mainHead: 'main-before',
      messageFile: '/message',
      phase: 'squashed',
      remoteMainHead: 'main-before',
      snapshotPath,
      version: 1,
    }
    fake.snapshots.set(snapshotPath, snapshot)

    const outcome = await MergeWithMainCommand.run({ abortSnapshot: snapshotPath }, fake.dependencies)
    Expect(outcome.mode).toBe('aborted')
    // Main never moved, so there is no ref to swap back: only the feature worktree is restored.
    Expect(fake.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
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
      currentMainHead: fake.repository.mainHead,
      featureHead: fake.repository.featureHead,
      featureIndexTree: fake.repository.tree,
      featureRoot: '/repo-feature',
      featureTree: fake.repository.tree,
      mainHead: fake.repository.mainHead,
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
    // The clone is detached below, which is what a mirror is: a checkout that shows what main holds
    // without holding the ref. Nothing here has main checked out once the landing starts.
    const mirrorRoot = FS.resolvePath('main', root)
    const featureRoot = FS.resolvePath('feature', root)
    try {
      await gitCommand(root, ['init', '--bare', remoteRoot])
      await gitCommand(root, ['clone', remoteRoot, mirrorRoot])
      await gitCommand(mirrorRoot, ['config', 'user.name', 'Tao Test'])
      await gitCommand(mirrorRoot, ['config', 'user.email', 'tao@example.test'])
      await FS.writeText(FS.resolvePath('.gitignore', mirrorRoot), '.artifacts/\n')
      await FS.writeText(FS.resolvePath('base.txt', mirrorRoot), 'base\n')
      await gitCommand(mirrorRoot, ['add', '.gitignore', 'base.txt'])
      await gitCommand(mirrorRoot, ['commit', '-m', 'Base'])
      await gitCommand(mirrorRoot, ['branch', '-M', 'main'])
      await gitCommand(mirrorRoot, ['push', '-u', 'origin', 'main'])
      await gitCommand(mirrorRoot, ['worktree', 'add', '-b', 'feat/integration', featureRoot])
      await gitCommand(mirrorRoot, ['checkout', '--detach', 'main'])
      await FS.writeText(FS.resolvePath('feature.txt', featureRoot), 'feature\n')
      await gitCommand(featureRoot, ['add', 'feature.txt'])
      await gitCommand(featureRoot, ['commit', '-m', 'Feature'])
      await gitCommand(featureRoot, ['push', '-u', 'origin', 'feat/integration'])
      await FS.writeText(
        FS.resolvePath('.artifacts/merge/feat/integration.msg', featureRoot),
        'Land integration fixture\n\n- Add the disposable feature.\n',
      )

      const realPhases: string[] = []
      const dependencies: MergeWithMainDependencies = {
        acquireLease: async () => ({ owner: realOwner, release: async () => {} }),
        askConfirm: async () => true,
        beginPhase: async (_repositoryRoot, name) => {
          realPhases.push(name)
        },
        endDurableClaim: async () => {},
        endPhases: async () => {},
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
      // On a real repository the transaction reports every phase it spends the lock on, in order.
      Expect(realPhases).toEqual(['integrating', 'cheap gates', 'push', 'cleanup'])
      Expect(await FS.exists(featureRoot)).toBe(true)
      Expect((await gitResult(featureRoot, ['status', '--porcelain'])).stdout).toBe('')
      Expect((await gitResult(featureRoot, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
        (await gitResult(root, ['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/merged/integration']))
          .stdout.trim(),
      )
      Expect((await gitResult(featureRoot, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1)
      Expect((await gitResult(featureRoot, ['branch', '--list', 'feat/integration'])).stdout).toBe('')
      const mainHead = (await gitResult(featureRoot, ['rev-parse', 'refs/heads/main'])).stdout.trim()
      // The mirror followed main without anyone touching it, and is still clean and still detached.
      Expect((await gitResult(mirrorRoot, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(mainHead)
      Expect((await gitResult(mirrorRoot, ['status', '--porcelain'])).stdout).toBe('')
      Expect((await gitResult(mirrorRoot, ['symbolic-ref', '--quiet', 'HEAD'])).exitCode).toBe(1)
      // The landed commit carries the feature tree, and says what it squashed.
      Expect((await gitResult(featureRoot, ['rev-parse', `${mainHead}^{tree}`])).stdout.trim())
        .toBe((await gitResult(featureRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim())
      const landedMessage = (await gitResult(featureRoot, ['log', '-1', '--format=%B', mainHead])).stdout
      Expect(landedMessage.startsWith('Land integration fixture\n\n- Add the disposable feature.\n')).toBe(true)
      Expect(landedMessage).toContain('Squashed commit of the following:')
      Expect(landedMessage).toContain('    Feature')
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
