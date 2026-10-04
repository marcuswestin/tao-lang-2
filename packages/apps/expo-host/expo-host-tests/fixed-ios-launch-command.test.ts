import { CLI, Errors, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred, Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { settleDevLoopCleanup } from '../expo-host-src/dev-loop/expo-dev-loop'
import {
  type FixedIosLaunchIntent,
  type FixedIosLaunchOperations,
  runFixedIosLaunchCommand,
} from '../expo-host-src/dev-loop/expo-runner/fixedIosLaunchCommand'
import { prepareSimulatorCompanion } from '../expo-host-src/dev-loop/prebuilt-host/SimulatorCompanion'

const udid = '01234567-89AB-CDEF-0123-456789ABCDEF'
const host = {
  binaryPath: '/fixture-host/Companion.app',
  directory: '/fixture-host',
  manifest: { format: 1 as const, hostVersion: '1.0.0', nativeKit: {}, platform: 'ios-simulator' as const },
}

async function hostFailure(promise: Promise<unknown>): Promise<Errors.HostEnvironmentError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Errors.HostEnvironmentError) {
      return error
    }
    throw error
  }
  Errors.throwUnexpected('Expected the fixture launch to reject with a host environment failure.')
}

function commandFixture() {
  const root: TrackedProcess = { pid: 45001, startedAt: 'owned-kernel', command: 'held shell' }
  const borrowed: TrackedProcess = { pid: 45002, startedAt: 'borrowed-kernel', command: 'borrowed target' }
  const living = new Map([[root.pid, root], [borrowed.pid, borrowed]])
  const closing = Deferred<CLI.CommandCloseResult>()
  const events: string[] = []
  let spec: CLI.CommandSpec | undefined
  const complete = (exitCode = 0, signal: CLI.CommandCloseResult['signal'] = null) => {
    living.delete(root.pid)
    closing.resolve({ exitCode, signal })
  }
  const command: CLI.StartedCommand = {
    pid: root.pid,
    command: '/bin/sh',
    args: [],
    exitCode: null,
    signalCode: null,
    closeOutput: async () => {
      events.push('output-drained')
    },
    dispose: () => {
      events.push('disposed')
    },
    endStdin: () => {
      events.push('stdin-ended')
      complete(125)
    },
    kill: signal => {
      events.push(`kill:${signal}`)
      complete(0)
      return true
    },
    onceClose: () => {},
    onceError: () => {},
    waitForClose: () => closing.promise,
    writeStdin: text => {
      events.push((typeof text === 'string' ? text : Buffer.from(text).toString('utf8')).trim())
      return true
    },
  }
  const tree = {
    identities: (pids: readonly number[]) =>
      new Map(pids.flatMap(pid => {
        const identity = living.get(pid)
        return identity === undefined ? [] : [[pid, identity] as const]
      })),
    descendants: (_pid: number): TrackedProcess[] => [],
    sameProcess: (current: TrackedProcess | undefined, expected: TrackedProcess) =>
      current?.startedAt === expected.startedAt,
    processGroupOf: (_pid: number): number | undefined => 45000,
  }
  const operations: FixedIosLaunchOperations = {
    start: (_command, next) => {
      spec = next
      return command
    },
    tree,
    processIsAlive: pid => living.has(pid),
  }
  return { root, borrowed, living, complete, command, events, operations, tree, spec: () => spec }
}

