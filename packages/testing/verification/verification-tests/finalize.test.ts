import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import {
  FinalizeCommand,
  type FinalizeDependencies,
  type FinalizeState,
  LandCommand,
  MergeMainCommand,
  prepareForLanding,
  recordMergeMessage,
  StartBranchCommand,
} from '../verification-src/Finalize'
import {
  GeneratedEvidence,
  type GeneratedEvidence as GeneratedEvidenceRecord,
} from '../verification-src/GeneratedEvidence'
import { validateMergeMessage } from '../verification-src/MergeWithMain'

type GreenTreeRecord = {
  at: string
  generated?: GeneratedEvidenceRecord
  logRoot: string
  toolchain: string
  treeHash: string
}

/** A fixed resolved-toolchain stand-in: fakes agree on this value everywhere a real run would read
 * `.devenv/profile`, so a test opts into a *different* value only when it means to prove that a
 * toolchain mismatch, not a tree change, is what should force a real run. */
const FAKE_TOOLCHAIN = 'fake-toolchain-abc'
const FAKE_GENERATED: GeneratedEvidenceRecord = {
  outputs: {
    'compiled-app': { inputs: 'compiled-inputs', outputs: 'compiled-outputs' },
    'ide-extension': { inputs: 'ide-inputs', outputs: 'ide-outputs' },
    parser: { inputs: 'parser-inputs', outputs: 'parser-outputs' },
  },
  version: 1,
}

type FakeRepository = {
  branch: string
  branchExists?: boolean
  conflictOnMerge?: boolean
  /** A merge that fails without recording a conflict, as a sandbox-denied one does. */
  deniedMergeStderr?: string
  diffPaths?: string[]
  /** Worktree-relative directories that exist, for the write probe that runs before a merge. */
  existingDirectories?: string[]
  /** Worktree-relative directories a write is denied in, as the sandbox denies `agents/skills`. */
  unwritableDirectories?: string[]
  /** Existing files a write is denied to inside a writable directory, as `.claude/settings.json` is. */
  unwritableFiles?: string[]
  /** Simulate a managed shell that creates a probe directory but cannot remove it. */
  probeRemovalError?: string
  /** Paths `git merge-tree` reports, which it can answer even when the merge itself cannot run. */
  mergeTreeConflicts?: string[]
  featureCommits?: Array<{ body: string; subject: string }>
  headSha: string
  localMainSha?: string
  mainSha: string
  remoteReachable: boolean
  status: string
  verifyExitCode?: number
}

function result(args: readonly string[], cwd: string | undefined, stdout = '', exitCode = 0, stderr = '') {
  return { args: [...args], command: 'x', cwd, error: undefined, exitCode, signal: null, stderr, stdout }
}

function fakeDependencies(overrides: Partial<FakeRepository> = {}) {
  const repository: FakeRepository = {
    branch: 'feat/example',
    headSha: 'headsha0000000000000000000000000000000000',
    mainSha: 'mainsha00000000000000000000000000000000000',
    remoteReachable: true,
    status: '',
    ...overrides,
  }
  const calls: Array<{ args: string[]; command: string; cwd?: string; stdio?: CLI.CommandStdio }> = []
  const states = new Map<string, unknown>()
  const files = new Map<string, string>()
  const probePaths: string[] = []
  const lines: string[] = []
  const greenTreeRecords = new Map<string, GreenTreeRecord>()
  let headAfterMerge = repository.headSha

  const runner = async (command: string, spec: CLI.CommandSpec) => {
    const args = [...(spec.args ?? [])]
    calls.push({ args, command, cwd: spec.cwd, stdio: spec.stdio })
    const joined = args.join(' ')

    if (joined === 'symbolic-ref --quiet --short HEAD') {
      return result(args, spec.cwd, `${repository.branch}\n`)
    }
    if (joined === 'status --porcelain=v1 --untracked-files=all') {
      return result(args, spec.cwd, repository.status)
    }
    if (args[0] === 'check-ref-format' && args[1] === '--branch') {
      return result(args, spec.cwd, '', args[2]?.includes(' ') ? 1 : 0)
    }
    if (args[0] === 'show-ref' && args[1] === '--verify') {
      return result(args, spec.cwd, '', repository.branchExists === true ? 0 : 1)
    }
    if (joined === `fetch --quiet origin main`) {
      return result(args, spec.cwd, '', repository.remoteReachable ? 0 : 1)
    }
    if (joined === 'rev-parse origin/main') {
      return result(args, spec.cwd, `${repository.mainSha}\n`)
    }
    if (joined === 'rev-parse --quiet --verify refs/heads/main') {
      return repository.localMainSha === undefined
        ? result(args, spec.cwd, '', 1)
        : result(args, spec.cwd, `${repository.localMainSha}\n`)
    }
    if (joined === 'rev-parse HEAD') {
      return result(args, spec.cwd, `${headAfterMerge}\n`)
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const mainShaUsed = repository.remoteReachable ? repository.mainSha : repository.localMainSha
      return result(args, spec.cwd, '', mainShaUsed === headAfterMerge || mainShaUsed === repository.headSha ? 0 : 1)
    }
    if (args[0] === 'merge-tree' && args[1] === '--write-tree') {
      const conflicts = repository.mergeTreeConflicts ?? []
      return conflicts.length === 0
        ? result(args, spec.cwd, 'treeoid0000000000000000000000000000000000\n')
        : result(args, spec.cwd, `treeoid0000000000000000000000000000000000\n${conflicts.join('\n')}\n\nCONFLICT\n`, 1)
    }
    if (args[0] === 'merge' && args[1] === '--no-edit') {
      if (repository.deniedMergeStderr !== undefined) {
        return result(args, spec.cwd, '', 1, repository.deniedMergeStderr)
      }
      if (repository.conflictOnMerge === true) {
        return result(args, spec.cwd, '', 1)
      }
      headAfterMerge = 'mergedhead000000000000000000000000000000000'
      return result(args, spec.cwd)
    }
    if (args[0] === 'switch' && args[1] === '--no-track') {
      headAfterMerge = repository.mainSha
      return result(args, spec.cwd)
    }
    if (joined === 'diff --name-only --diff-filter=U') {
      return result(args, spec.cwd, repository.conflictOnMerge === true ? 'conflicted.ts\n' : '')
    }
    if (args[0] === 'diff' && args[1] === '--name-only') {
      return result(
        args,
        spec.cwd,
        args.includes('-z')
          ? (repository.diffPaths ?? []).map(path => `${path}\0`).join('')
          : (repository.diffPaths ?? []).join('\n'),
      )
    }
    if (args[0] === 'log' && args[1] === '--no-merges') {
      const RECORD_SEPARATOR = ''
      const FIELD_SEPARATOR = ''
      const commits = repository.featureCommits
        ?? [{ body: '', subject: 'Add the example workflow' }]
      return result(
        args,
        spec.cwd,
        commits.map(commit => `${commit.subject}${FIELD_SEPARATOR}${commit.body}${RECORD_SEPARATOR}`).join('\n'),
      )
    }
    if (command === 'just' && args[0] === 'verify') {
      const treeHash = `tree-of-${headAfterMerge}`
      if ((repository.verifyExitCode ?? 0) === 0) {
        greenTreeRecords.set('verify', {
          at: '2026-09-17T10:00:00.000Z',
          generated: FAKE_GENERATED,
          logRoot: '/logs/verify',
          toolchain: FAKE_TOOLCHAIN,
          treeHash,
        })
      }
      return result(args, spec.cwd, '', repository.verifyExitCode ?? 0)
    }
    return result(args, spec.cwd, '', 1)
  }

  const resolvedIn = (directories: readonly string[]): string[] =>
    directories.map(directory => FS.resolvePath(directory, '/repo'))

  const dependencies: FinalizeDependencies = {
    canWriteFile: async path => !resolvedIn(repository.unwritableFiles ?? []).includes(path),
    exists: async path =>
      states.has(path) || files.has(path)
      || resolvedIn([...(repository.existingDirectories ?? []), ...(repository.unwritableFiles ?? [])]).includes(path),
    findGreenTree: async (_root, wanted, acceptedLanes, options = {}) => {
      for (const lane of acceptedLanes) {
        const record = greenTreeRecords.get(lane)
        const requested = options.generatedOutputs ?? []
        if (
          record !== undefined
          && record.treeHash === wanted.treeHash
          && record.toolchain === wanted.toolchain
          && GeneratedEvidence.covers(record.generated, requested)
          && GeneratedEvidence.equals(record.generated, requested.length === 0 ? undefined : FAKE_GENERATED)
        ) {
          return { ...record, lane }
        }
      }
      return undefined
    },
    isSymbolicLink: async () => false,
    key: async () => ({ toolchain: FAKE_TOOLCHAIN, treeHash: `tree-of-${headAfterMerge}` }),
    makeProbeDirectory: async prefix => {
      if (resolvedIn(repository.unwritableDirectories ?? []).some(directory => prefix.startsWith(`${directory}/`))) {
        Errors.throwUnexpected(`EPERM: operation not permitted, mkdir '${prefix}'`)
      }
      const path = `${prefix}${probePaths.length}`
      probePaths.push(path)
      files.set(path, '')
      return path
    },
    now: () => new Date('2026-09-17T12:00:00.000Z'),
    readJson: async <ValueT>(path: string) => {
      if (!states.has(path)) {
        Errors.throwUnexpected(`Missing fake state: ${path}`)
      }
      return states.get(path) as ValueT
    },
    realPath: async path => path,
    readText: async (path: string) => files.get(path) ?? '',
    run: runner,
    writeJson: async (path, value) => {
      states.set(path, structuredClone(value))
    },
    removeFile: async path => {
      if (repository.probeRemovalError !== undefined) {
        Errors.throwHostEnvironment(`${repository.probeRemovalError}: rmdir '${path}'`)
      }
      files.delete(path)
    },
    writeLine: line => lines.push(line),
    writeText: async (path, value) => {
      if (resolvedIn(repository.unwritableDirectories ?? []).some(directory => path.startsWith(`${directory}/`))) {
        Errors.throwUnexpected(`EPERM: operation not permitted, open '${path}'`)
      }
      files.set(path, value)
    },
  }
  return { calls, dependencies, files, greenTreeRecords, lines, probePaths, repository, states }
}

