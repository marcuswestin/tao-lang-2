import { EXPO_SDK_VERSION } from '@expo-host/dev-loop/expo-runner/expo-config'
import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred, Expect, mkTestDir, Test, until } from '@shared/test'
import {
  managedIosBarrierControlPrefix,
  managedIosCommandArguments,
  type ManagedIosCommandPlan,
} from '../dev-cli-src/dev-loop/ManagedIosCommandBarrier'
import {
  cleanupManagedIosFixtureAssets,
  createManagedIosFixture,
  loadManagedIosSdkDownloaderForSourceRegression,
  type ManagedIosRuntimeOperations,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime'
import {
  type AgentAppDevDevice,
  appDevReservation,
  type ManagedCleanupChild,
} from '../dev-cli-src/simulators/AgentAppDev'

Test('private iOS SDK loader uses the installed Expo publisher despite a competing checkout CLI', async () => {
  const root = await mkTestDir('managed-ios-sdk-loader-')
  try {
    const toolchain = FS.resolvePath('toolchain # installed', root)
    const expo = FS.resolvePath('node_modules/expo', toolchain)
    const publisher = FS.resolvePath('node_modules/@expo/cli', expo)
    const decoy = FS.resolvePath('node_modules/@expo/cli', toolchain)
    await FS.mkdir(expo)
    await FS.writeJson(FS.resolvePath('package.json', expo), { name: 'expo', exports: {} })
    for (const [directory, host] of [[publisher, 'expo.dev'], [decoy, 'foreign.example']]) {
      const source = FS.resolvePath('build/src/utils/downloadExpoGoAsync.js', directory!)
      await FS.mkdir(FS.dirname(source))
      await FS.writeJson(FS.resolvePath('package.json', directory!), { name: '@expo/cli', type: 'module', exports: {} })
      await FS.writeText(
        source,
        `
        export async function getExpoGoVersionEntryAsync(sdk) {
          return { iosClientUrl: 'https://${host}/' + sdk, iosClientVersion: '${host}' };
        }
        export async function downloadExpoGoAsync() { return ''; }
      `,
      )
    }
    const helper = await loadManagedIosSdkDownloaderForSourceRegression({
      resolvePackageDirectory: (name, from) =>
        FS.resolvePackageDirectory(
          name,
          from === Repo.resolvePath('packages/apps/expo-host') ? toolchain : from,
        ),
      importDownloader: async url => await import(url),
    })
    const metadata = await helper.getExpoGoVersionEntryAsync(EXPO_SDK_VERSION)
    Expect(metadata).toEqual({ iosClientUrl: `https://expo.dev/${EXPO_SDK_VERSION}`, iosClientVersion: 'expo.dev' })
    let imported = false
    await Expect(loadManagedIosSdkDownloaderForSourceRegression({
      resolvePackageDirectory: async () => undefined,
      importDownloader: async url => {
        imported = true
        return await import(url)
      },
    })).rejects.toThrow('installed Expo toolchain')
    await Expect(loadManagedIosSdkDownloaderForSourceRegression({
      resolvePackageDirectory: async name => name === 'expo' ? expo : undefined,
      importDownloader: async url => {
        imported = true
        return await import(url)
      },
    })).rejects.toThrow('CLI installed under its Expo toolchain')
    Expect(imported).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

async function fixture(
  hold?: 'boot' | 'download' | 'install' | 'shutdown',
  nativeObserver?: ManagedIosRuntimeOperations['onNativeExecution'],
  cleanupPublisher?: ManagedCleanupChild,
) {
  const invocation = Platform.randomUUID()
  const artifactRoot = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}/source-runtime`)
  await FS.mkdir(artifactRoot)
  const registryRoot = FS.resolvePath('registry', artifactRoot)
  const scope = Platform.randomUUID()
  const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
  const bootstrap: TrackedProcess = { pid: 2 ** 29 + 1, startedAt: 'bootstrap-start', command: 'launchd_sim' }
  const identities = new Map<number, TrackedProcess>([[holder.pid, holder]])
  const groups = new Set<number>()
  const workerGroups = new Map<number, number>()
  const children = new Map<number, ReturnType<typeof Deferred<CLI.CommandCloseResult>>>()
  const starts: string[] = []
  const executes: string[] = []
  const registered: string[] = []
  const disposed: number[] = []
  const closedOutput: number[] = []
  const signals: number[] = []
  const recoveries: string[] = []
  const device = { udid: Platform.randomUUID(), name: '', deviceTypeIdentifier: 'iPhone-type', state: 'Shutdown' }
  const foreign = {
    udid: Platform.randomUUID(),
    name: 'Developer shutdown iPhone',
    deviceTypeIdentifier: 'iPhone-type',
    state: 'Shutdown',
  }
  let created = false
  let stopped = false
  let serial = 0
  let faultAfterStart = false
  let artifactVersion = '57-source-client'
  let artifactExecutable = 'Exponent'
  let beforeInstall: (() => Promise<void>) | undefined
  let beforeAdmission: (() => Promise<void>) | undefined
  let changeBootstrap = false
  let mutateArtifact: 'metadata' | 'binary' | 'symlink' | undefined
  let denyChildPublication = false
  let denyOutput = false
  let holdOutput = false
  let denyRegistration = false
  let stopDuringRegistration = false
  const heldRegistration = Deferred<void>()
  let downloadFault:
    | 'supervisor-unreadable'
    | 'worker-replaced'
    | 'unknown-member'
    | 'child-closed'
    | 'child-error'
    | 'cancel'
    | 'missing-close'
    | 'missing-output'
    | undefined
  const commandHandles = new Map<
    number,
    { error?: Error; exitCode: number | null; signalCode: Platform.ProcessSignal | null }
  >()
  const signalCallbacks = new Map<Platform.ProcessSignal, () => void>()
  const unreadablePids = new Set<number>()
  const descendant: TrackedProcess = {
    pid: bootstrap.pid + 500,
    startedAt: 'source-descendant',
    command: 'source descendant',
  }
  let inspectionFailure: 'identities' | 'descendants' | 'liveness' | undefined
  let inspectionFailurePid: number | undefined
  let shutdownBootstrap:
    | 'unreadable-live'
    | 'inspection-throws'
    | 'readable-replacement'
    | 'unexpected-probe'
    | undefined
  let bootstrapInspectionThrows = false
  let bootstrapUnexpectedProbe = false
  const unexpectedProbeFailure = Object.assign(Errors.asError('Injected operating-system liveness failure'), {
    code: 'EIO',
  })
  const livenessProbes: number[] = []
  const result = (stdout = ''): CLI.CommandResult => ({
    command: 'source',
    args: [],
    stdout,
    stderr: '',
    exitCode: 0,
    signal: null,
  })
  const finish = (pid: number, signal: Platform.ProcessSignal | null = null) => {
    if (inspectionFailure && identities.get(pid)?.command === 'source download worker') {
      inspectionFailurePid = pid
    }
    identities.delete(pid)
    groups.delete(pid)
    children.get(pid)!.resolve({ exitCode: signal === null ? 0 : null, signal })
  }
  const scoped = <T extends object>(options: T) => ({ ...options, registryRoot })
  const operations: ManagedIosRuntimeOperations = {
    onNativeExecution: nativeObserver,
    budgetMs: 2_000,
    processIsAlive: pid => {
      if (bootstrapUnexpectedProbe && pid === bootstrap.pid) {
        return Platform.processIsAlive(pid, value => {
          livenessProbes.push(value)
          throw unexpectedProbeFailure
        })
      }
      if (inspectionFailure === 'liveness' && pid === inspectionFailurePid) {
        inspectionFailurePid = undefined
        Errors.throwHostEnvironment('Injected liveness inspection failure after child closure')
      }
      return identities.has(pid)
    },
    onSignal: (signal, callback) => {
      signalCallbacks.set(signal, callback)
      return () => signalCallbacks.delete(signal)
    },
    save: async (path, value) => {
      if (
        denyChildPublication
        && (value as { actions?: { stage: string; state: string }[] }).actions?.some(action =>
          action.stage === 'download' && action.state === 'captured'
        )
      ) {
        Errors.throwHostEnvironment('Injected child publication denial')
      }
      await FS.writeText(path, JSON.stringify(value))
    },
    resources: {
      acquire: options => MachineResources.acquire(scoped(options)),
      retain: options => MachineResources.retain(scoped(options)),
      recoverRetained: options => {
        recoveries.push(options.name)
        return MachineResources.recoverRetained(scoped(options))
      },
      readOwner: options => MachineResources.readOwner(scoped(options)),
      withCurrentOwners: async (options, action) => {
        const admission = beforeAdmission
        beforeAdmission = undefined
        await admission?.()
        if (starts.at(-1) === 'install' && !executes.includes('install')) {
          await beforeInstall?.()
          beforeInstall = undefined
          if (changeBootstrap) {
            identities.set(bootstrap.pid, { ...bootstrap, startedAt: 'rotated-bootstrap' })
          }
        }
        const value = await MachineResources.withCurrentOwners(scoped(options), action)
        if (faultAfterStart) {
          Errors.throwHostEnvironment('Injected mutex finalizer failure')
        }
        return value
      },
    },
    tree: {
      ...ProcessTree,
      identities: pids => {
        if (bootstrapInspectionThrows && pids.includes(bootstrap.pid)) {
          bootstrapInspectionThrows = false
          Errors.throwHostEnvironment('Injected bootstrap identity inspection failure')
        }
        if (
          inspectionFailure === 'identities' && inspectionFailurePid !== undefined
          && pids.includes(inspectionFailurePid)
        ) {
          inspectionFailurePid = undefined
          Errors.throwHostEnvironment('Injected identity inspection failure after child closure')
        }
        return new Map(
          pids.flatMap(pid =>
            identities.has(pid) && !unreadablePids.has(pid) ? [[pid, identities.get(pid)!] as const] : []
          ),
        )
      },
      descendants: pid => [...identities.values()].filter(process => workerGroups.get(process.pid) === pid),
      isGroupAlive: pid => groups.has(pid),
      processGroupOf: pid => workerGroups.get(pid) ?? (groups.has(pid) ? pid : undefined),
      groupMembers: group => {
        if (
          inspectionFailure === 'descendants' && inspectionFailurePid !== undefined
          && workerGroups.get(inspectionFailurePid) === group
        ) {
          inspectionFailurePid = undefined
          Errors.throwHostEnvironment('Injected descendant inspection failure after child closure')
        }
        return [...identities.values()].filter(process =>
          process.pid === group || workerGroups.get(process.pid) === group
        )
      },
      signalTracked: (tracked, signal) => {
        for (const expected of tracked) {
          if (!unreadablePids.has(expected.pid) && ProcessTree.sameProcess(identities.get(expected.pid), expected)) {
            signals.push(expected.pid)
            finish(expected.pid, signal)
          }
        }
      },
    },
    run: async (command, spec) => {
      const args = [...spec?.args ?? []]
      if (command === 'xcrun' && args[1] === 'list') {
        return result(
          JSON.stringify({
            devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [foreign, ...(created ? [device] : [])] },
          }),
        )
      }
      if (command === 'xcrun' && args[1] === 'spawn') {
        return result(String(bootstrap.pid))
      }
      if (command === 'xcrun' && args[1] === 'get_app_container') {
        return result('/source-installed-app')
      }
      if (command === 'plutil') {
        return result(args[1] === 'CFBundleIdentifier' ? 'host.exp.Exponent' : artifactVersion)
      }
      Errors.throwUnexpected('Unexpected source iOS read-only operation')
    },
    start: (command, spec) => {
      const barrierPlan = spec?.args?.[0]?.endsWith('/ManagedIosCommandBarrierSupervisor.ts')
        ? JSON.parse(FS.readTextSync(spec.args[1]!)) as ManagedIosCommandPlan
        : undefined
      const args = barrierPlan ? managedIosCommandArguments(barrierPlan) : [...spec?.args ?? []]
      const stage = barrierPlan ? barrierPlan.intent.stage : command === 'xcrun' ? args[1]! : 'download'
      starts.push(stage)
      const pid = 2 ** 29 + 100 + serial++
      identities.set(pid, { command: `source ${stage}`, pid, startedAt: `child-${pid}` })
      groups.add(pid)
      const closed = Deferred<CLI.CommandCloseResult>()
      children.set(pid, closed)
      const workerPid = barrierPlan ? 2 ** 29 + 100 + serial++ : pid
      if (barrierPlan) {
        identities.set(workerPid, {
          command: `source ${stage} worker`,
          pid: workerPid,
          startedAt: `worker-${workerPid}`,
        })
        workerGroups.set(workerPid, pid)
        children.set(workerPid, Deferred<CLI.CommandCloseResult>())
      }
      const nativeOutput = { stdout: '', stderr: '' }
      const output = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        if (barrierPlan) {
          nativeOutput[stream] += chunk.toString('utf8')
        } else {
          spec?.onOutput?.(stream, chunk)
        }
      }
      const emit = (event: 'ready' | 'closed', result?: CLI.CommandCloseResult) =>
        spec?.onOutput?.(
          'stdout',
          Buffer.from(
            `${managedIosBarrierControlPrefix}${
              JSON.stringify({ event, generation: barrierPlan!.generation, workerPid, workerParentPid: pid, result })
            }\n`,
          ),
        )
      let released = false
      const reportClosed = async (signal: Platform.ProcessSignal | null = null) => {
        if (!barrierPlan) {
          return
        }
        await FS.writeText(
          FS.resolvePath(`command-${barrierPlan.generation}-stdout.txt`, barrierPlan.root),
          nativeOutput.stdout,
        )
        await FS.writeText(
          FS.resolvePath(`command-${barrierPlan.generation}-stderr.txt`, barrierPlan.root),
          nativeOutput.stderr,
        )
        if (!(stage === 'download' && downloadFault === 'missing-close')) {
          emit('closed', { exitCode: signal ? null : 0, signal })
        }
      }
      const handle = {
        error: undefined as Error | undefined,
        exitCode: null as number | null,
        signalCode: null as Platform.ProcessSignal | null,
      }
      commandHandles.set(pid, handle)
      const work = async () => {
        executes.push(stage)
        if (barrierPlan && nativeObserver) {
          // Semantic native-name injection only; these source workers never execute simctl.
          identities.set(workerPid, { ...identities.get(workerPid)!, command: 'simctl' })
        }
        if (stage === 'create') {
          device.name = args[2]!
          created = true
          output('stdout', Buffer.from(device.udid))
        }
        if (stage === 'boot') {
          device.state = 'Booted'
          identities.set(bootstrap.pid, bootstrap)
        }
        if (stage === 'shutdown') {
          device.state = 'Shutdown'
          identities.delete(bootstrap.pid)
          if (shutdownBootstrap === 'unreadable-live' || shutdownBootstrap === 'unexpected-probe') {
            identities.set(bootstrap.pid, bootstrap)
            unreadablePids.add(bootstrap.pid)
            bootstrapUnexpectedProbe = shutdownBootstrap === 'unexpected-probe'
          } else if (shutdownBootstrap === 'inspection-throws') {
            bootstrapInspectionThrows = true
          } else if (shutdownBootstrap === 'readable-replacement') {
            identities.set(bootstrap.pid, { ...bootstrap, startedAt: 'foreign-bootstrap' })
          }
        }
        if (stage === 'delete') {
          created = false
        }
        if (stage === 'download') {
          const plan = JSON.parse(await FS.readText(args[2]!)) as { root: string }
          const appPath = FS.resolvePath('expo-home/client.app', plan.root)
          await FS.mkdir(appPath)
          await FS.writeText(
            FS.resolvePath(artifactExecutable === 'Expo Go' ? artifactExecutable : 'Exponent', appPath),
            'SDK client',
          )
          await FS.writeText(
            FS.resolvePath('download.json', plan.root),
            JSON.stringify({
              sdk: EXPO_SDK_VERSION,
              publisher: 'installed Expo SDK metadata',
              url: 'https://expo.dev/sdk-client.tar.gz',
              clientVersion: artifactVersion,
              bundleId: 'host.exp.Exponent',
              executable: artifactExecutable,
              appPath,
              digest: Platform.sha256Hex(Buffer.from('SDK client')),
            }),
          )
          output(
            'stdout',
            Buffer.from(`TAO_PRIVATE_IOS_ARTIFACT ${await FS.readText(FS.resolvePath('download.json', plan.root))}\n`),
          )
          Expect(spec?.env?.['TAO_DEV_LOOP_WORKER_CREDENTIALS']).toBe('')
          Expect(spec?.env?.['TMPDIR']).toBe(`${FS.resolvePath('tmp', plan.root)}/`)
          Expect(spec?.env?.['__UNSAFE_EXPO_HOME_DIRECTORY']).toBe(FS.resolvePath('expo-home', plan.root))
        }
        if (hold !== stage) {
          finish(workerPid)
        }
      }
      if (barrierPlan) {
        void Promise.resolve().then(() => emit('ready'))
      } else {
        void Promise.resolve().then(work).catch(error => closed.reject(error))
      }
      return {
        pid,
        get error() {
          return handle.error
        },
        get exitCode() {
          return handle.exitCode
        },
        get signalCode() {
          return handle.signalCode
        },
        writeStdin: (line: string) => {
          if (line === `run ${barrierPlan?.generation}\n` && !released) {
            released = true
            void work().then(async () => {
              if (hold !== stage) {
                await reportClosed()
              }
            }).catch(error => closed.reject(error))
          } else if (line === `finish ${barrierPlan?.generation}\n`) {
            finish(pid)
          } else if (line === `cancel ${barrierPlan?.generation}\n`) {
            if (identities.has(workerPid)) {
              finish(workerPid, 'SIGTERM')
            }
            void reportClosed('SIGTERM')
          }
          return true
        },
        endStdin: () => {
          if (barrierPlan) {
            if (identities.has(workerPid)) {
              finish(workerPid, 'SIGTERM')
            }
            if (identities.has(pid)) {
              finish(pid, 'SIGTERM')
            }
          }
        },
        waitForClose: () => closed.promise,
        closeOutput: async () => {
          closedOutput.push(pid)
          if (stage === 'download' && downloadFault === 'missing-output') {
            await FS.remove(FS.resolvePath(`command-${barrierPlan!.generation}-stdout.txt`, barrierPlan!.root))
          }
          if (denyOutput && stage === 'download') {
            Errors.throwHostEnvironment('Injected output closure denial')
          }
          if (holdOutput && stage === 'download') {
            await new Promise<void>(() => {})
          }
          if (stage === 'download' && mutateArtifact) {
            const path = FS.resolvePath('download.json', helper.root)
            const artifact = await FS.readJson<{ appPath: string; url: string }>(path)
            if (mutateArtifact === 'metadata') {
              await FS.writeText(path, JSON.stringify({ ...artifact, url: 'https://foreign.example/fake-runtime' }))
            } else if (mutateArtifact === 'binary') {
              await FS.writeText(FS.resolvePath('Exponent', artifact.appPath), 'replaced binary')
            } else {
              const outside = FS.resolvePath('same-digest-executable', helper.root)
              await FS.writeText(outside, 'SDK client')
              await FS.remove(FS.resolvePath('Exponent', artifact.appPath))
              await FS.symlink(outside, FS.resolvePath('Exponent', artifact.appPath))
            }
          }
        },
        dispose: () => {
          disposed.push(pid)
        },
      } as unknown as CLI.StartedCommand
    },
  }
  const helper = await createManagedIosFixture({
    invocation,
    scope,
    artifactRoot,
    baselineResources: [],
    shouldStop: () => stopped,
    onCleanupChild: cleanupPublisher,
    onChild: async child => {
      const identity = identities.get(child.pid!)
      Expect(identity).toBeDefined()
      Expect(groups.has(child.pid!)).toBe(true)
      const stage = identity!.command.slice('source '.length)
      registered.push(stage)
      if (stage === 'download' && downloadFault) {
        const worker = [...identities.values()].find(value => workerGroups.get(value.pid) === child.pid)!
        if (downloadFault === 'supervisor-unreadable') {
          unreadablePids.add(child.pid!)
        }
        if (downloadFault === 'worker-replaced') {
          identities.set(worker.pid, { ...worker, startedAt: 'replacement downloader worker' })
        }
        if (downloadFault === 'unknown-member') {
          identities.set(descendant.pid, descendant)
          workerGroups.set(descendant.pid, child.pid!)
        }
        if (downloadFault === 'child-closed') {
          finish(child.pid!)
        }
        if (downloadFault === 'child-error') {
          commandHandles.get(child.pid!)!.error = new Errors.HostEnvironmentError('Original supervisor error')
        }
        if (downloadFault === 'cancel') {
          stopped = true
        }
      }
      if (stopDuringRegistration && stage === 'download') {
        stopped = true
        await heldRegistration.promise
      }
      if (denyRegistration && stage === 'download') {
        Errors.throwHostEnvironment('Injected managed child publication denial')
      }
    },
  }, operations)
  const mint = async () => {
    const creation = {
      name: `${helper.selection.namePrefix}1`,
      type: device.deviceTypeIdentifier,
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
    }
    await helper.selection.beforeCreate(creation)
    const minted = await helper.run('xcrun', {
      args: ['simctl', 'create', creation.name, creation.type, creation.runtime],
    })
    await helper.selection.afterCreate({ ...creation, id: minted.stdout })
    const lease = await operations.resources.acquire({
      name: `ios-simulator:${device.udid}`,
      command: 'source target',
      repositoryRoot: artifactRoot,
      waitTimeoutMs: 0,
    })
    const owner = await operations.resources.retain({
      owners: [lease.owner],
      processes: [],
      quarantined: true,
      reason: 'source reserved target',
    })
    const owned: AgentAppDevDevice = {
      platform: 'ios',
      id: device.udid,
      owned: true,
      state: 'reserved',
      holder,
      generation: owner.id,
      resources: [owner],
    }
    await helper.observeDevice(owned)
    await helper.run('xcrun', { args: ['simctl', 'boot', device.udid] })
    const booted = { ...owned, state: 'booted' as const }
    await helper.observeDevice(booted)
    return {
      device: booted,
      reservation: appDevReservation('ios', device.udid, [owner], operations.resources.readOwner),
      shouldStop: () => stopped,
    }
  }
  const cleanup = async () => {
    await FS.remove(artifactRoot)
  }
  return {
    helper,
    downloadFault: (value: NonNullable<typeof downloadFault>) => {
      downloadFault = value
    },
    operations,
    starts,
    executes,
    registered,
    signals,
    disposed,
    closedOutput,
    device,
    foreign,
    mint,
    sourceDownloadProbe: async () => {
      helper.asset.bootstrap = bootstrap
      await FS.mkdir(FS.resolvePath('tmp', helper.root))
      await FS.mkdir(FS.resolvePath('expo-home', helper.root))
      await operations.save(FS.resolvePath('download-plan.json', helper.root), {
        root: helper.root,
        invocation,
        scope,
        sdk: EXPO_SDK_VERSION,
      })
      return await helper.finite('download', Platform.runtimeProcess.execPath, {
        args: [
          Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime.ts'),
          'download',
          FS.resolvePath('download-plan.json', helper.root),
        ],
        env: {
          TAO_DEV_LOOP_WORKER_CREDENTIALS: '',
          TMPDIR: `${FS.resolvePath('tmp', helper.root)}/`,
          __UNSAFE_EXPO_HOME_DIRECTORY: FS.resolvePath('expo-home', helper.root),
        },
      }, helper.asset.resources!)
    },
    cleanup,
    stop: () => {
      stopped = true
    },
    finalizerFailure: () => {
      faultAfterStart = true
    },
    registryRoot,
    setVersion: (version: string) => {
      artifactVersion = version
    },
    setExecutable: (name: string) => {
      artifactExecutable = name
    },
    beforeInstall: (hook: () => Promise<void>) => {
      beforeInstall = hook
    },
    beforeAdmission: (hook: () => Promise<void>) => {
      beforeAdmission = hook
    },
    replaceBootstrap: () => {
      identities.set(bootstrap.pid, { ...bootstrap, startedAt: 'replacement-bootstrap' })
    },
    changeBootstrap: () => {
      changeBootstrap = true
    },
    denyChildPublication: () => {
      denyChildPublication = true
    },
    denyOutput: () => {
      denyOutput = true
    },
    holdOutput: () => {
      holdOutput = true
    },
    denyRegistration: () => {
      denyRegistration = true
    },
    stopDuringRegistration: () => {
      stopDuringRegistration = true
    },
    releaseRegistration: () => heldRegistration.resolve(),
    descendant,
    recoveries,
    inspectionFailure: (kind: 'identities' | 'descendants' | 'liveness') => {
      inspectionFailure = kind
    },
    shutdownBootstrap: (
      kind: 'unreadable-live' | 'inspection-throws' | 'readable-replacement' | 'unexpected-probe',
    ) => {
      shutdownBootstrap = kind
    },
    bootstrapVisibility: (kind: 'unreadable-live' | 'inspection-throws' | 'unexpected-probe') => {
      if (kind === 'unreadable-live' || kind === 'unexpected-probe') {
        identities.set(bootstrap.pid, bootstrap)
        unreadablePids.add(bootstrap.pid)
        bootstrapUnexpectedProbe = kind === 'unexpected-probe'
      } else {
        bootstrapInspectionThrows = true
      }
    },
    forgetTarget: () => {
      created = false
    },
    unexpectedProbeFailure,
    livenessProbes,
    mutateArtifact: (kind: 'metadata' | 'binary' | 'symlink') => {
      mutateArtifact = kind
    },
  }
}

for (const publicationFailure of [false, true]) {
  Test(
    `private iOS cancelled startup routes shutdown through cleanup publication${
      publicationFailure ? ' and retains failed acknowledgement' : ''
    }`,
    async () => {
      let publishedTarget = ''
      const f = await fixture(undefined, undefined, async (child, capture, reservation) => {
        Expect(capture.root.pid).toBe(child.pid)
        Expect(capture.members.length).toBe(2)
        Expect(reservation.platform).toBe('ios')
        Expect(reservation.resources.map(owner => owner.name)).toEqual([`ios-simulator:${reservation.id}`])
        Expect(Object.isFrozen(reservation)).toBe(true)
        await reservation.assertCurrent()
        publishedTarget = reservation.id
        if (publicationFailure) {
          Errors.throwHostEnvironment('Injected shutdown publication failure')
        }
      })
      try {
        await f.mint()
        f.stop()
        const result = f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
        if (publicationFailure) {
          await Expect(result).rejects.toThrow('Injected shutdown publication failure')
          Expect(f.executes).not.toContain('shutdown')
          Expect(f.device.state).toBe('Booted')
          Expect(f.helper.asset.actions.at(-1)!.state).toBe('retained')
          Expect(f.helper.asset.actions.at(-1)!.barrier!.drainProved).toBe(false)
          Expect((await f.operations.resources.readOwner({ name: `ios-simulator:${f.device.udid}` }))!.retention)
            .toBeDefined()
        } else {
          Expect((await result).exitCode).toBe(0)
          Expect(f.executes).toContain('shutdown')
          Expect(f.device.state).toBe('Shutdown')
          Expect(f.helper.asset.actions.at(-1)!.state).toBe('closed')
          Expect(f.helper.asset.actions.at(-1)!.barrier!.drainProved).toBe(true)
        }
        Expect(publishedTarget).toBe(f.device.udid)
        Expect(f.registered).not.toContain('shutdown')
      } finally {
        await f.cleanup()
      }
    },
  )
}

Test('private iOS SDK executable accepts a literal Expo Go basename with publisher and digest proof', async () => {
  const f = await fixture()
  try {
    f.setExecutable('Expo Go')
    const preparation = await f.mint()
    await f.helper.prepare(preparation)
    Expect(f.starts).toEqual(['create', 'boot', 'download', 'install'])
    Expect(f.helper.asset.state).toBe('prepared')
    Expect(f.helper.asset.artifact?.executable).toBe('Expo Go')
    Expect(f.helper.asset.artifact?.publisher).toBe('installed Expo SDK metadata')
    Expect(f.helper.asset.artifact?.digest).toBe(Platform.sha256Hex(Buffer.from('SDK client')))
  } finally {
    await f.cleanup()
  }
})
Test(
  'semantic native boot cancellation drains its original command while missing bootstrap provenance remains retained',
  async () => {
    let observed: Parameters<NonNullable<ManagedIosRuntimeOperations['onNativeExecution']>>[0] | undefined
    const f = await fixture('boot', async execution => {
      if (execution.stage === 'boot') {
        observed = execution
      }
    })
    try {
      const minting = f.mint()
      Expect(await Time.pollUntil(() => observed, { intervalMs: 25, timeoutMs: 10_000 })).toBeDefined()
      Expect(observed!.id).toBe(f.device.udid)
      Expect(observed!.owners.map(owner => owner.id)).toEqual(f.helper.asset.resources!.map(owner => owner.id))
      f.stop()
      const cancelled = await minting.then(() => undefined, error => error)
      Expect(cancelled).toBeInstanceOf(Errors.HostEnvironmentError)
      const barrierFailure = (cancelled as Errors.HostEnvironmentError).cause as Errors.HostEnvironmentError
      Expect((barrierFailure.cause as Error).name).toBe('AbortError')
      const boot = f.helper.asset.actions.find(action => action.stage === 'boot')!
      Expect(boot.barrier?.drainProved).toBe(true)
      Expect(boot.barrier?.nativeClose?.signal).toBe('SIGTERM')
      Expect(f.helper.asset.bootstrap).toBeUndefined()
      await Expect(f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] }))
        .rejects.toThrow('replacement bootstrap kernel identity')
      Expect(f.helper.asset.bootstrap).toBeUndefined()
      const receipt = {
        version: 1 as const,
        session: Platform.randomUUID(),
        checkout: Repo.getRoot(),
        generation: Platform.randomUUID(),
        state: 'stopped' as const,
        args: [],
        createdAt: 'source',
        updatedAt: 'source',
        children: [],
        cleanupOutcome: 'proved' as const,
        devices: [{
          platform: 'ios' as const,
          id: f.device.udid,
          owned: true,
          state: 'released' as const,
          holder: f.helper.asset.holder,
          resources: f.helper.asset.resources,
        }],
      }
      await Expect(
        cleanupManagedIosFixtureAssets({ root: f.helper.root, receipt, baselineResources: [] }, f.operations),
      )
        .rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(f.executes).not.toContain('delete')
      Expect(f.executes).not.toContain('shutdown')
      Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).not.toHaveLength(0)
      Expect(f.foreign.state).toBe('Shutdown')
    } finally {
      await f.cleanup()
    }
  },
)

Test('private iOS publishes every finite child before advancing and retains failed durable publication', async () => {
  const f = await fixture('download')
  try {
    const preparation = await f.mint()
    f.denyRegistration()
    const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
    Expect(f.starts).toEqual(['create', 'boot', 'download'])
    Expect(f.registered).toEqual(f.starts)
    Expect(f.signals).toEqual([])
    Expect(f.closedOutput).toHaveLength(3)
    Expect(f.disposed).toHaveLength(3)
    Expect(f.helper.asset.state).toBe('retained')
    Expect(f.helper.asset.actions.at(-1)?.state).toBe('retained')
    Expect(Errors.formatForUser(error)).toContain('managed child publication denial')
    Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
    Expect(
      (await f.operations.resources.readOwner({ name: preparation.reservation.resources[0]!.name }))?.retention
        ?.quarantined,
    ).toBe(true)
  } finally {
    await f.cleanup()
  }
})

for (const kind of ['identities', 'descendants', 'liveness'] as const) {
  Test(
    `private iOS downloader ${kind} inspection exception remains quarantined after the original child closes`,
    async () => {
      const f = await fixture()
      try {
        const preparation = await f.mint()
        f.inspectionFailure(kind)
        const error = await f.sourceDownloadProbe()
          .then(() => undefined, error => error)
        const message = `Injected ${
          kind === 'descendants' ? 'descendant' : kind === 'identities' ? 'identity' : 'liveness'
        } inspection failure after child closure`
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect(Errors.formatForUser(error)).toContain(message)
        const typed = error as Errors.HostEnvironmentError
        Expect(typed.details?.['retainsTargetLease']).toBe(true)
        Expect(Errors.formatForUser((typed.cause as Errors.HostEnvironmentError).cause)).toBe(message)
        Expect(f.signals).toEqual([])
        Expect(f.closedOutput).toHaveLength(3)
        Expect(f.disposed).toHaveLength(3)
        Expect(f.starts).toEqual(['create', 'boot', 'download'])
        Expect(f.helper.asset.state).toBe('retained')
        const action = f.helper.asset.actions.at(-1)!
        Expect(action.state).toBe('retained')
        Expect(action.barrier?.refusal).toBe(message)
        Expect(action.captureInspectionFailure).toContain(message)
        Expect(f.operations.tree.isGroupAlive(action.group!)).toBe(false)
        const journal = await FS.readJson<{ state: string; actions: typeof f.helper.asset.actions }>(
          FS.resolvePath('asset.json', f.helper.root),
        )
        Expect(journal.state).toBe('retained')
        Expect(journal.actions.at(-1)?.captureInspectionFailure).toContain(message)
        for (const expected of [f.helper.asset.creation!, preparation.reservation.resources[0]!]) {
          const current = await f.operations.resources.readOwner({ name: expected.name })
          Expect(current?.id).toBe(expected.id)
          Expect(current?.retention?.quarantined).toBe(true)
        }
      } finally {
        await f.cleanup()
      }
    },
  )
}

for (const kind of ['unreadable-live', 'inspection-throws', 'readable-replacement', 'unexpected-probe'] as const) {
  Test(
    `private iOS shutdown checks original bootstrap closure after ${kind} without signalling a foreign PID`,
    async () => {
      const f = await fixture()
      try {
        await f.mint()
        const original = structuredClone(f.helper.asset.bootstrap)
        const owners = await MachineResources.listOwners({ registryRoot: f.registryRoot })
        f.shutdownBootstrap(kind)
        const error = await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
          .then(() => undefined, error => error)
        if (kind === 'readable-replacement') {
          Expect(error).toBe(undefined)
        } else {
          Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
          Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
          Expect(f.helper.asset.state).toBe('retained')
          if (kind === 'inspection-throws') {
            Expect(Errors.formatForUser((error as Errors.HostEnvironmentError).cause)).toBe(
              'Injected bootstrap identity inspection failure',
            )
          }
        }
        Expect(f.starts).toEqual(['create', 'boot', 'shutdown'])
        if (kind === 'unexpected-probe') {
          const classified = (error as Errors.HostEnvironmentError).cause as Errors.HostEnvironmentError
          Expect(classified).toBeInstanceOf(Errors.HostEnvironmentError)
          Expect(classified.details?.['code']).toBe('EIO')
          Expect(classified.cause).toBe(f.unexpectedProbeFailure)
          Expect(f.livenessProbes).toEqual([original!.pid])
        }
        Expect(f.helper.asset.bootstrap).toEqual(original)
        Expect(f.signals).toEqual([])
        Expect(f.disposed).toHaveLength(3)
        Expect(f.recoveries).toEqual([])
        Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual(owners)
      } finally {
        await f.cleanup()
      }
    },
  )
}

for (const phase of ['restart', 'producer', 'collector'] as const) {
  for (const kind of ['unreadable-live', 'inspection-throws', 'unexpected-probe'] as const) {
    Test(`private iOS ${phase} refuses ${kind} bootstrap closure without deleting or recovering fences`, async () => {
      const f = await fixture()
      try {
        const preparation = await f.mint()
        await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
        if (phase === 'producer') {
          f.forgetTarget()
        } else {
          const owner = preparation.reservation.resources[0]!
          await f.operations.resources.recoverRetained({
            name: owner.name,
            generation: owner.id,
            shutdown: async () => true,
          })
          await f.helper.observeDevice({ ...preparation.device, state: 'released' })
        }
        const owners = await MachineResources.listOwners({ registryRoot: f.registryRoot })
        const recovered = [...f.recoveries]
        f.bootstrapVisibility(kind)
        let operation: Promise<unknown>
        if (phase === 'restart') {
          operation = createManagedIosFixture({
            invocation: f.helper.asset.invocation,
            scope: f.helper.asset.scope,
            artifactRoot: FS.dirname(f.helper.root),
            baselineResources: [],
            shouldStop: () => false,
          }, f.operations)
        } else if (phase === 'producer') {
          operation = f.helper.finishProducerDeletion(preparation.reservation.resources)
        } else {
          const receipt = {
            version: 1 as const,
            session: Platform.randomUUID(),
            checkout: f.helper.asset.creation!.repositoryRoot,
            generation: Platform.randomUUID(),
            state: 'stopped' as const,
            args: [],
            createdAt: 'stamp',
            updatedAt: 'stamp',
            controller: f.helper.asset.holder,
            cleanupOutcome: 'proved' as const,
            devices: [{ ...preparation.device, state: 'released' as const }],
            children: [],
          }
          const collectorTree = {
            ...f.operations.tree,
            identities: (pids: readonly number[]) =>
              new Map(
                [...f.operations.tree.identities(pids)].map(([pid, identity]) => [
                  pid,
                  pid === f.helper.asset.holder.pid ? { ...identity, startedAt: 'source-next-collector' } : identity,
                ]),
              ),
          }
          operation = cleanupManagedIosFixtureAssets({ root: f.helper.root, receipt, baselineResources: [] }, {
            ...f.operations,
            tree: collectorTree,
          })
        }
        const error = await operation.then(() => undefined, error => error)
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
        if (kind === 'inspection-throws') {
          Expect(Errors.formatForUser((error as Errors.HostEnvironmentError).cause)).toBe(
            'Injected bootstrap identity inspection failure',
          )
        }
        Expect(f.starts).toEqual(['create', 'boot', 'shutdown'])
        Expect(f.signals).toEqual([])
        if (kind === 'unexpected-probe') {
          const classified = (error as Errors.HostEnvironmentError).cause as Errors.HostEnvironmentError
          Expect(classified).toBeInstanceOf(Errors.HostEnvironmentError)
          Expect(classified.details?.['code']).toBe('EIO')
          Expect(classified.cause).toBe(f.unexpectedProbeFailure)
          Expect(f.livenessProbes).toEqual([f.helper.asset.bootstrap!.pid])
        }
        Expect(f.recoveries).toEqual(recovered)
        Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual(owners)
      } finally {
        await f.cleanup()
      }
    })
  }
}

Test('private iOS fast downloader requires durable two-kernel custody and original stream/group closure', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    await f.helper.prepare(preparation)
    const action = f.helper.asset.actions.find(action => action.stage === 'download')!
    Expect(action.state).toBe('closed')
    Expect(action.barrier?.released).toBe(true)
    Expect(action.barrier?.drainProved).toBe(true)
    Expect(action.barrier?.outputClosed).toBe(true)
    Expect(action.barrier?.nativeClose).toEqual({ exitCode: 0, signal: null })
    Expect(action.child).toEqual(action.barrier?.supervisor)
    Expect(action.processes).toEqual([action.barrier!.supervisor, action.barrier!.worker])
    Expect(action.barrier!.supervisor.pid).not.toBe(action.barrier!.worker.pid)
    Expect(f.registered).toContain('download')
    Expect(f.executes).toEqual(['create', 'boot', 'download', 'install'])
  } finally {
    await f.cleanup()
  }
})

for (const boundary of ['restart', 'collector'] as const) {
  Test(
    `private iOS ${boundary} refuses a legacy closed downloader without original barrier drain evidence`,
    async () => {
      const f = await fixture()
      try {
        const preparation = await f.mint()
        await f.helper.prepare(preparation)
        await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
        const owner = preparation.reservation.resources[0]!
        await f.operations.resources.recoverRetained({
          name: owner.name,
          generation: owner.id,
          shutdown: async () => true,
        })
        await f.helper.observeDevice({ ...preparation.device, state: 'released' })
        const download = f.helper.asset.actions.find(action => action.stage === 'download')!
        delete download.barrier
        const path = FS.resolvePath('asset.json', f.helper.root)
        await f.operations.save(path, f.helper.asset)
        const before = await FS.readText(path)
        const starts = [...f.starts]
        const error = await (boundary === 'restart'
          ? createManagedIosFixture({
            invocation: f.helper.asset.invocation,
            scope: f.helper.asset.scope,
            artifactRoot: FS.dirname(f.helper.root),
            baselineResources: [],
            shouldStop: () => false,
          }, f.operations)
          : cleanupManagedIosFixtureAssets({
            root: f.helper.root,
            baselineResources: [],
            receipt: {
              version: 1,
              session: Platform.randomUUID(),
              generation: Platform.randomUUID(),
              checkout: Repo.getRoot(),
              state: 'stopped',
              cleanupOutcome: 'proved',
              controller: f.helper.asset.holder,
              children: [],
              args: [],
              createdAt: 'stamp',
              updatedAt: 'stamp',
              devices: [{ ...preparation.device, state: 'released' }],
            },
          }, {
            ...f.operations,
            tree: {
              ...f.operations.tree,
              identities: pids =>
                new Map([...f.operations.tree.identities(pids)].filter(([pid]) => pid !== f.helper.asset.holder.pid)),
            },
          })).catch(error => error)
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect(error.details?.['retainsTargetLease']).toBe(true)
        Expect(f.starts).toEqual(starts)
        Expect(await FS.readText(path)).toBe(before)
        Expect((await f.operations.resources.readOwner({ name: f.helper.asset.creation!.name }))?.id).toBe(
          f.helper.asset.creation!.id,
        )
      } finally {
        await f.cleanup()
      }
    },
  )
}

for (
  const failure of [
    'supervisor-unreadable',
    'worker-replaced',
    'unknown-member',
    'child-closed',
    'child-error',
    'cancel',
    'missing-close',
    'missing-output',
  ] as const
) {
  Test(`private iOS downloader barrier ${failure} retains its original target and creation generations`, async () => {
    const f = await fixture()
    try {
      const preparation = await f.mint()
      f.downloadFault(failure)
      const error = await f.helper.prepare(preparation).catch(error => error)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(error.details?.['retainsTargetLease']).toBe(true)
      const action = f.helper.asset.actions.at(-1)!
      Expect(action.stage).toBe('download')
      Expect(action.state).toBe('retained')
      Expect(action.barrier?.drainProved).toBe(false)
      Expect(action.captureInspectionFailure).toBeDefined()
      Expect(f.executes.includes('download')).toBe(failure === 'missing-close' || failure === 'missing-output')
      Expect(f.executes.includes('install')).toBe(false)
      const journal = await FS.readJson<{ actions: typeof f.helper.asset.actions }>(
        FS.resolvePath('asset.json', f.helper.root),
      )
      Expect(journal.actions.at(-1)?.captureInspectionFailure).toBe(action.captureInspectionFailure)
      for (const expected of [f.helper.asset.creation!, preparation.reservation.resources[0]!]) {
        const current = await f.operations.resources.readOwner({ name: expected.name })
        Expect(current?.id).toBe(expected.id)
        Expect(current?.retention?.quarantined).toBe(true)
      }
    } finally {
      await f.cleanup()
    }
  })
}

Test('private iOS publication denial remains the primary cause when output closure also fails', async () => {
  const f = await fixture('download')
  try {
    const preparation = await f.mint()
    f.denyRegistration()
    f.denyOutput()
    const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.formatForUser(error)).toContain('Injected managed child publication denial')
    Expect(Errors.formatForUser(error)).toContain('Injected output closure denial')
    const typed = error as Errors.HostEnvironmentError
    Expect(typed.cause).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(Errors.formatForUser(typed.cause)).toContain('barrier retained uncertain')
    Expect(Errors.formatForUser((typed.cause as Errors.HostEnvironmentError).cause)).toBe(
      'Injected managed child publication denial',
    )
    Expect(Errors.formatForUser((typed.cause as Errors.HostEnvironmentError).details?.['outputFailure'])).toBe(
      'Injected output closure denial',
    )
    Expect(typed.details?.['retainsTargetLease']).toBe(true)
    Expect(f.starts).toEqual(['create', 'boot', 'download'])
    Expect(f.signals).toEqual([])
    Expect(f.closedOutput).toHaveLength(3)
    Expect(f.disposed).toHaveLength(3)
    Expect(f.helper.asset.state).toBe('retained')
    for (const expected of [f.helper.asset.creation!, preparation.reservation.resources[0]!]) {
      const current = await f.operations.resources.readOwner({ name: expected.name })
      Expect(current?.id).toBe(expected.id)
      Expect(current?.retention?.quarantined).toBe(true)
    }
  } finally {
    await f.cleanup()
  }
})

Test('private iOS stop cancels a held publication acknowledgement and retains uncertainty', async () => {
  const f = await fixture('download')
  try {
    const preparation = await f.mint()
    f.stopDuringRegistration()
    const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
    Expect(f.starts).toEqual(['create', 'boot', 'download'])
    Expect(f.registered).toEqual(f.starts)
    Expect(f.signals).toEqual([])
    Expect(f.closedOutput).toHaveLength(3)
    Expect(f.disposed).toHaveLength(3)
    Expect(f.helper.asset.state).toBe('retained')
    Expect(f.helper.asset.actions.at(-1)?.state).toBe('retained')
    Expect(Errors.formatForUser(error)).toContain('publication budget')
    Expect((error as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
    Expect(
      (await f.operations.resources.readOwner({ name: preparation.reservation.resources[0]!.name }))?.retention
        ?.quarantined,
    ).toBe(true)
  } finally {
    f.releaseRegistration()
    await f.cleanup()
  }
})

Test(
  'private iOS SDK executable rejects traversal, separators, empty and special basenames before install',
  async () => {
    for (const name of ['', '.', '..', '../outside', '/outside', 'folder\\outside', 'Expo\0Go']) {
      const f = await fixture()
      try {
        f.setExecutable(name)
        const preparation = await f.mint()
        const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
        Expect(f.executes.includes('install')).toBe(false)
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect(Errors.formatForUser(error)).toContain('fixed publisher/SDK/bundle provenance')
        Expect(f.helper.asset.state).not.toBe('prepared')
      } finally {
        await f.cleanup()
      }
    }
  },
)

for (const kind of ['metadata', 'binary', 'symlink'] as const) {
  Test(`private iOS ${kind} tampering after owned downloader capture never reaches install`, async () => {
    const f = await fixture()
    try {
      const preparation = await f.mint()
      f.mutateArtifact(kind)
      const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
      Expect(f.executes.includes('install')).toBe(false)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(Errors.formatForUser(error)).toContain(
        kind === 'metadata'
          ? 'captured fixed downloader publication'
          : kind === 'binary'
          ? 'changed after verified download'
          : 'symbolic link',
      )
    } finally {
      await f.cleanup()
    }
  })
}

for (const outcome of ['proved', 'finalizer-failure'] as const) {
  Test(
    `private iOS asset ${outcome} deletion retains a fresh intent until exact child and target absence proof`,
    async () => {
      const f = await fixture()
      try {
        const preparation = await f.mint()
        await f.helper.prepare(preparation)
        await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
        const owner = preparation.reservation.resources[0]!
        await f.operations.resources.recoverRetained({
          name: owner.name,
          generation: owner.id,
          shutdown: async () => true,
        })
        await f.helper.observeDevice({ ...preparation.device, state: 'released' })
        if (outcome === 'finalizer-failure') {
          f.finalizerFailure()
        }
        const receipt = {
          version: 1 as const,
          session: Platform.randomUUID(),
          checkout: f.helper.asset.creation!.repositoryRoot,
          generation: Platform.randomUUID(),
          state: 'stopped' as const,
          args: [],
          createdAt: 'stamp',
          updatedAt: 'stamp',
          controller: f.helper.asset.holder,
          cleanupOutcome: 'proved' as const,
          devices: [{ ...preparation.device, state: 'released' as const }],
          children: [],
        }
        const collectorTree = {
          ...f.operations.tree,
          identities: (pids: readonly number[]) =>
            new Map(
              [...f.operations.tree.identities(pids)].map((
                [pid, identity],
              ) => [
                pid,
                pid === f.helper.asset.holder.pid ? { ...identity, startedAt: 'source-next-collector' } : identity,
              ]),
            ),
        }
        const cleanup = cleanupManagedIosFixtureAssets(
          { root: f.helper.root, receipt, baselineResources: [] },
          { ...f.operations, tree: collectorTree },
        )
        if (outcome === 'finalizer-failure') {
          await Expect(cleanup).rejects.toThrow('deletion retained')
          const owners = await MachineResources.listOwners({ registryRoot: f.registryRoot })
          Expect(owners.filter(resource => resource.retention?.quarantined)).toHaveLength(2)
          const asset = await FS.readJson<{ state: string; actions: { stage: string; state: string }[] }>(
            FS.resolvePath('asset.json', f.helper.root),
          )
          Expect(asset.state).toBe('retained')
          Expect(asset.actions.at(-1)?.state).toBe('retained')
        } else {
          await cleanup
          Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
          Expect((await FS.readJson<{ state: string }>(FS.resolvePath('asset.json', f.helper.root))).state).toBe(
            'deleted',
          )
        }
        Expect(f.disposed.length).toBe(f.starts.length)
        Expect(f.foreign.state).toBe('Shutdown')
      } finally {
        await f.cleanup()
      }
    },
  )
}

Test('private iOS preparation preserves the first boot capture and refuses its replacement', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    const original = structuredClone(f.helper.asset.bootstrap)
    f.replaceBootstrap()
    const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
    Expect(f.starts).toEqual(['create', 'boot'])
    Expect(Errors.formatForUser(error)).toContain('replacement bootstrap kernel identity')
    Expect(f.helper.asset.bootstrap).toEqual(original)
    Expect(f.signals).toEqual([])
    Expect((await f.operations.resources.readOwner({ name: preparation.reservation.resources[0]!.name }))?.id).toBe(
      preparation.reservation.resources[0]!.id,
    )
  } finally {
    await f.cleanup()
  }
})

for (const timing of ['before-proof', 'atomic-admission'] as const) {
  Test(`private iOS shutdown refuses a replacement bootstrap at ${timing} without physical mutation`, async () => {
    const f = await fixture()
    try {
      const preparation = await f.mint()
      await f.helper.prepare(preparation)
      if (timing === 'before-proof') {
        f.replaceBootstrap()
      } else {
        f.beforeAdmission(async () => f.replaceBootstrap())
      }
      const error = await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] }).then(
        () => undefined,
        error => error,
      )
      Expect(f.executes.includes('shutdown')).toBe(false)
      Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(f.device.state).toBe('Booted')
      Expect(f.signals).toEqual([])
      Expect(f.helper.asset.bootstrap?.startedAt).toBe('bootstrap-start')
    } finally {
      await f.cleanup()
    }
  })
}

Test('private iOS stale Shutdown discovery never authorizes shutdown of a newly Booted replacement', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    await f.helper.prepare(preparation)
    f.device.state = 'Shutdown'
    f.beforeAdmission(async () => {
      f.device.state = 'Booted'
      f.replaceBootstrap()
    })
    const error = await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] }).then(
      () => undefined,
      error => error,
    )
    Expect(f.executes.includes('shutdown')).toBe(false)
    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(f.device.state).toBe('Booted')
    Expect(f.signals).toEqual([])
    Expect(f.helper.asset.bootstrap?.startedAt).toBe('bootstrap-start')
  } finally {
    await f.cleanup()
  }
})

for (const actor of ['producer', 'collector'] as const) {
  Test(
    `private iOS ${actor} deletion rejects a late creation-generation successor without releasing the held delete worker`,
    async () => {
      const f = await fixture()
      try {
        const preparation = await f.mint()
        await f.helper.prepare(preparation)
        await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
        let successor: string | undefined
        f.beforeAdmission(async () => {
          const next = await f.operations.resources.retain({
            owners: [f.helper.asset.creation!],
            processes: [],
            quarantined: true,
            reason: 'source late creation successor',
          })
          successor = next.id
        })
        let operation: Promise<unknown>
        if (actor === 'producer') {
          operation = f.helper.run('xcrun', { args: ['simctl', 'delete', f.device.udid] })
        } else {
          const owner = preparation.reservation.resources[0]!
          await f.operations.resources.recoverRetained({
            name: owner.name,
            generation: owner.id,
            shutdown: async () => true,
          })
          await f.helper.observeDevice({ ...preparation.device, state: 'released' })
          const receipt = {
            version: 1 as const,
            session: Platform.randomUUID(),
            checkout: f.helper.asset.creation!.repositoryRoot,
            generation: Platform.randomUUID(),
            state: 'stopped' as const,
            args: [],
            createdAt: 'stamp',
            updatedAt: 'stamp',
            controller: f.helper.asset.holder,
            cleanupOutcome: 'proved' as const,
            devices: [{ ...preparation.device, state: 'released' as const }],
            children: [],
          }
          const tree = {
            ...f.operations.tree,
            identities: (pids: readonly number[]) =>
              new Map([...f.operations.tree.identities(pids)].map(([pid, identity]) => [
                pid,
                pid === f.helper.asset.holder.pid ? { ...identity, startedAt: 'source-collector' } : identity,
              ])),
          }
          operation = cleanupManagedIosFixtureAssets({ root: f.helper.root, receipt, baselineResources: [] }, {
            ...f.operations,
            tree,
          })
        }
        const error = await operation.then(() => undefined, error => error)
        Expect(f.executes.includes('delete')).toBe(false)
        Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
        Expect(successor).toBeDefined()
        Expect((await f.operations.resources.readOwner({ name: f.helper.asset.creation!.name }))?.id).toBe(successor)
        Expect(f.device.state).toBe('Shutdown')
        Expect(f.signals).toEqual([])
      } finally {
        await f.cleanup()
      }
    },
  )
}

Test('private iOS install admission rechecks bootstrap after the last awaited page and reservation proof', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    f.changeBootstrap()
    const error = await f.helper.prepare(preparation).then(() => undefined, error => error)
    Expect(f.executes).toEqual(['create', 'boot', 'download'])
    Expect(Errors.formatForUser(error)).toContain('bootstrap changed before barrier physical admission')
    Expect(f.foreign.state).toBe('Shutdown')
  } finally {
    await f.cleanup()
  }
})

Test('private iOS install admission refuses a resource successor created after asynchronous checks', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    f.beforeInstall(async () => {
      await f.operations.resources.retain({
        owners: preparation.reservation.resources,
        processes: [],
        quarantined: true,
        reason: 'source late install rotation',
      })
    })
    await Expect(f.helper.prepare(preparation)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(f.executes.includes('install')).toBe(false)
    Expect((await f.operations.resources.readOwner({ name: preparation.reservation.resources[0]!.name }))?.id).not.toBe(
      preparation.reservation.resources[0]!.id,
    )
  } finally {
    await f.cleanup()
  }
})

for (const failure of ['child-publication', 'output', 'held-output'] as const) {
  Test(`private iOS ${failure} uncertainty disposes captured child but retains the target fence`, async () => {
    const f = await fixture(failure === 'child-publication' ? 'download' : undefined)
    try {
      const preparation = await f.mint()
      if (failure === 'child-publication') {
        f.denyChildPublication()
      } else if (failure === 'held-output') {
        f.holdOutput()
      } else {
        f.denyOutput()
      }
      await Expect(f.helper.prepare(preparation)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      Expect(f.executes.includes('install')).toBe(false)
      Expect(f.disposed.length).toBe(f.starts.length)
      Expect(
        (await f.operations.resources.readOwner({ name: preparation.reservation.resources[0]!.name }))?.retention
          ?.quarantined,
      ).toBe(true)
      if (failure !== 'child-publication') {
        Expect(f.helper.asset.state).toBe('retained')
      }
    } finally {
      await f.cleanup()
    }
  })
}

Test('private iOS runtime uses minted target, pinned SDK provenance and bounded fixed install admission', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    await f.helper.prepare(preparation)
    Expect(f.starts).toEqual(['create', 'boot', 'download', 'install'])
    Expect(f.helper.asset.state).toBe('prepared')
    Expect(f.helper.asset.bootstrap?.startedAt).toBe('bootstrap-start')
    Expect(f.helper.asset.artifact?.sdk).toBe(EXPO_SDK_VERSION)
    Expect(f.foreign.state).toBe('Shutdown')
    Expect(f.closedOutput.length).toBe(4)
    Expect(f.disposed.length).toBe(4)
    Expect(f.registered).toEqual(f.starts)
  } finally {
    await f.cleanup()
  }
})

Test(
  'private iOS restart reuses only its exact released journal after old bootstrap and command groups close',
  async () => {
    const f = await fixture()
    try {
      const preparation = await f.mint()
      await f.helper.prepare(preparation)
      await f.helper.run('xcrun', { args: ['simctl', 'shutdown', f.device.udid] })
      const owner = preparation.reservation.resources[0]!
      await f.operations.resources.recoverRetained({
        name: owner.name,
        generation: owner.id,
        shutdown: async () => true,
      })
      await f.helper.observeDevice({ ...preparation.device, state: 'released' })
      const restarted = await createManagedIosFixture({
        invocation: f.helper.asset.invocation,
        scope: f.helper.asset.scope,
        artifactRoot: FS.dirname(f.helper.root),
        baselineResources: [],
        shouldStop: () => false,
      }, f.operations)
      Expect((await restarted.selection.reuse!())?.id).toBe(f.device.udid)
      Expect(f.starts.filter(stage => stage === 'create')).toHaveLength(1)
      restarted.asset.state = 'retained'
      await restarted.save()
      await Expect(
        createManagedIosFixture({
          invocation: restarted.asset.invocation,
          scope: restarted.asset.scope,
          artifactRoot: FS.dirname(restarted.root),
          baselineResources: [],
          shouldStop: () => false,
        }, f.operations),
      ).rejects.toThrow('unproved or foreign minted journal')
      Expect(f.starts.filter(stage => stage === 'create')).toHaveLength(1)
    } finally {
      await f.cleanup()
    }
  },
)

for (const stage of ['download', 'install'] as const) {
  Test(`private iOS stop during ${stage} disposes exact finite child and prevents readiness`, async () => {
    const f = await fixture(stage)
    try {
      const preparation = await f.mint()
      const preparing = f.helper.prepare(preparation)
      await until(() => f.starts.includes(stage))
      f.stop()
      await Expect(preparing).rejects.toThrow('cancelled')
      Expect(f.helper.asset.state).not.toBe('prepared')
      Expect(f.signals).toEqual([])
      Expect(f.closedOutput.length).toBe(f.starts.length)
      Expect(f.disposed.length).toBe(f.starts.length)
      if (stage === 'download') {
        Expect(f.executes.includes('install')).toBe(false)
      }
    } finally {
      await f.cleanup()
    }
  })
}

Test('private iOS rotated reservation refuses install before spawning; no name-only adoption', async () => {
  const f = await fixture()
  try {
    const preparation = await f.mint()
    await f.operations.resources.retain({
      owners: preparation.reservation.resources,
      processes: [],
      quarantined: true,
      reason: 'successor generation',
    })
    await Expect(f.helper.prepare(preparation)).rejects.toThrow('changed ownership')
    Expect(f.starts.includes('download')).toBe(false)
    Expect(f.executes.includes('install')).toBe(false)
    f.helper.asset.id = undefined
    await Expect(f.helper.assertMinted()).rejects.toThrow('name alone')
  } finally {
    await f.cleanup()
  }
})

Test('private iOS finalizer failure keeps captured child authority and closes its outputs', async () => {
  const f = await fixture('download')
  try {
    const preparation = await f.mint()
    f.finalizerFailure()
    await Expect(f.helper.prepare(preparation)).rejects.toThrow('mutex finalizer failure')
    Expect(f.starts).toEqual(['create', 'boot', 'download'])
    Expect(f.signals).toEqual([])
    Expect(f.closedOutput.length).toBe(3)
    Expect(f.disposed.length).toBe(3)
  } finally {
    await f.cleanup()
  }
})

Test('private iOS unpublished create remains quarantined and never authorizes boot', async () => {
  const f = await fixture()
  try {
    const save = f.operations.save
    f.operations.save = async (path, value) => {
      if ((value as { state?: string }).state === 'minted') {
        Errors.throwHostEnvironment('Injected minted receipt write denial')
      }
      await save(path, value)
    }
    // Factory captures operations; hold publication at its fixed source seam instead.
    const second = await createManagedIosFixture({
      invocation: Platform.randomUUID(),
      scope: Platform.randomUUID(),
      artifactRoot: f.helper.root,
      baselineResources: [],
      shouldStop: () => false,
    }, f.operations)
    const creation = {
      name: `${second.selection.namePrefix}1`,
      type: 'iPhone-type',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
    }
    await second.selection.beforeCreate(creation)
    const created = await second.run('xcrun', {
      args: ['simctl', 'create', creation.name, creation.type, creation.runtime],
    })
    await Expect(second.selection.afterCreate({ ...creation, id: created.stdout })).rejects.toThrow(
      'publication failed',
    )
    Expect((await f.operations.resources.readOwner({ name: second.asset.creation!.name }))?.retention?.quarantined)
      .toBe(true)
    Expect(f.starts).toEqual(['create'])
  } finally {
    await f.cleanup()
  }
})
