import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, HCI, Platform, Repo } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { MachineLanes, type MachineResourceLease } from '@verification/MachineLanes'
import { UiVisibility } from '@verification/UiVisibility'
import type { PrivateIosPreparation, PrivateIosSelection } from '../dev-loop/ManagedLoopAcceptanceIosRuntime'
import {
  type AgentAndroidOperations,
  type AgentAndroidReservation,
  reserveAndroidEmulator,
} from './AgentAndroidEmulator'

type Simulator = {
  deviceTypeIdentifier?: string
  name: string
  state?: string
  udid: string
  runtime: string
}

const POOL_SIZE = 6
const MANAGED_NAME = /^Tao Agent iPhone ([1-6])$/u

export type AgentAppDevOperations = {
  acquireResource: typeof MachineLanes.acquireResource
  onSignal: typeof Platform.onProcessSignal
  run: typeof CLI.run
  start: typeof CLI.start
  tryAcquireResource: typeof MachineLanes.tryAcquireResource
  write: (message: string) => void
  writeError: (message: string) => void
  retainResources?: typeof MachineResources.retain
  recoverResources?: typeof MachineResources.recoverRetained
  readResourceOwner?: typeof MachineResources.readOwner
  /** Invocation-owned host fixtures select a private pool and reserve its launch identity. */
  avdPrefix?: AgentAndroidOperations['avdPrefix']
  launchReservation?: AgentAndroidOperations['launchReservation']
  withCurrentOwners?: typeof MachineResources.withCurrentOwners
  /** Fixed host fixtures mint isolated devices; normal selection keeps its existing fallback. */
  privateIos?: PrivateIosSelection
  prepareOwnedIosRuntime?: (input: PrivateIosPreparation) => Promise<void>
}

const liveOperations: AgentAppDevOperations = {
  acquireResource: MachineLanes.acquireResource,
  onSignal: Platform.onProcessSignal,
  run: CLI.run,
  start: CLI.start,
  tryAcquireResource: MachineLanes.tryAcquireResource,
  write: HCI.writeLine,
  writeError: HCI.writeErrorLine,
}

export type AgentAppDevDevice = {
  platform: 'ios' | 'android'
  id: string
  owned: boolean
  state: 'reserved' | 'booted' | 'released' | 'retained'
  generation?: string
  avdName?: string
  consolePort?: number
  resources?: readonly MachineResourceOwner[]
  holder?: TrackedProcess
}

/** Assertion-only view; the reservation holder remains the sole release owner. */
export type AgentAppDevReservation = Readonly<{
  platform: 'ios' | 'android'
  id: string
  resources: readonly MachineResourceOwner[]
  assertCurrent: () => Promise<void>
}>

export function appDevReservation(
  platform: AgentAppDevReservation['platform'],
  id: string,
  resources: readonly MachineResourceOwner[],
  readOwner: typeof MachineResources.readOwner = MachineResources.readOwner,
): AgentAppDevReservation {
  const snapshot = structuredClone(resources).map(owner => Object.freeze(owner))
  return Object.freeze({
    platform,
    id,
    resources: Object.freeze(snapshot),
    assertCurrent: async () => {
      for (const expected of snapshot) {
        const current = await readOwner({ name: expected.name })
        if (
          current?.id !== expected.id || current.pid !== expected.pid
          || current.processStartedAt !== expected.processStartedAt
          || current.repositoryRoot !== expected.repositoryRoot
        ) {
          Errors.throwHostEnvironment(`Managed target resource '${expected.name}' changed ownership.`)
        }
        if (
          expected.processStartedAt !== undefined
          && ProcessTree.identities([expected.pid]).get(expected.pid)?.startedAt !== expected.processStartedAt
        ) {
          Errors.throwHostEnvironment(`Managed target resource '${expected.name}' lost its process identity.`)
        }
      }
    },
  })
}

/** A gated supervisor and worker captured before the worker may dispatch native input. */
export type ManagedChildCapture = Readonly<{
  version: 1
  root: TrackedProcess
  members: readonly TrackedProcess[]
}>

