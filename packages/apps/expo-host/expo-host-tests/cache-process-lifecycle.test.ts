import { CLI, FS, Platform } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { JestTransformCache } from '../expo-host-src/testing/jest-transform-cache'
import { TestRunRoot } from '../expo-host-src/testing/test-run-root'

const packageRoot = FS.resolvePath('packages/apps/expo-host')
const sharedModule = FS.resolvePath('packages/shared/shared-src/shared.ts')
const hour = 60 * 60 * 1000
type CacheKind = 'managed' | 'direct'
type DirectCache = {
  start: (root: string, options?: { maxIdentities: number }) => Promise<string>
  finish: (root: string, lease: string, options?: { maxIdentities: number }) => Promise<void>
}
const direct = require('../jest-direct-cache.cjs') as DirectCache

function startWorker(home: string, source: string) {
  let output = ''
  const child = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      `--tsconfig=${FS.resolvePath('tsconfig.json', packageRoot)}`,
      '-e',
      `import { FS, Time } from ${JSON.stringify(sharedModule)};
       import { JestTransformCache } from ${
        JSON.stringify(FS.resolvePath('expo-host-src/testing/jest-transform-cache.ts', packageRoot))
      };
       import { TestRunRoot } from ${
        JSON.stringify(FS.resolvePath('expo-host-src/testing/test-run-root.ts', packageRoot))
      };
       const direct = require(${JSON.stringify(FS.resolvePath('jest-direct-cache.cjs', packageRoot))});
       ${source}`,
    ],
    env: { NODE_ENV: 'test', TAO_HOME: home, HOME: FS.resolvePath('login-home', home) },
    processPolicy: 'test',
    stdio: 'pipe',
    onOutput: (_stream, chunk) => {
      output += chunk.toString()
    },
  })
  return {
    child,
    async finished() {
      Expect(await child.waitForClose()).toEqual({ exitCode: 0, signal: null })
      Expect(output).toBe('')
      child.dispose()
    },
    async ready(path: string) {
      await until(async () => {
        Expect({ error: child.error, exitCode: child.exitCode, signal: child.signalCode, output })
          .toEqual({ error: undefined, exitCode: null, signal: null, output: '' })
        return await FS.isFile(path)
      }, { description: `worker receipt ${FS.basename(path)}` })
    },
    async stop() {
      child.kill('SIGKILL')
      await child.waitForClose()
      child.dispose()
    },
  }
}

async function runCache(kind: CacheKind, root: string): Promise<void> {
  if (kind === 'managed') {
    await JestTransformCache.run(root, async directory => {
      await FS.writeText(FS.resolvePath('transform', directory), 'reusable')
    }, { root, maxIdentities: 1 })
  } else {
    const lease = await direct.start(root, { maxIdentities: 1 })
    await FS.writeText(FS.resolvePath('data/transform', root), 'reusable')
    await direct.finish(root, lease, { maxIdentities: 1 })
  }
}

function heldReader(kind: CacheKind, root: string, ready: string): string {
  const work = `async directory => {
    await FS.writeText(FS.resolvePath('transform', directory), 'live reader');
    await FS.writeText(${JSON.stringify(ready)}, 'ready');
    await new Promise(() => { setInterval(() => {}, 1000) });
  }`
  return kind === 'managed'
    ? `await JestTransformCache.run(${JSON.stringify(root)}, ${work}, { root: ${
      JSON.stringify(root)
    }, maxIdentities: 1 });`
    : `const root = ${JSON.stringify(root)};
       const lease = await direct.start(root, { maxIdentities: 1 });
       try { await (${work})(FS.resolvePath('data', root)); }
       finally { await direct.finish(root, lease, { maxIdentities: 1 }); }`
}

