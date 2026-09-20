import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  FinalizeCommand,
  type FinalizeDependencies,
  type FinalizeState,
} from '../dev-src/repository-tests/Finalize'
import {
  GeneratedEvidence,
  type GeneratedEvidence as GeneratedEvidenceRecord,
} from '../dev-src/repository-tests/GeneratedEvidence'
import { validateMergeMessage } from '../dev-src/repository-tests/MergeWithMain'

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
  conflictOnMerge?: boolean
  diffPaths?: string[]
  featureCommits?: Array<{ body: string; subject: string }>
  headSha: string
  localMainSha?: string
  mainSha: string
  remoteReachable: boolean
  status: string
  verifyExitCode?: number
}

function result(args: readonly string[], cwd: string | undefined, stdout = '', exitCode = 0) {
  return { args: [...args], command: 'x', cwd, error: undefined, exitCode, signal: null, stderr: '', stdout }
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
    if (args[0] === 'merge' && args[1] === '--no-edit') {
      if (repository.conflictOnMerge === true) {
        return result(args, spec.cwd, '', 1)
      }
      headAfterMerge = 'mergedhead000000000000000000000000000000000'
      return result(args, spec.cwd)
    }
    if (joined === 'diff --name-only --diff-filter=U') {
      return result(args, spec.cwd, 'conflicted.ts\n')
    }
    if (args[0] === 'diff' && args[1] === '--name-only') {
      return result(args, spec.cwd, (repository.diffPaths ?? []).join('\n'))
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

  const dependencies: FinalizeDependencies = {
    exists: async path => states.has(path) || files.has(path),
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
    key: async () => ({ toolchain: FAKE_TOOLCHAIN, treeHash: `tree-of-${headAfterMerge}` }),
    now: () => new Date('2026-09-17T12:00:00.000Z'),
    readJson: async <ValueT>(path: string) => {
      if (!states.has(path)) {
        Errors.throwUnexpected(`Missing fake state: ${path}`)
      }
      return states.get(path) as ValueT
    },
    run: runner,
    writeJson: async (path, value) => {
      states.set(path, structuredClone(value))
    },
    writeLine: line => lines.push(line),
    writeText: async (path, value) => {
      files.set(path, value)
    },
  }
  return { calls, dependencies, files, greenTreeRecords, lines, repository, states }
}

Describe('finalize', () => {
  Test('refuses a branch that is not feat/* or is detached', async () => {
    const fake = fakeDependencies({ branch: '' })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies))
      .rejects.toThrow('requires a feat/* branch')

    const other = fakeDependencies({ branch: 'chore/something' })
    await Expect(FinalizeCommand.run({ repositoryRoot: '/repo' }, other.dependencies))
      .rejects.toThrow('requires a feat/* branch')
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
    fake.files.set(messagePath, 'Land example\n\n- Hand-edited by Ro.\n')
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

    Expect(fake.files.get(messagePath)).toBe('Land example\n\n- Hand-edited by Ro.\n')
    Expect(outcome.lines.some(line => line.includes('Merge message is current'))).toBe(true)
  })

  Test('redrafts when the recorded head sha no longer matches the current HEAD', async () => {
    const fake = fakeDependencies()
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Stale draft\n\n- From an earlier HEAD.\n')
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

    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).not.toBe('Stale draft\n\n- From an earlier HEAD.\n')
  })

  Test('a missing state file degrades to redrafting even when a matching message file already exists', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')

    await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    // No state exists to prove the file was written for this HEAD, so finalize cannot skip the step.
    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
  })

  Test('a malformed or older-version state file degrades to redrafting rather than failing the run', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(statePath, { headSha: 'mainsha00000000000000000000000000000000000', version: 0 })

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
    Expect(outcome.ok).toBe(false)
  })

  Test('an unreadable state file (bad JSON) degrades to redrafting rather than throwing', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
    const messagePath = '/repo/.artifacts/merge/feat/example.msg'
    fake.files.set(messagePath, 'Land example\n\n- Add the example workflow\n')
    const statePath = '/repo/.artifacts/merge/feat/example.state.json'
    fake.states.set(statePath, statePath) // exists() sees it; readJson will "succeed" oddly, so force a throw instead:
    fake.dependencies.readJson = async () => {
      throw new SyntaxError('Unexpected token')
    }

    const outcome = await FinalizeCommand.run({ repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
    Expect(outcome.ok).toBe(false)
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
    const fake = fakeDependencies()
    const outcome = await FinalizeCommand.run({ check: true, repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.calls.some(call => call.args[0] === 'merge' && call.args[1] === '--no-edit')).toBe(false)
    Expect(fake.calls.some(call => call.command === 'just')).toBe(false)
    Expect(fake.files.size).toBe(0)
    Expect(fake.states.size).toBe(0)
    Expect(outcome.lines.some(line => line.startsWith('PLAN'))).toBe(true)
    Expect(outcome.ok).toBe(false)
  })

  Test('--fresh ignores matching recorded state and redrafts anyway', async () => {
    const fake = fakeDependencies({ headSha: 'mainsha00000000000000000000000000000000000' })
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

    await FinalizeCommand.run({ fresh: true, repositoryRoot: '/repo' }, fake.dependencies)

    Expect(fake.files.get(messagePath)).toContain('DRAFT: ')
  })

  Test(
    'reports human-verification paths and an untouched developer-environment ledger as advisory, never gating ok',
    async () => {
      const fake = fakeDependencies({
        headSha: 'mainsha00000000000000000000000000000000000',
        diffPaths: ['packages/studio/studio-src/client/Editor.ts', 'packages/dev/dev-src/repository-tests/Finalize.ts'],
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
      Expect(outcome.lines.some(line => line.includes('packages/studio/studio-src/client/Editor.ts'))).toBe(true)
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
    const root = await FS.realPath(await mkTestDir('tao-finalize-'))
    const mainRoot = FS.resolvePath('main', root)
    const featureRoot = FS.resolvePath('feature', root)
    try {
      await gitCommand(root, ['init', '--quiet', '--initial-branch=main', mainRoot])
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
        exists: FS.exists,
        findGreenTree: async () => undefined,
        key: async () => ({ toolchain: 'irrelevant-in-this-fixture', treeHash: 'irrelevant-in-this-fixture' }),
        now: () => new Date('2026-09-17T12:00:00.000Z'),
        readJson: FS.readJson,
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
    } finally {
      await FS.remove(root)
    }
  })
})

async function gitCommand(cwd: string, args: readonly string[]): Promise<void> {
  const commandResult = await CLI.run('git', { args, cwd, stdio: 'pipe' })
  if (commandResult.exitCode !== 0) {
    throw new Errors.CommandExecutionError(commandResult)
  }
}