Describe('fixed iOS launch command lifecycle', () => {
  Test(
    'released descendant inspection failure preserves diagnostic and terminal facts despite later clean exit',
    async () => {
      const fixture = commandFixture()
      const inspection = new Errors.HostEnvironmentError('fixture child enumeration failed', {
        details: {
          darwinInspection: {
            inspection: 'descendants',
            requestedPids: [45001],
            requestedPidCount: 1,
            backend: 'in-process-bun',
            failureKind: 'child-enumeration',
            routine: 'proc_listchildpids',
            pid: 45001,
            returnedCount: -1,
            argv: ['private-command'],
            credentials: 'private-credential',
            stderr: 'private-backend-output',
          },
        },
      })
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
        ...fixture.operations,
        onCommand: async capture => {
          if (capture.phase === 'released') {
            fixture.tree.descendants = () => {
              fixture.complete()
              throw inspection
            }
          }
        },
      })
      const error = await hostFailure(running)
      Expect(error.cause).toBe(inspection)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(error.details?.['released']).toBe(true)
      Expect(error.details?.['commandClose']).toEqual({ exitCode: 0, signal: null })
      Expect(error.details?.['outputClosed']).toBe(true)
      Expect(error.details?.['darwinInspection']).toEqual({
        inspection: 'descendants',
        requestedPids: [45001],
        requestedPidCount: 1,
        backend: 'in-process-bun',
        failureKind: 'child-enumeration',
        routine: 'proc_listchildpids',
        pid: 45001,
        returnedCount: -1,
      })
      Expect(Errors.formatForLog(error)).not.toContain('private-credential')
      Expect(Errors.formatForLog(error)).not.toContain('private-backend-output')
      Expect(fixture.events).toEqual(['run', 'stdin-ended', 'output-drained', 'disposed'])
      Expect(fixture.living.has(fixture.root.pid)).toBe(false)
      Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
    },
  )

  Test(
    'fixed ultrashort source child probes actual launch kernel inspection without native target effects',
    async () => {
      let child: CLI.StartedCommand | undefined
      let root: TrackedProcess | undefined
      let closed: CLI.CommandCloseResult | undefined
      let phases = ''
      try {
        const result = await runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
          start: (command, spec) => {
            Expect(command).toBe('/bin/sh')
            child = CLI.start(Platform.runtimeProcess.execPath, {
              ...spec,
              args: [Repo.resolvePath('packages/apps/expo-host/expo-host-tests/fixed-ios-launch-command-child.ts')],
              cwd: Repo.getRoot(),
            })
            void child.waitForClose().then(value => {
              closed = value
            }, () => {})
            return child
          },
          onCommand: async capture => {
            phases += `${capture.phase},`
            root ??= capture.root
            Expect(capture.root.pid).toBe(child?.pid)
            Expect(ProcessTree.sameProcess(capture.root, root)).toBe(true)
            if (capture.phase === 'held') {
              Expect(ProcessTree.sameProcess(ProcessTree.identities([root.pid]).get(root.pid), root)).toBe(true)
              Expect(ProcessTree.processGroupOf(root.pid)).toBe(ProcessTree.processGroupOf(Platform.runtimeProcess.pid))
            }
          },
        })
        Expect(phases).toBe('held,released,')
        Expect(result.stdout).toBe('fixed source launch completed\n')
        Expect(result.exitCode).toBe(0)
        Expect(result.signal).toBeNull()
        Expect(closed).toEqual({ exitCode: 0, signal: null })
        if (!root) {
          Errors.throwUnexpected('Expected the actual fixed source child kernel capture.')
        }
        Expect(ProcessTree.identities([root.pid]).has(root.pid)).toBe(false)
        Expect(Platform.processIsAlive(root.pid)).toBe(false)
      } catch (error) {
        // A natural inspector failure is evidence, never converted into a passing race reproduction.
        if (error instanceof Errors.HostEnvironmentError) {
          Expect(error.details?.['retainsTargetLease']).toBe(true)
          Expect(error.details?.['darwinInspection']).toBeDefined()
        }
        throw error
      } finally {
        child?.endStdin()
        if (child) {
          Expect(await Time.pollUntil(() => closed, { intervalMs: 25, timeoutMs: 10_000 })).toBeDefined()
          await child.closeOutput()
          child.dispose()
        }
      }
    },
  )

  Test(
    'after ACK an inspection failure and a second drain inspection failure preserve both causes and drain independently',
    async () => {
      const fixture = commandFixture()
      const first = new Errors.HostEnvironmentError('fixture admitted kernel inspection failure')
      const second = new Errors.HostEnvironmentError('fixture cleanup kernel inspection failure')
      const observer = Deferred<void>()
      let inspections = 0
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
        ...fixture.operations,
        onCommand: capture => {
          if (capture.phase === 'released') {
            fixture.tree.identities = () => {
              inspections++
              throw inspections === 1 ? first : second
            }
            return observer.promise
          }
          return Promise.resolve()
        },
      })
      const error = await hostFailure(running)
      observer.resolve()
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(error).toHaveProperty('cause.cause', first)
      Expect(error.details?.['secondaryFailures']).toEqual([
        { stage: 'captured kernel drain inspection', error: second },
      ])
      Expect(fixture.events).toEqual(['run', 'stdin-ended', 'output-drained', 'disposed'])
      Expect(fixture.living.has(fixture.root.pid)).toBe(false)
      Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
    },
  )

  Test(
    'after admission, primary observer and repeated cleanup inspection failures still drain output and retain the target',
    async () => {
      const fixture = commandFixture()
      const primary = new Errors.HostEnvironmentError('fixture primary observer failure')
      const inspection = new Errors.HostEnvironmentError('fixture repeated kernel inspection failure')
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
        ...fixture.operations,
        onCommand: capture => {
          if (capture.phase === 'released') {
            fixture.tree.identities = () => {
              throw inspection
            }
            throw primary
          }
          return Promise.resolve()
        },
      })
      const error = await hostFailure(running)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(error.cause).toBe(primary)
      Expect(error.details?.['secondaryFailures']).toEqual([
        { stage: 'owned command stop', error: inspection },
        { stage: 'captured kernel drain inspection', error: inspection },
      ])
      Expect(fixture.events).toEqual(['run', 'stdin-ended', 'output-drained', 'disposed'])
      Expect(fixture.living.has(fixture.root.pid)).toBe(false)
      Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
    },
  )

  Test('signaling and output failures are both preserved after independent command closure', async () => {
    const fixture = commandFixture()
    const primary = new Errors.HostEnvironmentError('fixture primary launch observer failure')
    const signaling = new Errors.HostEnvironmentError('fixture owned signaling failure')
    const output = new Errors.HostEnvironmentError('fixture output closure failure')
    fixture.command.kill = () => {
      fixture.events.push('signal-attempted')
      fixture.complete()
      throw signaling
    }
    fixture.command.closeOutput = async () => {
      fixture.events.push('output-drain-attempted')
      throw output
    }
    const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
      ...fixture.operations,
      onCommand: capture => {
        if (capture.phase === 'released') {
          throw primary
        }
        return Promise.resolve()
      },
    })
    const error = await hostFailure(running)
    Expect(error.details?.['retainsTargetLease']).toBe(true)
    Expect(error.cause).toBe(primary)
    Expect(error.details?.['secondaryFailures']).toEqual([
      { stage: 'owned command stop', error: signaling },
      { stage: 'output drain', error: output },
    ])
    Expect(fixture.events).toEqual(['run', 'signal-attempted', 'output-drain-attempted', 'disposed'])
    Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
  })

  for (const inspectionKind of ['identities', 'liveness'] as const) {
    Test(`post-close ${inspectionKind} failure cannot become success or lose retention during cleanup`, async () => {
      const fixture = commandFixture()
      const failure = new Errors.HostEnvironmentError(`fixture final ${inspectionKind} inspection failure`)
      const identities = fixture.tree.identities
      if (inspectionKind === 'identities') {
        fixture.tree.identities = pids => {
          if (!fixture.living.has(fixture.root.pid)) {
            throw failure
          }
          return identities(pids)
        }
      } else {
        fixture.operations.processIsAlive = () => {
          throw failure
        }
      }
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
        ...fixture.operations,
        onCommand: async capture => {
          if (capture.phase === 'released') {
            fixture.complete()
          }
        },
      })
      const error = await hostFailure(running)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      Expect(error.cause).toBe(failure)
      Expect(error.details?.['secondaryFailures']).toEqual([
        { stage: 'captured kernel drain inspection', error: failure },
      ])
      Expect(fixture.events).toEqual(['run', 'output-drained', 'output-drained', 'disposed'])
      Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
    })
  }

  Test('captures the held kernel before admission and proves a clean command drain', async () => {
    const fixture = commandFixture()
    const phases: string[] = []
    const result = await runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
      ...fixture.operations,
      onCommand: async capture => {
        phases.push(capture.phase)
        if (capture.phase === 'held') {
          Expect(fixture.events).toEqual([])
        }
        if (capture.phase === 'released') {
          fixture.complete()
        }
      },
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.args).toEqual(['simctl', 'boot', udid])
    Expect(phases).toEqual(['held', 'released'])
    Expect(fixture.events).toEqual(['run', 'output-drained', 'disposed'])
    Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
  })

  Test(
    'a recorded descendant surviving native closure retains the target without signalling borrowed processes',
    async () => {
      const fixture = commandFixture()
      const descendant: TrackedProcess = { pid: 45003, startedAt: 'owned-descendant', command: 'simctl descendant' }
      fixture.living.set(descendant.pid, descendant)
      fixture.tree.descendants = () => [descendant]
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => false, {
        ...fixture.operations,
        onCommand: async capture => {
          if (capture.phase === 'held') {
            await Promise.resolve()
          }
          if (capture.phase === 'released') {
            fixture.complete()
          }
        },
      })
      await Expect(running).rejects.toThrow('cleanup remains uncertain')
      Expect(fixture.events.some(event => event.startsWith('kill:'))).toBe(false)
      Expect(fixture.living.get(fixture.borrowed.pid)).toEqual(fixture.borrowed)
    },
  )

  for (
    const intent of [
      { stage: 'install', udid, appPath: host.binaryPath, artifactRoot: host.directory },
      { stage: 'openurl', udid, url: 'exp://127.0.0.1:49152', metroPort: 49152 },
    ] as const satisfies readonly FixedIosLaunchIntent[]
  ) {
    Test(
      `cancels admitted ${intent.stage} while its observer waits, drains, and retains uncertain simulator effects`,
      async () => {
        const fixture = commandFixture()
        const observing = Deferred<void>()
        const releaseObserver = Deferred<void>()
        let stopped = false
        const running = runFixedIosLaunchCommand(intent, () => stopped, {
          ...fixture.operations,
          onCommand: async capture => {
            Expect(capture.root).toEqual(fixture.root)
            if (capture.phase === 'released') {
              observing.resolve()
              await releaseObserver.promise
            }
          },
        })
        await observing.promise
        stopped = true
        const error = await hostFailure(running)
        releaseObserver.resolve()
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect(error.details?.['retainsTargetLease']).toBe(true)
        Expect(error.details?.['released']).toBe(true)
        Expect(fixture.events).toEqual(['run', 'kill:SIGTERM', 'output-drained', 'output-drained', 'disposed'])
        Expect(fixture.spec()?.detached).toBe(false)
        Expect(fixture.living.get(fixture.borrowed.pid)).toEqual(fixture.borrowed)
        Expect(fixture.spec()?.args?.slice(3, 6)).toEqual(['simctl', intent.stage, udid])
      },
    )
  }

  Test('stops a held command before native admission and never writes the execution acknowledgement', async () => {
    const fixture = commandFixture()
    const observing = Deferred<void>()
    const blocked = Deferred<void>()
    let stopped = false
    const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => stopped, {
      ...fixture.operations,
      onCommand: async () => {
        observing.resolve()
        await blocked.promise
      },
    })
    await observing.promise
    stopped = true
    await Expect(running).rejects.toThrow('cancelled before native admission after command drain')
    blocked.resolve()
    Expect(fixture.events.includes('run')).toBe(false)
    Expect(fixture.events).toContain('kill:SIGTERM')
    Expect(fixture.living.has(fixture.borrowed.pid)).toBe(true)
  })

  Test('a clean native close after stop cannot become launch success', async () => {
    const fixture = commandFixture()
    let stopped = false
    const running = runFixedIosLaunchCommand(
      { stage: 'openurl', udid, url: 'exp://localhost:49152', metroPort: 49152 },
      () => stopped,
      {
        ...fixture.operations,
        onCommand: async capture => {
          if (capture.phase === 'released') {
            stopped = true
            fixture.complete()
          }
        },
      },
    )
    await Expect(running).rejects.toThrow('cancelled after native admission')
    Expect(fixture.events).toContain('output-drained')
  })

  Test('records a late observer rejection after cancellation instead of leaving an unhandled rejection', async () => {
    const fixture = commandFixture()
    const observer = Deferred<void>()
    const entered = Deferred<void>()
    let stopped = false
    const captured = await withCapturedOutput(async () => {
      const running = runFixedIosLaunchCommand({ stage: 'boot', udid }, () => stopped, {
        ...fixture.operations,
        onCommand: async capture => {
          if (capture.phase === 'released') {
            entered.resolve()
            await observer.promise
          }
        },
      })
      await entered.promise
      stopped = true
      await Expect(running).rejects.toThrow('cancelled after native admission')
      observer.reject(new Errors.HostEnvironmentError('fixture late observer diagnostic'))
      await Promise.resolve()
      await Promise.resolve()
    })
    Expect(captured.stdout + captured.stderr).toContain(
      'Late iOS launch observer failure: fixture late observer diagnostic',
    )
  })

  Test('rejects a runtime URL from another Metro session before starting any command', async () => {
    const fixture = commandFixture()
    await Expect(
      runFixedIosLaunchCommand(
        { stage: 'openurl', udid, url: 'exp://localhost:8081', metroPort: 49152 },
        () => false,
        fixture.operations,
      ),
    )
      .rejects.toThrow('does not name this Metro session')
    Expect(fixture.spec()).toBeUndefined()
  })
})

