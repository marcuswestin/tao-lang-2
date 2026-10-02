import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, HCI, Platform, Repo } from '@shared'
import { MachineLanes, type MachineResourceLease } from '@verification/MachineLanes'
import { UiVisibility } from '@verification/UiVisibility'
import { type AgentAndroidReservation, reserveAndroidEmulator } from './AgentAndroidEmulator'

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
}

type ManagedAppDev = {
  childEnv: Platform.ProcessEnv
  onChild: (child: CLI.StartedCommand) => Promise<void>
  shouldStop: () => boolean
  onOutput: NonNullable<CLI.CommandSpec['onOutput']>
  onDevice?: (device: AgentAppDevDevice) => Promise<void>
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
  let child: CLI.StartedCommand | undefined
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
    androidSelected = android ? await reserveAndroidEmulator(operations, requestedSerial, androidVisible) : undefined
    if (androidSelected !== undefined && managed !== undefined) {
      const owner = await MachineResources.readOwner({ name: `android-avd:${androidSelected.avdName}` })
      await managed?.onDevice?.({
        platform: 'android',
        id: androidSelected.serial,
        owned: androidSelected.autoStarted,
        state: 'booted',
        generation: owner?.retention === undefined ? undefined : owner.id,
      })
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
    }
    child = operations.start(Repo.resolvePath('tao'), {
      args: ['dev', ...forwarded],
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
      await androidSelected?.release()
      if (androidSelected !== undefined) {
        await managed?.onDevice?.({
          platform: 'android',
          id: androidSelected.serial,
          owned: androidSelected.autoStarted,
          state: 'released',
        })
      }
    } finally {
      if (selected !== undefined) {
        let shutdownProved = true
        try {
          if (selected.autoSelected && selected.bootedHere) {
            const shutdown = await operations.run('xcrun', {
              args: ['simctl', 'shutdown', selected.simulator.udid],
            })
            if (shutdown.exitCode !== 0 || shutdown.error !== undefined) {
              shutdownProved = false
              operations.writeError(
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
          operations.writeError(Errors.formatForUser(error))
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
              platform: 'ios',
              id: selected.simulator.udid,
              owned: selected.autoSelected && selected.bootedHere,
              state: 'released',
            })
          } else {
            if (selected.retained === undefined) {
              await (operations.retainResources ?? MachineResources.retain)({
                owners: [selected.lease.owner],
                processes: [],
                quarantined: true,
                reason: `Shutdown of owned simulator ${selected.simulator.udid} was not proved.`,
              })
            }
            await managed?.onDevice?.({
              platform: 'ios',
              id: selected.simulator.udid,
              owned: true,
              state: 'retained',
              generation: selected.retained?.id,
            })
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
}> {
  const pool = await operations.acquireResource({
    command: 'agent app-dev simulator selection',
    name: 'tao-agent-simulator-pool',
    repositoryRoot: Repo.getRoot(),
    waitTimeoutMs: 60_000,
  })
  try {
    const devices = await listSimulators(operations)
    if (devices.length === 0) {
      Errors.throwHostEnvironment('No available iOS simulator or iOS runtime was found.')
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
  try {
    const bootedHere = simulator.state !== 'Booted'
    if (managed !== undefined && autoSelected && bootedHere) {
      retained = await (operations.retainResources ?? MachineResources.retain)({
        owners: [lease.owner],
        processes: [],
        quarantined: true,
        reason: `Owned simulator ${simulator.udid} requires verified shutdown before release.`,
      })
    }
    await managed?.onDevice?.({
      platform: 'ios',
      id: simulator.udid,
      owned: autoSelected && bootedHere,
      state: 'reserved',
      generation: retained?.id,
    })
    if (bootedHere) {
      const boot = await operations.run('xcrun', { args: ['simctl', 'boot', simulator.udid] })
      if (boot.exitCode !== 0 || boot.error !== undefined) {
        Errors.throwHostEnvironment(`Could not boot ${simulator.name}: ${boot.stderr.trim() || boot.error?.message}`)
      }
    }
    await managed?.onDevice?.({
      platform: 'ios',
      id: simulator.udid,
      owned: autoSelected && bootedHere,
      state: 'booted',
      generation: retained?.id,
    })
    return { autoSelected, bootedHere, lease, simulator, retained }
  } catch (error) {
    if (retained === undefined) {
      await lease.release()
    } else {
      await managed?.onDevice?.({
        platform: 'ios',
        id: simulator.udid,
        owned: true,
        state: 'retained',
        generation: retained.id,
      })
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