Describe('finalize', () => {
  Test('refuses a branch that is not feat/* or is detached', async () => {
    const fake = fakeDependencies({ branch: '' })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('requires a feat/* or dev/* branch')

    const other = fakeDependencies({ branch: 'chore/something' })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, other.dependencies))
      .rejects.toThrow('requires a feat/* or dev/* branch')
  })

  Test('reports exactly what is dirty and stops rather than fixing it', async () => {
    const fake = fakeDependencies({ status: '?? stray-file.ts\n M tracked.ts\n' })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('stray-file.ts')
    Expect(fake.calls.some(call => call.args[0] === 'fetch')).toBe(false)
  })

  Test('integrates main from origin when the branch does not already contain it', async () => {
    const fake = fakeDependencies()
    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(
      fake.calls.some(call => call.args.join(' ') === 'merge --no-edit mainsha00000000000000000000000000000000000'),
    )
      .toBe(true)
    Expect(outcome.lines.some(line => line.includes('Merged main'))).toBe(true)
  })

  Test('falls back to the local main branch without reporting it as an error when origin is unreachable', async () => {
    const fake = fakeDependencies({
      localMainSha: 'localmain0000000000000000000000000000000000',
      remoteReachable: false,
    })
    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(outcome.lines.some(line => line.includes('origin was unreachable'))).toBe(true)
    Expect(outcome.lines.some(line => line.startsWith('WARN'))).toBe(false)
    Expect(fake.calls.some(call => call.args.join(' ').includes('localmain0000000000000000000000000000000000')))
      .toBe(true)
  })

  Test('throws when neither origin nor a local main branch is reachable', async () => {
    const fake = fakeDependencies({ remoteReachable: false })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow(Errors.HostEnvironmentError)
  })

  Test('skips the merge when main is already an ancestor of HEAD', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.args[0] === 'merge')).toBe(false)
    Expect(outcome.lines.some(line => line.includes('already contained in this branch'))).toBe(true)
  })

  Test('stops on a merge conflict, names the conflicting paths, and never attempts to resolve it', async () => {
    const fake = fakeDependencies({ conflictOnMerge: true })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('conflicted.ts')
    Expect(fake.calls.some(call => ['reset', 'checkout', 'commit'].includes(call.args[0]!))).toBe(false)
  })

  Test('calls a denied integration what it is, rather than a conflict with nothing to resolve', async () => {
    const fake = fakeDependencies({
      deniedMergeStderr: "error: unable to unlink old 'agents/skills/delegation/SKILL.md': Operation not permitted",
      mergeTreeConflicts: ['agents/skills/delegation/SKILL.md'],
    })

    const failure = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(error => error)

    const message = String(failure)
    Expect(message.includes('did not complete, and it is not a conflict')).toBe(true)
    Expect(message.includes('Operation not permitted')).toBe(true)
    Expect(message.includes('agents/skills/delegation/SKILL.md')).toBe(true)
    Expect(message.includes('DEVENV-111')).toBe(true)
    Expect(message.includes('resolve it by hand and finalize again')).toBe(false)
  })

  Test('refuses before a merge it could not finish, rather than half-writing the worktree', async () => {
    // 77 of main's last 100 commits touch `agents/skills`, which a sandboxed shell cannot write.
    const fake = fakeDependencies({
      diffPaths: ['agents/skills/delegation/SKILL.md', 'packages/dev/dev-src/dev.ts'],
      existingDirectories: ['agents/skills/delegation', 'packages/dev/dev-src'],
      unwritableDirectories: ['agents/skills'],
    })

    const failure = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(error => error)

    const message = String(failure)
    Expect(message.includes('agents/skills/delegation')).toBe(true)
    Expect(message.includes('packages/dev/dev-src')).toBe(false)
    Expect(message.includes('Nothing has been changed')).toBe(true)
    Expect(message.includes('./agent unsandboxed merge-main')).toBe(true)
    Expect(message.includes('then finalize again')).toBe(true)
    // The merge must never have been attempted; that is the whole point of probing first.
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
  })

  Test('refuses for a protected file inside a writable directory, which a directory probe misses', async () => {
    const fake = fakeDependencies({
      diffPaths: ['.claude/settings.json', '.claude/hooks.md', 'agents/skills/delegation/SKILL.md'],
      existingDirectories: ['.claude', 'agents/skills/delegation'],
      unwritableDirectories: ['agents/skills'],
      unwritableFiles: ['.claude/settings.json', 'agents/skills/delegation/SKILL.md'],
    })

    const message = String(await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(e => e))

    Expect(message.includes('would write 2 paths')).toBe(true)
    Expect(message.includes('- .claude/settings.json')).toBe(true)
    Expect(message.includes('- agents/skills/delegation\n')).toBe(true)
    Expect(message.includes('.claude/hooks.md')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
  })

  Test('reports an unremovable write probe with its leftover path and recovery', async () => {
    const fake = fakeDependencies({
      diffPaths: ['Docs/Roadmap/plan.md'],
      existingDirectories: ['Docs/Roadmap'],
      probeRemovalError: 'EFAULT',
    })

    const failure = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(error => error)
    const report = Errors.formatForUser(failure)

    Expect(report).toContain(fake.probePaths[0]!)
    Expect(report).toContain('rmdir from a normal Terminal')
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
  })

  Test('merges normally when every directory main would write is writable', async () => {
    const fake = fakeDependencies({
      diffPaths: ['packages/dev/dev-src/dev.ts'],
      existingDirectories: ['packages/dev/dev-src'],
    })

    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(() => undefined)

    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(true)
    // A uniquely created probe leaves nothing behind in a directory it could write.
    Expect(fake.probePaths.length).toBe(1)
    Expect(fake.files.has(fake.probePaths[0]!)).toBe(false)
  })

  Test('does not overwrite an existing file with the old fixed probe name', async () => {
    const fake = fakeDependencies({
      diffPaths: ['packages/dev/dev-src/dev.ts'],
      existingDirectories: ['packages/dev/dev-src'],
    })
    const existing = '/repo/packages/dev/dev-src/.finalize-write-probe'
    fake.files.set(existing, 'keep this file')

    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(() => undefined)

    Expect(fake.files.get(existing)).toBe('keep this file')
    Expect(fake.probePaths.length).toBe(1)
    Expect(fake.files.has(fake.probePaths[0]!)).toBe(false)
  })

  Test('names what would conflict even when the merge recorded nothing to resolve', async () => {
    const fake = fakeDependencies({ deniedMergeStderr: 'denied', mergeTreeConflicts: [] })

    const failure = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(error => error)

    Expect(String(failure).includes('Nothing would have conflicted.')).toBe(true)
  })

  Test('asks what would conflict before attempting the merge, not after it has failed', async () => {
    const fake = fakeDependencies({ conflictOnMerge: true, mergeTreeConflicts: ['conflicted.ts'] })
    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(() => undefined)

    const preview = fake.calls.findIndex(call => call.args[0] === 'merge-tree')
    const merge = fake.calls.findIndex(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')
    Expect(preview).toBeGreaterThanOrEqual(0)
    Expect(preview < merge).toBe(true)
  })

  Test('runs just verify --complete only when no accepted lane already covers this tree', async () => {
    const fake = fakeDependencies()
    // `verify-full`, the lane's real name. This test used to register `full-verify`, which is not
    // a lane at all — it matched the misspelling in the accepted-lanes list, so the pair agreed
    // with each other and with nothing else, and the re-verification bug stayed invisible.
    fake.greenTreeRecords.set('verify-full', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/full',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: 'tree-of-mergedhead000000000000000000000000000000000',
    })

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(outcome.lines.some(line => line.includes('verify-full'))).toBe(true)
  })

  Test(
    'runs just verify --complete when the tree matches a record but the resolved toolchain does not',
    async () => {
      const fake = fakeDependencies()
      fake.greenTreeRecords.set('full-verify', {
        at: '2026-09-17T09:00:00.000Z',
        generated: FAKE_GENERATED,
        logRoot: '/logs/full',
        toolchain: 'a-different-toolchain',
        treeHash: 'tree-of-mergedhead000000000000000000000000000000000',
      })

      const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

      Expect(fake.calls.some(call => call.command === 'just' && call.args.join(' ') === 'verify --complete'))
        .toBe(true)
      Expect(outcome.lines.some(line => line.includes('Verified; standing on verify'))).toBe(true)
    },
  )

  Test('runs verification when no record covers the tree, and stands on its own record afterwards', async () => {
    const fake = fakeDependencies()
    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.command === 'just' && call.args.join(' ') === 'verify --complete')).toBe(true)
    Expect(outcome.lines.some(line => line.includes('Verified; standing on verify'))).toBe(true)
  })

  Test('propagates a failed verification lane instead of drafting a message or writing state', async () => {
    const fake = fakeDependencies({ verifyExitCode: 1 })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow(Errors.CommandExecutionError)
    Expect(fake.files.size).toBe(0)
    Expect(fake.states.size).toBe(0)
  })

  Test('drafts a merge message from real commit subjects and bodies, and it validates on its own', async () => {
    const fake = fakeDependencies({
      featureCommits: [
        { body: '', subject: 'Add the example workflow' },
        { body: 'Explain why the safety check exists.\n\nSecond paragraph.', subject: 'Prove its safety' },
      ],
    })
    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    const messagePath = [...fake.files.keys()].find(path => path.endsWith('.msg'))
    Expect(messagePath).toBeDefined()
    const draft = fake.files.get(messagePath!)!.replace(/\n$/u, '')
    Expect(() => validateMergeMessage(draft)).not.toThrow()
    Expect(draft).toContain('- Add the example workflow')
    Expect(draft).toContain('- Prove its safety')
    Expect(draft).toContain('- Explain why the safety check exists.')
    Expect(draft.startsWith('DRAFT: ')).toBe(true)
    Expect(outcome.ok).toBe(false)
    Expect(outcome.lines.some(line => line.includes('Review the drafted merge message'))).toBe(true)
  })

  Test('truncates an overlong summary to the validator-accepted 72 characters', async () => {
    const fake = fakeDependencies({
      featureCommits: [{
        body: '',
        subject: 'A'.repeat(120),
      }],
    })
    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    const messagePath = [...fake.files.keys()].find(path => path.endsWith('.msg'))!
    const summary = fake.files.get(messagePath)!.split('\n')[0]!
    Expect(summary.length).toBeLessThanOrEqual(72)
    Expect(() => validateMergeMessage(fake.files.get(messagePath)!)).not.toThrow()
  })

  Test('refuses to draft a message when main already contains every commit', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000', featureCommits: [] })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('nothing to draft a merge message from')
  })

  Test('keeps an existing merge message when recorded state proves it matches the current HEAD', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Hand-edited by the Developer.\n')
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    const state: FinalizeState = {
      headSha: 'mainsha00000000000000000000000000000000000',
      mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
      messageHeadSha: 'mainsha00000000000000000000000000000000000',
      updatedAt: '2026-09-17T09:00:00.000Z',
      verifiedAt: '2026-09-17T09:00:00.000Z',
      verifiedLane: 'verify',
      verifiedToolchain: FAKE_TOOLCHAIN,
      verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
      version: 2,
    }
    fake.states.set(statePath, state)
    fake.greenTreeRecords.set('verify', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/verify',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: 'tree-of-mainsha00000000000000000000000000000000000',
    })

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toBe('Land example\n\n- Hand-edited by the Developer.\n')
    Expect(outcome.lines.some(line => line.includes('Kept the existing merge message'))).toBe(true)
    Expect(outcome.lines.some(line => line.includes('3. Merge message: kept — recorded as written for this HEAD')))
      .toBe(true)
    Expect(outcome.ok).toBe(true)
  })

  // The landing validates the message in its preflight, so a hand-edited one that breaks the rule
  // costs a whole round trip to find out. Finalize already validates what it drafts; this is the
  // same rule applied to what it keeps, reported in the landing's own words.
  Test('reports a kept merge message the landing would reject, rather than leaving it to the landing', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const tooLong = `${'Land example with a summary that runs past the seventy-two character bound'}\n\n- One bullet.\n`
    fake.files.set(messagePath, tooLong)
    fake.states.set(
      '/repo/.artifacts/merge/feat/example.state.json',
      {
        headSha: 'mainsha00000000000000000000000000000000000',
        mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
        messageHeadSha: 'mainsha00000000000000000000000000000000000',
        updatedAt: '2026-09-17T09:00:00.000Z',
        verifiedAt: '2026-09-17T09:00:00.000Z',
        verifiedLane: 'verify',
        verifiedToolchain: FAKE_TOOLCHAIN,
        verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
        version: 2,
      } satisfies FinalizeState,
    )

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    // The file is never rewritten: the author's words are theirs to fix.
    Expect(fake.files.get(messagePath)).toBe(tooLong)
    Expect(outcome.lines.some(line => line.includes('The merge message summary must be at most 72 characters.')))
      .toBe(true)
    Expect(outcome.lines.some(line => line.includes('Fix the kept merge message, which the landing will reject')))
      .toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test(
    'keeps the message and says the branch gained commits when the recorded head sha no longer matches',
    async () => {
      const fake = fakeDependencies()
      const messagePath = '/repo/.artifacts/merge/feat/example.msg'
      const written = 'Land example\n\n- Written when the branch was one commit shorter.\n'
      fake.files.set(messagePath, written)
      const statePath = '/repo/.artifacts/merge/feat/example.state.json'
      fake.states.set(
        statePath,
        {
          headSha: 'someoldhead0000000000000000000000000000000',
          mainIntegratedSha: 'someoldmain00000000000000000000000000000000',
          messageHeadSha: 'someoldhead0000000000000000000000000000000',
          updatedAt: '2026-09-17T09:00:00.000Z',
          verifiedAt: '2026-09-17T09:00:00.000Z',
          verifiedLane: 'verify',
          verifiedToolchain: FAKE_TOOLCHAIN,
          verifiedTreeHash: 'some-old-tree',
          version: 2,
        } satisfies FinalizeState,
      )

      const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

      Expect(fake.files.get(messagePath)).toBe(written)
      Expect(outcome.lines.some(line =>
        line.includes(
          'Kept the existing merge message; the branch has gained commits since it was recorded for '
            + 'someoldhead0',
        )
      )).toBe(true)
      Expect(
        outcome.lines.some(line =>
          line.includes('3. Merge message: kept — the branch has gained commits since it was recorded for someoldhead0')
          && line.includes('only the author can confirm it still describes this branch')
        ),
      ).toBe(true)
      // Only the author can tell whether the new commits changed what the branch is for, so it is work
      // that remains, not a resolved step.
      Expect(outcome.lines.some(line => line.includes('Confirm the kept merge message still describes this branch')))
        .toBe(true)
      Expect(outcome.ok).toBe(false)
    },
  )

  Test('a missing state file keeps a hand-written message and says nothing records which HEAD it covers', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land example\n\n- Written by hand before finalize ever ran.\n'
    fake.files.set(messagePath, written)

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    // No state proves which HEAD this file covers, and a missing record is never a licence to
    // replace what an author wrote.
    Expect(fake.files.get(messagePath)).toBe(written)
    Expect(
      outcome.lines.some(line =>
        line.includes('Kept the existing merge message; nothing records which HEAD it was written for')
      ),
    ).toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test('a malformed or older-version state file keeps the message rather than replacing it', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land example\n\n- Add the example workflow\n'
    fake.files.set(messagePath, written)
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(statePath, { headSha: 'mainsha00000000000000000000000000000000000', version: 0 })

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toBe(written)
    Expect(outcome.lines.some(line => line.includes('nothing records which HEAD it was written for'))).toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test('an unreadable state file (bad JSON) keeps the message rather than throwing or replacing it', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land example\n\n- Add the example workflow\n'
    fake.files.set(messagePath, written)
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(statePath, statePath) // exists() sees it; readJson will "succeed" oddly, so force a throw instead:
    fake.dependencies.readJson = async () => {
      throw new SyntaxError('Unexpected token')
    }

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toBe(written)
    Expect(outcome.ok).toBe(false)
  })

  Test('run twice over a hand-written merge message leaves it byte-identical and reports keeping it', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land the example workflow\n\n- One bullet an author actually wrote.\n'
    fake.files.set(messagePath, written)

    const first = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)
    const second = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toBe(written)
    Expect(first.lines.some(line => line.includes('Kept the existing merge message'))).toBe(true)
    Expect(second.lines.some(line => line.includes('Kept the existing merge message'))).toBe(true)
    Expect(second.lines.some(line => line.includes('3. Merge message: kept'))).toBe(true)
    Expect([...fake.files.keys()].filter(path => path.endsWith('.msg'))).toEqual([messagePath])
    // The first run asks the author to confirm a message it has no record of; having reported that
    // and recorded this HEAD, the second run stands on it instead of asking again.
    Expect(first.ok).toBe(false)
    Expect(second.ok).toBe(true)
  })

  Test('--redraft replaces an existing merge message and says it replaced it', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Written by hand, and explicitly thrown away.\n')

    const outcome = await FinalizeCommand.run({ redraft: true, repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
    Expect(
      outcome.lines.some(line =>
        line.includes('Redrafted the merge message from 1 commit(s), replacing what was there')
      ),
    ).toBe(true)
    Expect(
      outcome.lines.some(line =>
        line.includes('3. Merge message: redrafted on request, replacing what was there — needs review')
      ),
    ).toBe(true)
    Expect(outcome.lines.some(line => line.includes('Review the redrafted merge message before landing'))).toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test('--check describes a hand-written message exactly as the run that follows it does', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land example\n\n- Written by hand.\n'
    fake.files.set(messagePath, written)

    const checked = await FinalizeCommand.run({ check: true, repositoryRoot: '/repo' }, fake.dependencies)
    const ran = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    // `--check` used to call a hand-written file current for this HEAD while the run that followed
    // replaced it. Both now reach the same decision from the same inputs.
    const messageLine = (lines: readonly string[]) => lines.find(line => line.startsWith('3. Merge message:'))
    Expect(messageLine(checked.lines)).toBe(messageLine(ran.lines))
    Expect(messageLine(checked.lines)).toContain('kept — nothing records which HEAD it was written for')
    Expect(fake.files.get(messagePath)).toBe(written)
  })

  Test(
    'never trusts the state file as a verification verdict: a matching verifiedTreeHash alone does not skip the lane',
    async () => {
      const fake = fakeDependencies()
      const statePath = '/repo/.artifacts/merge/feat/example.state.json'
      fake.states.set(
        statePath,
        {
          headSha: 'mergedhead000000000000000000000000000000000',
          mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
          messageHeadSha: 'mergedhead000000000000000000000000000000000',
          updatedAt: '2026-09-17T09:00:00.000Z',
          verifiedAt: '2026-09-17T09:00:00.000Z',
          verifiedLane: 'verify',
          verifiedToolchain: FAKE_TOOLCHAIN,
          // Claims to have proved the post-merge tree, but no GreenTree record backs that claim up.
          verifiedTreeHash: 'tree-of-mergedhead000000000000000000000000000000000',
          version: 2,
        } satisfies FinalizeState,
      )

      await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

      Expect(fake.calls.some(call => call.command === 'just' && call.args[0] === 'verify')).toBe(true)
    },
  )

  Test('a real GreenTree record is honored even with no state file at all', async () => {
    const fake = fakeDependencies()
    fake.greenTreeRecords.set('verify', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/verify',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: 'tree-of-mergedhead000000000000000000000000000000000',
    })

    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
  })

  Test('--check consumes verify evidence only while its generated inputs and outputs still match', async () => {
    const headSha = 'mainsha00000000000000000000000000000000000'
    const fake = fakeDependencies({ headSha })
    fake.greenTreeRecords.set('verify', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/verify',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: `tree-of-${headSha}`,
    })

    const covered = await FinalizeCommand.run({ check: true, repositoryRoot: '/repo' }, fake.dependencies)
    Expect(covered.lines.some(line => line.includes('tree unchanged since the green run'))).toBe(true)
    Expect(covered.lines.some(line => line.includes('Run just verify --complete'))).toBe(false)

    fake.greenTreeRecords.set('verify', {
      ...fake.greenTreeRecords.get('verify')!,
      generated: {
        ...FAKE_GENERATED,
        outputs: {
          ...FAKE_GENERATED.outputs,
          parser: { inputs: 'changed-inputs', outputs: 'parser-outputs' },
        },
      },
    })
    const stale = await FinalizeCommand.run({ check: true, repositoryRoot: '/repo' }, fake.dependencies)
    Expect(stale.lines).toContain('PLAN  Run just verify --complete; no record already covers this tree.')
  })

  Test('--check reports without integrating main, running a lane, or writing any file', async () => {
    const fake = fakeDependencies({
      diffPaths: ['agents/skills/delegation/SKILL.md'],
      existingDirectories: ['agents/skills/delegation'],
      unwritableDirectories: ['agents/skills'],
    })
    const outcome = await FinalizeCommand.run({ check: true, repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.probePaths).toEqual([])
    Expect(fake.files.size).toBe(0)
    Expect(fake.states.size).toBe(0)
    Expect(outcome.lines.some(line => line.startsWith('PLAN'))).toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test('--fresh ignores the recorded state but never replaces an existing merge message', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    const written = 'Land example\n\n- Add the example workflow\n'
    fake.files.set(messagePath, written)
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(
      statePath,
      {
        headSha: 'mainsha00000000000000000000000000000000000',
        mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
        messageHeadSha: 'mainsha00000000000000000000000000000000000',
        updatedAt: '2026-09-17T09:00:00.000Z',
        verifiedAt: '2026-09-17T09:00:00.000Z',
        verifiedLane: 'verify',
        verifiedToolchain: FAKE_TOOLCHAIN,
        verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
        version: 2,
      } satisfies FinalizeState,
    )
    fake.greenTreeRecords.set('verify', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/verify',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: 'tree-of-mainsha00000000000000000000000000000000000',
    })

    const outcome = await FinalizeCommand.run({ fresh: true, repositoryRoot: '/repo' }, fake.dependencies)

    // `--fresh` discards the record, which used to guarantee the overwrite. It now costs the run its
    // proof that the message is current, and nothing else.
    Expect(fake.files.get(messagePath)).toBe(written)
    Expect(
      outcome.lines.some(line =>
        line.includes('Kept the existing merge message; nothing records which HEAD it was written for')
      ),
    ).toBe(true)

    const redrafted = await FinalizeCommand.run(
      { fresh: true, redraft: true, repositoryRoot: '/repo' },
      fake.dependencies,
    )

    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
    Expect(redrafted.lines.some(line => line.includes('Redrafted the merge message'))).toBe(true)
  })

  Test(
    'reports human-verification paths and an untouched developer-environment ledger as advisory, never gating ok',
    async () => {
      const fake = fakeDependencies({
        headSha: 'mainsha00000000000000000000000000000000000',
        diffPaths: [
          'packages/ides/studio/studio-src/client/Editor.ts',
          'packages/testing/verification/verification-src/Finalize.ts',
        ],
      })
      const messagePath = '/repo/.artifacts/merge/feat/example.msg'
      fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')
      const statePath = '/repo/.artifacts/merge/feat/example.state.json'
      fake.states.set(
        statePath,
        {
          headSha: 'mainsha00000000000000000000000000000000000',
          mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
          messageHeadSha: 'mainsha00000000000000000000000000000000000',
          updatedAt: '2026-09-17T09:00:00.000Z',
          verifiedAt: '2026-09-17T09:00:00.000Z',
          verifiedLane: 'verify',
          verifiedToolchain: FAKE_TOOLCHAIN,
          verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
          version: 2,
        } satisfies FinalizeState,
      )
      fake.greenTreeRecords.set('verify', {
        at: '2026-09-17T09:00:00.000Z',
        generated: FAKE_GENERATED,
        logRoot: '/logs/verify',
        toolchain: FAKE_TOOLCHAIN,
        treeHash: 'tree-of-mainsha00000000000000000000000000000000000',
      })

      const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

      // Every real step was already satisfied, so the advisory-only findings must not flip this false.
      Expect(outcome.ok).toBe(true)
      Expect(outcome.lines.some(line => line.includes('4. Remaining: none'))).toBe(true)
      Expect(outcome.lines.some(line => line.includes('5. Advisory'))).toBe(true)
      Expect(outcome.lines.some(line => line.includes('Developer environment upgrades.md'))).toBe(true)
      Expect(outcome.lines.some(line => line.includes('packages/ides/studio/studio-src/client/Editor.ts'))).toBe(true)
    },
  )

  Test(
    'reports studio-tooling as both a human-verification path and workflow code the ledger advisory reaches',
    async () => {
      // studio-tooling owns Electrobun windows, CDP, and device launch — nothing sandboxed exercises
      // them — and it is repository workflow code in its own right (MachineLanes, the review command).
      const fake = fakeDependencies({
        headSha: 'mainsha00000000000000000000000000000000000',
        diffPaths: ['packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts'],
      })
      const messagePath = '/repo/.artifacts/merge/feat/example.msg'
      fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')
      const statePath = '/repo/.artifacts/merge/feat/example.state.json'
      fake.states.set(
        statePath,
        {
          headSha: 'mainsha00000000000000000000000000000000000',
          mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
          messageHeadSha: 'mainsha00000000000000000000000000000000000',
          updatedAt: '2026-09-17T09:00:00.000Z',
          verifiedAt: '2026-09-17T09:00:00.000Z',
          verifiedLane: 'verify',
          verifiedToolchain: FAKE_TOOLCHAIN,
          verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
          version: 2,
        } satisfies FinalizeState,
      )
      fake.greenTreeRecords.set('verify', {
        at: '2026-09-17T09:00:00.000Z',
        generated: FAKE_GENERATED,
        logRoot: '/logs/verify',
        toolchain: FAKE_TOOLCHAIN,
        treeHash: 'tree-of-mainsha00000000000000000000000000000000000',
      })

      const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

      Expect(outcome.ok).toBe(true)
      Expect(outcome.lines.some(line => line.includes('Developer environment upgrades.md'))).toBe(true)
      Expect(
        outcome.lines.some(line => line.includes('packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts')),
      ).toBe(true)
    },
  )

  Test('reports nothing remaining when every step was already satisfied', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000', diffPaths: [] })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(
      statePath,
      {
        headSha: 'mainsha00000000000000000000000000000000000',
        mainIntegratedSha: 'mainsha00000000000000000000000000000000000',
        messageHeadSha: 'mainsha00000000000000000000000000000000000',
        updatedAt: '2026-09-17T09:00:00.000Z',
        verifiedAt: '2026-09-17T09:00:00.000Z',
        verifiedLane: 'verify',
        verifiedToolchain: FAKE_TOOLCHAIN,
        verifiedTreeHash: 'tree-of-mainsha00000000000000000000000000000000000',
        version: 2,
      } satisfies FinalizeState,
    )
    fake.greenTreeRecords.set('verify', {
      at: '2026-09-17T09:00:00.000Z',
      generated: FAKE_GENERATED,
      logRoot: '/logs/verify',
      toolchain: FAKE_TOOLCHAIN,
      treeHash: 'tree-of-mainsha00000000000000000000000000000000000',
    })

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(outcome.ok).toBe(true)
    Expect(outcome.lines.some(line => line.includes('4. Remaining: none'))).toBe(true)
  })

  Test('writes the state file with the fields a re-entry needs, after a real run', async () => {
    const fake = fakeDependencies()
    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    const state = fake.states.get(statePath) as FinalizeState
    Expect(state.version).toBe(2)
    Expect(state.headSha).toBe('mergedhead000000000000000000000000000000000')
    Expect(state.mainIntegratedSha).toBe('mainsha00000000000000000000000000000000000')
    Expect(state.messageHeadSha).toBe('mergedhead000000000000000000000000000000000')
    Expect(state.verifiedLane).toBe('verify')
    Expect(state.verifiedToolchain).toBe(FAKE_TOOLCHAIN)
    Expect(typeof state.verifiedAt).toBe('string')
    Expect(state.updatedAt).toBe('2026-09-17T12:00:00.000Z')
  })

  Test('finalizes a real disposable Git branch end to end', async () => {
    const root = await mkGitTestDir('tao-finalize-')
    const mainRoot = FS.resolvePath('main', root)
    const featureRoot = FS.resolvePath('feature', root)
    await initGitTestRepository(mainRoot)
    await gitCommand(mainRoot, ['config', 'user.name', 'Tao Test'])
    await gitCommand(mainRoot, ['config', 'user.email', 'tao@example.test'])
    await FS.writeText(FS.resolvePath('.gitignore', mainRoot), '.artifacts/\n')
    await FS.writeText(FS.resolvePath('base.txt', mainRoot), 'base\n')
    await gitCommand(mainRoot, ['add', '.gitignore', 'base.txt'])
    await gitCommand(mainRoot, ['commit', '--quiet', '-m', 'Base'])
    await gitCommand(mainRoot, ['worktree', 'add', '--quiet', '-b', 'feat/finalize-fixture', featureRoot])
    await FS.writeText(FS.resolvePath('feature.txt', featureRoot), 'feature\n')
    await gitCommand(featureRoot, ['add', 'feature.txt'])
    await gitCommand(featureRoot, ['commit', '--quiet', '-m', 'Add the disposable finalize fixture'])

    const dependencies: FinalizeDependencies = {
      canWriteFile: async () => true,
      exists: FS.exists,
      findGreenTree: async () => undefined,
      isSymbolicLink: FS.isSymbolicLink,
      key: async () => ({ toolchain: 'irrelevant-in-this-fixture', treeHash: 'irrelevant-in-this-fixture' }),
      makeProbeDirectory: FS.mkTmpDir,
      now: () => new Date('2026-09-17T12:00:00.000Z'),
      readJson: FS.readJson,
      realPath: FS.realPath,
      readText: FS.readText,
      removeFile: FS.remove,
      run: async (command, spec) =>
        command === 'just'
          ? {
            args: [...(spec.args ?? [])],
            command,
            cwd: spec.cwd,
            error: undefined,
            exitCode: 0,
            signal: null,
            stderr: '',
            stdout: '',
          }
          : await CLI.run(command, { ...spec, stdio: 'pipe' }),
      writeJson: FS.writeJson,
      writeLine: () => {},
      writeText: FS.writeText,
    }

    const outcome = await FinalizeCommand.run({ repositoryRoot: featureRoot }, dependencies)

    Expect(outcome.lines.some(line => line.includes('already contained in this branch'))).toBe(true)
    const messagePath = FS.resolvePath('.artifacts/merge/feat/finalize-fixture.msg', featureRoot)
    Expect(await FS.exists(messagePath)).toBe(true)
    const draft = await FS.readText(messagePath)
    Expect(() => validateMergeMessage(draft)).not.toThrow()
    Expect(draft).toContain('- Add the disposable finalize fixture')
    const statePath = FS.resolvePath('.artifacts/merge/feat/finalize-fixture.state.json', featureRoot)
    Expect(await FS.exists(statePath)).toBe(true)
  })
})

