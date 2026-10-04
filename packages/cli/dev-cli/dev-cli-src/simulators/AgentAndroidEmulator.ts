import { emulatorExitMessage } from '@expo-host/dev-loop/expo-runner/android'
import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { MachineLanes, type MachineResourceLease } from '@verification/MachineLanes'
import type { AgentAppDevDevice } from './AgentAppDev'
import { AndroidOwnershipCapture } from './AndroidOwnershipCapture'
import { AndroidRecovery, type AndroidRecoveryOperations } from './AndroidRecovery'

const POOL_SIZE = 4
const AVD_PREFIX = 'Tao_Agent_Pixel_'
const SYSTEM_IMAGE = 'system-images;android-36;google_apis;arm64-v8a'
const BOOT_TIMEOUT_MS = 180_000

export type AgentAndroidOperations = AndroidRecoveryOperations & {
  acquireResource: typeof MachineLanes.acquireResource
  run: typeof CLI.run
  start: typeof CLI.start
  tryAcquireResource: typeof MachineLanes.tryAcquireResource
  write: (message: string) => void
  writeError: (message: string) => void
  /** Injected by tests to exercise failed startup without waiting for a real boot. */
  bootTimeoutMs?: number
  bootIntervalMs?: number
  /** Finite acceptance pauses the durable-intent/kernel-capture gap without changing production dispatch. */
  onSpawnedBeforeCapture?: (started: CLI.StartedCommand) => Promise<void>
  /** Fixed host fixtures own a separate named pool; ordinary callers use the reusable default. */
  avdPrefix?: string
  /** Trusted finite fixtures pre-reserve the exact serial before durable launch publication. */
  launchReservation?: (avdName: string) => Promise<{ consolePort: number; serialLease: MachineResourceLease }>
  readResourceOwner?: typeof MachineResources.readOwner
  withCurrentOwners?: typeof MachineResources.withCurrentOwners
}

export type AgentAndroidReservation = {
  avdName: string
  autoStarted: boolean
  serial: string
  release: () => Promise<void>
  resources: () => readonly MachineResourceOwner[]
  /** Available only on the actual launch owner, never on a borrowed target. */
  refreshOwnership?: () => Promise<void>
}

