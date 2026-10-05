import { discoverProjectTaoFiles } from '@compiler/workspace'
import { Assert, CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, runCleanups, Test, withCapturedOutput } from '@shared/test'
import { StudioCanvasViewportStore } from '@studio'
import { StudioMac2TestRun } from '../studio-tooling-src/StudioMac2TestRun'

type SmokeEntry = 'studio-host-control' | 'studio-mac2-acceptance' | 'studio-simulated-user'
type HarnessOptions = {
  browser?: boolean
  failCleanup?: string
  failNativeStart?: boolean
  failProjectRealPath?: boolean
  failSecondServer?: boolean
  journeyFailure?: boolean
}

/** Execute the actual entry callback with local dependencies, without registering or launching a host smoke. */
async function withSmokeEntry(
  entry: SmokeEntry,
  options: HarnessOptions,
  check: (harness: {
    root: string
    projectRoot: string
    runtimeRoot: string
    stopped: string[]
    invocationRoots: string[]
    allocatedRoots: string[]
    run: () => Promise<void>
  }) => Promise<void>,
) {
  const root = await mkTestDir('tao-smoke-cleanup-source-')
  const projectRoot = FS.resolvePath('source-project-1', root)
  const runtimeRoot = FS.resolvePath('preview-runtime-1', root)
  const invocationRoots: string[] = []
  const allocatedRoots: string[] = []
  const invocationRoot = () => invocationRoots.at(-1)!
  const stopped: string[] = []
  const stop = (label: string) => {
    stopped.push(label)
    if (options.failCleanup === label) {
      Errors.throwHostEnvironment(`${label} shutdown failed.`)
    }
  }
  let serverCount = 0
  const callbacks: (() => Promise<void>)[] = []
  let source = await FS.readText(
    Repo.resolvePath(`packages/ides/studio-tooling/studio-smoke/${entry}.test.ts`),
  )
  if (entry === 'studio-mac2-acceptance') {
    // The fixed entry now delegates to its private fixture runner. Evaluate that actual runner in
    // the same invocation-local scope so these cleanup assertions still exercise production setup.
    const fixture = await FS.readText(
      Repo.resolvePath('packages/ides/studio-tooling/studio-smoke/StudioMac2Fixture.ts'),
    )
    source = fixture.replace(/^export (?=(?:async )?function )/gm, '') + '\n' + source
  }
  // Imports are replaced with invocation-local dependencies. No process-wide module overrides are installed.
  const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, ''),
  )
  const dependencies = {
    Bun: {
      serve: (serverOptions: { port: number }) => {
        const index = ++serverCount
        if (options.failSecondServer && index === 2) {
          Errors.throwHostEnvironment('Second fixture bind failed.')
        }
        const label = entry === 'studio-simulated-user' || index === 2 ? 'preview server' : 'Studio fixture'
        return { port: serverOptions.port, stop: () => stop(label) }
      },
    },
    CLI: { mustRun: async () => Errors.throwHostEnvironment('Journey failed.') },
    Errors,
    Expect,
    FS: {
      ...FS,
      realPath: async (path: string) => {
        if (options.failProjectRealPath && allocatedRoots.includes(path)) {
          Expect(await FS.readJson(FS.resolvePath('external-directories.json', invocationRoot()))).toMatchObject({
            directories: [{ path, state: 'owned' }],
          })
          Errors.throwHostEnvironment('Project canonicalization failed.')
        }
        return path.endsWith('/appium-mac2-driver') ? root : await FS.realPath(path)
      },
      symlink: async () => {},
    },
    HCI,
    Platform: {
      runtimeProcess: {
        env: {
          TAO_STUDIO_SMOKE_ARTIFACT_ROOT: root,
          TAO_STUDIO_SMOKE_NATIVE: options.browser ? 'false' : 'true',
        },
      },
    },
    Repo: {
      ...Repo,
      mkScratchDir: async (prefix: string) => {
        if (prefix === 'tao-studio-simulated-user-') {
          Expect(invocationRoots).toHaveLength(allocatedRoots.length + 1)
          const allocated = options.failProjectRealPath
            ? await mkTestDir('tao-smoke-source-project-')
            : FS.resolvePath(`source-project-${invocationRoots.length}`, root)
          await FS.mkdir(allocated)
          allocatedRoots.push(allocated)
          return allocated
        }
        Expect(prefix).toBe('tao-studio-simulated-runtime-')
        Expect(await FS.readJson(FS.resolvePath('external-directories.json', invocationRoot()))).toMatchObject({
          directories: [{ owner: invocationRoot(), path: allocatedRoots.at(-1), state: 'owned' }],
        })
        const runtime = FS.resolvePath(`preview-runtime-${invocationRoots.length}`, root)
        await FS.mkdir(runtime)
        return runtime
      },
    },
    runCleanups,
    StudioCdp: {
      launchChrome: async (options: { artifactRoot: string }) => {
        Expect(options.artifactRoot).toBe(invocationRoot())
        return {
          close: async () => stop('browser'),
          setViewport: async () => Errors.throwHostEnvironment('Journey failed.'),
        }
      },
    },
    StudioMac2TestRun,
    StudioNative: {
      start: async () => {
        if (options.failNativeStart) {
          Errors.throwHostEnvironment('Native startup failed without a handle.')
        }
        return {
          hostControl: async () => Errors.throwHostEnvironment('Journey failed.'),
          stop: async () => stop('native Studio'),
          waitForProbe: async () => {
            if (options.journeyFailure) {
              Errors.throwHostEnvironment('Journey failed.')
            }
            return { capabilities: { transport: { passed: true } }, passed: true }
          },
        }
      },
    },
    StudioNativeTestRun: {
      create: async () => {
        const invocation = FS.resolvePath(`invocations/${invocationRoots.length + 1}`, root)
        await FS.mkdir(invocation)
        invocationRoots.push(invocation)
        return { root: invocation }
      },
      nativeOptions: async (path: string) => {
        Expect(path).toBe(invocationRoot())
        return {}
      },
    },
    StudioCanvasViewportStore,
    StudioSessionManager: class {
      add() {
        return { sessionId: 'fixture' }
      }
      async closeAll() {
        stop('Studio sessions')
      }
    },
    Test: (_name: string, run: () => Promise<void>) => callbacks.push(run),
    openStudioPreviewSession: async () => {
      const ledger = await FS.readJson<{ directories: { path: string; state: string }[] }>(
        FS.resolvePath('external-directories.json', invocationRoot()),
      )
      Expect(ledger.directories).toMatchObject([
        { path: allocatedRoots.at(-1), state: 'owned' },
        { path: FS.resolvePath(`preview-runtime-${invocationRoots.length}`, root), state: 'owned' },
      ])
      return {
        close: async () => stop('preview session'),
        session: { compileInitial: async () => ({ status: 'compiled' }) },
      }
    },
    startStudioSessionServer: async () => ({ stop: async () => stop('Studio server'), url: 'http://fixture' }),
  }
  try {
    new Function(...Object.keys(dependencies), body)(...Object.values(dependencies))
    const run = callbacks.at(-1)
    Assert.defined(run, 'the smoke entry to register its journey callback')
    await withCapturedOutput(() =>
      check({
        allocatedRoots,
        invocationRoots,
        projectRoot,
        root: FS.resolvePath('invocations/1', root),
        run,
        runtimeRoot,
        stopped,
      })
    )
  } finally {
    for (const allocated of allocatedRoots) {
      await FS.remove(allocated)
    }
    await FS.remove(root)
  }
}