Describe('iOS Companion cancellation', () => {
  Test('stop during host lookup prevents installation', async () => {
    const lookup = Deferred<{ host: typeof host; refused: string[] }>()
    let stopped = false
    let installs = 0
    const preparation = prepareSimulatorCompanion(udid, 'fixture simulator', {
      findPrebuiltHost: () => lookup.promise,
      shouldStop: () => stopped,
      installedMatches: async () => false,
      install: async () => {
        installs++
      },
    })
    stopped = true
    lookup.resolve({ host, refused: [] })
    await Expect(preparation).rejects.toThrow('preparation cancelled')
    Expect(installs).toBe(0)
  })

  Test('stop during install prevents reporting Companion readiness', async () => {
    const installing = Deferred<void>()
    const installed = Deferred<void>()
    let stopped = false
    await withCapturedOutput(async () => {
      const preparation = prepareSimulatorCompanion(udid, 'fixture simulator', {
        findPrebuiltHost: async () => ({ host, refused: [] }),
        shouldStop: () => stopped,
        installedMatches: async () => false,
        install: async () => {
          installing.resolve()
          await installed.promise
        },
      })
      await installing.promise
      stopped = true
      installed.resolve()
      await Expect(preparation).rejects.toThrow('preparation cancelled')
    })
  })
})

Test(
  'dispatch drain rejection still shuts down services and preserves both failures and target uncertainty',
  async () => {
    const dispatch = Deferred<void>()
    const serviceClosed = Deferred<void>()
    const failure = new Errors.HostEnvironmentError('fixture dispatch drain failed', {
      details: { retainsTargetLease: true },
    })
    const cleaning = settleDevLoopCleanup(dispatch.promise, async () => {
      serviceClosed.resolve()
      Errors.throwHostEnvironment('fixture service close failed')
    })
    await serviceClosed.promise
    dispatch.reject(failure)
    const result = await hostFailure(cleaning)
    Expect(result.message).toContain('fixture dispatch drain failed; fixture service close failed')
    Expect(result.cause).toBe(failure)
    Expect(result.details?.['retainsTargetLease']).toBe(true)
    Expect(result.details?.['failures']).toHaveLength(2)
  },
)
