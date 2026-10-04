import { EXPO_SDK_VERSION } from '@expo-host/dev-loop/expo-runner/expo-config'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred } from '@shared/test'
import {
  managedIosBarrierControlPrefix,
  managedIosCommandArguments,
  type ManagedIosCommandPlan,
} from '../dev-cli-src/dev-loop/ManagedIosCommandBarrier'
import type { ManagedIosRuntimeOperations } from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime'

export function managedIosRuntimeSourceStage(command: string, spec: CLI.CommandSpec = {}): string {
  if (spec.args?.[0]?.endsWith('/ManagedIosCommandBarrierSupervisor.ts')) {
    return (JSON.parse(FS.readTextSync(spec.args[1]!)) as ManagedIosCommandPlan).intent.stage
  }
  return command === 'xcrun' ? spec.args?.[1] ?? 'unknown' : 'download'
}

/** Finite source children exercise the production journal and admission; no physical SDK install occurs. */
export function managedIosRuntimeSourceOperations(
  base: Pick<ManagedIosRuntimeOperations, 'run' | 'tree' | 'resources'>,
): Partial<ManagedIosRuntimeOperations> {
  const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
  const identities = new Map<number, TrackedProcess>()
  const groups = new Set<number>()
  const workerGroups = new Map<number, number>()
  let sequence = 0
  let app = ''
  const results = new Map<number, ReturnType<typeof Deferred<CLI.CommandCloseResult>>>()
  const finish = (pid: number, exitCode = 0, signal: Platform.ProcessSignal | null = null) => {
    identities.delete(pid)
    groups.delete(pid)
    results.get(pid)!.resolve({ exitCode, signal })
  }
  const tree: typeof ProcessTree = {
    ...base.tree,
    identities: pids =>
      new Map(pids.flatMap(pid => {
        const value = identities.get(pid) ?? (pid === holder.pid ? holder : base.tree.identities([pid]).get(pid))
        return value ? [[pid, value] as const] : []
      })),
    descendants: pid => [...identities.values()].filter(process => workerGroups.get(process.pid) === pid),
    groupMembers: group =>
      [...identities.values()].filter(process => process.pid === group || workerGroups.get(process.pid) === group),
    processGroupOf: pid => workerGroups.get(pid) ?? (groups.has(pid) ? pid : undefined),
    isGroupAlive: pid => groups.has(pid),
    signalTracked: (tracked, signal) => {
      for (const expected of tracked) {
        if (ProcessTree.sameProcess(identities.get(expected.pid), expected)) {
          finish(expected.pid, 1, signal)
        }
      }
    },
  }
  const result = (stdout = ''): CLI.CommandResult => ({
    command: 'source SDK fixture',
    args: [],
    stdout,
    stderr: '',
    exitCode: 0,
    signal: null,
  })
  const run: typeof CLI.run = async (command, spec) => {
    const args = spec?.args ?? []
    if (command === 'plutil') {
      return result(args[1] === 'CFBundleIdentifier' ? 'host.exp.Exponent' : 'source-client')
    }
    if (command === 'xcrun' && args[1] === 'get_app_container') {
      return result(app)
    }
    return await base.run(command, spec)
  }
  return {
    run,
    tree,
    resources: base.resources,
    onSignal: () => () => {},
    budgetMs: 2_000,
    start: (command, spec = {}) => {
      const plan = spec.args?.[0]?.endsWith('/ManagedIosCommandBarrierSupervisor.ts')
        ? JSON.parse(FS.readTextSync(spec.args[1]!)) as ManagedIosCommandPlan
        : undefined
      const nativeArgs = plan ? managedIosCommandArguments(plan) : undefined
      const pid = 2 ** 28 + ++sequence
      identities.set(pid, { pid, startedAt: `source-private-ios-${pid}`, command })
      groups.add(pid)
      const closed = Deferred<CLI.CommandCloseResult>()
      results.set(pid, closed)
      const workerPid = plan ? 2 ** 28 + ++sequence : pid
      if (plan) {
        identities.set(workerPid, {
          pid: workerPid,
          startedAt: `source-held-worker-${workerPid}`,
          command: 'source fixed iOS command worker',
        })
        workerGroups.set(workerPid, pid)
        results.set(workerPid, Deferred<CLI.CommandCloseResult>())
      }
      const emit = (event: 'ready' | 'closed', result?: CLI.CommandCloseResult) =>
        spec.onOutput?.(
          'stdout',
          Buffer.from(
            `${managedIosBarrierControlPrefix}${
              JSON.stringify({ event, generation: plan!.generation, workerPid, workerParentPid: pid, result })
            }\n`,
          ),
        )
      let released = false
      let cancelled = false
      const work = async () => {
        try {
          if (plan?.intent.stage === 'download' || spec.args?.[1] === 'download') {
            const root = plan?.root ?? FS.dirname(spec.args![2]!)
            app = FS.resolvePath('expo-home/Expo.app', root)
            await FS.mkdir(app)
            await FS.writeText(FS.resolvePath('Exponent', app), 'source SDK executable')
            await FS.writeText(FS.resolvePath('Info.plist', app), 'source SDK metadata')
            await FS.writeJson(FS.resolvePath('download.json', root), {
              sdk: EXPO_SDK_VERSION,
              publisher: 'installed Expo SDK metadata',
              url: 'https://expo.dev/source-runtime',
              clientVersion: 'source-client',
              appPath: app,
              executable: 'Exponent',
              bundleId: 'host.exp.Exponent',
              digest: Platform.sha256Hex('source SDK executable'),
            })
            const stdout = `TAO_PRIVATE_IOS_ARTIFACT ${
              JSON.stringify(await FS.readJson(FS.resolvePath('download.json', root)))
            }\n`
            if (plan) {
              await FS.writeText(FS.resolvePath(`command-${plan.generation}-stdout.txt`, root), stdout)
              await FS.writeText(FS.resolvePath(`command-${plan.generation}-stderr.txt`, root), '')
              finish(workerPid)
              emit('closed', { exitCode: 0, signal: null })
              return
            }
            spec.onOutput?.('stdout', Buffer.from(stdout))
          } else {
            const output = await run(plan ? 'xcrun' : command, plan ? { ...spec, args: nativeArgs } : spec)
            if (plan) {
              await FS.writeText(FS.resolvePath(`command-${plan.generation}-stdout.txt`, plan.root), output.stdout)
              await FS.writeText(FS.resolvePath(`command-${plan.generation}-stderr.txt`, plan.root), output.stderr)
              finish(workerPid, output.exitCode ?? 1, output.signal)
              emit('closed', { exitCode: output.exitCode, signal: output.signal })
              return
            }
            spec.onOutput?.('stdout', Buffer.from(output.stdout))
            spec.onOutput?.('stderr', Buffer.from(output.stderr))
            if (output.exitCode !== 0) {
              finish(pid, output.exitCode ?? 1)
              return
            }
          }
          finish(pid)
        } catch (error) {
          if (plan) {
            await FS.writeText(FS.resolvePath(`command-${plan.generation}-stdout.txt`, plan.root), '')
            await FS.writeText(
              FS.resolvePath(`command-${plan.generation}-stderr.txt`, plan.root),
              Errors.formatForUser(error),
            )
            finish(workerPid, 1)
            emit('closed', { exitCode: 1, signal: null })
          } else {
            finish(pid, 1)
          }
        }
      }
      if (plan) {
        void Promise.resolve().then(() => emit('ready'))
      } else {
        void Promise.resolve().then(work)
      }
      return {
        pid,
        error: undefined,
        exitCode: null,
        signalCode: null,
        writeStdin: (line: string) => {
          if (plan && line === `run ${plan.generation}\n` && !released && !cancelled) {
            released = true
            // The external worker executes after the synchronous ACK admission returns.
            void Promise.resolve().then(work)
          } else if (plan && line === `finish ${plan.generation}\n`) {
            finish(pid)
          } else if (plan && line === `cancel ${plan.generation}\n`) {
            cancelled = true
            finish(workerPid, 1, 'SIGTERM')
            void Promise.all([
              FS.writeText(FS.resolvePath(`command-${plan.generation}-stdout.txt`, plan.root), ''),
              FS.writeText(FS.resolvePath(`command-${plan.generation}-stderr.txt`, plan.root), ''),
            ]).then(() => emit('closed', { exitCode: null, signal: 'SIGTERM' }))
          }
          return true
        },
        endStdin: () => {
          cancelled = true
          if (plan) {
            finish(workerPid, 1, 'SIGTERM')
          }
          finish(pid, 1, 'SIGTERM')
        },
        waitForClose: () => closed.promise,
        closeOutput: async () => {},
        dispose: () => {},
        kill: (signal: Platform.ProcessSignal) => finish(pid, 1, signal),
      } as unknown as CLI.StartedCommand
    },
  }
}

