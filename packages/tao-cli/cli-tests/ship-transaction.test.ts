import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { readProjectLock } from '../cli-src/ship-lock'
import { shipContentHash } from '../cli-src/ship-model'

const transactionModule = FS.resolvePath('packages/tao-cli/cli-src/ship-transaction.ts')
const lockModule = FS.resolvePath('packages/tao-cli/cli-src/ship-lock.ts')
const sharedModule = FS.resolvePath('packages/shared/shared-src/shared.ts')
const tsconfig = FS.resolvePath('packages/tao-cli/tsconfig.json')

Describe('tao ship cross-process transactions', () => {
  Test('elects one stale owner reclaimer across three forced contenders', async () => {
    const root = await mkTestDir('tao-ship-stale-transaction-')
    const repositoryKey = shipContentHash([await FS.realPath(root)])
    const coordinationRoot = FS.resolvePath(`tao-ship-coordination/${repositoryKey}`, FS.tmpdir())
    try {
      const ownerPath = FS.resolvePath('ship-transaction-stale.json', coordinationRoot)
      await FS.writeJson(ownerPath, { pid: Number.MAX_SAFE_INTEGER, token: 'stale' })
      await FS.symlink(FS.basename(ownerPath), FS.resolvePath('ship-transaction.lock', coordinationRoot))

      const results = await Promise.all(Array.from({ length: 3 }, (_, index) =>
        runWorker(`
          import { CLI, FS, Platform, Time } from ${JSON.stringify(sharedModule)}
          import { ShipTransactionTesting, withShipTransaction } from ${JSON.stringify(transactionModule)}
          const root = ${JSON.stringify(root)}
          const coordinationRoot = ${JSON.stringify(coordinationRoot)}
          const readyPath = FS.resolvePath(${JSON.stringify(`ready-${index}`)}, root)
          let replacementCheck
          ShipTransactionTesting.setStaleUnlinkDelay(75)
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
            replacementCheck = (async () => {
              await Time.sleep(100)
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
            await FS.writeText(readyPath, '')
            while ((await FS.listDir(root)).filter(entry => entry.startsWith('ready-')).length < 3) {
              await Time.sleep(5)
            }
            await withShipTransaction(root, async () => {
              await FS.writeText(FS.resolvePath(${JSON.stringify(`entered-${index}`)}, root), '')
              await Time.sleep(10)
            })
            await replacementCheck
          } finally {
            ShipTransactionTesting.setStaleUnlinkDelay(0)
            ShipTransactionTesting.setBeforeStaleUnlink(undefined)
          }
        `)))

      Expect(results.map(result => result.exitCode)).toEqual([0, 0, 0])
      Expect((await FS.listDir(root)).filter(entry => entry.startsWith('entered-')).toSorted()).toEqual([
        'entered-0',
        'entered-1',
        'entered-2',
      ])
      const replacementResults = (await FS.listDir(root)).filter(entry => entry.startsWith('replacement-'))
      Expect(replacementResults).toHaveLength(1)
      Expect(await FS.readJson(FS.resolvePath(replacementResults[0]!, root))).toEqual({ survived: true })
      Expect(await FS.exists(FS.resolvePath('ship-transaction.lock', coordinationRoot))).toBe(false)
    } finally {
      await FS.remove(coordinationRoot)
      await FS.remove(root)
    }
  })

  Test('serializes projects that share one Git repository', async () => {
    const root = await mkTestDir('tao-ship-repository-transaction-')
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
    const root = await mkTestDir('tao-ship-transaction-')
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
    const root = await mkTestDir('tao-ship-lock-writers-')
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
})

async function runWorker(source: string) {
  return await CLI.run('bun', {
    args: [`--tsconfig=${tsconfig}`, '-e', source],
  })
}
