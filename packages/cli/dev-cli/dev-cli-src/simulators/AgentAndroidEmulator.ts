import { emulatorExitMessage } from '@expo-host/dev-loop/expo-runner/android'
import { CLI, Errors, FS, Repo, Time } from '@shared'
import { MachineLanes, type MachineResourceLease } from '@verification/MachineLanes'

const POOL_SIZE = 4
const AVD_PREFIX = 'Tao_Agent_Pixel_'
const SYSTEM_IMAGE = 'system-images;android-36;google_apis;arm64-v8a'
const BOOT_TIMEOUT_MS = 180_000

export type AgentAndroidOperations = {
  acquireResource: typeof MachineLanes.acquireResource
  run: typeof CLI.run
  start: typeof CLI.start
  tryAcquireResource: typeof MachineLanes.tryAcquireResource
  write: (message: string) => void
  writeError: (message: string) => void
}

export type AgentAndroidReservation = {
  avdName: string
  autoStarted: boolean
  serial: string
  release: () => Promise<void>
}

/** Keep each agent on one AVD, and never adopt a running developer emulator implicitly. */
export async function reserveAndroidEmulator(
  operations: AgentAndroidOperations,
  requestedSerial?: string,
  visible = false,
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
      return {
        avdName,
        autoStarted: false,
        serial: requestedSerial,
        release: async () => {
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
  let outputTail = ''
  try {
    started = operations.start('emulator', {
      args: [
        '-avd',
        selection.avdName,
        '-memory',
        '2048',
        '-netdelay',
        'none',
        '-netspeed',
        'full',
        ...(visible ? [] : ['-no-window', '-no-audio']),
      ],
      detached: true,
      onOutput: (_stream, chunk) => {
        outputTail = (outputTail + chunk.toString('utf8')).slice(-16_000)
      },
      stdio: 'pipe',
      unref: true,
    })
    const serial = await Time.pollUntil(async () => {
      const candidate = [...(await runningAvds(operations)).entries()]
        .find(([, name]) => name === selection.avdName)?.[0]
      if (candidate !== undefined && candidate !== leasedSerial) {
        await serialLease?.release()
        serialLease = await acquireSerial(operations, candidate, selection.avdName, true, visible)
        leasedSerial = candidate
      }
      return candidate !== undefined && await isBooted(operations, candidate) ? candidate : undefined
    }, {
      intervalMs: 2_000,
      stop: () =>
        started?.error !== undefined
        || (started?.exitCode !== null && started?.exitCode !== undefined)
        || (started?.signalCode !== null && started?.signalCode !== undefined),
      timeoutMs: BOOT_TIMEOUT_MS,
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
      `Android emulator: ${selection.avdName} (${serial}); ${visible ? 'viewer requested' : 'no window opened'}.`,
    )
    return {
      avdName: selection.avdName,
      autoStarted: true,
      serial,
      release: async () => {
        try {
          const stopped = await operations.run('adb', { args: ['-s', serial, 'emu', 'kill'] })
          if (stopped.error !== undefined || stopped.exitCode !== 0) {
            operations.writeError(
              `Could not stop owned Android emulator ${serial}: ${
                stopped.stderr.trim() || stopped.error?.message || 'unknown error'
              }`,
            )
            started?.kill('SIGTERM')
          } else {
            const exited = await Time.pollUntil(
              async () =>
                (started?.exitCode !== null || started?.signalCode !== null)
                  && !(await runningAvds(operations)).has(serial)
                  ? true
                  : undefined,
              { intervalMs: 250, timeoutMs: 30_000 },
            )
            if (exited !== true) {
              operations.writeError(`Android emulator ${serial} did not exit after the stop request.`)
              started?.kill('SIGTERM')
            }
          }
        } finally {
          await serialLease?.release()
          await selection.lease.release()
          await started?.closeOutput()
        }
      },
    }
  } catch (error) {
    started?.kill('SIGTERM')
    await started?.closeOutput()
    await serialLease?.release()
    await selection.lease.release()
    throw error
  }
}

async function selectAvd(operations: AgentAndroidOperations): Promise<{
  avdName: string
  lease: MachineResourceLease
}> {
  const pool = await operations.acquireResource({
    command: 'agent app-dev Android selection',
    name: 'tao-agent-android-pool',
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
      const avdName = `${AVD_PREFIX}${slot}`
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
      const avdName = `${AVD_PREFIX}${slot}`
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
