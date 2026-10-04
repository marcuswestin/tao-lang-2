import { Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { MachineResourceBusyError } from '@verification/MachineLanes'
import { REQUIRED_CAPABILITIES } from '../studio-tooling-src/StudioCanary'
import { StudioCanaryCommand } from '../studio-tooling-src/StudioCanaryCommand'
import { StudioDev } from '../studio-tooling-src/StudioDev'
import { StudioHutchHome } from '../studio-tooling-src/StudioHutchHome'
import { openLaunchRecord, readLaunches } from '../studio-tooling-src/StudioLaunchManifest'
import { StudioManualChecks } from '../studio-tooling-src/StudioManualChecks'
import { StudioNative } from '../studio-tooling-src/StudioNative'
import { StudioNativeIdentity } from '../studio-tooling-src/StudioNativeIdentity'
import { StudioNativeTestRun } from '../studio-tooling-src/StudioNativeTestRun'

Describe('native Studio test isolation', () => {
  for (const resourcesStopped of [false, undefined]) {
    Test(
      `fails a passing probe and retains build and project when cleanup proof is ${
        resourcesStopped === false ? 'negative' : 'missing'
      }`,
      async () => {
        const root = await mkTestDir('tao-native-canary-cleanup-verdict-')
        let projectRoot: string | undefined
        let nativeRoot: string | undefined
        try {
          const passingProbe = {
            capabilities: Object.fromEntries(REQUIRED_CAPABILITIES.map(name => [name, { passed: true }])),
            passed: true,
          }
          const captured = await withCapturedOutput(async () =>
            await StudioCanaryCommand.testing.runStudioCanary({ artifactRoot: root }, {
              blockedReason: async () => undefined,
              readLaunches: async () => [],
              readProbeResult: async () => passingProbe,
              registryRoot: FS.resolvePath('registry', root),
              runStudioDev: async options => {
                projectRoot = options.projectRoot
                nativeRoot = options.nativeArtifactRoot!
                await FS.writeText(FS.resolvePath('build/evidence.txt', nativeRoot), 'retain this build')
                if (resourcesStopped !== undefined) {
                  options.onCleanup?.({ resourcesStopped })
                }
                return 0
              },
              survivingOwnedPids: async () => [],
            })
          )
          Expect(captured.result).toBe(1)
          Expect(await FS.exists(projectRoot!)).toBe(true)
          Expect(await FS.readText(FS.resolvePath('build/evidence.txt', nativeRoot!))).toBe('retain this build')
          const invocationRoot = FS.dirname(nativeRoot!)
          Expect(await FS.readJson(FS.resolvePath('canary.json', invocationRoot))).toMatchObject({
            exitCode: 0,
            failureReason: 'Studio did not confirm shutdown of its native and project processes after the probe.',
            status: 'failed',
          })
          Expect(await FS.readJson(FS.resolvePath('external-directories.json', invocationRoot))).toMatchObject({
            path: projectRoot,
            state: 'retained',
          })
        } finally {
          if (projectRoot !== undefined) {
            await FS.remove(projectRoot)
          }
          await FS.remove(root)
        }
      },
    )
  }

  Test(
    'keeps a stable consent identity through checkout aliases and separates development and other checkouts',
    async () => {
      const root = await mkTestDir('tao-native-test-identity-')
      try {
        const primary = FS.resolvePath('primary', root)
        const other = FS.resolvePath('other', root)
        const alias = FS.resolvePath('alias', root)
        await FS.mkdir(primary)
        await FS.mkdir(other)
        await FS.symlink(primary, alias)
        const identity = await StudioNativeIdentity.forTest(primary)
        Expect(await StudioNativeIdentity.forTest(alias)).toEqual(identity)
        Expect(identity.bundleIdentifier).toMatch(/^com\.devtao\.studio\.test-[0-9a-f]{12}$/)
        Expect(identity.appName).toMatch(/^Tao Studio Test — [0-9a-f]{12}$/)
        Expect(identity.hostResourceName).toBe(`studio-native-host:${identity.bundleIdentifier}`)
        Expect(identity.testing).toBe(true)
        Expect(identity.bundleIdentifier).not.toBe((await StudioNativeIdentity.forWorktree(primary)).bundleIdentifier)
        Expect(identity.bundleIdentifier).not.toBe((await StudioNativeIdentity.forTest(other)).bundleIdentifier)
      } finally {
        await FS.remove(root)
      }
    },
  )

  Test('waits for the test host without offering a takeover even in an interactive terminal', async () => {
    const waits: number[] = []
    const effects: string[] = []
    const owner = {
      command: 'studio-canary',
      id: 'held',
      name: 'test-host',
      pid: 1234,
      repositoryRoot: '/repo',
      startedAt: '2026-10-02T00:00:00Z',
    }
    await Expect(StudioNative.testing.acquireNativeHostLease({
      command: 'studio-manual-checks',
      name: 'test-host',
      testing: true,
    }, {
      acquire: async options => {
        waits.push(options.waitTimeoutMs!)
        throw new MachineResourceBusyError(owner)
      },
      askConfirm: async () => {
        effects.push('prompt')
        return true
      },
      isInteractive: () => {
        effects.push('terminal')
        return true
      },
      stopOwner: async () => {
        effects.push('stop')
        return ''
      },
    })).rejects.toBeInstanceOf(MachineResourceBusyError)
    Expect(waits).toEqual([600_000])
    Expect(effects).toEqual([])
  })

  Test('forwards cancellation to both native leases and releases the host if the probe claim cancels', async () => {
    const abort = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    let releases = 0
    await Expect(StudioNative.testing.acquireNativeHostLeases({
      command: 'test-probe',
      name: 'test-host',
      probe: true,
      signal: abort.signal,
      testing: true,
    }, {
      acquire: async options => {
        signals.push(options.signal)
        if (signals.length === 2) {
          abort.abort()
          throw Errors.abortError('probe claim cancelled')
        }
        return {
          owner: {} as never,
          release: async () => {
            releases++
          },
        }
      },
    })).rejects.toMatchObject({ name: 'AbortError' })
    Expect(signals).toEqual([abort.signal, abort.signal])
    Expect(releases).toBe(1)
  })

  Test('isolates launch records and never prunes a stopped developer launch', async () => {
    const root = await mkTestDir('tao-native-launch-isolation-')
    try {
      const development = await openLaunchRecord({ artifactRoot: root, mode: 'native', repositoryRoot: root })
      await development.finalize({})
      const records = FS.resolvePath('test-records', root)
      const first = await openLaunchRecord({
        artifactRoot: root,
        launchRecordsRoot: records,
        mode: 'native',
        repositoryRoot: root,
      })
      await first.finalize({})
      const second = await openLaunchRecord({
        artifactRoot: root,
        launchRecordsRoot: records,
        mode: 'native',
        repositoryRoot: root,
      })
      Expect(await FS.exists(development.path)).toBe(true)
      Expect(await FS.exists(first.path)).toBe(false)
      Expect((await readLaunches(root)).map(item => item.manifest.launchId)).toEqual([development.launchId])
      Expect((await readLaunches(root, records)).map(item => item.manifest.launchId)).toEqual([second.launchId])
    } finally {
      await FS.remove(root)
    }
  })

  Test('resets the test Hutch registrations while preserving development registrations', async () => {
    const root = await mkTestDir('tao-native-hutch-isolation-')
    try {
      const development = FS.resolvePath('development-home/state/projects/live.json', root)
      const testHome = FS.resolvePath('test-home', root)
      const sourceHome = FS.resolvePath('uninstalled-home', root)
      await FS.writeJson(development, { projectRoot: '/developer/project' })
      await StudioHutchHome.prepare({ sourceHome, targetHome: testHome })
      const testRecord = FS.resolvePath('state/projects/previous.json', testHome)
      await FS.writeJson(testRecord, { projectRoot: '/test/project' })
      await StudioHutchHome.prepare({ sourceHome, targetHome: testHome })
      Expect(await FS.exists(testRecord)).toBe(false)
      Expect(await FS.readJson(development)).toEqual({ projectRoot: '/developer/project' })
    } finally {
      await FS.remove(root)
    }
  })

  Test('removes the default disposable projection after canary startup fails', async () => {
    const root = await mkTestDir('tao-native-canary-isolation-')
    let sourceRoot: string | undefined
    try {
      await withCapturedOutput(async () => {
        Expect(
          await StudioCanaryCommand.testing.runStudioCanary({ artifactRoot: root }, {
            blockedReason: async () => undefined,
            readLaunches: async () => [],
            readProbeResult: async () => undefined,
            registryRoot: FS.resolvePath('registry', root),
            runStudioDev: async options => {
              sourceRoot = options.projectRoot
              Expect(options.appName).toBe('KeyboardNavigationAcceptance')
              Expect(options.projectRoot).not.toContain('Apps/HNReader')
              Expect(await FS.readText(FS.resolvePath('KeyboardNavigation.tao', options.projectRoot)))
                .toContain('app KeyboardNavigationAcceptance')
              Expect(options.nativeIdentity?.bundleIdentifier).toMatch(/\.test-[0-9a-f]{12}$/)
              Expect(options.nativeHutchHome).toBe(Repo.resolvePath('.artifacts/tests/studio-native/hutch-home'))
              Expect(options.devDataRoot).toContain('/invocations/')
              Expect(options.userStateRoot).toContain('/invocations/')
              Expect(options.launchRecordsRoot).toContain('/invocations/')
              options.onCleanup?.({ resourcesStopped: true })
              Errors.throwHostEnvironment('startup failed')
            },
            survivingOwnedPids: async () => [],
          }),
        ).toBe(1)
      })
      Expect(sourceRoot).toBeDefined()
      Expect(await FS.exists(sourceRoot!)).toBe(false)
      const invocation = (await FS.listDir(FS.resolvePath('invocations', root)))[0]!
      Expect(await FS.readJson(FS.resolvePath(`invocations/${invocation}/external-directories.json`, root)))
        .toMatchObject({ path: sourceRoot, state: 'removed' })
    } finally {
      if (sourceRoot !== undefined) {
        await FS.remove(sourceRoot)
      }
      await FS.remove(root)
    }
  })

  Test('preserves an explicit project and app without creating a projection', async () => {
    const root = await mkTestDir('tao-native-explicit-project-')
    try {
      const selected = await StudioNativeTestRun.project({ appName: 'Selected', projectRoot: root }, root)
      Expect(selected.appName).toBe('Selected')
      Expect(selected.projectRoot).toBe(root)
      await selected.cleanup()
      Expect(await FS.exists(root)).toBe(true)
      Expect(await FS.exists(FS.resolvePath('external-directories.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains a projection and its ownership note without positive shutdown proof or with survivors', async () => {
    const root = await mkTestDir('tao-native-projection-proof-')
    let projectRoot: string | undefined
    try {
      const target = await StudioNativeTestRun.project({}, root)
      projectRoot = target.projectRoot
      await withCapturedOutput(async () => {
        await target.cleanup()
        Expect(await FS.exists(projectRoot!)).toBe(true)
        await target.cleanup({ resourcesStopped: false })
        Expect(await FS.exists(projectRoot!)).toBe(true)
        await target.cleanup({ resourcesStopped: true }, [7777])
      })
      Expect(await FS.exists(projectRoot)).toBe(true)
      Expect(await FS.readJson(FS.resolvePath('external-directories.json', root))).toMatchObject({
        path: projectRoot,
        reason: 'Owned processes survived shutdown: 7777.',
        state: 'retained',
      })
      await target.cleanup({ resourcesStopped: true }, [])
      Expect(await FS.exists(projectRoot)).toBe(false)
    } finally {
      if (projectRoot !== undefined) {
        await FS.remove(projectRoot)
      }
      await FS.remove(root)
    }
  })

  Test('a native source projection retains a live local project owner after resource shutdown', async () => {
    const root = await mkTestDir('tao-native-projection-owner-')
    const target = await StudioNativeTestRun.project({}, root)
    const ownerPath = FS.resolvePath('.tao/local/sessions/owner.json', target.projectRoot)
    try {
      await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid })
      await withCapturedOutput(async () => await target.cleanup({ resourcesStopped: true }, []))
      Expect(await FS.isFile(FS.resolvePath('KeyboardNavigation.tao', target.projectRoot))).toBe(true)
      await FS.remove(ownerPath)
      await target.cleanup({ resourcesStopped: true }, [])
      Expect(await FS.exists(target.projectRoot)).toBe(false)
    } finally {
      await FS.remove(target.projectRoot)
      await FS.remove(root)
    }
  })

  Test('shutdown inspection checks native and Metro roots and refuses unavailable process evidence', async () => {
    const roots = ['/owned/native', '/owned/metro']
    const command = { args: ['-nP', '-d', 'cwd', '-Fpn'], command: '/usr/sbin/lsof', signal: null }
    Expect(
      await StudioDev.testing.resourcesAreStopped(roots, async () => ({
        ...command,
        exitCode: 0,
        stderr: '',
        stdout: 'p123\nn/unrelated/native\n',
      })),
    ).toBe(true)
    for (const root of roots) {
      Expect(
        await StudioDev.testing.resourcesAreStopped(roots, async () => ({
          ...command,
          exitCode: 0,
          stderr: '',
          stdout: `p123\nn${root}/build\n`,
        })),
      ).toBe(false)
    }
    Expect(
      await StudioDev.testing.resourcesAreStopped(roots, async () => ({
        ...command,
        exitCode: 1,
        stderr: 'inspection refused',
        stdout: '',
      })),
    ).toBe(false)
  })

  Test('canary retains a projection after failed cleanup even when its project owner marker is absent', async () => {
    const root = await mkTestDir('tao-native-canary-retained-')
    let projectRoot: string | undefined
    try {
      await withCapturedOutput(async () => {
        Expect(
          await StudioCanaryCommand.testing.runStudioCanary({ artifactRoot: root }, {
            blockedReason: async () => undefined,
            readLaunches: async () => [],
            readProbeResult: async () => undefined,
            registryRoot: FS.resolvePath('registry', root),
            runStudioDev: async options => {
              projectRoot = options.projectRoot
              options.onCleanup?.({ resourcesStopped: false })
              Errors.throwHostEnvironment('Metro shutdown failed')
            },
            survivingOwnedPids: async () => [],
          }),
        ).toBe(1)
      })
      Expect(projectRoot).toBeDefined()
      Expect(await FS.exists(projectRoot!)).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao/local/sessions/owner.json', projectRoot!))).toBe(false)
      const invocation = (await FS.listDir(FS.resolvePath('invocations', root)))[0]!
      Expect(await FS.readJson(FS.resolvePath(`invocations/${invocation}/external-directories.json`, root)))
        .toMatchObject({ path: projectRoot, state: 'retained' })
    } finally {
      if (projectRoot !== undefined) {
        await FS.remove(projectRoot)
      }
      await FS.remove(root)
    }
  })

  Test('canary retains a projection when scoped survivor inspection finds an owned process', async () => {
    const root = await mkTestDir('tao-native-canary-survivor-')
    let projectRoot: string | undefined
    try {
      await withCapturedOutput(async () => {
        Expect(
          await StudioCanaryCommand.testing.runStudioCanary({ artifactRoot: root }, {
            blockedReason: async () => undefined,
            readLaunches,
            readProbeResult: async () => undefined,
            registryRoot: FS.resolvePath('registry', root),
            runStudioDev: async options => {
              projectRoot = options.projectRoot
              const launch = await openLaunchRecord({
                artifactRoot: root,
                launchRecordsRoot: options.launchRecordsRoot,
                mode: 'native',
              })
              options.onLaunch?.(launch.launchId)
              options.onCleanup?.({ resourcesStopped: true })
              await launch.finalize({})
              return 1
            },
            survivingOwnedPids: async () => [7777],
          }),
        ).toBe(1)
      })
      Expect(await FS.exists(projectRoot!)).toBe(true)
      const invocation = (await FS.listDir(FS.resolvePath('invocations', root)))[0]!
      Expect(await FS.readJson(FS.resolvePath(`invocations/${invocation}/external-directories.json`, root)))
        .toMatchObject({ path: projectRoot, reason: 'Owned processes survived shutdown: 7777.', state: 'retained' })
    } finally {
      if (projectRoot !== undefined) {
        await FS.remove(projectRoot)
      }
      await FS.remove(root)
    }
  })

  Test('requires ownership and a stopped command and children before sweeping an invocation', async () => {
    const root = await mkTestDir('tao-native-inactive-')
    try {
      const { root: invocation } = await StudioNativeTestRun.create(root)
      const command = { args: ['-nP', '-d', 'cwd', '-Fpn'], command: '/usr/sbin/lsof', signal: null }
      const empty = async () => ({ ...command, exitCode: 0, stderr: '', stdout: 'p123\nn/elsewhere\n' })
      Expect(await StudioNativeTestRun.isInactive(invocation, empty)).toBe(false)
      await FS.writeJson(FS.resolvePath('invocation.json', invocation), {
        ownerPid: 999_999_999,
        root: await FS.realPath(invocation),
        version: 1,
      })
      Expect(await StudioNativeTestRun.isInactive(invocation, empty)).toBe(true)
      Expect(
        await StudioNativeTestRun.isInactive(invocation, async () => ({
          ...command,
          exitCode: 0,
          stderr: '',
          stdout: `p123\nn${invocation}/electrobun/build\n`,
        })),
      ).toBe(false)
      Expect(
        await StudioNativeTestRun.isInactive(invocation, async () => ({
          ...command,
          exitCode: 1,
          stderr: 'inspection unavailable',
          stdout: '',
        })),
      ).toBe(false)
      await FS.remove(FS.resolvePath('invocation.json', invocation))
      Expect(await StudioNativeTestRun.isInactive(invocation, empty)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test(
    'manual runs use separate invocation state and remove each projection after ordinary stop or failure',
    async () => {
      const root = await mkTestDir('tao-native-manual-isolation-')
      const projects: string[] = []
      const nativeRoots: string[] = []
      try {
        for (const fail of [false, true]) {
          await withCapturedOutput(async () => {
            const run = StudioManualChecks.run({ artifactRoot: root, showStudio: true }, {
              isInteractive: () => true,
              runStudio: async options => {
                projects.push(options.projectRoot)
                nativeRoots.push(options.nativeArtifactRoot!)
                Expect(options.appName).toBe('KeyboardNavigationAcceptance')
                options.onCleanup?.({ resourcesStopped: true })
                if (fail) {
                  Errors.throwHostEnvironment('manual startup failed')
                }
                return 130
              },
              writeLine: () => {},
            })
            if (fail) {
              await Expect(run).rejects.toThrow('manual startup failed')
            } else {
              Expect(await run).toBe(0)
            }
          })
        }
        Expect(new Set(nativeRoots).size).toBe(2)
        for (const project of projects) {
          Expect(await FS.exists(project)).toBe(false)
        }
      } finally {
        for (const project of projects) {
          await FS.remove(project)
        }
        await FS.remove(root)
      }
    },
  )
})