Describe('Studio smoke entry cleanup', () => {
  Test(
    'caller-owned scratch projects are discovered and survive normal child exit with their retention receipt',
    async () => {
      const receipts = await mkTestDir('tao-smoke-scratch-receipt-')
      const note = FS.resolvePath('owned-project.json', receipts)
      let owned: string | undefined
      try {
        await CLI.mustRun(Platform.runtimeProcess.execPath, {
          args: [
            '-e',
            `import { FS, Repo } from '@shared';
const root = await Repo.mkScratchDir('tao-studio-retained-project-');
try {
  await FS.writeText(FS.resolvePath('Smoke.tao', root), 'app Smoke { view MainView }');
  await FS.writeJson(${JSON.stringify(note)}, { root, state: 'retained-unknown-shutdown' }, { mode: 0o600 });
} catch (error) {
  await FS.remove(root);
  throw error;
}`,
          ],
          cwd: Repo.resolvePath('packages/ides/studio-tooling'),
          processPolicy: 'test',
          timeoutMs: 10_000,
        })
        const receipt = await FS.readJson<{ root: string; state: string }>(note)
        owned = receipt.root
        Expect(receipt.state).toBe('retained-unknown-shutdown')
        Expect(FS.pathIsWithin(owned, Repo.resolvePath('.artifacts/scratch'))).toBe(true)
        Expect(await FS.isDirectory(owned)).toBe(true)
        Expect(await discoverProjectTaoFiles(owned)).toEqual([FS.resolvePath('Smoke.tao', owned)])
        Expect(await FS.isFile(note)).toBe(true)
      } finally {
        // This source fixture owns no resource beyond the child, whose confirmed exit permits cleanup.
        if (owned !== undefined) {
          await FS.remove(owned)
        }
        await FS.remove(receipts)
      }
    },
  )

  for (const browser of [false, true]) {
    Test(
      `simulated-user preserves a retained ${browser ? 'browser' : 'native'} ledger across repeated runs`,
      async () => {
        await withSmokeEntry('studio-simulated-user', {
          browser,
          failCleanup: browser ? 'browser' : 'native Studio',
          journeyFailure: true,
        }, async ({ allocatedRoots, invocationRoots, run }) => {
          await Expect(run()).rejects.toThrow('Journey failed.')
          Expect(invocationRoots).toHaveLength(1)
          const firstLedgerPath = FS.resolvePath('external-directories.json', invocationRoots[0]!)
          const firstLedger = await FS.readText(firstLedgerPath)
          Expect(JSON.parse(firstLedger)).toMatchObject({
            directories: [{ path: allocatedRoots[0], state: 'retained' }, { state: 'retained' }],
          })
          await Expect(run()).rejects.toThrow('Journey failed.')
          Expect(invocationRoots).toHaveLength(2)
          Expect(invocationRoots[1]).not.toBe(invocationRoots[0])
          Expect(allocatedRoots[1]).not.toBe(allocatedRoots[0])
          Expect(await FS.readText(firstLedgerPath)).toBe(firstLedger)
          Expect(await FS.readJson(FS.resolvePath('external-directories.json', invocationRoots[1]!))).toMatchObject({
            directories: [{ path: allocatedRoots[1], state: 'retained' }, { state: 'retained' }],
          })
        })
      },
    )
  }

  Test('simulated-user records and removes the allocated raw directory when canonicalization fails', async () => {
    await withSmokeEntry(
      'studio-simulated-user',
      { failProjectRealPath: true },
      async ({ allocatedRoots, root, run }) => {
        await Expect(run()).rejects.toThrow('Project canonicalization failed.')
        Expect(allocatedRoots).toHaveLength(1)
        const rawPath = allocatedRoots[0]!
        Expect(await FS.exists(rawPath)).toBe(false)
        Expect(await FS.readJson(FS.resolvePath('external-directories.json', root))).toMatchObject({
          directories: [{ owner: root, path: rawPath, state: 'removed' }],
          pendingShutdown: [],
        })
      },
    )
  })

  for (const entry of ['studio-host-control', 'studio-mac2-acceptance'] as const) {
    Test(`${entry} stops the first fixture when the second fixture cannot bind`, async () => {
      await withSmokeEntry(entry, { failSecondServer: true }, async ({ run, stopped }) => {
        await Expect(run()).rejects.toThrow('Second fixture bind failed.')
        Expect(stopped).toEqual(['Studio fixture'])
      })
    })
  }

  Test(
    'host-control attempts both fixtures after native shutdown fails and preserves the journey failure',
    async () => {
      await withSmokeEntry('studio-host-control', { failCleanup: 'native Studio' }, async ({ run, stopped }) => {
        await Expect(run()).rejects.toThrow('Journey failed.')
        Expect(stopped).toEqual(['native Studio', 'Studio fixture', 'preview server'])
      })
    },
  )

  Test('host-control attempts the preview fixture after the Studio fixture shutdown fails', async () => {
    await withSmokeEntry('studio-host-control', { failCleanup: 'Studio fixture' }, async ({ run, stopped }) => {
      await Expect(run()).rejects.toThrow('Journey failed.')
      Expect(stopped).toEqual(['native Studio', 'Studio fixture', 'preview server'])
    })
  })

  Test(
    'Mac2 attempts the preview fixture after the Studio fixture shutdown fails and preserves its journey failure',
    async () => {
      await withSmokeEntry('studio-mac2-acceptance', { failCleanup: 'Studio fixture' }, async ({ run, stopped }) => {
        await Expect(run()).rejects.toThrow('Journey failed.')
        Expect(stopped).toEqual(['Studio fixture', 'preview server'])
      })
    },
  )

  Test(
    'simulated-user records ownership before launch and removes both directories after complete shutdown',
    async () => {
      await withSmokeEntry('studio-simulated-user', {}, async ({ projectRoot, root, run, runtimeRoot, stopped }) => {
        await run()
        Expect(stopped).toEqual([
          'native Studio',
          'Studio server',
          'Studio sessions',
          'preview session',
          'preview server',
        ])
        Expect(await FS.exists(projectRoot)).toBe(false)
        Expect(await FS.exists(runtimeRoot)).toBe(false)
        Expect(await FS.readJson(FS.resolvePath('external-directories.json', root))).toMatchObject({
          directories: [
            { owner: root, path: projectRoot, state: 'removed' },
            { owner: root, path: runtimeRoot, state: 'removed' },
          ],
          pendingShutdown: [],
        })
      })
    },
  )

  Test(
    'simulated-user fails a successful journey when native shutdown fails and retains both directories',
    async () => {
      await withSmokeEntry(
        'studio-simulated-user',
        { failCleanup: 'native Studio' },
        async ({ projectRoot, run, runtimeRoot }) => {
          await Expect(run()).rejects.toThrow('cleanup operations failed')
          Expect(await FS.exists(projectRoot)).toBe(true)
          Expect(await FS.exists(runtimeRoot)).toBe(true)
        },
      )
    },
  )

  for (
    const label of ['native Studio', 'Studio server', 'Studio sessions', 'preview session', 'preview server', 'browser']
  ) {
    Test(`simulated-user retains its project and runtime after ${label} shutdown fails`, async () => {
      await withSmokeEntry('studio-simulated-user', {
        browser: label === 'browser',
        failCleanup: label,
        journeyFailure: true,
      }, async ({ projectRoot, root, run, runtimeRoot, stopped }) => {
        await Expect(run()).rejects.toThrow('Journey failed.')
        Expect(stopped).toEqual([
          label === 'browser' ? 'browser' : 'native Studio',
          'Studio server',
          'Studio sessions',
          'preview session',
          'preview server',
        ])
        Expect(await FS.exists(projectRoot)).toBe(true)
        Expect(await FS.exists(runtimeRoot)).toBe(true)
        const ledger = await FS.readJson(FS.resolvePath('external-directories.json', root))
        Expect(ledger).toMatchObject({
          directories: [
            { owner: root, path: projectRoot, state: 'retained' },
            { owner: root, path: runtimeRoot, state: 'retained' },
          ],
          pendingShutdown: [label],
        })
      })
    })
  }

  Test('simulated-user retains both directories when native startup leaves shutdown unproved', async () => {
    await withSmokeEntry(
      'studio-simulated-user',
      { failNativeStart: true },
      async ({ projectRoot, root, run, runtimeRoot }) => {
        await Expect(run()).rejects.toThrow('Native startup failed without a handle.')
        Expect(await FS.exists(projectRoot)).toBe(true)
        Expect(await FS.exists(runtimeRoot)).toBe(true)
        Expect(await FS.readJson(FS.resolvePath('external-directories.json', root))).toMatchObject({
          directories: [{ state: 'retained' }, { state: 'retained' }],
          pendingShutdown: ['native Studio'],
        })
      },
    )
  })
})
