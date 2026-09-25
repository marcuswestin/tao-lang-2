import { CLI, FS, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { readProjectLock } from '../cli-src/ship-lock'
import { shipContentHash } from '../cli-src/ship-model'

const transactionModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-transaction.ts')
const lockModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-lock.ts')
const commandModule = FS.resolvePath('packages/cli/tao-cli/cli-src/ship-command.ts')
const sharedModule = FS.resolvePath('packages/shared/shared-src/shared.ts')
const tsconfig = FS.resolvePath('packages/cli/tao-cli/tsconfig.json')

Describe('tao ship cross-process transactions', () => {
  Test('keeps one stale reclaimer across older and freshly started contenders', async () => {
    const root = await mkTestDir('tao-ship-stale-transaction-', { location: 'host' })
    const repositoryKey = shipContentHash([await FS.realPath(root)])
    const coordinationRoot = FS.resolvePath(`tao-ship-coordination/${repositoryKey}`, FS.tmpdir())
    try {
      const ownerPath = FS.resolvePath('ship-transaction-stale.json', coordinationRoot)
      await FS.writeJson(ownerPath, { pid: Number.MAX_SAFE_INTEGER, token: 'stale' })
      await FS.symlink(FS.basename(ownerPath), FS.resolvePath('ship-transaction.lock', coordinationRoot))

      const longLived = runWorker(staleContenderSource(root, coordinationRoot, 0, 300))
      const claimPath = FS.resolvePath(
        'ship-transaction-reclaim-ship-transaction-stale.json.lock',
        coordinationRoot,
      )
      const claimInstalled = await Time.pollUntil(async () => await FS.exists(claimPath), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      Expect(claimInstalled).toBe(true)

      const freshOne = runWorker(staleContenderSource(root, coordinationRoot, 1, 0))
      await Time.sleep(40)
      const freshTwo = runWorker(staleContenderSource(root, coordinationRoot, 2, 0))
      const results = await Promise.all([longLived, freshOne, freshTwo])

      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0])
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('entered-')).toSorted()).toEqual([
        'entered-0',
        'entered-1',
        'entered-2',
      ])
      const clocks = await Promise.all(
        [0, 1, 2].map(async index => await FS.readJson<{ now: number }>(FS.resolvePath(`clock-${index}.json`, root))),
      )
      Expect(clocks[0]!.now).toBeGreaterThan(clocks[1]!.now + 200)
      Expect(clocks[0]!.now).toBeGreaterThan(clocks[2]!.now + 200)
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('hook-'))).toEqual(['hook-0'])
      const replacementResults = (await FS.listDir(root)).filter(entry => entry.startsWith('replacement-'))
      Expect(replacementResults).toHaveLength(1)
      Expect(await FS.readJson(FS.resolvePath(replacementResults[0]!, root))).toEqual({ survived: true })
      Expect(await FS.exists(FS.resolvePath('ship-transaction.lock', coordinationRoot))).toBe(false)
    } finally {
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
    await FS.writeJson(staleOwnerPath, { pid: Number.MAX_SAFE_INTEGER, token: 'stale' })
    await FS.symlink(FS.basename(staleOwnerPath), lockPath)
    const worker = CLI.start('bun', {
      args: [
        `--tsconfig=${tsconfig}`,
        '-e',
        `
          import { FS } from ${JSON.stringify(sharedModule)}
          import { ShipTransactionTesting, withShipTransaction } from ${JSON.stringify(transactionModule)}
          ShipTransactionTesting.setStaleUnlinkDelay(250)
          try {
            await withShipTransaction(${JSON.stringify(root)}, async () => {
              await FS.writeText(${JSON.stringify(FS.resolvePath('entered', root))}, '')
            })
          } finally {
            ShipTransactionTesting.setStaleUnlinkDelay(0)
          }
        `,
      ],
    })
    try {
      const claimInstalled = await Time.pollUntil(async () => await FS.exists(claimPath), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      Expect(claimInstalled).toBe(true)
      const displacedPath = FS.resolvePath('displaced-live-claim.lock', coordinationRoot)
      await FS.move(claimPath, displacedPath)
      await FS.remove(displacedPath)

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
    const root = await mkTestDir('tao-ship-repository-transaction-', { location: 'host' })
    try {
      await CLI.mustRun('git', { args: ['-C', root, 'init', '-q'] })
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
    } finally {
      await FS.remove(root)
    }
  })

  Test('admits only one independent ship process at a time', async () => {
    const root = await mkTestDir('tao-ship-transaction-', { location: 'host' })
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
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
      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0])
      Expect(await FS.exists(FS.resolvePath('inside.lock', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('merges fresh app checkpoints from independent writers', async () => {
    const root = await mkTestDir('tao-ship-lock-writers-', { location: 'host' })
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
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
      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0])
      Expect(Object.keys((await readProjectLock(root)).ship?.apps ?? {}).toSorted()).toEqual([
        'app-0',
        'app-1',
        'app-2',
        'app-3',
        'app-4',
        'app-5',
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
      const ship = runWorker(`
        import { FS, Time } from ${JSON.stringify(sharedModule)}
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
        await Time.sleep(150)
        await writeProjectLock(root, acceptedEntryWithRunState(prepared, entry))
      `)
      const prepared = await Time.pollUntil(async () => await FS.exists(preparedPath), {
        intervalMs: 5,
        timeoutMs: 30_000,
      })
      Expect(prepared).toBe(true)
      await writeInstalls(root, freshInstalls)
      Expect((await ship).exitCode).toBe(0)

      const lock = await readProjectLock(root)
      Expect(lock.installs).toEqual(freshInstalls)
      Expect(lock.ship?.apps['notes/Notes']?.inputHash).toBe('current-input')
    } finally {
      await FS.remove(root)
    }
  })
})

async function runWorker(source: string) {
  return await CLI.run('bun', {
    args: [`--tsconfig=${tsconfig}`, '-e', source],
  })
}

function staleContenderSource(root: string, coordinationRoot: string, index: number, initialDelayMs: number): string {
  return `
    import { CLI, FS, Platform, Time } from ${JSON.stringify(sharedModule)}
    import { ShipTransactionTesting, withShipTransaction } from ${JSON.stringify(transactionModule)}
    const root = ${JSON.stringify(root)}
    const coordinationRoot = ${JSON.stringify(coordinationRoot)}
    let replacementCheck
    await Time.sleep(${initialDelayMs})
    await FS.writeJson(FS.resolvePath(${JSON.stringify(`clock-${index}.json`)}, root), { now: Time.nowMs() })
    ShipTransactionTesting.setStaleUnlinkDelay(250)
    ShipTransactionTesting.setBeforeStaleUnlink(async linkPath => {
      const replacement = FS.resolvePath(${
    JSON.stringify(`ship-transaction-replacement-${index}.json`)
  }, coordinationRoot)
      const replacementLink = FS.resolvePath(${
    JSON.stringify(`ship-transaction-replacement-${index}.lock`)
  }, coordinationRoot)
      await FS.writeJson(replacement, { pid: Platform.runtimeProcess.pid, token: 'replacement' })
      await FS.symlink(FS.basename(replacement), replacementLink)
      await FS.move(replacementLink, linkPath)
      await FS.writeText(FS.resolvePath(${JSON.stringify(`hook-${index}`)}, root), '')
      replacementCheck = (async () => {
        await Time.sleep(150)
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
        await Time.sleep(10)
      })
      await replacementCheck
    } finally {
      ShipTransactionTesting.setStaleUnlinkDelay(0)
      ShipTransactionTesting.setBeforeStaleUnlink(undefined)
    }
  `
}

function installsLock(label: string) {
  return {
    lockfileVersion: 1 as const,
    projects: {
      [label]: { projectId: label, resolvedCommit: `${label}-commit` },
    },
    requires: {
      [label]: { ref: `${label}-ref` },
    },
  }
}

async function writeInstalls(root: string, installs: ReturnType<typeof installsLock>): Promise<void> {
  const result = await runWorker(`
    import { writeProjectLock } from ${JSON.stringify(lockModule)}
    await writeProjectLock(${JSON.stringify(root)}, { schemaVersion: 1, installs: ${JSON.stringify(installs)} })
  `)
  Expect(result.exitCode).toBe(0)
}