/** Shutdown publication is separate from permission to launch application work. */
export type ManagedCleanupChild = (
  child: CLI.StartedCommand,
  capture: ManagedChildCapture,
  reservation: AgentAppDevReservation,
) => Promise<void>

type ManagedAppDev = {
  childEnv: Platform.ProcessEnv
  onChild: (child: CLI.StartedCommand, capture?: ManagedChildCapture) => Promise<void>
  onCleanupChild?: ManagedCleanupChild
  shouldStop: () => boolean
  onOutput: NonNullable<CLI.CommandSpec['onOutput']>
  onDevice?: (device: AgentAppDevDevice) => Promise<void>
  onReservation?: (reservation: AgentAppDevReservation) => Promise<void>
  /** The owned Android producer supplies this authority separately from assertion-only reservations. */
  onAndroidOwnershipRefresh?: (refresh: () => Promise<void>) => Promise<void>
  beforeTargetCleanup?: () => Promise<void>
}

function reportAppDevSecondaryFailure(operations: Pick<AgentAppDevOperations, 'writeError'>, message: string): void {
  try {
    void Promise.resolve(operations.writeError(message)).catch(() => {})
  } catch { /* Output failure must not bypass retention or replace the primary lifecycle failure. */ }
}

/** Agent app-dev owns its device reservations for the lifetime of its dev loop. */
export async function runAgentAppDev(
  args: readonly string[],
  operations: AgentAppDevOperations = liveOperations,
  managed?: ManagedAppDev,
): Promise<number> {
  if (managed !== undefined) {
    operations = {
      ...operations,
      write: message => managed.onOutput('stdout', Buffer.from(`${message}\n`)),
      writeError: message => managed.onOutput('stderr', Buffer.from(`${message}\n`)),
    }
  }
  const forwarded: string[] = []
  let iosVisible = false
  let androidVisible = false
  let browserVisible = false
  let requestedUdid: string | undefined
  let requestedSerial: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--show-simulator') {
      iosVisible = true
    } else if (arg === '--show-emulator') {
      androidVisible = true
    } else if (arg === '--show-browser') {
      browserVisible = true
    } else if (arg === '--simulator') {
      requestedUdid = args[++index]
      if (requestedUdid === undefined || requestedUdid.startsWith('-')) {
        Errors.throwHostEnvironment('Usage: app-dev [path] --ios [--simulator <udid>] [--show-simulator]')
      }
    } else if (arg === '--emulator') {
      requestedSerial = args[++index]
      if (requestedSerial === undefined || !/^emulator-\d+$/u.test(requestedSerial)) {
        Errors.throwHostEnvironment('Usage: app-dev [path] --android [--emulator <serial>] [--show-emulator]')
      }
    } else {
      forwarded.push(arg)
    }
  }
  const ios = forwarded.includes('--ios')
  const android = forwarded.includes('--android')
  if (!ios && (iosVisible || requestedUdid !== undefined)) {
    Errors.throwHostEnvironment('--simulator and --show-simulator require --ios.')
  }
  if (!android && (androidVisible || requestedSerial !== undefined)) {
    Errors.throwHostEnvironment('--emulator and --show-emulator require --android.')
  }

  let selected: Awaited<ReturnType<typeof reserveSimulator>> | undefined
  const warnings = UiVisibility.warningsForCommand('app-dev', args)
  for (const warning of warnings) {
    operations.writeError(`WARNING: ${warning}`)
  }
  let androidSelected: AgentAndroidReservation | undefined
  let borrowedAndroidDevice: AgentAppDevDevice | undefined
  let child: CLI.StartedCommand | undefined
  let preparationRefusal: Errors.HostEnvironmentError | undefined
  const removeSignals = (['SIGHUP', 'SIGINT', 'SIGTERM'] as const).map(signal =>
    operations.onSignal(signal, () => child?.kill(signal === 'SIGHUP' ? 'SIGTERM' : signal))
  )
  try {
    if (managed?.shouldStop()) {
      return 0
    }
    selected = ios ? await reserveSimulator(operations, requestedUdid, managed) : undefined
    if (managed?.shouldStop()) {
      return 0
    }
    androidSelected = android
      ? await reserveAndroidEmulator(
        operations,
        requestedSerial,
        androidVisible,
        managed === undefined ? undefined : async device => {
          if (!device.owned) {
            borrowedAndroidDevice = structuredClone(device)
          }
          await managed?.onDevice?.(device)
          if (device.state === 'booted' && device.resources !== undefined) {
            await managed?.onReservation?.(
              appDevReservation('android', device.id, device.resources, operations.readResourceOwner),
            )
          }
        },
        managed?.shouldStop,
      )
      : undefined
    if (androidSelected !== undefined && managed !== undefined) {
      if (androidSelected.refreshOwnership !== undefined) {
        await managed.onAndroidOwnershipRefresh?.(androidSelected.refreshOwnership)
      }
      await managed?.onReservation?.(
        appDevReservation('android', androidSelected.serial, androidSelected.resources(), operations.readResourceOwner),
      )
    }
    if (managed?.shouldStop()) {
      return 0
    }
    if (selected !== undefined) {
      operations.write(
        `iOS simulator: ${selected.simulator.name} (${selected.simulator.udid}); ${
          iosVisible ? 'viewer requested' : 'no viewer opened'
        }.`,
      )
      if (
        operations.privateIos !== undefined && selected.autoSelected && selected.bootedHere
        && operations.prepareOwnedIosRuntime !== undefined
      ) {
        try {
          await operations.prepareOwnedIosRuntime({
            device: selected.device,
            reservation: appDevReservation(
              'ios',
              selected.simulator.udid,
              [selected.retained ?? selected.lease.owner],
              operations.readResourceOwner,
            ),
            shouldStop: managed?.shouldStop ?? (() => false),
            onChild: managed?.onChild,
            onCleanupChild: managed?.onCleanupChild,
          })
        } catch (error) {
          if (error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true) {
            preparationRefusal = error
          }
          throw error
        }
        if (managed?.shouldStop()) {
          return 0
        }
      }
    }
    child = operations.start(Repo.resolvePath('tao'), {
      args: ['run', ...forwarded],
      env: {
        TAO_AGENT_SIMULATOR_QUIET: '1',
        TAO_AGENT_SIMULATOR_UDID: selected?.simulator.udid ?? '',
        TAO_AGENT_SIMULATOR_VISIBLE: iosVisible ? '1' : '0',
        TAO_AGENT_ANDROID_QUIET: '1',
        TAO_AGENT_ANDROID_SERIAL: androidSelected?.serial ?? '',
        TAO_AGENT_BROWSER_QUIET: '1',
        TAO_AGENT_BROWSER_VISIBLE: browserVisible ? '1' : '0',
        TAO_DEV_LOOP_WORKER_CREDENTIALS: '',
        TAO_DEV_LOOP_SELECTION_ONLY: '',
        ...managed?.childEnv,
      },
      processPolicy: 'server',
      detached: managed !== undefined,
      stdio: managed === undefined ? 'inherit' : 'pipe',
      onOutput: managed?.onOutput,
    })
    await managed?.onChild(child)
    const result = await child.waitForClose()
    return result.exitCode ?? 1
  } finally {
    for (const warning of warnings) {
      operations.writeError(`WARNING: ${warning}`)
    }
    for (const remove of removeSignals) {
      remove()
    }
    try {
      await managed?.beforeTargetCleanup?.()
      await androidSelected?.release()
      if (androidSelected !== undefined && !androidSelected.autoStarted && managed !== undefined) {
        if (
          borrowedAndroidDevice === undefined || borrowedAndroidDevice.id !== androidSelected.serial
          || borrowedAndroidDevice.avdName !== androidSelected.avdName || borrowedAndroidDevice.owned
        ) {
          Errors.throwUnexpected('Expected the exact selected borrowed Android reservation publication.')
        }
        await managed?.onDevice?.({
          ...borrowedAndroidDevice,
          state: 'released',
        })
      }
    } finally {
      if (selected !== undefined && preparationRefusal) {
        try {
          await managed?.onDevice?.({ ...selected.device, state: 'retained' })
        } catch (publicationError) {
          reportAppDevSecondaryFailure(
            operations,
            `Additional iOS retained publication failure: ${Errors.formatForUser(publicationError).slice(0, 2048)}`,
          )
        }
        throw preparationRefusal
      }
      if (selected !== undefined) {
        await managed?.beforeTargetCleanup?.()
        let shutdownProved = true
        try {
          if (selected.autoSelected && selected.bootedHere) {
            const shutdown = await operations.run('xcrun', {
              args: ['simctl', 'shutdown', selected.simulator.udid],
            })
            if (shutdown.exitCode !== 0 || shutdown.error !== undefined) {
              shutdownProved = false
              reportAppDevSecondaryFailure(
                operations,
                `Could not shut down owned simulator ${selected.simulator.udid}: ${
                  shutdown.stderr.trim() || shutdown.error?.message || 'unknown error'
                }`,
              )
            }
            shutdownProved &&= (await listSimulators(operations)).some(device =>
              device.udid === selected!.simulator.udid && device.state === 'Shutdown'
            )
          }
        } catch (error) {
          shutdownProved = false
          reportAppDevSecondaryFailure(operations, Errors.formatForUser(error))
        } finally {
          if (shutdownProved) {
            if (selected.retained !== undefined) {
              await (operations.recoverResources ?? MachineResources.recoverRetained)({
                generation: selected.retained.id,
                name: selected.lease.owner.name,
                shutdown: async () => true,
              })
            } else {
              await selected.lease.release()
            }
            await managed?.onDevice?.({
              ...selected.device,
              state: 'released',
            })
          } else {
            if (selected.retained === undefined) {
              selected.retained = await (operations.retainResources ?? MachineResources.retain)({
                owners: [selected.lease.owner],
                processes: [],
                quarantined: true,
                reason: `Shutdown of owned simulator ${selected.simulator.udid} was not proved.`,
              })
            }
            try {
              await managed?.onDevice?.({
                ...selected.device,
                state: 'retained',
                generation: selected.retained.id,
                resources: [selected.retained],
              })
            } catch (publicationError) {
              reportAppDevSecondaryFailure(
                operations,
                `Additional iOS retained publication failure: ${Errors.formatForUser(publicationError).slice(0, 2048)}`,
              )
            }
          }
        }
        if (!shutdownProved) {
          Errors.throwHostEnvironment(
            `Owned simulator ${selected.simulator.udid} remains quarantined because shutdown was not proved.`,
          )
        }
      }
    }
  }
}