/**
 * The unlocked half of a landing. What it must *not* do is as load-bearing as what it does: it
 * settles the merge message, which is the only part that can need an author, and it leaves
 * integrating main and verifying to the transaction, where they happen under the lock and cannot go
 * stale between one command and the next.
 */
Describe('landing preparation', () => {
  Test('settles the merge message without integrating main or running a lane', async () => {
    const fake = fakeDependencies()

    const preparation = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(preparation.branch).toBe('feat/example')
    Expect(preparation.ok).toBe(false)
    Expect(preparation.remaining[0]).toContain('Review the drafted merge message before landing')
    // The two things the transaction owns now, neither of which happens here.
    Expect(fake.calls.some(call => call.args[0] === 'merge')).toBe(false)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    // But main is still read, because a draft is written against `main..HEAD`.
    Expect(preparation.lines.some(line => line.includes('Read origin/main at'))).toBe(true)
  })

  Test('accepts an edited draft for the same HEAD without an out-of-lock finalize', async () => {
    const fake = fakeDependencies()
    const first = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(first.ok).toBe(false)
    const path = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(path, 'Land the example workflow\n\n- Add the example workflow.\n')

    const second = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(second.ok).toBe(true)
    Expect(fake.calls.some(call => call.args[0] === 'merge')).toBe(false)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)

    fake.states.set(`${path}.review.json`, {
      draftText: 'DRAFT: Add the example workflow\n\n- Add the example workflow.\n',
      headSha: 'oldhead0000000000000000000000000000000000',
      version: 1,
    })
    const changedHead = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(changedHead.ok).toBe(false)
  })

  Test('keeps a message a command recorded for this HEAD, and asks again once the branch moves', async () => {
    const fake = fakeDependencies()
    const path = await recordMergeMessage(
      'Pin storage\n\n- Point storage at abc12345',
      { repositoryRoot: '/repo' },
      fake.dependencies,
    )
    Expect(fake.files.get(path)).toBe('Pin storage\n\n- Point storage at abc12345\n')

    const recorded = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(recorded.ok).toBe(true)

    fake.states.set('/repo/.artifacts/merge/feat/example.state.json', {
      ...fake.states.get('/repo/.artifacts/merge/feat/example.state.json') as FinalizeState,
      messageHeadSha: 'oldhead0000000000000000000000000000000000',
    })
    const moved = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(moved.ok).toBe(false)
  })

  Test('does not turn an untouched generated draft into author review on a later landing', async () => {
    const fake = fakeDependencies()
    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)
    const path = '/repo/.artifacts/merge/feat/example.msg'

    const untouched = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(untouched.ok).toBe(false)
    Expect(untouched.remaining[0]).toContain('generated draft has not been edited by its author')

    fake.files.set(path, 'Land the example workflow\n\n- Add the example workflow.\n')
    const edited = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(edited.ok).toBe(true)
  })

  Test('accepts an updated kept message without an out-of-lock finalize', async () => {
    const fake = fakeDependencies()
    const path = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(path, 'Land the example workflow\n\n- Add the example workflow.\n')
    const first = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(first.ok).toBe(false)
    fake.files.set(path, 'Land the example workflow\n\n- Add and validate the example workflow.\n')

    const second = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)
    Expect(second.ok).toBe(true)
    Expect(fake.calls.some(call => call.args[0] === 'merge')).toBe(false)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
  })

  Test('is ready once the message on disk is recorded against this HEAD', async () => {
    const fake = fakeDependencies()
    fake.files.set('/repo/.artifacts/merge/feat/example.msg', 'Land it\n\n- Do the thing.\n')
    fake.states.set(
      '/repo/.artifacts/merge/feat/example.state.json',
      {
        headSha: fake.repository.headSha,
        mainIntegratedSha: fake.repository.mainSha,
        messageHeadSha: fake.repository.headSha,
        updatedAt: '2026-09-19T12:00:00.000Z',
        verifiedAt: '2026-09-19T12:00:00.000Z',
        verifiedLane: 'verify',
        verifiedToolchain: FAKE_TOOLCHAIN,
        verifiedTreeHash: 'tree',
        version: 2,
      } satisfies FinalizeState,
    )

    const preparation = await prepareForLanding({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(preparation.ok).toBe(true)
    Expect(preparation.remaining).toEqual([])
  })

  Test('refuses to take the lock at all when the branch is not ready', async () => {
    // A landing that took the machine-wide lock and then discovered an unreviewed merge message
    // would be spending everyone else's turn on something only its author can finish.
    const fake = fakeDependencies()

    await Expect(LandCommand.run({ showStudio: true, repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('is not ready to land, and the landing lock was not taken')
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'update-ref')).toBe(false)
  })

  Test('rejects an alternate agent landing message before redraft can read or write it', async () => {
    const fake = fakeDependencies()
    const outside = '/private/tmp/host-owned.msg'
    fake.files.set(outside, 'Keep this host file.\n')

    await Expect(
      LandCommand.run(
        { showStudio: true, messageFile: outside, redraft: true, repositoryRoot: '/repo' },
        fake.dependencies,
      ),
    ).rejects.toThrow('only accepts its canonical merge message')

    Expect(fake.files.get(outside)).toBe('Keep this host file.\n')
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
  })

  Test('rejects symlinked and physically escaped canonical landing messages before preparation', async () => {
    const symlinked = fakeDependencies()
    symlinked.dependencies.isSymbolicLink = async path => path === '/repo/.artifacts/merge'
    await Expect(LandCommand.run({ showStudio: true, repositoryRoot: '/repo' }, symlinked.dependencies))
      .rejects.toThrow('crosses a symbolic link')
    Expect(symlinked.calls.some(call => call.args[0] === 'fetch')).toBe(false)

    const escaped = fakeDependencies()
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    escaped.files.set(messagePath, 'Land it\n\n- Do the thing.\n')
    escaped.dependencies.realPath = async path => path === messagePath ? '/private/tmp/escaped.msg' : path
    await Expect(LandCommand.run({ showStudio: true, repositoryRoot: '/repo' }, escaped.dependencies))
      .rejects.toThrow('resolves outside the repository')
    Expect(escaped.calls.some(call => call.args[0] === 'fetch')).toBe(false)
  })

  Test('rejects the two noninteractive verification skips before inspecting the repository', async () => {
    const fake = fakeDependencies()

    await Expect(
      LandCommand.run(
        { showStudio: true, repositoryRoot: '/repo', skipVerify: true, skipVerifyFull: true },
        fake.dependencies,
      ),
    ).rejects.toThrow('cannot combine --skip-verify-full with --skip-verify')

    Expect(fake.calls).toEqual([])
  })

  Test('refuses a branch that is not feat/* or a dirty worktree, before anything else', async () => {
    const detached = fakeDependencies({ branch: '' })
    await Expect(prepareForLanding({ repositoryRoot: '/repo' }, detached.dependencies))
      .rejects.toThrow('requires a feat/* or dev/* branch')

    const dirty = fakeDependencies({ status: '?? stray.ts\n' })
    await Expect(prepareForLanding({ repositoryRoot: '/repo' }, dirty.dependencies))
      .rejects.toThrow('stray.ts')
    Expect(dirty.calls.some(call => call.args[0] === 'fetch')).toBe(false)
  })
})

Describe('merge-main', () => {
  Test('merges main and stops there: no lane, no merge message, no state file', async () => {
    const fake = fakeDependencies()
    const outcome = await MergeMainCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(outcome.mergedNow).toBe(true)
    Expect(fake.lines.some(line => line.includes('Merged main'))).toBe(true)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'log')).toBe(false)
    Expect(fake.states.size).toBe(0)
  })

  Test('reports a branch that already contains main without merging', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const outcome = await MergeMainCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(outcome.mergedNow).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'merge')).toBe(false)
  })

  Test('refuses where it cannot finish, and names itself unsandboxed as the way through', async () => {
    const fake = fakeDependencies({
      diffPaths: ['agents/skills/delegation/SKILL.md'],
      existingDirectories: ['agents/skills/delegation'],
      unwritableDirectories: ['agents/skills'],
    })

    const message = String(await MergeMainCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(e => e))

    Expect(message.includes('./agent unsandboxed merge-main')).toBe(true)
    Expect(message.includes('finalize')).toBe(false)
    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
  })

  Test('leaves a conflict for the author to resolve and commit', async () => {
    const fake = fakeDependencies({ conflictOnMerge: true })

    const message = String(await MergeMainCommand.run({ repositoryRoot: '/repo' }, fake.dependencies).catch(e => e))

    Expect(message.includes('conflicted.ts')).toBe(true)
    Expect(message.includes('commit the merge')).toBe(true)
    Expect(fake.calls.some(call => ['reset', 'checkout', 'commit'].includes(call.args[0]!))).toBe(false)
  })

  Test('refuses a detached HEAD or a dirty worktree in its own name', async () => {
    const detached = fakeDependencies({ branch: '' })
    await Expect(MergeMainCommand.run({ repositoryRoot: '/repo' }, detached.dependencies))
      .rejects.toThrow('merge-main requires a feat/* or dev/* branch')

    const dirty = fakeDependencies({ status: ' M tracked.ts\n' })
    await Expect(MergeMainCommand.run({ repositoryRoot: '/repo' }, dirty.dependencies))
      .rejects.toThrow('merge-main refuses to guess')
  })
})