/** Real finite process groups surround simulated target/SDK work so the controller records kernel evidence. */
export function managedIosRuntimeRealChildSourceOperations(
  base: Pick<ManagedIosRuntimeOperations, 'run' | 'tree' | 'resources'>,
  root: string,
): Partial<ManagedIosRuntimeOperations> {
  const source = managedIosRuntimeSourceOperations(base)
  return {
    ...source,
    budgetMs: 10_000,
    tree: {
      ...source.tree!,
      identities: pids => new Map([...source.tree!.identities(pids), ...ProcessTree.identities(pids)]),
      descendants: pid =>
        source.tree!.descendants(pid).length ? source.tree!.descendants(pid) : ProcessTree.descendants(pid),
      groupMembers: group =>
        source.tree!.groupMembers(group).length ? source.tree!.groupMembers(group) : ProcessTree.groupMembers(group),
      processGroupOf: pid => source.tree!.processGroupOf(pid) ?? ProcessTree.processGroupOf(pid),
      isGroupAlive: group => source.tree!.isGroupAlive(group) || ProcessTree.isGroupAlive(group),
    },
    start: (command, spec = {}) => {
      if (spec.args?.[0]?.endsWith('/ManagedIosCommandBarrierSupervisor.ts')) {
        const plan = JSON.parse(FS.readTextSync(spec.args[1]!)) as ManagedIosCommandPlan
        const started = CLI.start(command, {
          ...spec,
          args: [
            Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/ManagedIosCommandBarrierSourceSupervisor.ts'),
            spec.args[1]!,
            'fixed-result',
          ],
        })
        let closed = false
        void started.waitForClose().then(() => {
          closed = true
        }, () => {
          closed = true
        })
        void (async () => {
          const released = await Time.pollUntil(
            async () =>
              await FS.isFile(FS.resolvePath(`source-released-${plan.generation}.json`, plan.root)) ? true : undefined,
            {
              intervalMs: 25,
              timeoutMs: 10_000,
              stop: () => closed,
            },
          )
          if (!released) {
            return
          }
          let result: CLI.CommandResult
          try {
            if (plan.intent.stage === 'download') {
              let stdout = ''
              let stderr = ''
              const simulated = source.start!(Platform.runtimeProcess.execPath, {
                args: managedIosCommandArguments(plan),
                env: spec.env,
                onOutput: (stream, chunk) => {
                  if (stream === 'stdout') {
                    stdout += chunk.toString('utf8')
                  } else {
                    stderr += chunk.toString('utf8')
                  }
                },
              })
              const close = await simulated.waitForClose()
              await simulated.closeOutput()
              simulated.dispose()
              result = {
                command: Platform.runtimeProcess.execPath,
                args: managedIosCommandArguments(plan),
                stdout,
                stderr,
                ...close,
              }
            } else {
              result = await source.run!('xcrun', { args: managedIosCommandArguments(plan) })
            }
          } catch (error) {
            result = {
              command: 'fixed source result',
              args: [],
              stdout: '',
              stderr: Errors.formatForUser(error),
              exitCode: 1,
              signal: null,
            }
          }
          const path = FS.resolvePath(`source-result-${plan.generation}.json`, plan.root)
          await FS.writeJson(`${path}.pending`, result)
          await FS.chmod(`${path}.pending`, 0o600)
          await FS.move(`${path}.pending`, path)
        })().catch(() => started.endStdin())
        return started
      }
      const marker = FS.resolvePath(`finite-child-${Platform.randomUUID()}.json`, root)
      const simulated = source.start!(command, spec)
      const started = CLI.start(Platform.runtimeProcess.execPath, {
        ...spec,
        args: [
          '--eval',
          `
          import { Errors, FS, Platform, Time } from ${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))
          };
          const closed = await Time.pollUntil(async () => await FS.isFile(${JSON.stringify(marker)})
            ? await FS.readJson(${JSON.stringify(marker)}) : undefined, { intervalMs: 25, timeoutMs: 10000 });
          if (!closed) Errors.throwHostEnvironment('Finite source child did not receive its owned completion record.');
          Platform.runtimeProcess.setExitCode(closed.exitCode ?? 1);
        `,
        ],
        onOutput: undefined,
        timeoutMs: 10_000,
      })
      const completion = simulated.waitForClose().then(async closed => {
        await FS.writeJson(marker, closed)
      })
      void completion.catch(() => {})
      return {
        ...started,
        waitForClose: async () => {
          await completion
          return await started.waitForClose()
        },
        closeOutput: async () => {
          try {
            await simulated.closeOutput()
          } finally {
            await started.closeOutput()
          }
        },
        dispose: () => {
          simulated.dispose()
          started.dispose()
        },
      }
    },
  }
}