/** Keep each agent on one AVD, and never adopt a running developer emulator implicitly. */
export async function reserveAndroidEmulator(
  operations: AgentAndroidOperations,
  requestedSerial?: string,
  visible = false,
  onOwnership?: (device: AgentAppDevDevice) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<AgentAndroidReservation> {
  if (requestedSerial !== undefined) {
    const running = await runningAvds(operations)
    const avdName = running.get(requestedSerial)
    if (avdName === undefined || !await isBooted(operations, requestedSerial)) {
      Errors.throwHostEnvironment(`Requested Android emulator ${requestedSerial} is not booted.`)
    }
    const avdLease = await operations.acquireResource({
      command: `agent app-dev Android AVD ${avdName} (borrowed)`,
      name: `android-avd:${avdName}`,
      repositoryRoot: Repo.getRoot(),
      waitTimeoutMs: 0,
    })
    try {
      const lease = await acquireSerial(operations, requestedSerial, avdName, false, visible)
      const retained = onOwnership === undefined
        ? undefined
        : await (operations.retainResources ?? MachineResources.retain)({
          owners: [avdLease.owner, lease.owner],
          processes: [],
          quarantined: true,
          reason:
            `Borrowed Android emulator ${requestedSerial} requires verified managed driver cleanup before release.`,
          registryRoot: operations.registryRoot,
        })
      const resources = () =>
        retained === undefined
          ? [avdLease.owner, lease.owner]
          : [avdLease.owner, lease.owner].map(owner => ({ ...retained, name: owner.name, command: owner.command }))
      await onOwnership?.({
        platform: 'android',
        id: requestedSerial,
        avdName,
        owned: false,
        state: 'booted',
        generation: retained?.id,
        resources: resources(),
        holder: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
      })
      return {
        avdName,
        autoStarted: false,
        serial: requestedSerial,
        resources,
        release: async () => {
          if (retained !== undefined) {
            await (operations.recoverResources ?? MachineResources.recoverRetained)({
              name: avdLease.owner.name,
              generation: retained.id,
              registryRoot: operations.registryRoot,
              shutdown: async () => true,
            })
          }
          await lease.release()
          await avdLease.release()
        },
      }
    } catch (error) {
      await avdLease.release()
      throw error
    }
  }

  const selection = await selectAvd(operations)
  let started: CLI.StartedCommand | undefined
  let serialLease: MachineResourceLease | undefined
  let leasedSerial: string | undefined
  let consolePort: number | undefined
  let serialMismatch = false
  let launchOwnershipLost = false
  let outputTail = ''
  let captured: ReturnType<typeof AndroidRecovery.capture> | undefined
  let cleaning: Promise<void> | undefined
  let retainedOwnership: MachineResourceOwner | undefined
  let publishedCapture = ''
  let deviceState: AgentAppDevDevice['state'] = 'reserved'
  let ownershipRefused = false
  let publication = Promise.resolve()
  const serialize = (work: () => Promise<void>): Promise<void> => {
    const result = publication.then(work)
    publication = result.catch(() => {})
    return result
  }
  const owners = (): MachineResourceOwner[] => {
    const current = (original: MachineResourceOwner): MachineResourceOwner =>
      retainedOwnership?.retention?.resourceNames.includes(original.name)
        ? { ...retainedOwnership, name: original.name, command: original.command }
        : original
    return [current(selection.lease.owner), ...(serialLease === undefined ? [] : [current(serialLease.owner)])]
  }
  const publishOwnership = async (force = false, stoppedAtStart = false): Promise<void> => {
    if (captured === undefined || captured.processes.length === 0) {
      return
    }
    const key = JSON.stringify([captured.processes, captured.uncertain, leasedSerial])
    if (!force && key === publishedCapture) {
      return
    }
    if (shouldStop() !== stoppedAtStart) {
      Errors.throwHostEnvironment('Android ownership publication was cancelled before physical commit.', {
        details: { retainsTargetLease: true },
      })
    }
    retainedOwnership = await (operations.retainResources ?? MachineResources.retain)({
      owners: owners(),
      processes: captured.processes,
      processGroupPid: captured.rootPid,
      quarantined: captured.uncertain,
      reason: `Android emulator ${selection.avdName} ownership captured during startup.`,
      registryRoot: operations.registryRoot,
    })
    try {
      // Once physical publication commits, the new generation must reach the receipt even on cancellation.
      await publishDevice(deviceState)
      if (shouldStop() !== stoppedAtStart) {
        Errors.throwHostEnvironment('Android ownership publication was cancelled after physical commit.', {
          details: { retainsTargetLease: true },
        })
      }
      publishedCapture = key
    } catch (cause) {
      ownershipRefused = true
      captured.uncertain = true
      await publishDevice('retained').catch(() => {})
      Errors.throwHostEnvironment('Android physical ownership committed without a complete receipt acknowledgement.', {
        cause,
        details: { retainsTargetLease: true, generation: retainedOwnership.id },
      })
    }
  }
  const publishDevice = async (state: AgentAppDevDevice['state']): Promise<void> => {
    deviceState = state
    await onOwnership?.({
      platform: 'android',
      id: leasedSerial ?? selection.avdName,
      avdName: selection.avdName,
      ...(consolePort === undefined ? {} : { consolePort }),
      owned: true,
      state,
      generation: retainedOwnership?.id,
      resources: owners(),
      holder: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    })
  }
  const refresh = async (): Promise<void> => {
    const stoppedAtStart = shouldStop()
    try {
      if (captured === undefined || ownershipRefused) {
        Errors.throwHostEnvironment('Android ownership refresh has no active original capture.', {
          details: { retainsTargetLease: true },
        })
      }
      const tree = operations.processTree ?? ProcessTree
      if (tree.groupMembers === undefined) {
        Errors.throwHostEnvironment('Android ownership refresh cannot inspect process group membership.')
      }
      captured = AndroidOwnershipCapture.refresh(captured, {
        ...tree,
        groupMembers: tree.groupMembers,
        processIsAlive: operations.processIsAlive,
      })
      await publishOwnership(true, stoppedAtStart)
    } catch (cause) {
      ownershipRefused = true
      if (captured !== undefined) {
        captured.uncertain = true
      }
      Errors.throwHostEnvironment('Android ownership refresh was refused; physical fences remain retained.', {
        cause,
        details: { retainsTargetLease: true, generation: retainedOwnership?.id },
      })
    }
  }
  const cleanup = (): Promise<void> =>
    cleaning ??= serialize(async () => {
      let stopped = started === undefined && !launchOwnershipLost
      let failure: unknown
      const attempt = async (work: () => void | Promise<void>): Promise<void> => {
        try {
          await work()
        } catch (error) {
          if (failure === undefined) {
            failure = error
          } else {
            operations.writeError(`Additional Android cleanup failure: ${Errors.formatForLog(error)}`)
          }
        }
      }
      await attempt(async () => {
        if (started === undefined || ownershipRefused || captured?.rootPid === undefined) {
          return
        }
        try {
          const tree = operations.processTree ?? ProcessTree
          const root = tree.identities([captured.rootPid]).get(captured.rootPid)
          if (
            root !== undefined || tree.isGroupAlive(captured.rootPid)
            || (operations.processIsAlive ?? Platform.processIsAlive)(captured.rootPid)
          ) {
            await refresh()
          }
        } catch (cause) {
          ownershipRefused = true
          captured.uncertain = true
          Errors.throwHostEnvironment(
            'Android cleanup ownership refresh was refused; physical fences remain retained.',
            {
              cause,
              details: { retainsTargetLease: true },
            },
          )
        }
      })
      await attempt(async () => {
        if (started !== undefined && (serialMismatch || ownershipRefused)) {
          retainedOwnership = await (operations.retainResources ?? MachineResources.retain)({
            owners: owners(),
            processes: captured?.processes ?? [],
            processGroupPid: captured?.rootPid,
            quarantined: true,
            reason: `Android emulator ${selection.avdName} ownership requires investigation before physical cleanup.`,
            registryRoot: operations.registryRoot,
          })
          await publishDevice('retained')
        } else if (started !== undefined) {
          stopped = await AndroidRecovery.stop({
            ...operations,
            avdName: selection.avdName,
            capture: captured ?? AndroidRecovery.capture(started, operations),
            owners: owners(),
            serial: leasedSerial,
            started,
            onRetained: async owner => {
              retainedOwnership = owner
              await publishDevice('retained')
            },
          })
        }
      })
      if (stopped) {
        if (retainedOwnership !== undefined) {
          await attempt(() =>
            (operations.recoverResources ?? MachineResources.recoverRetained)({
              name: `android-avd:${selection.avdName}`,
              generation: retainedOwnership!.id,
              registryRoot: operations.registryRoot,
              shutdown: async () => true,
            })
          )
        }
        // Publication can fail after serial acquisition. Generation-fenced release also
        // cleans up any original lease that never joined the durable handoff.
        await attempt(async () => {
          await serialLease?.release()
        })
        await attempt(() => selection.lease.release())
        if (failure === undefined) {
          // Publish target/resource proof before independently fallible output disposal.
          // A failed receipt write stays a cleanup failure; released fences are never recreated.
          await attempt(() => publishDevice('released'))
        }
      }
      await attempt(async () => {
        await started?.closeOutput()
      })
      await attempt(() => {
        started?.dispose()
      })
      if (failure !== undefined) {
        throw failure
      }
      if (!stopped && onOwnership !== undefined) {
        Errors.throwHostEnvironment(
          `Android emulator ${selection.avdName} cleanup remains unproved; its fences are retained.`,
        )
      }
    })
  try {
    if (operations.launchReservation !== undefined) {
      const reservation = await operations.launchReservation(selection.avdName)
      // Take release responsibility before validating the trusted callback's result.
      serialLease = reservation.serialLease
      consolePort = reservation.consolePort
      leasedSerial = `emulator-${consolePort}`
      if (
        !Number.isInteger(consolePort) || consolePort < 1024 || consolePort > 65534 || consolePort % 2 !== 0
        || serialLease.owner.name !== `android-emulator:${leasedSerial}`
      ) {
        Errors.throwHostEnvironment('Android launch reservation must hold the exact serial for a valid console pair.')
      }
    }
    // Publish an intent before spawning: even a parent killed between spawn and kernel
    // identity capture must leave the AVD quarantined rather than available for adoption.
    retainedOwnership = await (operations.retainResources ?? MachineResources.retain)({
      owners: owners(),
      processes: [],
      quarantined: true,
      reason: `Android emulator ${selection.avdName} launch intent; child identity is not yet captured.`
        + (consolePort === undefined
          ? ''
          : ` Expected serial ${leasedSerial}; console pair ${consolePort}/${consolePort + 1}.`),
      registryRoot: operations.registryRoot,
    })
    const launchHolder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
    await publishDevice('reserved')
    let admitted = false
    try {
      const expectedOwners = owners()
      await (operations.withCurrentOwners ?? MachineResources.withCurrentOwners)({
        owners: expectedOwners,
        registryRoot: operations.registryRoot,
      }, () => {
        if (
          launchHolder === undefined
          || ProcessTree.identities([launchHolder.pid]).get(launchHolder.pid)?.startedAt !== launchHolder.startedAt
        ) {
          Errors.throwHostEnvironment('Android launch holder lost its kernel identity before spawn.')
        }
        admitted = true
        // Capture the child synchronously: a failed mutex finalizer must not lose cleanup authority.
        started = operations.start('emulator', {
          args: [
            '-avd',
            selection.avdName,
            ...(consolePort === undefined ? [] : ['-port', String(consolePort)]),
            '-memory',
            '2048',
            '-netdelay',
            'none',
            '-netspeed',
            'full',
            ...(visible ? [] : ['-no-window', '-no-audio']),
          ],
          detached: true,
          processPolicy: 'server',
          onOutput: (_stream, chunk) => {
            outputTail = (outputTail + chunk.toString('utf8')).slice(-16_000)
          },
          stdio: 'pipe',
          unref: true,
        })
        return started
      })
    } catch (error) {
      // A failed admission leaves the original intent quarantined, preserving successors.
      // If spawn already happened, ordinary physical cleanup still owns the captured child.
      launchOwnershipLost = started === undefined && !admitted
      throw error
    }
    if (started === undefined) {
      Errors.throwUnexpected('Android launch admission returned without capturing its child.')
    }
    await operations.onSpawnedBeforeCapture?.(started)
    captured = AndroidRecovery.capture(started, operations)
    await serialize(() => publishOwnership())
    const serial = await Time.pollUntil(async () => {
      captured = AndroidRecovery.capture(started!, operations, captured)
      await serialize(() => publishOwnership())
      const candidate = [...(await runningAvds(operations)).entries()]
        .find(([, name]) => name === selection.avdName)?.[0]
      if (candidate !== undefined && candidate !== leasedSerial) {
        if (serialLease !== undefined) {
          serialMismatch = true
          Errors.throwHostEnvironment(
            `Android AVD ${selection.avdName} changed serial while booting; its fences need recovery.`,
          )
        }
        serialLease = await acquireSerial(operations, candidate, selection.avdName, true, visible)
        leasedSerial = candidate
        await serialize(() => publishOwnership())
      }
      return candidate !== undefined && await isBooted(operations, candidate) ? candidate : undefined
    }, {
      intervalMs: operations.bootIntervalMs ?? 2_000,
      stop: () =>
        started?.error !== undefined
        || (started?.exitCode !== null && started?.exitCode !== undefined)
        || (started?.signalCode !== null && started?.signalCode !== undefined),
      timeoutMs: operations.bootTimeoutMs ?? BOOT_TIMEOUT_MS,
    })
    if (serial === undefined) {
      const logPath = Repo.resolvePath(`.artifacts/logs/agent-android/${selection.avdName}.log`)
      const logText = `${outputTail}\n${started.error?.message ?? ''}`
      await FS.mkdir(FS.dirname(logPath))
      await FS.writeText(logPath, logText)
      Errors.throwHostEnvironment(
        started.error !== undefined || started.exitCode !== null || started.signalCode !== null
          ? emulatorExitMessage(logText, logPath)
          : `Android emulator ${selection.avdName} did not boot within three minutes. Its log is ${logPath}.`,
      )
    }
    operations.write(
      `Android emulator: ${selection.avdName} (${serial}); ${visible ? 'viewer requested' : 'no window opened'}. `
        + `Ownership generation: ${retainedOwnership.id}.`,
    )
    await serialize(async () => {
      await refresh()
      await publishDevice('booted')
    })
    return {
      avdName: selection.avdName,
      autoStarted: true,
      serial,
      resources: owners,
      release: cleanup,
      refreshOwnership: () => serialize(refresh),
    }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      operations.writeError(
        `Android cleanup failed while preserving the startup failure: ${Errors.formatForLog(cleanupError)}`,
      )
    }
    throw error
  }
}

