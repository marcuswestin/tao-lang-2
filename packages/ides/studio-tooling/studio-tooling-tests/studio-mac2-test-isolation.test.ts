import { MachineResources } from '@host-control'
import { CLI, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { StudioMac2TestRun } from '../studio-tooling-src/StudioMac2TestRun'

async function fixture() {
  const root = await mkTestDir('tao-mac2-isolation-')
  const wdaSource = FS.resolvePath('installed WDA', root)
  await FS.writeText(FS.resolvePath('WebDriverAgentMac.xcodeproj/project.pbxproj', wdaSource), 'pinned source')
  await FS.writeText(FS.resolvePath('WebDriverAgentRunner/Runner.m', wdaSource), 'runner source')
  const xcodebuild = FS.resolvePath('original-xcodebuild', root)
  await FS.writeText(xcodebuild, 'source test executable')
  const registryRoot = FS.resolvePath('registry', root)
  return {
    root,
    wdaSource,
    registryRoot,
    async prepare(id: string, scenario = 'normal') {
      const calls: { command: string; options: CLI.CommandSpec }[] = []
      const http: string[] = []
      const signals: string[] = []
      const artifacts = FS.resolvePath(id, root)
      const pid = 12001
      const identity = { command: 'xcodebuild', pid, startedAt: 'kernel-start-1' }
      let alive = false
      let clock = 0
      let disposed = false
      let identityReads = 0
      let kernelUnknown = false
      let listener: ReturnType<typeof Bun.serve> | undefined
      let port: number | undefined
      let holdStatus = false
      let replaced = false
      let statusEntered: (() => void) | undefined
      let releaseStatus: (() => void) | undefined
      const heldStatus = new Promise<void>(resolve => {
        releaseStatus = resolve
      })
      const statusStarted = new Promise<void>(resolve => {
        statusEntered = resolve
      })
      const foreignRequests: string[] = []
      let redirectLocation: string | undefined
      const run = await StudioMac2TestRun.prepare({
        artifactRoot: artifacts,
        registryRoot,
        wdaSource,
        xcodebuild,
        writeLog: scenario.endsWith('log-failure')
          ? async () => Errors.throwHostEnvironment('Injected log write failure')
          : undefined,
        now: () => clock,
        sleep: async milliseconds => {
          clock += milliseconds
        },
        identities: pids => {
          if (kernelUnknown) {
            throw new Errors.HostEnvironmentError('Kernel process inspection unavailable')
          }
          identityReads++
          return new Map(pids.flatMap(value =>
            value === pid && alive
              ? [[
                value,
                scenario === 'reused-pid' && identityReads > 2
                  ? { ...identity, startedAt: 'new-kernel-start' }
                  : identity,
              ]]
              : []
          ))
        },
        descendants: () => alive ? [identity] : [],
        signalTracked: (_processes, signal) => {
          signals.push(signal)
          if (scenario === 'kernel-inspection-unavailable') {
            kernelUnknown = true
            return
          }
          if (scenario !== 'survivor' && scenario !== 'reused-pid') {
            alive = false
          }
        },
        fetch: async (url, init) => {
          http.push(String(url))
          if (holdStatus && String(url).endsWith('/status')) {
            statusEntered?.()
            await heldStatus
          }
          if (replaced && init?.method !== undefined && init.method !== 'GET') {
            return await globalThis.fetch(url, { method: init.method })
          }
          if (redirectLocation !== undefined && init?.method !== undefined) {
            return new Response(null, { status: 302, headers: { location: redirectLocation } })
          }
          return new Response('{}', { status: 200 })
        },
        inspect: async (command, options) => {
          const args = [...(options?.args ?? [])]
          let stdout = ''
          let exitCode = 0
          if (args.some(arg => arg.startsWith('-iTCP:'))) {
            if (scenario === 'startup-log-failure' && alive) {
              return Errors.throwHostEnvironment('Owned startup listener inspection failed')
            }
            port = Number(args.find(arg => arg.startsWith('-iTCP:'))!.slice(6))
            if (
              replaced || scenario === 'foreign-before-start' || (scenario === 'foreign-after-start' && alive)
              || (scenario === 'reused-pid' && alive)
            ) {
              listener ??= Bun.serve({
                hostname: '127.0.0.1',
                port,
                fetch: request => {
                  foreignRequests.push(request.method)
                  return new Response('{}')
                },
              })
              stdout = scenario === 'reused-pid' ? `p${pid}\n` : 'p77777\n'
            } else if (alive) {
              stdout = `p${pid}\n`
            }
          } else if (scenario === 'inspection-unavailable') {
            exitCode = 1
          }
          return { command, args, error: undefined, exitCode, signal: null, stderr: '', stdout }
        },
        start: (command, options = {}) => {
          calls.push({ command, options })
          alive = true
          return {
            command,
            args: [...(options.args ?? [])],
            pid,
            exitCode: null,
            signalCode: null,
            closeOutput: async () => {},
            dispose: () => {
              disposed = true
            },
            endStdin: () => {},
            kill: () => false,
            onceClose: () => {},
            onceError: () => {},
            waitForClose: async () => ({ exitCode: 0, signal: null }),
            writeStdin: () => true,
          }
        },
      })
      return {
        run,
        calls,
        http,
        signals,
        disposed: () => disposed,
        closeForeignListener: () => listener?.stop(true),
        foreignRequests,
        statusStarted,
        holdStatus: () => {
          holdStatus = true
        },
        replaceWda: () => {
          replaced = true
          listener ??= Bun.serve({
            hostname: '127.0.0.1',
            port: run.systemPort,
            fetch: request => {
              foreignRequests.push(request.method)
              return new Response('{}')
            },
          })
        },
        redirectBackend: (location: string) => {
          redirectLocation = location
        },
        releaseStatus: () => {
          releaseStatus?.()
        },
      }
    },
  }
}

Describe('Mac2 invocation isolation', () => {
  Test('preserves record failure and releases the backend fence when frontend rollback also fails', async () => {
    const test = await fixture()
    const artifacts = FS.resolvePath('run', test.root)
    await FS.mkdir(FS.resolvePath('appium-mac2/isolation.json', artifacts))
    const cleanupFailure = new Errors.HostEnvironmentError('Injected frontend cleanup failure')
    let frontendStopped = false
    let port: number | undefined
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StudioMac2TestRun.prepare({
          artifactRoot: artifacts,
          registryRoot: test.registryRoot,
          wdaSource: test.wdaSource,
          xcodebuild: FS.resolvePath('original-xcodebuild', test.root),
          startForwarder: options => {
            const file = FS.listDirSync(test.registryRoot).find(name => name.startsWith('resource-appium-wda-port-'))
            port = Number(file!.slice('resource-appium-wda-port-'.length, -'.lease'.length))
            const server = Bun.serve(options)
            const stop = server.stop.bind(server)
            server.stop = closeActiveConnections => {
              stop(closeActiveConnections)
              frontendStopped = true
              throw cleanupFailure
            }
            return server
          },
        })).rejects.toMatchObject({ code: 'EISDIR' })
      })
      Expect(captured.stderr).toContain('Injected frontend cleanup failure')
      Expect(frontendStopped).toBe(true)
      Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      Expect(port).toBeDefined()
      const replacement = Bun.serve({ hostname: '127.0.0.1', port: port!, fetch: () => new Response() })
      replacement.stop(true)
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('rolls back the owned backend listener and machine fence when frontend allocation fails', async () => {
    const test = await fixture()
    const allocationFailure = new Errors.HostEnvironmentError('Injected frontend EMFILE failure')
    let port: number | undefined
    try {
      await Expect(StudioMac2TestRun.prepare({
        artifactRoot: FS.resolvePath('run', test.root),
        registryRoot: test.registryRoot,
        wdaSource: test.wdaSource,
        xcodebuild: FS.resolvePath('original-xcodebuild', test.root),
        startForwarder: () => {
          const file = FS.listDirSync(test.registryRoot).find(name => name.startsWith('resource-appium-wda-port-'))
          Expect(file).toBeDefined()
          port = Number(file!.slice('resource-appium-wda-port-'.length, -'.lease'.length))
          throw allocationFailure
        },
      })).rejects.toBe(allocationFailure)
      Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      Expect(port).toBeDefined()
      const replacement = Bun.serve({ hostname: '127.0.0.1', port: port!, fetch: () => new Response() })
      replacement.stop(true)
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('refuses backend redirects without handing Appium an unchecked Location', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    const foreignRequests: string[] = []
    const destination = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: request => {
        foreignRequests.push(request.method)
        return new Response('{}')
      },
    })
    try {
      const desktop = await state.run.desktopLeases.acquire()
      state.redirectBackend(`http://127.0.0.1:${destination.port}/foreign`)
      const result = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`, { redirect: 'manual' })
      Expect(result.status).toBe(503)
      Expect(result.headers.get('location')).toBeNull()
      Expect(foreignRequests).toEqual([])
      await desktop.release()
      await state.run.cleanup(true)
    } finally {
      destination.stop(true)
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('fences Appium internal POST and DELETE after a held status response outlives WDA ownership', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      await desktop.assertCurrent(desktop.generation)
      state.holdStatus()
      const status = globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`)
      await state.statusStarted
      state.replaceWda()
      state.releaseStatus()
      Expect((await status).status).toBe(200)
      const statuses: number[] = []
      for (const [method, path] of [['POST', '/session'], ['DELETE', '/session/remote']]) {
        const result = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}${path}`, {
          method,
          body: method === 'POST' ? '{}' : undefined,
        })
        statuses.push(result.status)
      }
      Expect(statuses).toEqual([503, 503])
      Expect(state.foreignRequests).toEqual([])
      Expect(state.http).toEqual([
        `http://127.0.0.1:${state.run.systemPort}/status`,
        `http://127.0.0.1:${state.run.systemPort}/status`,
      ])
      await Expect(desktop.assertCurrent(desktop.generation)).rejects.toThrow('not owned')
      await Expect(desktop.release()).rejects.toThrow('shutdown is unproved')
    } finally {
      state.releaseStatus()
      state.closeForeignListener()
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  for (const scenario of ['startup-log-failure', 'release-log-failure']) {
    Test(`stops WDA and independently owned resources despite ${scenario}`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      const effects: string[] = []
      try {
        const captured = await withCapturedOutput(async () => {
          let primaryFailure: { error: unknown } | undefined
          let desktop: Awaited<ReturnType<typeof state.run.desktopLeases.acquire>> | undefined
          try {
            desktop = await state.run.desktopLeases.acquire()
          } catch (error) {
            primaryFailure = { error }
          }
          const finishing = StudioMac2TestRun.finish({
            closeController: async () => await desktop?.release(),
            cleanupWda: async () => await state.run.cleanup(true),
            primaryFailure,
            stopNative: async () => {
              effects.push('native')
            },
            stopFixtures: () => {
              effects.push('fixtures')
            },
          })
          if (scenario === 'startup-log-failure') {
            Expect(Errors.messageOf(primaryFailure?.error)).toContain('Owned startup listener inspection failed')
            await Expect(finishing).rejects.toBe(primaryFailure!.error)
          } else {
            await finishing
          }
        })
        Expect(captured.stderr).toContain('Injected log write failure')
        Expect(state.signals).toEqual(['SIGTERM'])
        Expect(state.disposed()).toBe(true)
        Expect(effects).toEqual(['native', 'fixtures'])
        Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
          .toBeUndefined()
        Expect(
          await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }),
        ).toBeUndefined()
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  for (const primary of [false, true]) {
    Test(
      `stops native and fixtures after retained WDA cleanup, preserving ${
        primary ? 'the probe' : 'the cleanup'
      } failure`,
      async () => {
        const effects: string[] = []
        const cleanupFailure = new Errors.HostEnvironmentError('WDA shutdown is unproved')
        const probeFailure = new Errors.HostEnvironmentError('Probe failed')
        const captured = await withCapturedOutput(async () => {
          await Expect(StudioMac2TestRun.finish({
            closeController: async () => {
              effects.push('controller')
            },
            cleanupWda: async () => {
              effects.push('wda-retained')
              throw cleanupFailure
            },
            primaryFailure: primary ? { error: probeFailure } : undefined,
            stopNative: async () => {
              effects.push('native-stopped')
            },
            stopFixtures: () => {
              effects.push('fixtures-stopped')
            },
          })).rejects.toBe(primary ? probeFailure : cleanupFailure)
        })
        Expect(effects).toEqual(['controller', 'wda-retained', 'native-stopped', 'fixtures-stopped'])
        if (primary) {
          Expect(captured.stderr).toContain('WDA shutdown is unproved')
        }
      },
    )
  }

  Test('copies the full WDA tree and fences distinct listeners without using the default port', async () => {
    const test = await fixture()
    const first = (await test.prepare('first')).run
    const second = (await test.prepare('second')).run
    try {
      Expect(first.systemPort).not.toBe(10100)
      Expect(second.systemPort).not.toBe(first.systemPort)
      Expect(await FS.readText(FS.resolvePath('WebDriverAgentRunner/Runner.m', first.bootstrapRoot))).toBe(
        'runner source',
      )
      await FS.writeText(FS.resolvePath('WebDriverAgentRunner/Runner.m', first.bootstrapRoot), 'private mutation')
      Expect(await FS.readText(FS.resolvePath('WebDriverAgentRunner/Runner.m', test.wdaSource))).toBe('runner source')
      Expect(
        await MachineResources.tryAcquire({
          name: `appium-wda-port-${first.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
      Expect(() => Bun.serve({ hostname: '127.0.0.1', port: first.systemPort, fetch: () => new Response() })).toThrow()
    } finally {
      await first.cleanup(false)
      await second.cleanup(false)
      Expect(
        await MachineResources.readOwner({
          name: `appium-wda-port-${first.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
      await FS.remove(test.root)
    }
  })

  Test('starts fixed copied WDA under physical input ownership and attaches only to its proven listener', async () => {
    const test = await fixture()
    const state = await test.prepare('run with spaces')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
        .toBeDefined()
      Expect(state.calls).toHaveLength(1)
      Expect(state.calls[0]!.command).toBe(await FS.realPath(FS.resolvePath('original-xcodebuild', test.root)))
      Expect(state.calls[0]!.options).toMatchObject({
        args: [
          'build-for-testing',
          'test-without-building',
          '-project',
          FS.resolvePath('WebDriverAgentMac.xcodeproj', state.run.bootstrapRoot),
          '-scheme',
          'WebDriverAgentRunner',
          'COMPILER_INDEX_STORE_ENABLE=NO',
          '-derivedDataPath',
          await FS.realPath(FS.resolvePath('run with spaces/appium-mac2/DerivedData', test.root)),
        ],
        cwd: state.run.bootstrapRoot,
        env: { USE_PORT: String(state.run.systemPort), USE_HOST: '127.0.0.1' },
      })
      Expect(state.http).toEqual([`http://127.0.0.1:${state.run.systemPort}/status`])
      Expect(await FS.readJson(FS.resolvePath('run with spaces/appium-mac2/isolation.json', test.root))).toMatchObject({
        state: 'ready',
        processes: [{ pid: 12001, startedAt: 'kernel-start-1' }],
      })
      await desktop.release()
      await state.run.cleanup(true)
      Expect(state.disposed()).toBe(true)
      Expect(state.signals).toEqual(['SIGTERM'])
      Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
        .toBeUndefined()
      Expect(
        await MachineResources.readOwner({
          name: `appium-wda-port-${state.run.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  for (const scenario of ['foreign-before-start', 'foreign-after-start', 'reused-pid']) {
    Test(`refuses ${scenario} before any readiness HTTP and retains uncertain fences`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        await withCapturedOutput(async () => {
          await Expect(state.run.desktopLeases.acquire()).rejects.toThrow(/unowned listener|not owned/)
        })
        Expect(state.http).toEqual([])
        Expect(state.calls).toHaveLength(scenario === 'foreign-before-start' ? 0 : 1)
        Expect(
          (await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }))?.retention?.quarantined,
        ).toBe(true)
        Expect(
          (await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
            ?.retention?.quarantined,
        ).toBe(true)
        Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
      } finally {
        state.closeForeignListener()
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  for (const scenario of ['survivor', 'inspection-unavailable', 'kernel-inspection-unavailable']) {
    Test(`quarantines both physical input and port and preserves handles/artifacts when ${scenario}`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        const desktop = await state.run.desktopLeases.acquire()
        await Expect(desktop.release()).rejects.toThrow('shutdown is unproved')
        Expect(state.disposed()).toBe(false)
        Expect(
          (await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }))?.retention?.quarantined,
        ).toBe(true)
        Expect(
          (await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
            ?.retention?.quarantined,
        ).toBe(true)
        Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
        Expect(await FS.readJson(FS.resolvePath('run/appium-mac2/isolation.json', test.root))).toMatchObject({
          state: 'retained',
        })
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  Test('retains the listener fence when the Appium server shutdown remains unproved', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      await desktop.release()
      await Expect(state.run.cleanup(false)).rejects.toThrow('shutdown is unproved')
      // Keep the owned frontend bound but inert until the owned Appium child is proved stopped.
      Expect((await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`)).status).toBe(503)
      Expect(
        (await MachineResources.readOwner({
          name: `appium-wda-port-${state.run.systemPort}`,
          registryRoot: test.registryRoot,
        }))?.retention?.quarantined,
      ).toBe(true)
      Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('uses the one owned app matching the consent identifier and rejects absent or ambiguous bundles', async () => {
    const test = await fixture()
    try {
      const nativeRoot = FS.resolvePath('electrobun', test.root)
      const bundle = FS.resolvePath('build/dev-macos-arm64/Studio Test-dev.app', nativeRoot)
      await FS.writeText(FS.resolvePath('Contents/Info.plist', bundle), 'owned plist')
      const inspect: typeof CLI.run = async (command, options) => ({
        command,
        args: [...(options?.args ?? [])],
        error: undefined,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: 'test.bundle\n',
      })
      Expect(await StudioMac2TestRun.appPath(nativeRoot, 'test.bundle', inspect)).toBe(await FS.realPath(bundle))
      await Expect(StudioMac2TestRun.appPath(nativeRoot, 'foreign.bundle', inspect)).rejects.toThrow(
        'exact Studio application',
      )
      await FS.writeText(
        FS.resolvePath('build/dev-macos-arm64/Other-dev.app/Contents/Info.plist', nativeRoot),
        'ambiguous plist',
      )
      await Expect(StudioMac2TestRun.appPath(nativeRoot, 'test.bundle', inspect)).rejects.toThrow(
        'exact Studio application',
      )
    } finally {
      await FS.remove(test.root)
    }
  })
})