/** Disposable repositories keep failure/restore coverage on Git's real stash semantics. */
async function mergeStashFixture() {
  const root = await mkGitTestDir('tao-merge-stash-')
  await initGitTestRepository(root, {
    commit: { files: { '.gitignore': '.artifacts/\n', 'work.txt': 'base\n', 'incoming.txt': 'old\n' } },
  })
  const readGit = async (args: string[]): Promise<string> => {
    const output = await CLI.mustRun('git', { args, cwd: root, stdio: 'pipe' })
    return output.stdout.trim()
  }
  await readGit(['config', 'user.name', 'Tao Test'])
  await readGit(['config', 'user.email', 'tao@example.test'])
  await readGit(['branch', 'feat/stash-fixture'])
  await FS.writeText(FS.resolvePath('incoming.txt', root), 'new\n')
  await readGit(['add', 'incoming.txt'])
  await readGit(['commit', '--quiet', '-m', 'Advance main'])
  const main = await readGit(['rev-parse', 'HEAD'])
  await readGit(['switch', '--quiet', 'feat/stash-fixture'])
  const baseline = await readGit(['rev-parse', 'HEAD'])
  const fake = fakeDependencies()
  const calls: string[][] = []
  const dependencies: FinalizeDependencies = {
    ...fake.dependencies,
    exists: FS.exists,
    makeProbeDirectory: FS.mkTmpDir,
    removeFile: FS.remove,
    run: async (command, spec) => {
      calls.push([...(spec.args ?? [])])
      return CLI.run(command, { ...spec, stdio: 'pipe' })
    },
  }
  const dirty = async (): Promise<void> => {
    await FS.writeText(FS.resolvePath('work.txt', root), 'staged\n')
    await readGit(['add', 'work.txt'])
    await FS.writeText(FS.resolvePath('work.txt', root), 'unstaged\n')
    await FS.writeText(FS.resolvePath('untracked.txt', root), 'untracked\n')
  }
  return { baseline, calls, dependencies, dirty, lines: fake.lines, main, readGit, root }
}