Describe('cache process lifecycle', () => {
  for (const kind of ['managed', 'direct'] as const) {
    Test(`${kind} cache plateaus across fresh processes without writing to the login-home cache`, async () => {
      const home = await mkTestDir(`cache-process-plateau-${kind}-`)
      const namespace = kind === 'managed' ? 'jest-transform-cache-v2' : 'jest-standalone-v2'
      const legacy = FS.resolvePath(`login-home/.cache/tao/${namespace.replace('-v2', '')}/sentinel`, home)
      await FS.writeText(legacy, 'preserve legacy')
      try {
        const counts: number[] = []
        for (let index = 0; index < 5; index += 1) {
          const runtime = FS.resolvePath(`runtime-${index}`, home)
          const source = kind === 'managed'
            ? `const root = JestTransformCache.root(${JSON.stringify(runtime)});
               await JestTransformCache.run(${JSON.stringify(runtime)}, async data => {
                 await FS.writeText(FS.resolvePath('transform', data), 'reuse');
               }, { maxIdentities: 2, maxTotalFiles: 2, maxTotalBytes: 10 });`
            : `const root = direct.root(${JSON.stringify(runtime)});
               const options = { maxIdentities: 2, maxTotalFiles: 2, maxTotalBytes: 10 };
               const lease = await direct.start(root, options);
               await FS.writeText(FS.resolvePath('data/transform', root), 'reuse');
               await direct.finish(root, lease, options);`
          const worker = startWorker(home, source)
          try {
            await worker.finished()
          } finally {
            await worker.stop()
          }
          const parent = FS.resolvePath(`cache/${namespace}`, home)
          const identities = (await FS.listDir(parent)).filter(name => /^[0-9a-f]{16}$/.test(name))
          counts.push(identities.length)
          for (const identity of identities) {
            Expect(await FS.readText(FS.resolvePath(`${identity}/data/transform`, parent))).toBe('reuse')
            Expect(await FS.listDir(FS.resolvePath(`${identity}/leases`, parent))).toEqual([])
          }
        }
        Expect(counts).toEqual([1, 2, 2, 2, 2])
        Expect(await FS.readText(legacy)).toBe('preserve legacy')
        const loginFiles: string[] = []
        for await (const path of FS.walk(FS.resolvePath('login-home/.cache', home), { includeHidden: true })) {
          if (await FS.isFile(path)) {
            loginFiles.push(path)
          }
        }
        Expect(loginFiles).toEqual([legacy])
        Expect(await FS.exists(FS.resolvePath('login-home/.tao', home))).toBe(false)
      } finally {
        await FS.remove(home)
      }
    })

    Test(`${kind} cache waits behind another process lock before registering its reader`, async () => {
      const parent = await mkTestDir(`cache-process-lock-${kind}-`)
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const ready = FS.resolvePath('ready', parent)
      const lockName = kind === 'managed' ? 'coordination.tao-file-mutation.lock' : '.coordination.lock'
      const lock = FS.resolvePath(lockName, parent)
      const release = Deferred()
      const acquired = Deferred()
      const holding = kind === 'managed'
        ? FS.withFileMutationLock(FS.resolvePath('coordination', parent), parent, async () => {
          acquired.resolve()
          await release.promise
        })
        : FS.writeJson(lock, { pid: Platform.runtimeProcess.pid, token: 'parent' }).then(async () => {
          acquired.resolve()
          await release.promise
          await FS.remove(lock)
        })
      await acquired.promise
      const worker = startWorker(parent, heldReader(kind, root, ready))
      try {
        // Seeing an actual claim while the parent's lock is held proves overlap without a sleep.
        await until(async () =>
          await FS.isFile(ready)
          || (await FS.listDir(parent)).some(name => name.startsWith(`${lockName}.owner-`)), {
          description: 'a competing cache lock claim',
        })
        Expect(await FS.isFile(ready)).toBe(false)
        Expect(await FS.readJson(lock)).toMatchObject({ pid: Platform.runtimeProcess.pid })
        Expect(await FS.exists(FS.resolvePath('leases', root))).toBe(false)
        release.resolve()
        await holding
        await worker.ready(ready)
        Expect(await FS.readText(FS.resolvePath('data/transform', root))).toBe('live reader')
      } finally {
        release.resolve()
        await holding
        await worker.stop()
        await FS.remove(parent)
      }
    })

    Test(`${kind} cache protects a real live and killed reader, then retires it after grace`, async () => {
      const parent = await mkTestDir(`cache-process-kill-${kind}-`)
      const root = FS.resolvePath('aaaaaaaaaaaaaaaa', parent)
      const next = FS.resolvePath('bbbbbbbbbbbbbbbb', parent)
      const ready = FS.resolvePath('ready', parent)
      const worker = startWorker(parent, heldReader(kind, root, ready))
      try {
        await worker.ready(ready)
        const leases = FS.resolvePath('leases', root)
        const names = await FS.listDir(leases)
        Expect(names).toHaveLength(1)
        Expect(names[0]).toMatch(new RegExp(`^${worker.child.pid}-`))
        const lease = FS.resolvePath(names[0]!, leases)
        await FS.setModifiedTimeMs(lease, Date.now() - 2 * hour)
        await runCache(kind, next)
        Expect(await FS.readText(FS.resolvePath('data/transform', root))).toBe('live reader')
        await FS.setModifiedTimeMs(lease, Date.now())
        await worker.stop()
        Expect(Platform.processIsAlive(worker.child.pid!)).toBe(false)
        await runCache(kind, next)
        Expect(await FS.readText(FS.resolvePath('data/transform', root))).toBe('live reader')
        Expect(await FS.listDir(leases)).toEqual(names)
        // Advance only this killed owner's lease, retaining real process identity and disk state.
        await FS.setModifiedTimeMs(lease, Date.now() - 2 * hour)
        await runCache(kind, next)
        Expect(await FS.exists(root)).toBe(false)
        Expect(await FS.readText(FS.resolvePath('data/transform', next))).toBe('reusable')
        Expect(await FS.listDir(FS.resolvePath('leases', next))).toEqual([])
      } finally {
        await worker.stop()
        await FS.remove(parent)
      }
    })
  }

  Test('retained test roots preserve a real reader and recover a killed owner after handoff grace', async () => {
    const parent = await mkTestDir('test-roots-process-kill-')
    const ready = FS.resolvePath('ready', parent)
    const worker = startWorker(
      parent,
      `
      const runtimePackageRoot = ${JSON.stringify(FS.resolvePath('runtime', parent))};
      const run = await TestRunRoot.create('process-test', {
        runtimePackageRoot, generatedRoot: TestRunRoot.hostGeneratedRoot(runtimePackageRoot)
      });
      await FS.writeText(FS.resolvePath('output.ts', run), 'retained');
      await FS.writeJson(${JSON.stringify(`${ready}.pending`)}, { run });
      await FS.move(${JSON.stringify(`${ready}.pending`)}, ${JSON.stringify(ready)});
      await new Promise(() => { setInterval(() => {}, 1000) });
    `,
    )
    try {
      await worker.ready(ready)
      const { run } = await FS.readJson<{ run: string }>(ready)
      const identity = FS.dirname(FS.dirname(FS.dirname(run)))
      const aggregate = FS.dirname(identity)
      const owner = FS.resolvePath(`.owners/${worker.child.pid}.json`, identity)
      Expect(await FS.readJson(owner)).toMatchObject({ pid: worker.child.pid, version: 1 })
      await TestRunRoot.pruneHostAggregate(aggregate, undefined, 0, true, 0)
      Expect(await FS.readText(FS.resolvePath('output.ts', run))).toBe('retained')
      const old = Date.now() - 26 * hour
      const receipt = await FS.readJson<Record<string, unknown>>(owner)
      // Run IDs encode activity too: keep the actual generated tree but age its owned run name.
      const agedRun = FS.resolvePath(`run-${old}-aged`, FS.dirname(run))
      await FS.move(run, agedRun)
      const age = async () => {
        await FS.writeJson(owner, { ...receipt, updatedAt: new Date(old).toISOString() })
        for await (const path of FS.walk(identity, { includeHidden: true })) {
          await FS.setModifiedTimeMs(path, old)
        }
        await FS.setModifiedTimeMs(identity, old)
      }
      await age()
      await TestRunRoot.pruneHostAggregate(aggregate, undefined, 0, true, 0)
      Expect(await FS.readText(FS.resolvePath('output.ts', agedRun))).toBe('retained')
      await FS.writeJson(owner, { ...receipt, updatedAt: new Date().toISOString() })
      await worker.stop()
      Expect(Platform.processIsAlive(worker.child.pid!)).toBe(false)
      await TestRunRoot.pruneHostAggregate(aggregate, undefined, 0, true, 0)
      Expect(await FS.readText(FS.resolvePath('output.ts', agedRun))).toBe('retained')
      await age()
      await TestRunRoot.pruneHostAggregate(aggregate, undefined, 0, true, 0)
      Expect(await FS.exists(identity)).toBe(false)
    } finally {
      await worker.stop()
      await FS.remove(parent)
    }
  })
})