async function reserveSimulator(
  operations: AgentAppDevOperations,
  requestedUdid?: string,
  managed?: ManagedAppDev,
): Promise<{
  bootedHere: boolean
  lease: MachineResourceLease
  autoSelected: boolean
  simulator: Simulator
  retained?: MachineResourceOwner
  device: AgentAppDevDevice
}> {
  const pool = await operations.acquireResource({
    command: 'agent app-dev simulator selection',
    name: operations.privateIos === undefined
      ? 'tao-agent-simulator-pool'
      : `tao-agent-simulator-pool:${operations.privateIos.namePrefix}`,
    repositoryRoot: Repo.getRoot(),
    waitTimeoutMs: 60_000,
  })
  try {
    const devices = await listSimulators(operations)
    if (devices.length === 0) {
      Errors.throwHostEnvironment('No available iOS simulator or iOS runtime was found.')
    }
    if (operations.privateIos !== undefined && requestedUdid === undefined) {
      const privateIos = operations.privateIos
      if (!/^Tao Managed [0-9a-f-]{36}_[0-9a-f-]{36}_$/iu.test(privateIos.namePrefix)) {
        Errors.throwHostEnvironment('Private iOS selection requires its fixed invocation prefix.')
      }
      const reuse = await privateIos.reuse?.()
      if (reuse !== undefined) {
        const simulator = devices.find(device =>
          device.udid === reuse.id && device.name === reuse.name
          && device.runtime === reuse.runtime && device.deviceTypeIdentifier === reuse.type
          && device.state === 'Shutdown'
        )
        if (simulator === undefined) {
          Errors.throwHostEnvironment('Private iOS reuse lost exact minted shutdown proof.')
        }
        const lease = await operations.acquireResource({
          name: `ios-simulator:${reuse.id}`,
          command: 'private iOS restart',
          repositoryRoot: Repo.getRoot(),
          waitTimeoutMs: 0,
        })
        return await bootReservedSimulator(operations, simulator, lease, true, managed)
      }
      if (devices.some(device => device.name.startsWith(privateIos.namePrefix))) {
        Errors.throwHostEnvironment('Private iOS selection refuses preexisting names; no name-only adoption.')
      }
      const template = devices.find(device =>
        device.name.includes('iPhone') && device.deviceTypeIdentifier !== undefined
      )
      if (template?.deviceTypeIdentifier === undefined) {
        Errors.throwHostEnvironment('Private iOS selection requires an available iPhone runtime/type.')
      }
      const intent = {
        name: `${privateIos.namePrefix}1`,
        type: template.deviceTypeIdentifier,
        runtime: template.runtime,
      }
      await privateIos.beforeCreate(intent)
      const created = await operations.run('xcrun', {
        args: ['simctl', 'create', intent.name, intent.type, intent.runtime],
      })
      if (created.exitCode !== 0 || created.error !== undefined) {
        Errors.throwHostEnvironment('Private iOS creation did not complete successfully.')
      }
      const id = created.stdout.trim()
      await privateIos.afterCreate({ ...intent, id })
      const simulator = { ...template, name: intent.name, udid: id, state: 'Shutdown' }
      const lease = await operations.acquireResource({
        name: `ios-simulator:${id}`,
        command: 'private iOS app-dev',
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      return await bootReservedSimulator(operations, simulator, lease, true, managed)
    }
    if (requestedUdid !== undefined) {
      const simulator = devices.find(device => device.udid === requestedUdid)
      if (simulator === undefined) {
        Errors.throwHostEnvironment(`Requested simulator ${requestedUdid} is unavailable.`)
      }
      const lease = await operations.acquireResource({
        command: 'agent app-dev',
        name: `ios-simulator:${simulator.udid}`,
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      return bootReservedSimulator(operations, simulator, lease, false, managed)
    }

    for (const simulator of devices) {
      if (!MANAGED_NAME.test(simulator.name) || simulator.state !== 'Shutdown') {
        continue
      }
      const lease = await operations.tryAcquireResource({
        command: 'agent app-dev',
        name: `ios-simulator:${simulator.udid}`,
        repositoryRoot: Repo.getRoot(),
      })
      if (lease !== undefined) {
        return bootReservedSimulator(operations, simulator, lease, true, managed)
      }
    }

    // A shutdown device may already carry Expo Go or Companion. Borrow it before creating one.
    for (const simulator of devices) {
      if (
        MANAGED_NAME.test(simulator.name) || simulator.state !== 'Shutdown'
        || !simulator.name.includes('iPhone')
      ) {
        continue
      }
      const lease = await operations.tryAcquireResource({
        command: 'agent app-dev',
        name: `ios-simulator:${simulator.udid}`,
        repositoryRoot: Repo.getRoot(),
      })
      if (lease !== undefined) {
        return bootReservedSimulator(operations, simulator, lease, true, managed)
      }
    }

    const occupied = new Set(devices.map(device => MANAGED_NAME.exec(device.name)?.[1]).filter(Boolean))
    const slot = Array.from({ length: POOL_SIZE }, (_, index) => String(index + 1))
      .find(number => !occupied.has(number))
    if (slot === undefined) {
      Errors.throwHostEnvironment(
        `All ${POOL_SIZE} managed agent simulators are busy or booted outside an agent session. `
          + 'Stop an unused Tao Agent iPhone simulator or request an explicit --simulator <udid>.',
      )
    }
    const template = devices.find(device =>
      device.name.includes('iPhone') && device.deviceTypeIdentifier !== undefined && !MANAGED_NAME.test(device.name)
    )
    if (template?.deviceTypeIdentifier === undefined) {
      Errors.throwHostEnvironment('No available iPhone simulator type can seed an agent simulator.')
    }
    const name = `Tao Agent iPhone ${slot}`
    const created = await operations.run('xcrun', {
      args: ['simctl', 'create', name, template.deviceTypeIdentifier, template.runtime],
    })
    if (created.exitCode !== 0 || created.error !== undefined) {
      Errors.throwHostEnvironment(`Could not create ${name}: ${created.stderr.trim() || created.error?.message}`)
    }
    const udid = created.stdout.trim()
    if (udid.length === 0) {
      Errors.throwHostEnvironment(`simctl created ${name} but did not report its UDID; inspect it before retrying.`)
    }
    const simulator = { ...template, name, state: 'Shutdown', udid }
    const lease = await operations.acquireResource({
      command: 'agent app-dev',
      name: `ios-simulator:${udid}`,
      repositoryRoot: Repo.getRoot(),
      waitTimeoutMs: 0,
    })
    operations.write(`Created reusable ${name} (${udid}); CoreSimulator stores it outside this checkout.`)
    return bootReservedSimulator(operations, simulator, lease, true, managed)
  } finally {
    await pool.release()
  }
}

async function bootReservedSimulator(
  operations: AgentAppDevOperations,
  simulator: Simulator,
  lease: MachineResourceLease,
  autoSelected: boolean,
  managed?: ManagedAppDev,
) {
  let retained: MachineResourceOwner | undefined
  let reservedDevice: AgentAppDevDevice | undefined
  try {
    const bootedHere = simulator.state !== 'Booted'
    if (managed !== undefined) {
      retained = await (operations.retainResources ?? MachineResources.retain)({
        owners: [lease.owner],
        processes: [],
        quarantined: true,
        reason: `Managed simulator ${simulator.udid} requires verified driver cleanup${
          autoSelected && bootedHere ? ' and shutdown' : ''
        } before release.`,
      })
    }
    reservedDevice = {
      platform: 'ios',
      id: simulator.udid,
      owned: autoSelected && bootedHere,
      state: 'reserved',
      generation: retained?.id,
      resources: [retained ?? lease.owner],
      holder: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    }
    await managed?.onDevice?.(structuredClone(reservedDevice))
    if (bootedHere) {
      const boot = await operations.run('xcrun', { args: ['simctl', 'boot', simulator.udid] })
      if (boot.exitCode !== 0 || boot.error !== undefined) {
        Errors.throwHostEnvironment(`Could not boot ${simulator.name}: ${boot.stderr.trim() || boot.error?.message}`)
      }
    }
    const device: AgentAppDevDevice = {
      ...reservedDevice,
      state: 'booted',
    }
    await managed?.onDevice?.(structuredClone(device))
    await managed?.onReservation?.(
      appDevReservation('ios', simulator.udid, [retained ?? lease.owner], operations.readResourceOwner),
    )
    return { autoSelected, bootedHere, lease, simulator, retained, device }
  } catch (error) {
    if (retained === undefined) {
      await lease.release()
    } else {
      try {
        if (reservedDevice !== undefined) {
          await managed?.onDevice?.({ ...reservedDevice, state: 'retained' })
        }
      } catch (publicationError) {
        reportAppDevSecondaryFailure(
          operations,
          `Additional iOS retained publication failure: ${Errors.formatForUser(publicationError).slice(0, 2048)}`,
        )
      }
    }
    throw error
  }
}

async function listSimulators(operations: AgentAppDevOperations): Promise<Simulator[]> {
  const listed = await operations.run('xcrun', { args: ['simctl', 'list', 'devices', '--json', 'available'] })
  if (listed.exitCode !== 0 || listed.error !== undefined) {
    Errors.throwHostEnvironment(`Could not list iOS simulators: ${listed.stderr.trim() || listed.error?.message}`)
  }
  let parsed: { devices?: Record<string, Omit<Simulator, 'runtime'>[]> }
  try {
    parsed = JSON.parse(listed.stdout) as typeof parsed
  } catch {
    Errors.throwHostEnvironment('simctl returned invalid simulator inventory JSON.')
  }
  return Object.entries(parsed.devices ?? {})
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, devices]) => devices.map(device => ({ ...device, runtime })))
    .filter(device => device.udid.length > 0 && device.name.length > 0)
}