Describe('merge-main saved work', () => {
  Test('requires explicit stash opt-in for keep-stashed', async () => {
    const fake = fakeDependencies()
    await Expect(MergeMainCommand.run({ keepStashed: true, repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('--keep-stashed requires --stash')
    Expect(fake.calls.some(call => call.args[0] === 'stash')).toBe(false)
  })

  Test('restores staged, unstaged and untracked bytes while retaining the exact backup', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    const outcome = await MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies)
    Expect(outcome.mergedNow).toBe(true)
    Expect(await fixture.readGit(['rev-parse', 'HEAD'])).toBe(fixture.main)
    Expect(await fixture.readGit(['show', ':work.txt'])).toBe('staged')
    Expect(await FS.readText(FS.resolvePath('work.txt', fixture.root))).toBe('unstaged\n')
    Expect(await FS.readText(FS.resolvePath('untracked.txt', fixture.root))).toBe('untracked\n')
    const stash = await fixture.readGit(['rev-parse', 'refs/stash'])
    Expect(fixture.calls.some(args => args.join(' ') === `stash apply --index ${stash}`)).toBe(true)
    Expect(await fixture.readGit(['show', `${stash}^3:untracked.txt`])).toBe('untracked')
    Expect(fixture.calls.some(args => args[0] === 'stash' && ['pop', 'drop'].includes(args[1]!))).toBe(false)
  })

  Test('keeps interrupted checkout bytes saved and finishes main without replaying them', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    await FS.writeText(FS.resolvePath('incoming.txt', fixture.root), 'new\n')
    const outcome = await MergeMainCommand.run(
      { repositoryRoot: fixture.root, stash: true, keepStashed: true },
      fixture.dependencies,
    )
    Expect(await fixture.readGit(['rev-parse', 'HEAD'])).toBe(fixture.main)
    Expect(await fixture.readGit(['status', '--porcelain=v1'])).toBe('')
    Expect(await FS.readText(FS.resolvePath('work.txt', fixture.root))).toBe('base\n')
    Expect(await fixture.readGit(['show', 'refs/stash:work.txt'])).toBe('unstaged')
    Expect(await fixture.readGit(['show', 'refs/stash:incoming.txt'])).toBe('new')
    Expect(await fixture.readGit(['show', 'refs/stash^3:untracked.txt'])).toBe('untracked')
    Expect(fixture.calls.some(args => args[0] === 'stash' && args[1] === 'apply')).toBe(false)
    Expect(outcome.lines.some(line => line.includes('Saved work has not been restored'))).toBe(true)
  })

  Test('retains the backup when merge fails and does not reapply it into a partial checkout', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    const run = fixture.dependencies.run
    fixture.dependencies.run = async (command, spec) =>
      spec.args?.[0] === 'merge'
        ? result(spec.args, spec.cwd, '', 1, 'checkout write denied')
        : run(command, spec)
    await Expect(MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies))
      .rejects.toThrow('checkout write denied')
    Expect(await fixture.readGit(['rev-parse', 'HEAD'])).toBe(fixture.baseline)
    Expect(await fixture.readGit(['show', 'refs/stash:work.txt'])).toBe('unstaged')
    Expect(await fixture.readGit(['show', 'refs/stash^3:untracked.txt'])).toBe('untracked')
    Expect(fixture.calls.some(args => args[0] === 'stash' && args[1] === 'apply')).toBe(false)
  })

  Test('reports a saved backup even if stash checkout cleanup fails', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    const run = fixture.dependencies.run
    fixture.dependencies.run = async (command, spec) => {
      const output = await run(command, spec)
      return spec.args?.[0] === 'stash' && spec.args[1] === 'push'
        ? { ...output, exitCode: 1, stderr: 'stash cleanup denied' }
        : output
    }
    await Expect(MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies))
      .rejects.toThrow()
    const stash = await fixture.readGit(['rev-parse', 'refs/stash'])
    Expect(fixture.lines.some(line => line.includes(stash))).toBe(true)
    Expect(await fixture.readGit(['show', `${stash}^3:untracked.txt`])).toBe('untracked')
    Expect(fixture.calls.some(args => args[0] === 'merge')).toBe(false)
  })

  Test('leaves a restoration failure and its immutable backup for manual resolution', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    const run = fixture.dependencies.run
    fixture.dependencies.run = async (command, spec) =>
      spec.args?.[0] === 'stash' && spec.args[1] === 'apply'
        ? result(spec.args, spec.cwd, '', 1, 'restore conflict')
        : run(command, spec)
    await Expect(MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies))
      .rejects.toThrow('restoring saved work needs attention')
    Expect(await fixture.readGit(['rev-parse', 'HEAD'])).toBe(fixture.main)
    Expect(await fixture.readGit(['show', 'refs/stash:work.txt'])).toBe('unstaged')
    Expect(await fixture.readGit(['show', 'refs/stash^3:untracked.txt'])).toBe('untracked')
  })

  Test('does not disturb an existing merge operation', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    await FS.writeText(FS.resolvePath('.git/MERGE_HEAD', fixture.root), `${fixture.main}\n`)
    await Expect(MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies))
      .rejects.toThrow('MERGE_HEAD exists')
    Expect(await FS.readText(FS.resolvePath('work.txt', fixture.root))).toBe('unstaged\n')
    Expect(fixture.calls.some(args => args[0] === 'stash')).toBe(false)
  })

  Test('stops when the shared stash reference moves and identifies its own backup label', async () => {
    const fixture = await mergeStashFixture()
    await fixture.dirty()
    const run = fixture.dependencies.run
    fixture.dependencies.run = async (command, spec) =>
      spec.args?.join(' ') === 'rev-parse --verify refs/stash'
        ? result(spec.args, spec.cwd, `${fixture.main}\n`)
        : run(command, spec)
    const failure = await MergeMainCommand.run({ repositoryRoot: fixture.root, stash: true }, fixture.dependencies)
      .catch(error => error)
    const message = Errors.formatForUser(failure)
    Expect(message).toContain('shared stash changed concurrently')
    Expect(message).toContain(`merge-main dirty work 2026-09-17T12:00:00.000Z ${fixture.root}`)
    Expect(await fixture.readGit(['show', 'refs/stash:work.txt'])).toBe('unstaged')
    Expect(fixture.calls.some(args => args[0] === 'merge' || (args[0] === 'stash' && args[1] === 'apply'))).toBe(false)
  })
})

