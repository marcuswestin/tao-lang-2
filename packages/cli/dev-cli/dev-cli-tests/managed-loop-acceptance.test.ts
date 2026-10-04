import type { MachineResourceOwner } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo } from '@shared'
import { connectDevLoopWorker } from '@shared/DevLoopControl'
import type { TrackedProcess } from '@shared/ProcessTree'
import { Deferred, Expect, settle, Test, withCapturedOutput } from '@shared/test'
import { runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import { runDevLoopController } from '../dev-cli-src/dev-loop/DevLoopController'
import type { DevLoopReceipt } from '../dev-cli-src/dev-loop/DevLoopStore'
import {
  devLoopDirectory,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'
import {
  runManagedLoopAcceptance,
  validateManagedLoopRestartReloadRace,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptance'
import {
  assertManagedChromePage,
  managedChromePageMatches,
  runCurrentManagedChromeAction,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceChrome'
import {
  captureManagedForegroundProcesses,
  ManagedLoopAcceptanceEvidence,
  type ManagedLoopInventory,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceEvidence'
import {
  type ManagedIosNativeStopObservation,
  managedIosNativeStopStage,
  managedLoopAndroidPrefix,
  managedLoopFaultArgs,
  type ManagedLoopFaultScenario,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults'
import {
  cleanupManagedLoopAcceptanceFixtures,
  ManagedLoopAcceptanceFixtures,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceFixture'
import type { ManagedIosAsset } from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime'
import type { ManagedLoopProcessGroupDiagnostic } from '../dev-cli-src/dev-loop/ManagedLoopProcessGroupDiagnostic'

const emptyInventory: ManagedLoopInventory = { processCount: 100, peers: [], resources: [] }

for (const orderedReload of [false, true]) {
  Test(
    `actual public controller ${
      orderedReload ? 'orders reload before restart' : 'fences concurrent reload while restart changes generation'
    } and accepts fresh successor reload`,
    async () => {
      const session = Platform.randomUUID()
      const receipt: DevLoopReceipt = {
        version: 1,
        session,
        checkout: await FS.realPath(Repo.getRoot()),
        generation: Platform.randomUUID(),
        state: 'starting',
        args: ['/source-owned', '--app', 'DataMVPApp'],
        selection: { projectRoot: '/source-owned', appPath: '/source-owned/Data MVP.tao', appName: 'DataMVPApp' },
        createdAt: 'stamp',
        updatedAt: 'stamp',
        children: [],
      }
      await writeDevLoopReceipt(receipt)
      const initialReady = Deferred()
      const restartEntered = Deferred()
      const restartRelease = Deferred()
      const stopped = Deferred()
      const events: { event: string; action: string; session: string; generation: string }[] = []
      let reloadEffects = 0
      let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
      const controller = await runDevLoopController(receipt, {
        runAppDev: async (_args, _operations, managed) => {
          hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
          const record = (event: string, action: string) => {
            events.push({ event, action, ...hooks!.identity!() })
          }
          hooks.bind({
            restart: async () => {
              record('action-start', 'restart')
              restartEntered.resolve()
              await restartRelease.promise
              await hooks!.emit({ type: 'starting' })
              record('action-end', 'restart')
            },
            reload: async () => {
              record('action-start', 'reload')
              reloadEffects++
              record('action-end', 'reload')
            },
            stop: async () => {
              stopped.resolve()
            },
          })
          await hooks.emit({ type: 'starting' })
          await hooks.emit({ type: 'ready', url: 'source-only', targets: [] })
          initialReady.resolve()
          await stopped.promise
          await hooks.close()
          await managed!.beforeTargetCleanup?.()
          return 0
        },
      })
      const command = async (action: 'reload' | 'restart'): Promise<CLI.CommandResult> => {
        const capture = await withCapturedOutput(() => runDevLoopCommand([action, '--session', session, '--json']))
        return {
          command: './dev',
          args: ['dev-loop', action, '--session', session, '--json'],
          stdout: capture.stdout,
          stderr: capture.stderr,
          signal: null,
          exitCode: capture.result,
        }
      }
      try {
        await initialReady.promise
        const before = await readDevLoopReceipt(session)
        let reload: Promise<CLI.CommandResult>
        if (orderedReload) {
          reload = Promise.resolve(await command('reload'))
        }
        const restarting = command('restart')
        await restartEntered.promise
        if (!orderedReload) {
          reload = command('reload')
        }
        await settle()
        Expect(reloadEffects).toBe(orderedReload ? 1 : 0)
        restartRelease.resolve()
        const [restartResult, reloadResult] = await Promise.all([restarting, reload!])
        Expect(reloadResult.exitCode).toBe(orderedReload ? 0 : 1)
        Expect(
          ProcessTree.sameProcess(
            ProcessTree.identities([before.controller!.pid]).get(before.controller!.pid),
            before.controller!,
          ),
        ).toBe(true)
        await hooks!.emit({ type: 'ready', url: 'source-successor', targets: [] })
        const after = await readDevLoopReceipt(session)
        const proof = { before, after, restart: restartResult, reload: reloadResult, events: [...events] }
        Expect(validateManagedLoopRestartReloadRace(proof).reload).toBe(
          orderedReload ? 'ordered before restart' : 'fenced',
        )
        if (orderedReload) {
          // The command snapshot can advance after its serialized input finished.
          Expect(
            validateManagedLoopRestartReloadRace({
              ...proof,
              reload: { ...reloadResult, stdout: restartResult.stdout },
            }).reload,
          ).toBe('ordered before restart')
          Expect(() =>
            validateManagedLoopRestartReloadRace({
              ...proof,
              events: [
                ...events.filter(event => event.action === 'restart'),
                ...events.filter(event => event.action === 'reload'),
              ],
            })
          ).toThrow('ordered before the generation fence')
        }
        if (!orderedReload) {
          const refused = JSON.parse(reloadResult.stdout) as DevLoopReceipt & { ok: boolean; error: string }
          Expect(refused.error).toBe('The dev loop is not ready for this command.')
          Expect(() =>
            validateManagedLoopRestartReloadRace({
              ...proof,
              reload: { ...reloadResult, stdout: JSON.stringify({ ...refused, error: 'Unrelated transport failure' }) },
            })
          ).toThrow('exact generation fence refusal')
          Expect(() =>
            validateManagedLoopRestartReloadRace({
              ...proof,
              reload: { ...reloadResult, stdout: JSON.stringify({ ...refused, generation: Platform.randomUUID() }) },
            })
          ).toThrow('recorded generation transition')
          Expect(() =>
            validateManagedLoopRestartReloadRace({
              ...proof,
              events: [...events, { event: 'action-start', action: 'reload', session, generation: after.generation }],
            })
          ).toThrow('without input effects')
          Expect(reloadEffects).toBe(0)
        }
        const fresh = await command('reload')
        Expect(fresh.exitCode).toBe(0)
        Expect((JSON.parse(fresh.stdout) as DevLoopReceipt).generation).toBe(after.generation)
        Expect(reloadEffects).toBe(orderedReload ? 2 : 1)
      } finally {
        restartRelease.resolve()
        stopped.resolve()
        await controller.waitForDisposal()
        await FS.remove(devLoopDirectory(session))
      }
    },
  )
}

type Report = {
  artifactRoot: string
  evidenceKind: string
  rows: { name: string; disposition: string; hostDisposition?: string; detail?: unknown }[]
  visibilityWarning?: string
}

function harness(
  fault: 'none' | 'reload-generation' | 'restart-generation' | 'retained-stop' | 'keep-old-service' = 'none',
) {
  const records = new Map<string, DevLoopReceipt>()
  const current = new Map<number, TrackedProcess>()
  const commands: string[][] = []
  let servicePid = 90_010
  const result = (command: string, args: readonly string[], stdout = '', exitCode = 0): CLI.CommandResult => ({
    command,
    args: [...args],
    exitCode,
    signal: null,
    stdout,
    stderr: '',
  })
  const operations = {
    evidenceKind: 'source regression' as const,
    inventory: async () => ({
      ...structuredClone(emptyInventory),
      listeners: [...current.values()]
        .filter(process => process.command === 'metro').map(process => ({
          pid: process.pid,
          startedAt: process.startedAt,
          port: 8081,
        })),
    }),
    identities: (pids: readonly number[]) =>
      new Map(pids.flatMap(pid => current.has(pid) ? [[pid, current.get(pid)!] as const] : [])),
    receipt: async (session: string) => structuredClone(records.get(session)!),
    run: async (command: string, spec: CLI.CommandSpec = {}) => {
      const args = [...spec.args ?? []]
      if (command === 'git') {
        return result(command, args, args[0] === 'rev-parse' ? 'source-commit\n' : '')
      }
      Expect(args[0]).toBe('dev-loop')
      commands.push(args)
      const verb = args[1]
      if (verb === 'start') {
        const fixture = args[2]!
        const session = Platform.randomUUID()
        const controller = { pid: 90_000, startedAt: 'controller-start', command: 'controller' }
        const worker = { pid: ++servicePid, startedAt: `service-${servicePid}`, command: 'metro' }
        const wrapper = { pid: 90_100, startedAt: 'persistent-wrapper', command: 'wrapper' }
        current.set(controller.pid, controller)
        current.set(worker.pid, worker)
        current.set(wrapper.pid, wrapper)
        const receipt: DevLoopReceipt = {
          version: 1,
          session,
          checkout: await FS.realPath(Repo.getRoot()),
          args: [
            fixture,
            '--app',
            'DataMVPApp',
            ...args.filter(arg =>
              ['--web', '--ios', '--android', '--show-browser', '--show-simulator', '--show-emulator'].includes(arg)
            ),
          ],
          selection: { projectRoot: fixture, appPath: FS.resolvePath('Data MVP.tao', fixture), appName: 'DataMVPApp' },
          generation: Platform.randomUUID(),
          state: 'ready',
          controller,
          children: [wrapper, worker],
          provenance: 'complete',
          createdAt: 'stamp',
          updatedAt: 'stamp',
          cleanupOutcome: 'pending',
          targets: (['web', 'ios', 'android'] as const).filter(target => args.includes(`--${target}`)).map(target => ({
            target,
            dispatched: true,
          })),
          url: 'http://127.0.0.1:8081',
        }
        records.set(session, receipt)
        return result(command, args, JSON.stringify(receipt))
      }
      const session = args[args.indexOf('--session') + 1]!
      const receipt = records.get(session)!
      if (verb === 'reload' && fault === 'reload-generation') {
        receipt.generation = Platform.randomUUID()
      }
      if (verb === 'restart') {
        if (fault !== 'restart-generation') {
          receipt.generation = Platform.randomUUID()
        }
        if (fault !== 'keep-old-service') {
          for (const child of receipt.children.filter(child => child.command === 'metro')) {
            current.delete(child.pid)
          }
        }
        const child = { pid: ++servicePid, startedAt: `service-${servicePid}`, command: 'metro' }
        current.set(child.pid, child)
        receipt.children = [...receipt.children.filter(child => child.command === 'wrapper'), child]
      }
      if (verb === 'stop') {
        if (fault === 'retained-stop') {
          receipt.state = 'cleanup-failed'
          receipt.cleanupOutcome = 'retained'
          current.clear()
        } else {
          receipt.state = 'stopped'
          receipt.cleanupOutcome = 'proved'
          receipt.controllerDisposed = true
          for (const device of receipt.devices ?? []) {
            device.state = 'released'
          }
          current.clear()
        }
      }
      return result(
        command,
        args,
        verb === 'logs' && !args.includes('--json') ? 'scoped log\n' : JSON.stringify(receipt),
      )
    },
  }
  return { operations, records, current, commands }
}

async function proof(
  options: Parameters<typeof runManagedLoopAcceptance>[0],
  operations: Parameters<typeof runManagedLoopAcceptance>[1],
): Promise<{ exitCode: number; report: Report; stderr: string; cleanup: () => Promise<void> }> {
  const captured = await withCapturedOutput(() => runManagedLoopAcceptance(options, operations))
  const report = JSON.parse(captured.stdout.trim()) as Report
  return {
    exitCode: captured.result,
    report,
    stderr: captured.stderr,
    cleanup: async () => {
      const ledger = FS.resolvePath('external-directories.json', report.artifactRoot)
      if (await FS.isFile(ledger)) {
        const entries = await FS.readJson<{ path: string; state: string }[]>(ledger)
        for (const entry of entries) {
          // Source-only injected records started no real processes, so retained source is test-owned.
          await FS.remove(entry.path)
        }
      }
      await FS.remove(report.artifactRoot)
    },
  }
}

Test('any injected lifecycle operations force source evidence without an explicit evidence kind', async () => {
  const world = harness()
  const { evidenceKind: _evidenceKind, ...sourceOperations } = world.operations
  const result = await proof({ case: 'lifecycle' }, sourceOperations)
  try {
    Expect(result.exitCode).toBe(0)
    Expect(result.report.evidenceKind).toBe('source regression')
    Expect(result.report.rows.some(row => row.disposition === 'pass')).toBe(false)
    Expect(world.commands.some(args => args[1] === 'start')).toBe(true)
    Expect(world.current.size).toBe(0)
  } finally {
    await result.cleanup()
  }
})

for (const explicitKind of [false, true]) {
  Test(
    `injected commands without a diagnostic refuse before allocation with explicit kind ${explicitKind}`,
    async () => {
      let calls = 0
      const captured = await withCapturedOutput(() =>
        runManagedLoopAcceptance({ case: 'commands' }, {
          ...(explicitKind ? { evidenceKind: 'source regression' as const } : {}),
          start: () => {
            calls++
            return Errors.throwUnexpected('An unadmitted adapter must never start a child.')
          },
          run: async () => {
            calls++
            return Errors.throwUnexpected('An unadmitted adapter must never run a command.')
          },
          inventory: async () => {
            calls++
            return emptyInventory
          },
        })
      )
      Expect(captured.result).toBe(1)
      Expect(captured.stdout).toBe('')
      Expect(captured.stderr).toContain('requires an explicit source process-group diagnostic')
      Expect(calls).toBe(0)
    },
  )
}

Test('accessor operation overrides refuse without evaluating the getter or allocating a diagnostic', async () => {
  let reads = 0
  const operations = Object.defineProperty({}, 'processGroupDiagnostic', {
    enumerable: false,
    get: () => {
      reads++
      return () => Errors.throwUnexpected('An accessor must never provide a diagnostic.')
    },
  })
  const captured = await withCapturedOutput(() => runManagedLoopAcceptance({ case: 'commands' }, operations))
  Expect(captured.result).toBe(1)
  Expect(captured.stdout).toBe('')
  Expect(captured.stderr).toContain('operation overrides must be data properties')
  Expect(reads).toBe(0)
})

Test('a nonenumerable diagnostic override is installed explicitly and forces source evidence', async () => {
  let calls = 0
  let invocation = ''
  const world = harness()
  const { evidenceKind: _evidenceKind, ...sourceOperations } = world.operations
  const operations = Object.defineProperty(sourceOperations, 'processGroupDiagnostic', {
    enumerable: false,
    value: async (current: string): Promise<ManagedLoopProcessGroupDiagnostic> => {
      calls++
      invocation = current
      return {
        evidenceKind: 'source regression',
        invocation: current,
        runtime: { platform: Platform.hostPlatform },
        acknowledged: false,
        naturalExitProved: false,
        closureProved: false,
        outputClosed: false,
        disposed: false,
        failures: [],
      }
    },
  })
  const captured = await withCapturedOutput(() => runManagedLoopAcceptance({ case: 'commands' }, operations))
  Expect(calls).toBe(1)
  const report = JSON.parse(captured.stdout.trim()) as Report
  try {
    Expect(captured.result).toBe(1)
    Expect(report.evidenceKind).toBe('source regression')
    Expect(invocation).toBe(FS.basename(report.artifactRoot))
    Expect(report.rows.some(row => row.disposition === 'pass')).toBe(false)
    const diagnostic = await FS.readJson<ManagedLoopProcessGroupDiagnostic>(
      FS.resolvePath('process-group-diagnostic.json', report.artifactRoot),
    )
    Expect(diagnostic.invocation).toBe(invocation)
    Expect(diagnostic.closureProved).toBe(false)
  } finally {
    await FS.remove(report.artifactRoot)
  }
})

for (const scenario of ['proved', 'inconclusive', 'forged host'] as const) {
  Test(`commands acceptance ${scenario} persists the owned-group diagnostic before fixture admission`, async () => {
    const world = harness()
    const events: string[] = []
    const { evidenceKind: _evidenceKind, ...sourceOperations } = world.operations
    const result = await proof({ case: 'commands' }, {
      ...sourceOperations,
      processGroupDiagnostic: async invocation => {
        events.push('diagnostic')
        const diagnostic: ManagedLoopProcessGroupDiagnostic = {
          evidenceKind: scenario === 'forged host' ? 'real host' : 'source regression',
          invocation,
          runtime: { platform: Platform.hostPlatform },
          acknowledged: true,
          naturalExitProved: true,
          closureProved: scenario !== 'inconclusive',
          outputClosed: true,
          disposed: true,
          failures: [],
        }
        return diagnostic
      },
      run: async (command, spec) => {
        if (command === 'git') {
          return await world.operations.run(command, spec)
        }
        events.push('fixture admission')
        return Errors.throwHostEnvironment('Source-only downstream command boundary')
      },
    })
    try {
      const diagnostic = await FS.readJson<ManagedLoopProcessGroupDiagnostic>(
        FS.resolvePath('process-group-diagnostic.json', result.report.artifactRoot),
      )
      Expect(result.exitCode).toBe(1)
      Expect(result.report.evidenceKind).toBe('source regression')
      Expect(diagnostic.evidenceKind).toBe('source regression')
      Expect(diagnostic.invocation).toBe(FS.basename(result.report.artifactRoot))
      Expect(diagnostic.closureProved).toBe(scenario !== 'inconclusive')
      Expect(events).toEqual(scenario === 'proved' ? ['diagnostic', 'fixture admission'] : ['diagnostic'])
      const row = result.report.rows.find(row => row.name === 'fixed owned process-group diagnostic')
      Expect(row?.disposition).toBe(scenario === 'proved' ? 'source regression' : undefined)
      Expect(result.report.rows.some(row => row.disposition === 'pass')).toBe(false)
      Expect(world.commands).toEqual([])
    } finally {
      await result.cleanup()
    }
  })
}

/** A source actor drives complete finite cases; it never creates a host process or resource lease. */
function faultOrchestrationFixture(
  omitCombinedMobile = false,
  malformedCleanupFailure = false,
  nativeFault?: 'closed' | 'entry-exit' | 'owner-rotation' | 'retained-cleanup' | 'active-native' | 'peer-churn',
) {
  type Actor = {
    receipt: DevLoopReceipt
    kind?: ManagedLoopFaultScenario
    eventRoot: string
    events: Record<string, unknown>[]
    controllerEvents: Record<string, unknown>[]
    stops: number
    pending?: ReturnType<typeof Deferred<void>>
    retained: boolean
    publication?: Promise<void>
    nativeObservation?: ManagedIosNativeStopObservation
    nativeAsset?: ManagedIosAsset
  }
  const actors = new Map<string, Actor>()
  const kernel = new Map<number, TrackedProcess>()
  const commands: string[][] = []
  const signals: string[] = []
  const interactions: string[] = []
  const collected: string[] = []
  let pid = 92_000
  let borrowedPreserved = false
  const response = (
    command: string,
    args: readonly string[],
    receipt: DevLoopReceipt,
    exitCode = 0,
  ): CLI.CommandResult => ({
    command,
    args: [...args],
    stdout: JSON.stringify(receipt),
    stderr: '',
    exitCode,
    signal: null,
  })
  const save = async (actor: Actor) => {
    const worker = structuredClone(actor.events)
    const controller = structuredClone(actor.controllerEvents)
    actor.publication = (actor.publication ?? Promise.resolve()).then(async () => {
      for (const [role, events] of [['worker', worker], ['controller', controller]] as const) {
        const temporary = FS.resolvePath(`${role}-${Platform.randomUUID()}.tmp`, actor.eventRoot)
        await FS.writeJson(temporary, events)
        await FS.move(temporary, FS.resolvePath(`${role}-events.json`, actor.eventRoot))
      }
    })
    await actor.publication
    if (actor.nativeAsset) {
      await FS.mkdir(actor.nativeAsset.root)
      await FS.writeJson(FS.resolvePath('asset.json', actor.nativeAsset.root), actor.nativeAsset)
    }
  }
  const create = async (
    fixture: { root: string; appPath: string; sourceIdentity: string },
    artifactRoot: string,
    kind?: ManagedLoopFaultScenario,
    borrowedIos?: string,
  ): Promise<Actor> => {
    const session = Platform.randomUUID()
    const controller = { pid: ++pid, startedAt: `controller-${pid}`, command: 'source controller' }
    const metro = { pid: ++pid, startedAt: `metro-${pid}`, command: 'source Metro' }
    kernel.set(controller.pid, controller)
    kernel.set(metro.pid, metro)
    const target = kind?.startsWith('mobile-android-') ? 'android' : kind?.startsWith('mobile-ios-') ? 'ios' : undefined
    const combined = kind?.startsWith('combined-') === true
    const receipt: DevLoopReceipt = {
      version: 1,
      session,
      checkout: await FS.realPath(Repo.getRoot()),
      generation: Platform.randomUUID(),
      args: kind === undefined
        ? [fixture.root, '--app', 'DataMVPApp']
        : managedLoopFaultArgs(fixture, kind, borrowedIos),
      selection: { projectRoot: fixture.root, appPath: fixture.appPath, appName: 'DataMVPApp' },
      state: 'ready',
      controller,
      children: [metro],
      provenance: 'complete',
      createdAt: 'stamp',
      updatedAt: 'stamp',
      cleanupOutcome: 'pending',
      url: `http://127.0.0.1:${pid}`,
      targets: [],
      devices: combined
        ? [
          { platform: 'ios', id: borrowedIos!, owned: false, state: 'booted' },
          {
            platform: 'android',
            id: 'emulator-5580',
            avdName: `${managedLoopAndroidPrefix(FS.basename(artifactRoot))}1`,
            owned: true,
            state: 'booted',
          },
        ]
        : target === undefined
        ? []
        : [{ platform: target, id: `${target}-source-owned`, owned: true, state: 'booted' }],
    }
    const eventRoot = FS.resolvePath(`source-actors/${session}`, artifactRoot)
    await FS.mkdir(eventRoot)
    const actor: Actor = { receipt, kind, eventRoot, events: [], controllerEvents: [], stops: 0, retained: false }
    actors.set(session, actor)
    const nativeStage = kind && managedIosNativeStopStage(kind)
    if (nativeStage) {
      const id = Platform.randomUUID()
      const native = { pid: ++pid, startedAt: `native-${pid}`, command: 'simctl' }
      const supervisor = { pid: ++pid, startedAt: `supervisor-${pid}`, command: 'source supervisor' }
      const owner: MachineResourceOwner = {
        id: Platform.randomUUID(),
        name: `ios-simulator:${id}`,
        pid: controller.pid,
        processStartedAt: controller.startedAt,
        command: controller.command,
        repositoryRoot: Repo.getRoot(),
        startedAt: 'source acquisition',
      }
      const observation: ManagedIosNativeStopObservation = {
        version: 1,
        invocation: FS.basename(artifactRoot),
        scope: session,
        session,
        loopGeneration: receipt.generation,
        stage: nativeStage,
        id,
        actionGeneration: Platform.randomUUID(),
        holder: controller,
        owners: [owner],
        worker: { ...native, command: 'sh' },
        native,
        group: supervisor.pid,
        supervisor,
        processes: [supervisor, native],
      }
      actor.nativeObservation = observation
      actor.nativeAsset = {
        version: 2,
        invocation: observation.invocation,
        scope: session,
        root: FS.resolvePath(`ios-${session}`, eventRoot),
        name: `Tao Managed ${observation.invocation}_${session}_1`,
        holder: controller,
        id,
        state: 'minted',
        resources: [owner],
        actions: [{
          stage: nativeStage === 'openurl' ? 'install' : nativeStage,
          generation: observation.actionGeneration,
          state: 'captured',
          barrier: {
            version: 1,
            generation: observation.actionGeneration,
            supervisor,
            worker: observation.worker,
            workerParentPid: supervisor.pid,
            group: observation.group,
            processes: [supervisor, observation.worker],
            released: true,
            drainProved: false,
          },
        }],
      }
      receipt.devices = [{ platform: 'ios', id, owned: true, state: 'booted', resources: [owner], holder: controller }]
      receipt.children.push(native)
      receipt.children.push(supervisor)
      if (nativeStage !== 'boot' || nativeFault !== 'closed') {
        kernel.set(native.pid, native)
        kernel.set(supervisor.pid, supervisor)
        const events = nativeStage === 'openurl' ? actor.events : actor.controllerEvents
        events.push({ event: 'ios-native-executing', ...observation })
      }
      if (nativeStage === 'boot' && nativeFault === 'retained-cleanup') {
        actor.retained = true
        receipt.message = 'Private iOS boot has unknown bootstrap ownership; target fences remain retained.'
      }
    }
    if (combined) {
      receipt.targets = ['web', 'ios', 'android'].map(target => ({
        target: target as 'web' | 'ios' | 'android',
        dispatched: kind !== 'combined-web-failure' || target !== 'web',
      }))
      if (kind === 'combined-web-failure') {
        receipt.state = 'failed'
        receipt.message = 'Could not dispatch targets: web.'
        actor.events.push({ event: 'combined-web-refused' }, {
          event: 'combined-dispatch',
          targets: omitCombinedMobile ? receipt.targets.filter(target => target.target === 'web') : receipt.targets,
        })
      }
    } else if (target !== undefined) {
      receipt.targets = [{ target, dispatched: true }]
    }
    if (kind === 'metro-failure' || kind === 'dispatch-failure') {
      receipt.state = 'failed'
      receipt.message = `Intentionally injected ${kind}`
    } else if (kind?.startsWith('pause-') && kind !== 'pause-restart') {
      receipt.state = 'starting'
      actor.events.push({ event: 'phase', phase: kind.slice('pause-'.length) })
    } else if (kind === 'pause-restart') {
      actor.events.push({ event: 'phase', phase: 'compile' })
    }
    if (kind === undefined && (await FS.readText(fixture.appPath)).includes('MissingAcceptanceDeclaration')) {
      receipt.state = 'failed'
      receipt.message = 'MissingAcceptanceDeclaration source error'
    }
    if (receipt.state === 'failed') {
      receipt.controllerDisposed = true
      kernel.delete(controller.pid)
      kernel.delete(metro.pid)
    }
    await save(actor)
    return actor
  }
  const operations: NonNullable<Parameters<typeof runManagedLoopAcceptance>[1]> = {
    evidenceKind: 'source regression',
    inventory: async () => ({
      ...structuredClone(emptyInventory),
      resources: [...actors.values()].flatMap(actor =>
        actor.nativeObservation && actor.receipt.cleanupOutcome !== 'proved'
          ? actor.nativeObservation.owners.map(owner => ({
            name: owner.name,
            generation: actor.nativeObservation?.stage === 'boot' && nativeFault === 'owner-rotation'
              ? 'successor-generation'
              : owner.id,
            pid: owner.pid,
            retained: actor.retained,
          }))
          : []
      ).concat(
        nativeFault === 'peer-churn'
          && [...actors.values()].some(actor => actor.nativeObservation?.stage === 'boot' && actor.stops > 0)
          ? [{ name: 'unrelated-studio-resource', generation: 'unrelated-generation', pid: 93_999, retained: false }]
          : [],
      ),
      peers: nativeFault === 'peer-churn'
          && [...actors.values()].some(actor => actor.nativeObservation?.stage === 'boot' && actor.stops > 0)
        ? [{
          pid: 93_999,
          startedAt: 'unrelated Studio',
          command: 'Studio',
          kind: 'studio',
          role: 'primary' as const,
        }]
        : [],
      targetInspection: { ios: 'complete', android: 'complete' },
      targets: [],
    }),
    identities: pids => new Map(pids.flatMap(pid => kernel.has(pid) ? [[pid, kernel.get(pid)!] as const] : [])),
    processIsAlive: pid => kernel.has(pid),
    receipt: async session => structuredClone(actors.get(session)!.receipt),
    run: async (command, spec = {}) => {
      const args = [...spec.args ?? []]
      if (command === 'git') {
        return {
          command,
          args,
          stdout: args[0] === 'rev-parse' ? 'source-commit\n' : '',
          stderr: '',
          exitCode: 0,
          signal: null,
        }
      }
      commands.push(args)
      if (args[1] === 'start') {
        const fixture = { root: args[2]!, appPath: FS.resolvePath('Data MVP.tao', args[2]!), sourceIdentity: 'source' }
        // The finite runner creates its source ledger before this synthetic public launch.
        const root = [...actors.values()][0]?.eventRoot.split('/source-actors/')[0]
          ?? FS.resolvePath('source-orchestration', Repo.resolvePath('.artifacts/tests'))
        const actor = await create(fixture, root)
        return response(command, args, actor.receipt)
      }
      const actor = actors.get(args[args.indexOf('--session') + 1]!)!
      const verb = args[1]
      if (verb === 'status' && actor.kind === 'authenticated-controls' && actor.receipt.state === 'starting') {
        actor.receipt.state = 'ready'
      }
      if (verb === 'stop') {
        actor.stops++
        if (actor.nativeObservation && actor.stops === 1) {
          const observation = actor.nativeObservation
          if (observation.stage === 'boot' && nativeFault === 'entry-exit') {
            kernel.delete(observation.native.pid)
          }
          actor.controllerEvents.push({
            event: 'ios-native-stop-entry',
            stage: observation.stage,
            session: observation.session,
            generation: observation.loopGeneration,
            observation,
            proved: kernel.has(observation.native.pid),
            reason: kernel.has(observation.native.pid) ? undefined : 'Native command exited before stop entry.',
          })
        }
        actor.pending?.reject(Errors.abortError('Source transport revoked by stop'))
        if (
          actor.retained || actor.nativeObservation?.stage === 'boot' && nativeFault === 'active-native'
          || actor.kind === 'cleanup-failure' && actor.stops === 1
        ) {
          actor.receipt.state = malformedCleanupFailure && actor.kind === 'cleanup-failure'
            ? 'failed'
            : 'cleanup-failed'
          actor.receipt.cleanupOutcome = 'retained'
          actor.events.push({ event: 'services-closed' })
          if (actor.nativeObservation?.stage === 'boot') {
            for (const device of actor.receipt.devices ?? []) {
              device.state = 'retained'
            }
            for (const process of actor.receipt.children) {
              if (nativeFault !== 'active-native' || process.pid !== actor.nativeObservation.native.pid) {
                kernel.delete(process.pid)
              }
            }
          }
          if (!actor.retained && !(actor.nativeObservation?.stage === 'boot' && nativeFault === 'active-native')) {
            actor.receipt.controllerDisposed = true
            for (const identity of [actor.receipt.controller!, ...actor.receipt.children]) {
              kernel.delete(identity.pid)
            }
          }
          await save(actor)
          return response(command, args, actor.receipt, 1)
        }
        actor.receipt.state = 'stopped'
        actor.receipt.cleanupOutcome = 'proved'
        actor.receipt.controllerDisposed = true
        for (const identity of [actor.receipt.controller!, ...actor.receipt.children]) {
          kernel.delete(identity.pid)
        }
        if (actor.nativeObservation?.stage === 'boot' && nativeFault === 'active-native') {
          kernel.set(actor.nativeObservation.native.pid, actor.nativeObservation.native)
        }
        for (const device of actor.receipt.devices ?? []) {
          device.state = 'released'
        }
        if (actor.kind?.startsWith('pause-')) {
          actor.events.push({ event: 'pause-cancelled', phase: actor.kind.slice('pause-'.length) })
        }
        if (actor.kind === 'delayed-cleanup') {
          actor.events.push({ event: 'delayed-cleanup-completed' })
        }
      }
      if (verb === 'reload' || verb === 'restart') {
        if (actor.retained) {
          return response(command, args, actor.receipt, 1)
        }
        if (verb === 'reload' && actor.kind === 'authenticated-controls' && actor.receipt.state !== 'ready') {
          return {
            ...response(command, args, actor.receipt, 1),
            stdout: JSON.stringify({
              ...actor.receipt,
              ok: false,
              error: 'The dev loop is not ready for this command.',
            }),
          }
        }
        actor.events.push({
          event: 'action-start',
          action: verb,
          session: actor.receipt.session,
          generation: actor.receipt.generation,
        })
        actor.pending?.reject(Errors.abortError('Source transport revoked by restart'))
        if (verb === 'restart') {
          actor.receipt.generation = Platform.randomUUID()
          if (actor.kind === 'authenticated-controls') {
            actor.receipt.state = 'starting'
          }
          if (actor.kind === 'pause-restart') {
            actor.events.push({ event: 'phase', phase: 'compile' })
          }
        }
        actor.events.push({
          event: 'action-end',
          action: verb,
          session: actor.receipt.session,
          generation: actor.receipt.generation,
        })
      }
      await save(actor)
      return response(command, args, actor.receipt)
    },
    startFault: async options => {
      const actor = await create(options.fixture, options.artifactRoot, options.scenario, options.borrowedIos)
      return {
        session: actor.receipt.session,
        eventRoot: actor.eventRoot,
        launcher: actor.receipt.controller,
        initialGeneration: actor.receipt.generation,
        rollback: async () => ({ proved: false }),
        collect: async () => {
          collected.push(actor.receipt.session)
          if (actor.nativeAsset && actor.nativeObservation?.stage === 'boot') {
            const action = actor.nativeAsset.actions[0]!
            action.state = 'closed'
            action.barrier!.drainProved = nativeFault !== 'active-native'
            action.barrier!.nativeClose = nativeFault === 'closed'
              ? { exitCode: 0, signal: null }
              : { exitCode: null, signal: 'SIGTERM' }
            await save(actor)
            if (actor.retained || nativeFault === 'active-native') {
              Errors.throwHostEnvironment(
                'Private iOS target cleanup lacks original bootstrap provenance; fences retained.',
              )
            }
          }
        },
        probeAuthentication: async () => ({ missing: 401, wrong: 401, stale: 'Stale generation' }),
      }
    },
    signalOwned: (identity, owned, signal) => {
      if (
        !owned.some(candidate => candidate.pid === identity.pid && candidate.startedAt === identity.startedAt)
        || kernel.get(identity.pid)?.startedAt !== identity.startedAt
      ) {
        Errors.throwHostEnvironment('Source stale identity refused')
      }
      const actor = [...actors.values()].find(actor => actor.receipt.controller?.pid === identity.pid)!
      signals.push(`${actor.kind ?? 'ordinary'}:${signal}`)
      kernel.delete(identity.pid)
      actor.receipt.state = 'interrupted'
      if (actor.pending !== undefined) {
        actor.retained = true
        actor.pending.reject(Errors.abortError('Source holder death revoked transport'))
      }
    },
    chromeInteraction: async context => {
      await context.assertCurrent()
      interactions.push('web')
      return { screenshotPaths: [], rowName: 'source fixture', consoleErrors: [], browserPreserved: true }
    },
    mobileInteraction: async context => {
      await context.assertCurrent()
      const actor = actors.get(context.receipt.session)!
      interactions.push(`${context.target}:${context.phase}`)
      actor.controllerEvents.push({ event: 'mobile-action', phase: 'input' })
      if (context.phase === 'controlled-driver-failure') {
        actor.receipt.mobileDriverCleanup = 'proved'
        await save(actor)
        Errors.throwHostEnvironment('Intentionally injected managed driver action failure')
      }
      if (context.phase.startsWith('overlap-') || context.phase === 'owned-controller-death') {
        actor.receipt.mobileDriverCleanup = 'opening'
        actor.pending = Deferred<void>()
        await save(actor)
        return await actor.pending.promise
      }
      if (context.phase === 'controlled-delete-refusal') {
        actor.retained = true
        actor.receipt.mobileDriverCleanup = 'retained'
        actor.controllerEvents.push({ event: 'mobile-delete-refused' })
        await save(actor)
        Errors.throwHostEnvironment('Intentionally injected managed driver remote deletion refusal')
      }
      await save(actor)
      return {}
    },
    borrowTarget: async (target, artifactRoot, callback) => {
      const id = Platform.randomUUID()
      try {
        await callback(id)
        borrowedPreserved = [...actors.values()].filter(actor => actor.kind?.startsWith('combined-')).every(actor =>
          actor.receipt.state === 'stopped'
          && actor.receipt.devices?.find(device => device.platform === 'ios')?.id === id
        )
        return {
          target,
          id,
          artifacts: artifactRoot,
          disposition: 'source regression',
          preserved: borrowedPreserved,
          cleanup: 'complete',
          processes: [],
          unresolved: [],
        }
      } catch (error) {
        return {
          target,
          id,
          artifacts: artifactRoot,
          disposition: 'source regression',
          preserved: false,
          cleanup: 'retained',
          processes: [],
          unresolved: [],
          detail: Errors.formatForUser(error),
        }
      }
    },
  }
  return { actors, commands, signals, interactions, collected, operations, borrowedPreserved: () => borrowedPreserved }
}

for (const fail of [false, true]) {
  Test(
    `complete combined ${
      fail ? 'partial failure' : 'ready interaction'
    } orchestration stops Android before borrowed sentinel teardown`,
    async () => {
      const world = faultOrchestrationFixture()
      const result = await proof({ case: fail ? 'combined-target-failure' : 'combined-lifecycle' }, world.operations)
      try {
        Expect(result.exitCode).toBe(0)
        Expect(world.borrowedPreserved()).toBe(true)
        Expect(world.collected).toHaveLength(1)
        Expect([...world.actors.values()].every(actor => actor.receipt.cleanupOutcome === 'proved')).toBe(true)
        Expect(world.interactions).toEqual(fail ? [] : ['web', 'android:combined-initial', 'ios:combined-initial'])
        Expect(result.report.rows.some(row =>
          row.name === (fail
            ? 'combined partial target dispatch before independent rollback'
            : 'combined web iOS Android readiness and sequential interaction')
        )).toBe(true)
      } finally {
        await result.cleanup()
      }
    },
  )
}

Test(
  'combined refusal requires independent mobile dispatch and rolls back even when partial evidence is missing',
  async () => {
    const world = faultOrchestrationFixture(true)
    const result = await proof({ case: 'combined-target-failure' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      Expect(world.commands.some(args => args[1] === 'stop')).toBe(true)
      Expect([...world.actors.values()][0]!.receipt.cleanupOutcome).toBe('proved')
      Expect(
        result.report.rows.some(row => row.name === 'combined partial target dispatch before independent rollback'),
      ).toBe(false)
    } finally {
      await result.cleanup()
    }
  },
)

Test(
  'complete lifecycle fault orchestration reaches retained cleanup then public recovery and owned controller death',
  async () => {
    const world = faultOrchestrationFixture()
    const result = await proof({ case: 'lifecycle-faults' }, world.operations)
    try {
      Expect([...world.actors.values()].map(actor => actor.kind ?? 'ordinary')).toEqual([
        'ordinary',
        'metro-failure',
        'dispatch-failure',
        'pause-compile',
        'pause-metro',
        'pause-dispatch',
        'delayed-cleanup',
        'cleanup-failure',
        'authenticated-controls',
        'pause-restart',
        'ios-owned-stop-boot',
        'ios-owned-stop-install',
        'ios-owned-stop-openurl',
        'ordinary',
      ])
      Expect(result.report.rows.filter(row => row.hostDisposition !== 'real-host pass')).toEqual([])
      Expect(result.exitCode).toBe(0)
      Expect(world.actors.size).toBe(14)
      Expect([...world.actors.values()].every(actor => actor.receipt.cleanupOutcome === 'proved')).toBe(true)
      Expect(
        result.report.rows.some(row => row.name === 'controlled real cleanup-inspection failure and retained receipt'),
      ).toBe(true)
      Expect(result.report.rows.some(row => row.name === 'durable controlled controller death and public recovery'))
        .toBe(true)
      Expect(world.signals).toEqual(['ordinary:SIGKILL'])
      Expect(world.collected).toHaveLength(15)
    } finally {
      for (const actor of world.actors.values()) {
        await FS.remove(actor.eventRoot)
      }
      await result.cleanup()
    }
  },
)

for (const fault of ['closed', 'entry-exit', 'owner-rotation', 'retained-cleanup'] as const) {
  Test(`semantic native public-stop ${fault} remains inconclusive and always attempts cancellation`, async () => {
    const world = faultOrchestrationFixture(false, false, fault)
    const result = await proof({ case: 'lifecycle-faults' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      const native = [...world.actors.values()].find(actor => actor.kind === 'ios-owned-stop-boot')!
      Expect(native.stops).toBeGreaterThan(0)
      Expect(world.collected).toContain(native.receipt.session)
      Expect(
        result.report.rows.filter(row =>
          row.name === 'public stop during exact native iOS execution and independent cleanup'
        )
          .map(row => (row.detail as { stage: string }).stage),
      ).toEqual(['install', 'openurl'])
      const independentlyScoped = [...world.actors.values()].filter(actor =>
        actor.kind === 'ios-owned-stop-install' || actor.kind === 'ios-owned-stop-openurl'
      )
      Expect(independentlyScoped).toHaveLength(2)
      Expect(independentlyScoped.every(actor => actor.stops > 0 && actor.receipt.cleanupOutcome === 'proved')).toBe(
        true,
      )
      Expect(independentlyScoped.every(actor => world.collected.includes(actor.receipt.session))).toBe(true)
      Expect(new Set([native, ...independentlyScoped].map(actor => actor.receipt.devices?.[0]?.id)).size).toBe(3)
      Expect(result.report.rows).toContainEqual(
        Expect['objectContaining']({ name: 'native iOS boot stop outcome', hostDisposition: 'real-host failure' }),
      )
      if (fault === 'retained-cleanup') {
        Expect(native.receipt.cleanupOutcome).toBe('retained')
        Expect(native.receipt.devices?.[0]?.state).toBe('retained')
        Expect(native.receipt.state).toBe('cleanup-failed')
        Expect(native.receipt.message).toContain('unknown bootstrap ownership')
        Expect(native.receipt.devices?.[0]?.resources).toHaveLength(1)
        Expect(native.nativeAsset?.bootstrap).toBeUndefined()
        Expect(native.nativeAsset?.actions[0]?.barrier?.drainProved).toBe(true)
        Expect(native.nativeAsset?.actions[0]?.barrier?.nativeClose?.signal).toBe('SIGTERM')
      } else {
        Expect(native.receipt.cleanupOutcome).toBe('proved')
        Expect(native.receipt.devices?.[0]?.state).toBe('released')
      }
    } finally {
      for (const actor of world.actors.values()) {
        await FS.remove(actor.eventRoot)
      }
      await result.cleanup()
    }
  })
}

for (const fault of ['active-native', 'peer-churn'] as const) {
  Test(`native independent scopes refuse further allocation after ${fault} uncertainty`, async () => {
    const world = faultOrchestrationFixture(false, false, fault)
    const result = await proof({ case: 'lifecycle-faults' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      const native = [...world.actors.values()].filter(actor => actor.kind?.startsWith('ios-owned-stop-'))
      Expect(native.map(actor => actor.kind)).toEqual(['ios-owned-stop-boot'])
      Expect(native[0]!.stops).toBeGreaterThan(0)
      Expect(world.collected).toContain(native[0]!.receipt.session)
      Expect(result.report.rows).toContainEqual(
        Expect['objectContaining']({ name: 'native iOS boot stop outcome', hostDisposition: 'real-host failure' }),
      )
      Expect(
        result.report.rows.filter(row =>
          row.name === 'public stop during exact native iOS execution and independent cleanup'
        ),
      ).toHaveLength(0)
      const detail = result.report.rows.find(row => row.name === 'native iOS boot stop outcome')!.detail
      Expect(JSON.stringify(detail)).toContain(
        fault === 'active-native' ? 'native command drain proof' : 'Unrelated resource',
      )
      if (fault === 'active-native') {
        Expect(native[0]!.nativeAsset?.actions[0]?.barrier?.drainProved).toBe(false)
      }
    } finally {
      for (const actor of world.actors.values()) {
        await FS.remove(actor.eventRoot)
      }
      await result.cleanup()
    }
  })
}

Test(
  'complete mobile fault orchestration preserves retained driver fences while independent sessions and both targets finish',
  async () => {
    const world = faultOrchestrationFixture()
    const result = await proof({ case: 'mobile-interaction-faults' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      Expect(world.actors.size).toBe(10)
      Expect([...world.actors.values()].filter(actor => actor.retained)).toHaveLength(4)
      Expect(
        [...world.actors.values()].filter(actor => !actor.retained).every(actor =>
          actor.receipt.cleanupOutcome === 'proved'
        ),
      ).toBe(true)
      Expect(world.collected).toHaveLength(10)
      Expect(world.signals).toHaveLength(2)
      Expect(result.report.rows.filter(row => row.name.includes('driver deletion refusal blocks later mutation')))
        .toHaveLength(2)
      Expect(result.report.rows.filter(row => row.name.includes('holder death revokes transport'))).toHaveLength(2)
      Expect(result.report.rows.filter(row => row.name.startsWith('cleanup '))).toHaveLength(4)
    } finally {
      await result.cleanup()
    }
  },
)

Test(
  'lifecycle fault orchestration rejects a malformed retained cleanup receipt and still rolls back every previously allocated session',
  async () => {
    const world = faultOrchestrationFixture(false, true)
    const result = await proof({ case: 'lifecycle-faults' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      Expect(world.actors.size).toBe(8)
      Expect([...world.actors.values()].every(actor => actor.receipt.cleanupOutcome === 'proved')).toBe(true)
      Expect(world.collected).toHaveLength(7)
      Expect(
        result.report.rows.some(row => row.name === 'controlled real cleanup-inspection failure and retained receipt'),
      ).toBe(false)
      Expect(
        result.report.rows.some(row =>
          row.name === 'lifecycle-faults' && JSON.stringify(row.detail).includes('retain its failure receipt')
        ),
      ).toBe(true)
    } finally {
      for (const actor of world.actors.values()) {
        await FS.remove(actor.eventRoot)
      }
      await result.cleanup()
    }
  },
)

Test(
  'finite server lifecycle preserves the holder wrapper while restart replaces the kernel-bound Metro service',
  async () => {
    const world = harness()
    const result = await proof({ case: 'lifecycle' }, world.operations)
    try {
      Expect(result.exitCode).toBe(0)
      Expect(result.report.evidenceKind).toBe('source regression')
      Expect(result.report.rows.some(row => row.name === 'reload and restart generations')).toBe(true)
      Expect(world.commands.map(args => args[1])).toEqual([
        'start',
        'status',
        'logs',
        'logs',
        'status',
        'reload',
        'status',
        'status',
        'restart',
        'status',
        'status',
        'reload',
        'reload',
        'stop',
        'stop',
        'stop',
        'status',
        'stop',
      ])
      const ledger = await FS.readJson<{ state: string }[]>(
        FS.resolvePath('external-directories.json', result.report.artifactRoot),
      )
      Expect(ledger.map(entry => entry.state)).toEqual(['removed'])
      Expect(world.current.size).toBe(0)
      Expect([...world.records.values()][0]!.children.some(child => child.startedAt === 'persistent-wrapper')).toBe(
        true,
      )
    } finally {
      await result.cleanup()
    }
  },
)

Test('Chrome held page inspection revocation blocks all subsequent input, capture and cleanup actions', async () => {
  let entered!: () => void
  let release!: () => void
  const inspecting = new Promise<void>(resolve => {
    entered = resolve
  })
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let revoked = false
  const actions: string[] = []
  let checks = 0
  const pending = runCurrentManagedChromeAction(
    {
      evaluate: async <T>() => {
        entered()
        await held
        return { url: 'http://127.0.0.1:5507/', bounded: true } as T
      },
    },
    'http://127.0.0.1:5507/',
    async () => {
      checks++
      if (revoked) {
        Errors.throwHostEnvironment('Generation revoked while page inspection was pending')
      }
    },
    async () => {
      actions.push('input', 'capture', 'cleanup-selector', 'cleanup-click')
    },
  )
  await inspecting
  revoked = true
  release()
  let refused = false
  try {
    await pending
  } catch {
    refused = true
  }
  Expect(refused).toBe(true)
  Expect(checks).toBe(1)
  Expect(actions).toEqual([])
})

Test(
  'Chrome guarded action checks the current identity after page inspection and immediately before acting',
  async () => {
    const events: string[] = []
    await runCurrentManagedChromeAction(
      {
        evaluate: async <T>() => {
          events.push('page')
          return { url: 'http://127.0.0.1:5507/', bounded: true } as T
        },
      },
      'http://127.0.0.1:5507/',
      async () => {
        events.push('current')
      },
      async () => {
        events.push('action')
      },
    )
    Expect(events).toEqual(['page', 'current', 'action'])
  },
)

Test(
  'owned Android lifecycle uses its fixed private starter and the public reload, restart and stop controls',
  async () => {
    const world = harness()
    const kinds: string[] = []
    const phases: string[] = []
    let collected = 0
    const result = await proof({ case: 'android-lifecycle' }, {
      ...world.operations,
      inventory: async () => ({
        ...await world.operations.inventory(),
        targetInspection: { android: 'complete', ios: 'complete' },
        targets: [],
      }),
      startFault: async options => {
        kinds.push(options.scenario)
        // Allocate source records through the fixture; no command or device starts on the host.
        const created = await world.operations.run('source-record-allocation', {
          args: ['dev-loop', 'start', options.fixture.root],
        })
        const receipt = JSON.parse(created.stdout) as DevLoopReceipt
        const current = world.records.get(receipt.session)!
        current.args = [...current.args, '--android']
        current.targets = [{ target: 'android', dispatched: true }]
        current.devices = [{
          platform: 'android',
          id: 'emulator-5580',
          state: 'booted',
          owned: true,
          avdName: `${managedLoopAndroidPrefix(FS.basename(options.artifactRoot))}1`,
          consolePort: 5580,
        }]
        return {
          session: current.session,
          eventRoot: options.artifactRoot,
          launcher: current.controller,
          initialGeneration: current.generation,
          rollback: async () => ({ proved: false }),
          collect: async () => {
            collected++
          },
          probeAuthentication: async () => ({ missing: 401, wrong: 401, stale: 'Stale generation' }),
        }
      },
      mobileInteraction: async context => {
        await context.assertCurrent()
        phases.push(context.phase)
        return {}
      },
      borrowTarget: async (target, artifactRoot) => ({
        target,
        artifacts: artifactRoot,
        disposition: 'real-host pass',
        preserved: true,
        cleanup: 'complete',
        processes: [],
        unresolved: [],
      }),
    })
    try {
      Expect(result.exitCode).toBe(0)
      Expect(kinds).toEqual(['android-owned-normal'])
      Expect(phases).toEqual(['initial', 'reload', 'restart'])
      Expect(world.commands.filter(args => ['reload', 'restart', 'stop'].includes(args[1]!)).map(args => args[1]))
        .toEqual([
          'reload',
          'restart',
          'reload',
          'reload',
          'stop',
          'stop',
          'stop',
          'stop',
        ])
      Expect(collected).toBe(1)
      Expect([...world.records.values()][0]!.devices![0]!.state).toBe('released')
    } finally {
      await result.cleanup()
    }
  },
)

Test('owned Android abrupt exit routes through private allocation before any controller death injection', async () => {
  const world = harness()
  const kinds: string[] = []
  let signals = 0
  const result = await proof({ case: 'android-abrupt-exit' }, {
    ...world.operations,
    startFault: async options => {
      kinds.push(options.scenario)
      return Errors.throwHostEnvironment('Source-only private launch boundary')
    },
    signalOwned: () => {
      signals++
    },
  })
  try {
    Expect(result.exitCode).toBe(1)
    Expect(kinds).toEqual(['android-owned-normal'])
    Expect(world.commands).toEqual([])
    Expect(signals).toBe(0)
  } finally {
    await result.cleanup()
  }
})

Test('owned Android parallel routes to the closed private kind before public default-pool allocation', async () => {
  const world = harness()
  const kinds: string[] = []
  const result = await proof({ case: 'android-parallel' }, {
    ...world.operations,
    startFault: async options => {
      kinds.push(options.scenario)
      Errors.throwHostEnvironment('Source-only private launch boundary')
    },
  })
  try {
    Expect(result.exitCode).toBe(1)
    Expect(kinds).toEqual(['android-owned-parallel'])
    Expect(world.commands).toEqual([])
  } finally {
    await result.cleanup()
  }
})

for (
  const [selected, target, flag] of [
    ['chrome-visible', 'web', '--show-browser'],
    ['ios-visible', 'ios', '--show-simulator'],
    ['android-visible', 'android', '--show-emulator'],
  ] as const
) {
  Test(
    `fixed ${selected} preserves only its target show flag and records its visibility warning before private launch`,
    async () => {
      const world = harness()
      const privateKinds: string[] = []
      const result = await proof({ case: selected }, {
        ...world.operations,
        inventory: async () => ({
          ...await world.operations.inventory(),
          targetInspection: { android: 'complete', ios: 'complete' },
          targets: [],
        }),
        chromeInteraction: async () => {
          Errors.throwUnexpected('Visible lifecycle must not start an interaction journey')
        },
        mobileInteraction: async () => {
          Errors.throwUnexpected('Visible lifecycle must not start an interaction journey')
        },
        startFault: async options => {
          privateKinds.push(options.scenario)
          const notice = await FS.readJson<{ flag: string; warning: string }>(
            FS.resolvePath('visibility.json', options.artifactRoot),
          )
          Expect(notice.flag).toBe(flag)
          Expect(notice.warning).toContain('may take window focus')
          const allocated = await world.operations.run('source-record-allocation', {
            args: ['dev-loop', 'start', options.fixture.root],
          })
          const current = world.records.get((JSON.parse(allocated.stdout) as DevLoopReceipt).session)!
          current.args = managedLoopFaultArgs(options.fixture, options.scenario)
          current.targets = [{ target, dispatched: true }]
          return {
            session: current.session,
            launcher: current.controller,
            initialGeneration: current.generation,
            eventRoot: options.artifactRoot,
            rollback: async () => ({ proved: false }),
            collect: async () => {},
            probeAuthentication: async () => ({ missing: 401, wrong: 401, stale: 'Stale generation' }),
          }
        },
      })
      try {
        Expect(result.exitCode).toBe(0)
        const receipt = [...world.records.values()][0]!
        Expect(receipt.args.filter(arg => arg.startsWith('--show-'))).toEqual([flag])
        Expect(receipt.args).toContain(`--${target}`)
        Expect(privateKinds).toEqual(
          target === 'android' ? ['android-owned-visible'] : target === 'ios' ? ['ios-owned-visible'] : [],
        )
        Expect(result.report.visibilityWarning).toContain('may take window focus')
        Expect(result.stderr).toContain(result.report.visibilityWarning!)
        if (target === 'web') {
          Expect(world.commands[0]).toEqual([
            'dev-loop',
            'start',
            receipt.selection!.projectRoot,
            '--app',
            'DataMVPApp',
            `--${target}`,
            flag,
            '--json',
          ])
        }
      } finally {
        await result.cleanup()
      }
    },
  )
}

for (const failure of ['receipt-read', 'receipt-validation'] as const) {
  for (const rollbackProved of [false, true]) {
    Test(`returned helper ${failure} is rollback-owned before validation; proved=${rollbackProved}`, async () => {
      const world = harness()
      const sessions: string[] = []
      const rollbacks: string[] = []
      const collected: string[] = []
      const result = await proof({ case: 'android-parallel' }, {
        ...world.operations,
        inventory: async () => ({
          ...await world.operations.inventory(),
          targetInspection: { android: 'complete', ios: 'complete' },
          targets: [],
        }),
        receipt: async session => {
          if (session === sessions[1]) {
            if (failure === 'receipt-read') {
              Errors.throwHostEnvironment('Injected owned receipt read failure')
            }
            return {
              ...await world.operations.receipt(session),
              selection: { appName: 'DataMVPApp', projectRoot: '/foreign-source', appPath: '/foreign-source/App.tao' },
            }
          }
          return await world.operations.receipt(session)
        },
        startFault: async options => {
          const allocated = await world.operations.run('source-record-allocation', {
            args: ['dev-loop', 'start', options.fixture.root],
          })
          const current = world.records.get((JSON.parse(allocated.stdout) as DevLoopReceipt).session)!
          sessions.push(current.session)
          current.args = [...current.args, '--android']
          current.targets = [{ target: 'android', dispatched: true }]
          return {
            session: current.session,
            launcher: current.controller,
            initialGeneration: current.generation,
            eventRoot: options.artifactRoot,
            rollback: async () => {
              rollbacks.push(current.session)
              return { proved: rollbackProved }
            },
            collect: async () => {
              collected.push(current.session)
            },
            probeAuthentication: async () => ({ missing: 401, wrong: 401, stale: 'Stale generation' }),
          }
        },
      })
      try {
        Expect(result.exitCode).toBe(1)
        Expect(sessions.length).toBe(2)
        Expect(rollbacks).toEqual([sessions[1]!])
        Expect(collected).toEqual([sessions[0]!, sessions[1]!])
        Expect(world.commands.filter(args => args[1] === 'stop').map(args => args[args.indexOf('--session') + 1]))
          .toEqual([sessions[0]!])
        const ledger = await FS.readJson<{ path: string; state: string }[]>(
          FS.resolvePath('external-directories.json', result.report.artifactRoot),
        )
        Expect(ledger.map(entry => entry.state)).toEqual(['removed', rollbackProved ? 'removed' : 'retained'])
        if (!rollbackProved) {
          Expect(await FS.exists(ledger[1]!.path)).toBe(true)
        }
      } finally {
        await result.cleanup()
      }
    })
  }
}

Test('foreground acquisition refuses dead handles and recycled roots before or during a descendant walk', () => {
  const root = { pid: 712, startedAt: 'owned-root', command: 'owned' }
  const replacement = { ...root, startedAt: 'unrelated-replacement' }
  const foreign = { pid: 713, startedAt: 'foreign-child', command: 'foreign' }
  const handle = { pid: root.pid, exitCode: null as number | null, signalCode: null }
  let walks = 0
  const walk = () => {
    walks++
    return [foreign]
  }
  const before = captureManagedForegroundProcesses(handle, root, () => new Map([[root.pid, replacement]]), walk)
  Expect(before.uncertain).toBe(true)
  Expect(before.processes).toEqual([])
  Expect(walks).toBe(0)
  handle.exitCode = 0
  const dead = captureManagedForegroundProcesses(handle, undefined, () => new Map([[root.pid, replacement]]), walk)
  Expect(dead.uncertain).toBe(true)
  Expect(dead.processes).toEqual([])
  Expect(walks).toBe(0)
  handle.exitCode = null
  let reads = 0
  const during = captureManagedForegroundProcesses(
    handle,
    root,
    () => new Map([[root.pid, ++reads === 1 ? root : replacement]]),
    walk,
  )
  Expect(during.uncertain).toBe(true)
  Expect(during.processes.some(process => process.pid === foreign.pid)).toBe(false)
  Expect(walks).toBe(1)
})

Test('foreground acquisition accepts descendants only with a stable live root across the walk', () => {
  const root = { pid: 712, startedAt: 'owned-root', command: 'owned' }
  const child = { pid: 713, startedAt: 'owned-child', command: 'owned' }
  const capture = captureManagedForegroundProcesses(
    { pid: root.pid, exitCode: null, signalCode: null },
    undefined,
    () => new Map([[root.pid, root]]),
    () => [child],
  )
  Expect(capture.uncertain).toBe(false)
  Expect(capture.processes).toEqual([root, child])
})

Test(
  'Chrome page guard rejects a prefix-confusable port, another path, and missing bounded controls before input',
  async () => {
    const expected = 'http://127.0.0.1:5507/'
    Expect(managedChromePageMatches(expected, 'http://127.0.0.1:55077/')).toBe(false)
    Expect(managedChromePageMatches(expected, 'http://127.0.0.1:5507/unrelated')).toBe(false)
    Expect(managedChromePageMatches(expected, 'http://127.0.0.1:5507/?cache=1')).toBe(true)
    for (const page of [{ url: 'http://127.0.0.1:55077/', bounded: true }, { url: expected, bounded: false }]) {
      let refused = false
      try {
        await assertManagedChromePage({ evaluate: async <T>() => page as T }, expected)
      } catch {
        refused = true
      }
      Expect(refused).toBe(true)
    }
    await assertManagedChromePage({ evaluate: async <T>() => ({ url: expected, bounded: true }) as T }, expected)
  },
)

Test(
  'a fixture identity inspection error retains that projection and still cleans the next independent projection',
  async () => {
    const artifactRoot = Repo.resolvePath(`.artifacts/tests/managed-loop-fixture-${Platform.randomUUID()}`)
    await FS.mkdir(artifactRoot)
    const fixtures = new ManagedLoopAcceptanceFixtures(artifactRoot)
    const first = await fixtures.create()
    const second = await fixtures.create()
    const failures: string[] = []
    try {
      await cleanupManagedLoopAcceptanceFixtures(fixtures, fixture => {
        if (fixture === first) {
          Errors.throwHostEnvironment('Kernel inventory unavailable')
        }
        return true
      }, (fixture, error) => {
        failures.push(`${fixture.root}:${String(error)}`)
      })
      Expect(failures.length).toBe(1)
      Expect(failures[0]!.includes('Kernel inventory unavailable')).toBe(true)
      Expect(await FS.isFile(first.appPath)).toBe(true)
      Expect(await FS.exists(second.root)).toBe(false)
      const records = await FS.readJson<{ state: string }[]>(FS.resolvePath('external-directories.json', artifactRoot))
      Expect(records.map(record => record.state)).toEqual(['retained', 'removed'])
    } finally {
      await FS.remove(first.root)
      await FS.remove(second.root)
      await FS.remove(artifactRoot)
    }
  },
)

for (const fault of ['reload-generation', 'restart-generation', 'keep-old-service'] as const) {
  Test(`finite lifecycle refuses ${fault} and still rolls back its owned loop`, async () => {
    const world = harness(fault)
    const result = await proof({ case: 'lifecycle' }, world.operations)
    try {
      Expect(result.exitCode).toBe(1)
      Expect(result.report.rows.some(row => row.hostDisposition === 'real-host failure')).toBe(true)
      Expect(world.commands.at(-1)![1]).toBe('stop')
      Expect(world.current.size).toBe(0)
      Expect([...world.records.values()][0]!.state).toBe('stopped')
    } finally {
      await result.cleanup()
    }
  })
}

Test('failed cleanup retains the source projection and reports a nonzero disposition', async () => {
  const world = harness('retained-stop')
  const result = await proof({ case: 'lifecycle' }, world.operations)
  try {
    Expect(result.exitCode).toBe(1)
    const ledger = await FS.readJson<{ path: string; state: string }[]>(
      FS.resolvePath('external-directories.json', result.report.artifactRoot),
    )
    Expect(ledger[0]!.state).toBe('retained')
    Expect(await FS.isFile(FS.resolvePath('Data MVP.tao', ledger[0]!.path))).toBe(true)
    Expect(result.report.rows.some(row => row.name === 'source projection retained')).toBe(true)
  } finally {
    await result.cleanup()
  }
})

Test('existing Chrome session receives bounded input only, without public lifecycle mutations', async () => {
  const world = harness()
  const controller = { pid: 90_000, startedAt: 'controller-start', command: 'controller' }
  world.current.set(controller.pid, controller)
  const session = Platform.randomUUID()
  const projectRoot = Repo.resolvePath('Apps/Test Apps/Data MVP')
  world.records.set(session, {
    version: 1,
    session,
    checkout: await FS.realPath(Repo.getRoot()),
    args: [projectRoot, '--app', 'DataMVPApp', '--web'],
    selection: { projectRoot, appPath: FS.resolvePath('Data MVP.tao', projectRoot), appName: 'DataMVPApp' },
    generation: Platform.randomUUID(),
    state: 'ready',
    controller,
    children: [],
    createdAt: 'stamp',
    updatedAt: 'stamp',
  })
  let observations = 0
  const result = await proof({ case: 'chrome', session }, {
    ...world.operations,
    chromeInteraction: async context => {
      await context.assertCurrent()
      observations++
      return {
        screenshotPaths: ['before.png', 'after.png'],
        rowName: 'unique',
        consoleErrors: [],
        browserPreserved: true,
      }
    },
  })
  try {
    Expect(result.exitCode).toBe(0)
    Expect(observations).toBe(1)
    Expect(world.commands).toEqual([])
    Expect(world.current.get(controller.pid)).toEqual(controller)
  } finally {
    await result.cleanup()
  }
})

Test('invalid finite case and caller-owned destructive cases refuse before any allocation', async () => {
  let calls = 0
  for (
    const options of [
      { case: 'constructor' },
      { case: 'lifecycle-faults', session: Platform.randomUUID() },
      { case: 'chrome', target: 'android' },
      { case: 'mobile-interaction', session: Platform.randomUUID() },
      { case: 'lifecycle', executable: '/bin/sh' },
    ]
  ) {
    const captured = await withCapturedOutput(() =>
      runManagedLoopAcceptance(options, {
        run: async () => {
          calls++
          return { command: 'unused', args: [], exitCode: 0, signal: null, stdout: '', stderr: '' }
        },
        inventory: async () => {
          calls++
          return emptyInventory
        },
      })
    )
    Expect(captured.result).toBe(1)
    Expect(captured.stdout).toBe('')
    Expect(captured.stderr.length > 0).toBe(true)
  }
  Expect(calls).toBe(0)
})

Test('target-fault failure returns nonzero without allocating a public lifecycle session', async () => {
  const world = harness()
  let calls = 0
  const result = await proof({ case: 'android-quarantine' }, {
    ...world.operations,
    targetFault: async (caseName, artifactRoot) => {
      calls++
      return {
        case: caseName,
        disposition: 'real-host failure',
        events: [],
        artifacts: artifactRoot,
        unresolved: [],
        detail: 'source-injected missing capability',
      }
    },
  })
  try {
    Expect(result.exitCode).toBe(1)
    Expect(world.commands).toEqual([])
    Expect(calls).toBe(1)
    Expect(result.report.rows.some(row => row.hostDisposition === 'real-host failure')).toBe(true)
  } finally {
    await result.cleanup()
  }
})

for (
  const retainedCase of [
    'valid',
    'valid-boundary',
    'wrong-case',
    'source-disposition',
    'missing',
    'extra',
    'duplicate',
    'foreign-invocation',
    'slot-five',
    'outside-console',
    'odd-console',
    'mismatched-generation',
    'empty-generation',
    'baseline-avd',
    'baseline-serial',
    'other-case-retained',
    'recovery-retained',
    'ios-recovery-retained',
    'other-case-empty',
  ] as const
) {
  Test(
    `target-fault orchestrator ${retainedCase} classifies intentional private quarantine without cleanup authority`,
    async () => {
      const world = harness()
      const inventory = structuredClone(emptyInventory)
      let unresolved: { name: string; generation: string }[] = []
      let calls = 0
      const requestedCase = retainedCase.startsWith('other-case')
        ? 'android-escalation'
        : retainedCase === 'recovery-retained'
        ? 'android-recovery'
        : retainedCase === 'ios-recovery-retained'
        ? 'ios-recovery'
        : 'android-quarantine'
      const result = await proof({ case: requestedCase }, {
        ...world.operations,
        inventory: async () => inventory,
        signalOwned: () => Errors.throwUnexpected('Catalog classification must not signal a retained intent.'),
        targetFault: async (caseName, artifactRoot) => {
          calls++
          const prefix = managedLoopAndroidPrefix(FS.basename(artifactRoot))
          unresolved = [
            {
              name: `android-avd:${prefix}${retainedCase === 'valid-boundary' ? 4 : 1}`,
              generation: 'owned-retained-generation',
            },
            {
              name: `android-emulator:emulator-${retainedCase === 'valid-boundary' ? 5680 : 5582}`,
              generation: 'owned-retained-generation',
            },
          ]
          if (retainedCase === 'missing' || retainedCase === 'other-case-empty') {
            unresolved = []
          }
          if (retainedCase === 'extra') {
            unresolved.push({ name: 'android-emulator:emulator-5584', generation: 'owned-retained-generation' })
          }
          if (retainedCase === 'duplicate') {
            unresolved[1] = { ...unresolved[0]! }
          }
          if (retainedCase === 'foreign-invocation') {
            unresolved[0]!.name = `android-avd:${managedLoopAndroidPrefix(Platform.randomUUID())}1`
          }
          if (retainedCase === 'slot-five') {
            unresolved[0]!.name = `android-avd:${prefix}5`
          }
          if (retainedCase === 'outside-console') {
            unresolved[1]!.name = 'android-emulator:emulator-5682'
          }
          if (retainedCase === 'odd-console') {
            unresolved[1]!.name = 'android-emulator:emulator-5581'
          }
          if (retainedCase === 'mismatched-generation') {
            unresolved[1]!.generation = 'foreign-generation'
          }
          if (retainedCase === 'empty-generation') {
            unresolved.forEach(owner => {
              owner.generation = ' '
            })
          }
          if (retainedCase === 'baseline-avd' || retainedCase === 'baseline-serial') {
            // The shared source inventory supplies the invocation-bound baseline name to the adapter.
            inventory.resources.push({
              name: unresolved[retainedCase === 'baseline-avd' ? 0 : 1]!.name,
              generation: 'preserved-baseline',
              pid: 44,
              retained: true,
            })
          }
          return {
            case: retainedCase === 'wrong-case' ? 'android-recovery' : caseName,
            disposition: retainedCase === 'source-disposition' ? 'source regression' : 'real-host pass',
            events: [{ action: 'unknown quarantine recovery refused without signals; intent retained' }],
            artifacts: artifactRoot,
            unresolved,
          }
        },
      })
      try {
        const accepted = ['valid', 'valid-boundary', 'other-case-empty'].includes(retainedCase)
        Expect(result.exitCode).toBe(accepted ? 0 : 1)
        Expect(calls).toBe(1)
        Expect(world.commands).toEqual([])
        Expect(result.report.evidenceKind).toBe('source regression')
        const row = result.report.rows.find(row => row.name === requestedCase)!
        Expect(row.hostDisposition).toBe(accepted ? 'real-host pass' : 'real-host failure')
        Expect((row.detail as { unresolved: typeof unresolved }).unresolved).toEqual(unresolved)
        if (retainedCase === 'valid' || retainedCase === 'valid-boundary') {
          Expect((row.detail as { unresolved: typeof unresolved }).unresolved).toHaveLength(2)
          Expect((row.detail as { outcome: string }).outcome).toBe(
            'recovery refusal with intentional launch-intent retention',
          )
        }
      } finally {
        await result.cleanup()
      }
    },
  )
}

Test('evidence sanitizes credentials and detects exact peer generation changes without storing command lines', () => {
  Expect(ManagedLoopAcceptanceEvidence.sanitize({
    token: 'private-token',
    nested: { authorization: 'Bearer secret', status: 'ready' },
    output: 'Authorization: Bearer private-token\n{"token":"private-token"}',
  })).toEqual({
    nested: { status: 'ready' },
    output: 'Authorization: [redacted] [redacted]\n{"token":"[redacted]"}',
  })
  const before: ManagedLoopInventory = {
    processCount: 2,
    peers: [{ pid: 12, startedAt: 'a', command: 'scoped host peer', kind: 'chrome' }],
    resources: [{ name: 'ios-simulator:fixture', generation: 'g1', pid: 12, retained: false }],
  }
  Expect(ManagedLoopAcceptanceEvidence.preserved(before, structuredClone(before))).toEqual([])
  Expect(ManagedLoopAcceptanceEvidence.preserved(before, {
    processCount: 2,
    peers: [{ ...before.peers[0]!, startedAt: 'b' }],
    resources: [{ ...before.resources[0]!, generation: 'g2' }],
  })).toEqual(['Peer chrome 12/a changed or exited.', 'Peer resource ios-simulator:fixture/g1 changed.'])
})

Test('peer inventory distinguishes real host executables and Metro server argv from source test filenames', () => {
  const classify = ManagedLoopAcceptanceEvidence.processKind
  Expect(classify('bun', 'bun test studio-native.test.ts AgentChrome.test.ts metro.test.ts')).toBeUndefined()
  Expect(classify('node', 'node /repo/packages/cli/dev-cli/dev-cli-tests/AgentAndroidEmulator.test.ts')).toBeUndefined()
  Expect(classify('bun', 'bun run /repo/packages/ides/studio-tooling/StudioCdp.test.ts')).toBeUndefined()
  Expect(classify('Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe('chrome')
  Expect(classify('Tao Studio', '/repo/.artifacts/studio/build/Tao Studio')).toBe('studio')
  Expect(classify('node', 'node /repo/node_modules/expo/bin/cli start --port 8081 /repo/studio/fixture')).toBe('metro')
  Expect(classify('qemu-system-aarch64', '/repo/emulator/qemu-system-aarch64 -avd fixture')).toBe('emulator')
})

Test('renderer/helper recycling remains observational while stable primary peer changes fail preservation', () => {
  const before: ManagedLoopInventory = {
    processCount: 2,
    resources: [],
    peers: [
      { pid: 11, startedAt: 'primary', command: 'scoped host peer', kind: 'chrome', role: 'primary' },
      {
        pid: 12,
        startedAt: 'renderer',
        command: 'scoped host peer',
        kind: 'chrome',
        role: 'helper',
        ppid: 11,
        parentStartedAt: 'primary',
      },
    ],
  }
  const after = { ...before, peers: [before.peers[0]!] }
  Expect(ManagedLoopAcceptanceEvidence.preserved(before, after)).toEqual([])
  Expect(ManagedLoopAcceptanceEvidence.helperChanges(before, after)).toEqual([
    { pid: 12, startedAt: 'renderer', command: 'observed helper departure; causality unproved' },
  ])
  Expect(ManagedLoopAcceptanceEvidence.preserved(before, { ...after, peers: [] })).toEqual([
    'Peer chrome 11/primary changed or exited.',
  ])
})

Test('fault signals refuse both absent invocation ownership and a stale kernel start identity', () => {
  const identity = { pid: Platform.runtimeProcess.pid, startedAt: 'deliberately-stale', command: 'controlled peer' }
  Expect(() => ManagedLoopAcceptanceEvidence.signalOwned(identity, [], 'SIGTERM')).toThrow('invocation-owned')
  Expect(() => ManagedLoopAcceptanceEvidence.signalOwned(identity, [identity], 'SIGTERM')).toThrow('identity changed')
  Expect(Platform.processIsAlive(identity.pid)).toBe(true)
})