async function selectAvd(operations: AgentAndroidOperations): Promise<{
  avdName: string
  lease: MachineResourceLease
}> {
  const prefix = operations.avdPrefix ?? AVD_PREFIX
  if (!/^[A-Za-z0-9_]+$/u.test(prefix)) {
    Errors.throwUnexpected('Expected an Android fixture pool prefix using letters, numbers, and underscores.')
  }
  const pool = await operations.acquireResource({
    command: 'agent app-dev Android selection',
    name: operations.avdPrefix === undefined ? 'tao-agent-android-pool' : `tao-agent-android-pool:${prefix}`,
    repositoryRoot: Repo.getRoot(),
    waitTimeoutMs: 60_000,
  })
  try {
    const listed = await operations.run('emulator', { args: ['-list-avds'] })
    if (listed.error !== undefined || listed.exitCode !== 0) {
      Errors.throwHostEnvironment(`Could not list Android AVDs: ${listed.stderr.trim() || listed.error?.message}`)
    }
    const avds = listed.stdout.split(/\r?\n/u).map(name => name.trim()).filter(Boolean)
    const running = new Set((await runningAvds(operations)).values())
    for (let slot = 1; slot <= POOL_SIZE; slot++) {
      const avdName = `${prefix}${slot}`
      if (!avds.includes(avdName) || running.has(avdName)) {
        continue
      }
      const lease = await operations.tryAcquireResource({
        command: `agent app-dev Android AVD ${avdName}`,
        name: `android-avd:${avdName}`,
        repositoryRoot: Repo.getRoot(),
      })
      if (lease !== undefined) {
        return { avdName, lease }
      }
    }
    for (let slot = 1; slot <= POOL_SIZE; slot++) {
      const avdName = `${prefix}${slot}`
      if (avds.includes(avdName)) {
        continue
      }
      const lease = await operations.acquireResource({
        command: `agent app-dev Android AVD ${avdName}`,
        name: `android-avd:${avdName}`,
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      try {
        const created = await operations.run('avdmanager', {
          args: ['create', 'avd', '--name', avdName, '--package', SYSTEM_IMAGE, '--device', 'pixel'],
          stdin: 'no\n',
        })
        if (created.error !== undefined || created.exitCode !== 0) {
          Errors.throwHostEnvironment(`Could not create ${avdName}: ${created.stderr.trim() || created.error?.message}`)
        }
        operations.write(`Created reusable Android AVD ${avdName}.`)
        return { avdName, lease }
      } catch (error) {
        await lease.release()
        throw error
      }
    }
    Errors.throwHostEnvironment(`All ${POOL_SIZE} agent Android AVDs are busy; wait for one to finish.`)
  } finally {
    await pool.release()
  }
}

async function acquireSerial(
  operations: AgentAndroidOperations,
  serial: string,
  avdName: string,
  autoStarted: boolean,
  visible: boolean,
): Promise<MachineResourceLease> {
  return await operations.acquireResource({
    command: `agent app-dev Android AVD ${avdName} (${autoStarted ? 'auto-started' : 'borrowed'}, ${
      visible ? 'visible' : 'headless'
    })`,
    name: `android-emulator:${serial}`,
    repositoryRoot: Repo.getRoot(),
    waitTimeoutMs: 0,
  })
}

async function runningAvds(operations: AgentAndroidOperations): Promise<Map<string, string>> {
  const listed = await operations.run('adb', { args: ['devices'] })
  if (listed.error !== undefined || listed.exitCode !== 0) {
    Errors.throwHostEnvironment(`Could not list Android devices: ${listed.stderr.trim() || listed.error?.message}`)
  }
  const serials = listed.stdout.split(/\r?\n/u)
    .map(line => /^(emulator-\d+)\s+device\b/u.exec(line)?.[1])
    .filter((serial): serial is string => serial !== undefined)
  const avds = new Map<string, string>()
  for (const serial of serials) {
    const named = await operations.run('adb', { args: ['-s', serial, 'emu', 'avd', 'name'] })
    if (named.error !== undefined || named.exitCode !== 0) {
      continue
    }
    const name = named.stdout.split(/\r?\n/u).map(line => line.trim()).find(line => line.length > 0 && line !== 'OK')
    if (name !== undefined) {
      avds.set(serial, name)
    }
  }
  return avds
}

async function isBooted(operations: AgentAndroidOperations, serial: string): Promise<boolean> {
  const booted = await operations.run('adb', { args: ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'] })
  return booted.error === undefined && booted.exitCode === 0 && booted.stdout.trim() === '1'
}
