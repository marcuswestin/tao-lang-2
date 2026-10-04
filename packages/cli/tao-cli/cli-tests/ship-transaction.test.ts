import { CLI, FS, Platform, Time } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test, until } from '@shared/test'
import { readProjectLock } from '../cli-src/ship-lock'
import { shipContentHash } from '../cli-src/ship-model'

const transactionModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-transaction.ts')
const lockModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-lock.ts')
const commandModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-command.ts')
const sharedModule = FS.resolvePath('packages/shared/shared-src/shared.ts')
const testModule = FS.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts')
const tsconfig = FS.resolvePath('packages/cli/tao-cli/tsconfig.json')

Describe('tao ship cross-process transactions', () => {
  Test('keeps one stale reclaimer across older and freshly started contenders', async () => {
    const root = await mkTestDir('tao-ship-stale-transaction-', { location: 'host' })
    const repositoryKey = shipContentHash([await FS.realPath(root)])
    const coordinationRoot = FS.resolvePath(`tao-ship-coordination/${repositoryKey}`, FS.tmpdir())
    const workers: Array<{ command: CLI.StartedCommand; result?: CLI.CommandCloseResult }> = []
    const startContender = (index: number) => {
      const command = CLI.start('bun', {
        args: [`--tsconfig=${tsconfig}`, '-e', staleContenderSource(root, coordinationRoot, index)],
        onOutput: () => {},
        processPolicy: 'test',
        stdio: 'pipe',
        timeoutMs: 30_000,
      })
      const worker: (typeof workers)[number] = { command }
      workers.push(worker)
      void command.waitForClose().then(result => worker.result = result)
    }
    try {
      const ownerPath = FS.resolvePath('ship-transaction-stale.json', coordinationRoot)
      await FS.writeJson(ownerPath, { pid: await exitedChildPid(), token: 'stale' })
      await FS.symlink(FS.basename(ownerPath), FS.resolvePath('ship-transaction.lock', coordinationRoot))

      startContender(0)
      const claimPath = FS.resolvePath(
        'ship-transaction-reclaim-ship-transaction-stale.json.lock',
        coordinationRoot,
      )
      await until(async () => await FS.exists(FS.resolvePath('hook-0', root)), {
        description: 'the first contender to hold the stale reclaim claim before unlinking',
      })
      Expect(await FS.exists(claimPath)).toBe(true)
      startContender(1)
      startContender(2)
      await until(
        async () =>
          await FS.exists(FS.resolvePath('contested-1', root)) && await FS.exists(FS.resolvePath('contested-2', root)),
        {
          description: 'both fresh contenders to receive EEXIST from the held fixed reclaim claim',
        },
      )
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('hook-'))).toEqual(['hook-0'])
      await FS.writeText(FS.resolvePath('release-reclaim', root), '')
      await until(
        async () => await FS.exists(FS.resolvePath('ready-replacement', root)) && !await FS.exists(claimPath),
        {
          description:
            'the reclaimer to leave its destructive edge and release its claim after observing the replacement',
        },
      )
      await FS.writeText(FS.resolvePath('verify-replacement', root), '')
      await until(() => workers.every(worker => worker.result !== undefined), {
        description: 'the ship contenders to finish',
      })

      Expect(workers.map(worker => worker.result?.exitCode)).toEqual([0, 0, 0])
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('entered-')).toSorted()).toEqual([
        'entered-0',
        'entered-1',
        'entered-2',
      ])
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('hook-'))).toEqual(['hook-0'])
      const replacementResults = (await FS.listDir(root)).filter(entry => entry.startsWith('replacement-'))
      Expect(replacementResults).toHaveLength(1)
      Expect(await FS.readJson(FS.resolvePath(replacementResults[0]!, root))).toEqual({ survived: true })
      Expect(await FS.exists(FS.resolvePath('ship-transaction.lock', coordinationRoot))).toBe(false)
    } finally {
      for (const worker of workers) {
        worker.command.kill('SIGKILL')
      }
      await until(() => workers.every(worker => worker.result !== undefined), {
        description: 'the owned ship workers to close after cleanup',
      })
      for (const worker of workers) {
        worker.command.dispose()
      }
      await FS.remove(coordinationRoot)
      await FS.remove(root)
    }
  })

  Test('reacquires a stale-owner claim displaced while the claimant is alive', async () => {
    const root = await mkTestDir('tao-ship-displaced-claim-', { location: 'host' })
    const repositoryKey = shipContentHash([await FS.realPath(root)])
    const coordinationRoot = FS.resolvePath(`tao-ship-coordination/${repositoryKey}`, FS.tmpdir())
    const staleOwnerPath = FS.resolvePath('ship-transaction-stale.json', coordinationRoot)
    const lockPath = FS.resolvePath('ship-transaction.lock', coordinationRoot)
    const claimPath = FS.resolvePath(
      'ship-transaction-reclaim-ship-transaction-stale.json.lock',
      coordinationRoot,
    )
    await FS.writeJson(staleOwnerPath, { pid: await exitedChildPid(), token: 'stale' })
    await FS.symlink(FS.basename(staleOwnerPath), lockPath)
    const worker = CLI.start('bun', {
      args: [
        `--tsconfig=${tsconfig}`,
        '-e',
        `
          import { Errors, FS, Time } from ${JSON.stringify(sharedModule)}
          import { ShipTransactionTesting, withShipTransaction } from ${JSON.stringify(transactionModule)}
          ShipTransactionTesting.setBeforeStaleUnlink(async () => {
            await FS.writeText(${JSON.stringify(FS.resolvePath('reclaim-ready', root))}, '')
            const ready = await Time.pollUntil(() => FS.exists(${
          JSON.stringify(FS.resolvePath('claim-displaced', root))
        }), {
              intervalMs: 5,
              timeoutMs: 30_000,
            })
            if (!ready) Errors.throwUnexpected('Timed out waiting for claim displacement')
          })
          try {
            await withShipTransaction(${JSON.stringify(root)}, async () => {
              await FS.writeText(${JSON.stringify(FS.resolvePath('entered', root))}, '')
            })
          } finally {
            ShipTransactionTesting.setBeforeStaleUnlink(undefined)
          }
        `,
      ],
    })
    try {
      const claimInstalled = await Time.pollUntil(async () => await FS.exists(FS.resolvePath('reclaim-ready', root)), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      Expect(claimInstalled).toBe(true)
      const displacedPath = FS.resolvePath('displaced-live-claim.lock', coordinationRoot)
      await FS.move(claimPath, displacedPath)
      await FS.remove(displacedPath)
      await FS.writeText(FS.resolvePath('claim-displaced', root), '')

      const completed = await Time.pollUntil(() => worker.exitCode !== null, {
        intervalMs: 10,
        timeoutMs: 30_000,
      })
      if (!completed) {
        worker.kill('SIGKILL')
      }
      const result = await worker.waitForClose()
      Expect(completed).toBe(true)
      Expect(result.exitCode).toBe(0)
      Expect(await FS.exists(FS.resolvePath('entered', root))).toBe(true)
    } finally {
      if (worker.exitCode === null) {
        worker.kill('SIGKILL')
        await worker.waitForClose()
      }
      worker.dispose()
      await FS.remove(coordinationRoot)
      await FS.remove(root)
    }
  })

  Test('serializes projects that share one Git repository', async () => {
    const root = await mkGitTestDir('tao-ship-repository-transaction-')
    await initGitTestRepository(root)
    const projects = [FS.resolvePath('one', root), FS.resolvePath('two', root)]
    await Promise.all(projects.map(FS.mkdir))
    const results = await Promise.all(projects.map((project, index) =>
      runWorker(`
      import { withShipTransaction } from ${JSON.stringify(transactionModule)}
      import { FS } from ${JSON.stringify(sharedModule)}
      const marker = ${JSON.stringify(FS.resolvePath('inside.lock', root))}
      await withShipTransaction(${JSON.stringify(project)}, async () => {
        await FS.symlink(${JSON.stringify(String(index))}, marker)
        await new Promise(resolve => setTimeout(resolve, 60))
        await FS.remove(marker)
      })
    `)
    ))
    Expect(results.map(result => result.exitCode)).toEqual([0, 0])
  })

  Test('admits only one independent ship process at a time', async () => {
    const root = await mkTestDir('tao-ship-transaction-', { location: 'host' })
    try {
      const results = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          runWorker(`
          import { withShipTransaction } from ${JSON.stringify(transactionModule)}
          import { FS } from ${JSON.stringify(sharedModule)}
          const root = ${JSON.stringify(root)}
          const marker = FS.resolvePath('inside.lock', root)
          await withShipTransaction(root, async () => {
            await FS.symlink(${JSON.stringify(String(index))}, marker)
            await new Promise(resolve => setTimeout(resolve, 60))
            await FS.remove(marker)
          })
        `)),
      )
      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0])
      Expect(await FS.exists(FS.resolvePath('inside.lock', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('merges fresh app checkpoints from independent writers', async () => {
    const root = await mkTestDir('tao-ship-lock-writers-', { location: 'host' })
    try {
      const results = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          runWorker(`
          import { writeProjectLock } from ${JSON.stringify(lockModule)}
          const identity = ${JSON.stringify('app-')} + ${index}
          await writeProjectLock(${JSON.stringify(root)}, {
            schemaVersion: 1,
            ship: { apps: { [identity]: {
              identity,
              inputHash: identity,
              provenance: { at: '2026-09-16T00:00:00.000Z', command: 'tao ship', version: 1 },
              status: 'suggested',
            } } },
          })
        `)),
      )
      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0])
      Expect(Object.keys((await readProjectLock(root)).ship?.apps ?? {}).toSorted()).toEqual([
        'app-0',
        'app-1',
        'app-2',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('preserves a fresh installs concern when a stale ship process checkpoints', async () => {
    const root = await mkTestDir('tao-ship-lock-concerns-', { location: 'host' })
    const staleInstalls = installsLock('stale')
    const freshInstalls = installsLock('fresh')
    try {
      await writeInstalls(root, staleInstalls)
      const preparedPath = FS.resolvePath('ship-prepared', root)
      const checkpointPath = FS.resolvePath('ship-checkpoint', root)
      const ship = runWorker(`
        import { Errors, FS, Time } from ${JSON.stringify(sharedModule)}
        import { acceptedEntryWithRunState } from ${JSON.stringify(commandModule)}
        import { writeProjectLock } from ${JSON.stringify(lockModule)}
        const root = ${JSON.stringify(root)}
        const entry = {
          identity: 'notes/Notes',
          inputHash: 'old-input',
          provenance: { at: '2026-09-16T00:00:00.000Z', command: 'tao ship', version: 1 },
          status: 'accepted',
        }
        const prepared = {
          inputHash: 'current-input',
          lock: { schemaVersion: 1, installs: ${JSON.stringify(staleInstalls)} },
        }
        await FS.writeText(${JSON.stringify(preparedPath)}, '')
        const ready = await Time.pollUntil(() => FS.exists(${JSON.stringify(checkpointPath)}), {
          intervalMs: 5,
          timeoutMs: 30_000,
        })
        if (!ready) Errors.throwUnexpected('Timed out waiting for the fresh installs checkpoint')
        await writeProjectLock(root, acceptedEntryWithRunState(prepared, entry))
      `)
      const prepared = await Time.pollUntil(async () => await FS.exists(preparedPath), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      Expect(prepared).toBe(true)
      await writeInstalls(root, freshInstalls)
      await FS.writeText(checkpointPath, '')
      Expect((await ship).exitCode).toBe(0)

      const lock = await readProjectLock(root)
      Expect(lock.installs).toEqual({
        lockfileVersion: 2,
        environments: {
          fresh: {
            projectRoot: 'fresh',
            npm: { fresh: { name: 'fresh', requested: 'fresh-ref', version: 'fresh-version' } },
            publications: [],
          },
          stale: {
            projectRoot: 'stale',
            npm: { stale: { name: 'stale', requested: 'stale-ref', version: 'stale-version' } },
            publications: [],
          },
        },
        local: {},
      })
      Expect(lock.ship?.apps['notes/Notes']?.inputHash).toBe('current-input')
    } finally {
      await FS.remove(root)
    }
  })
})

async function exitedChildPid(): Promise<number> {
  const exited = CLI.start(Platform.runtimeProcess.execPath, {
    args: ['--eval', ''],
    stdio: 'pipe',
  })
  const pid = exited.pid ?? 0
  try {
    Expect((await exited.waitForClose()).exitCode).toBe(0)
  } finally {
    exited.dispose()
  }
  Expect(pid).toBeGreaterThan(0)
  Expect(Platform.processIsAlive(pid)).toBe(false)
  return pid
}

async function runWorker(source: string) {
  return await CLI.run('bun', {
    args: [`--tsconfig=${tsconfig}`, '-e', source],
  })
}

function staleContenderSource(root: string, coordinationRoot: string, index: number): string {
  return `
    const shared = { ...await import(${JSON.stringify(sharedModule)}) }
    const { CLI, Errors, FS, Platform, Time } = shared
    const { MockModule } = await import(${JSON.stringify(testModule)})
    const root = ${JSON.stringify(root)}
    const coordinationRoot = ${JSON.stringify(coordinationRoot)}
    const claimPath = FS.resolvePath('ship-transaction-reclaim-ship-transaction-stale.json.lock', coordinationRoot)
    const symlink = FS.symlink
    MockModule('@shared', () => ({ ...shared, FS: { ...FS, symlink: async (target, path) => {
      try {
        return await symlink(target, path)
      } catch (error) {
        if (path === claimPath && error.code === 'EEXIST') {
          await FS.writeText(FS.resolvePath(${JSON.stringify(`contested-${index}`)}, root), '')
        }
        throw error
      }
    } } }))
    const { ShipTransactionTesting, withShipTransaction } = await import(${JSON.stringify(transactionModule)})
    let replacementCheck
    async function waitFor(name) {
      const ready = await Time.pollUntil(() => FS.exists(FS.resolvePath(name, root)), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      if (!ready) Errors.throwUnexpected('Timed out waiting for fixture handshake: ' + name)
    }
    ShipTransactionTesting.setBeforeStaleUnlink(async linkPath => {
      await FS.writeText(FS.resolvePath(${JSON.stringify(`hook-${index}`)}, root), '')
      await waitFor('release-reclaim')
      const replacement = FS.resolvePath(${
    JSON.stringify(`ship-transaction-replacement-${index}.json`)
  }, coordinationRoot)
      const replacementLink = FS.resolvePath(${
    JSON.stringify(`ship-transaction-replacement-${index}.lock`)
  }, coordinationRoot)
      await FS.writeJson(replacement, { pid: Platform.runtimeProcess.pid, token: 'replacement' })
      await FS.symlink(FS.basename(replacement), replacementLink)
      await FS.move(replacementLink, linkPath)
      await FS.writeText(FS.resolvePath('ready-replacement', root), '')
      replacementCheck = (async () => {
        await waitFor('verify-replacement')
        const target = await CLI.run('/usr/bin/readlink', { args: [linkPath] })
        const survived = target.stdout.trim() === FS.basename(replacement)
        await FS.writeJson(FS.resolvePath(${JSON.stringify(`replacement-${index}.json`)}, root), { survived })
        if (survived) {
          await FS.remove(linkPath)
        }
        await FS.remove(replacementLink)
        await FS.remove(replacement)
      })()
    })
    try {
      await withShipTransaction(root, async () => {
        await FS.writeText(FS.resolvePath(${JSON.stringify(`entered-${index}`)}, root), '')
      })
      await replacementCheck
    } finally {
      ShipTransactionTesting.setBeforeStaleUnlink(undefined)
    }
  `
}

function installsLock(label: string) {
  return {
    lockfileVersion: 2 as const,
    environments: {
      [label]: {
        projectRoot: label,
        npm: { [label]: { name: label, requested: `${label}-ref`, version: `${label}-version` } },
        publications: [],
      },
    },
    local: {},
  }
}

async function writeInstalls(root: string, installs: ReturnType<typeof installsLock>): Promise<void> {
  const result = await runWorker(`
    import { writeProjectLock } from ${JSON.stringify(lockModule)}
    await writeProjectLock(${JSON.stringify(root)}, { schemaVersion: 1, installs: ${JSON.stringify(installs)} })
  `)
  Expect(result.exitCode).toBe(0)
}