Describe('start-branch', () => {
  Test('refuses a protected checkout path before switching, naming its host command', async () => {
    const fake = fakeDependencies({
      branch: '',
      diffPaths: ['.claude/settings.json', 'packages/cli/dev-cli/dev-cli-src/dev.ts'],
      existingDirectories: ['.claude', 'packages/cli/dev-cli/dev-cli-src'],
      unwritableFiles: ['.claude/settings.json'],
    })

    const failure = await StartBranchCommand.run('feat/next', { repositoryRoot: '/repo' }, fake.dependencies)
      .catch(error => error)
    const report = Errors.formatForUser(failure)

    Expect(report).toContain('.claude/settings.json')
    Expect(report).toContain('./agent unsandboxed start-branch feat/next')
    Expect(report).not.toContain('packages/cli/dev-cli/dev-cli-src/dev.ts')
    Expect(fake.calls.some(call => call.args[0] === 'fetch')).toBe(true)
    Expect(fake.calls.some(call => call.args[0] === 'switch')).toBe(false)
  })

  Test('starts an untracked feature branch from fetched origin/main when writes are allowed', async () => {
    const fake = fakeDependencies({
      branch: '',
      diffPaths: ['Docs/Roadmap/plan.md'],
      existingDirectories: ['Docs/Roadmap'],
    })

    await StartBranchCommand.run('feat/next', { repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.args.join(' ') === 'fetch --quiet origin main')).toBe(true)
    Expect(fake.calls.some(call =>
      call.args.join(' ')
        === 'switch --no-track -c feat/next mainsha00000000000000000000000000000000000'
    )).toBe(true)
    Expect(fake.lines.some(line => line.includes("Started 'feat/next' from origin/main"))).toBe(true)
  })

  Test('probes a pathname containing a newline as one protected file', async () => {
    const protectedPath = '.claude/odd\nname.json'
    const fake = fakeDependencies({
      diffPaths: [protectedPath],
      existingDirectories: ['.claude'],
      unwritableFiles: [protectedPath],
    })

    const failure = await StartBranchCommand.run('feat/next', { repositoryRoot: '/repo' }, fake.dependencies)
      .catch(error => error)

    Expect(Errors.formatForUser(failure)).toContain(protectedPath)
    Expect(fake.calls.some(call => call.args[0] === 'switch')).toBe(false)
  })

  Test('requires a clean worktree and a new valid feat branch before fetching', async () => {
    for (
      const [name, overrides] of [
        ['dev/next', {}],
        ['feat/bad name', {}],
        ['feat/next', { status: ' M tracked.ts\n' }],
        ['feat/next', { branchExists: true }],
      ] as const
    ) {
      const fake = fakeDependencies(overrides)
      await Expect(StartBranchCommand.run(name, { repositoryRoot: '/repo' }, fake.dependencies)).rejects.toThrow()
      Expect(fake.calls.some(call => call.args[0] === 'fetch')).toBe(false)
      Expect(fake.calls.some(call => call.args[0] === 'switch')).toBe(false)
    }
  })
})

async function gitCommand(cwd: string, args: readonly string[]): Promise<void> {
  const commandResult = await CLI.run('git', { args, cwd, stdio: 'pipe' })
  if (commandResult.exitCode !== 0) {
    throw new Errors.CommandExecutionError(commandResult)
  }
}
