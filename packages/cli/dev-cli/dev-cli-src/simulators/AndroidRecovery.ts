import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, Platform, ProcessTree, Time, type TrackedProcess } from '@shared'
import { readManagedAndroidRecoveryCustody } from '../dev-loop/DevLoopStore'

type ProcessOperations =
  & Pick<
    typeof ProcessTree,
    'descendants' | 'identities' | 'isGroupAlive' | 'processGroupOf' | 'signalTracked'
  >
  & Partial<Pick<typeof ProcessTree, 'groupMembers'>>

export type AndroidRecoveryOperations = {
  processTree?: ProcessOperations
  registryRoot?: string
  shutdownTimeoutMs?: number
  retainResources?: typeof MachineResources.retain
  recoverResources?: typeof MachineResources.recoverRetained
  readOwner?: typeof MachineResources.readOwner
  readManagedCustody?: typeof readManagedAndroidRecoveryCustody
  processIsAlive?: (pid: number) => boolean
}

type Capture = {
  processes: TrackedProcess[]
  uncertain: boolean
  rootPid?: number
}

const SHUTDOWN_TIMEOUT_MS = 30_000

function capture(started: CLI.StartedCommand, operations: AndroidRecoveryOperations, previous?: Capture): Capture {
  const state: Capture = previous ?? { processes: [], rootPid: started.pid, uncertain: false }
  if (started.pid === undefined) {
    state.uncertain ||= started.error === undefined
    return state
  }
  const tree = operations.processTree ?? ProcessTree
  try {
    const root = tree.identities([started.pid]).get(started.pid)
    if (root === undefined) {
      state.uncertain ||= state.processes.length === 0
      return state
    }
    const expected = state.processes.find(process => process.pid === started.pid)
    if (expected !== undefined && expected.startedAt !== root.startedAt) {
      state.uncertain = true
      return state
    }
    state.uncertain ||= tree.processGroupOf(started.pid) !== started.pid
    for (const process of [root, ...tree.descendants(started.pid)]) {
      if (!state.processes.some(expected => expected.pid === process.pid && expected.startedAt === process.startedAt)) {
        state.processes.push(process)
      }
    }
  } catch {
    state.uncertain = true
  }
  return state
}

function survivors(state: Capture, operations: AndroidRecoveryOperations): TrackedProcess[] | undefined {
  const tree = operations.processTree ?? ProcessTree
  try {
    const identities = tree.identities(state.processes.map(process => process.pid))
    const alive: TrackedProcess[] = []
    for (const expected of state.processes) {
      const current = identities.get(expected.pid)
      if (current === undefined && Platform.processIsAlive(expected.pid)) {
        return undefined
      }
      if (current?.startedAt === expected.startedAt) {
        alive.push(current)
      }
    }
    return alive
  } catch {
    return undefined
  }
}

function treeStopped(state: Capture, operations: AndroidRecoveryOperations): boolean {
  if (state.uncertain) {
    return false
  }
  const alive = survivors(state, operations)
  if (alive === undefined || alive.length > 0) {
    return false
  }
  try {
    return state.rootPid === undefined || !(operations.processTree ?? ProcessTree).isGroupAlive(state.rootPid)
  } catch {
    return false
  }
}

/** bounded keeps every host request and authoritative child-close wait inside the shutdown budget. */
async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function ownsSerial(
  serial: string,
  avdName: string,
  state: Capture,
  operations: AndroidRecoveryOperations & { run: typeof CLI.run },
): Promise<boolean> {
  const port = /^emulator-(\d+)$/u.exec(serial)?.[1]
  const root = state.processes.find(process => process.pid === state.rootPid)
  if (port === undefined || root === undefined) {
    return false
  }
  const tree = operations.processTree ?? ProcessTree
  const rootAlive = () => tree.identities([root.pid]).get(root.pid)?.startedAt === root.startedAt
  try {
    if (!rootAlive()) {
      return false
    }
    const timeoutMs = operations.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS
    const spec = { processPolicy: 'test', timeoutMs } as const
    const named = await bounded(
      operations.run('adb', {
        ...spec,
        args: ['-s', serial, 'emu', 'avd', 'name'],
      }),
      timeoutMs,
    )
    const name = named?.stdout.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '' && line !== 'OK')
    if (named?.error !== undefined || named?.exitCode !== 0 || name !== avdName) {
      return false
    }
    // The serial is a reusable console port. ADB's AVD name alone cannot bind it to our child.
    const listeners = await bounded(
      operations.run('lsof', {
        ...spec,
        args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'],
      }),
      timeoutMs,
    )
    if (listeners?.error !== undefined || listeners?.exitCode !== 0) {
      return false
    }
    const pids = [
      ...new Set(
        listeners.stdout.split(/\r?\n/u).flatMap(line => {
          const pid = /^p(\d+)$/u.exec(line)?.[1]
          return pid === undefined ? [] : [Number(pid)]
        }),
      ),
    ]
    const current = tree.identities(pids)
    return pids.length > 0 && rootAlive()
      && pids.every(pid =>
        state.processes.some(expected => expected.pid === pid && expected.startedAt === current.get(pid)?.startedAt)
      )
  } catch {
    return false
  }
}

async function stop(
  options: AndroidRecoveryOperations & {
    avdName: string
    capture: Capture
    owners: MachineResourceOwner[]
    run: typeof CLI.run
    serial?: string
    started: CLI.StartedCommand
    writeError: (message: string) => void
    onRetained?: (owner: MachineResourceOwner) => Promise<void>
  },
): Promise<boolean> {
  const state = capture(options.started, options, options.capture)
  const timeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS
  let closed = false
  const closing = options.started.waitForClose().then(() => {
    closed = true
  }).catch(() => {})
  const noSpawn = () =>
    closed && options.started.pid === undefined && options.started.error !== undefined
    && state.rootPid === undefined && state.processes.length === 0
  const wait = () =>
    Time.pollUntil(() => noSpawn() || (closed && treeStopped(state, options)) ? true : undefined, {
      intervalMs: Math.min(100, Math.max(1, timeoutMs / 5)),
      timeoutMs,
    })
  if (options.serial !== undefined && await ownsSerial(options.serial, options.avdName, state, options)) {
    await bounded(
      options.run('adb', {
        args: ['-s', options.serial, 'emu', 'kill'],
        processPolicy: 'test',
        timeoutMs,
      }).catch(() => undefined),
      timeoutMs,
    )
    if (await wait() === true) {
      await closing
      return true
    }
  }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    capture(options.started, options, state)
    try {
      const tree = options.processTree ?? ProcessTree
      tree.signalTracked(state.processes, signal)
      // ChildProcess.kill is safe while its own close event is pending; after close the PID
      // may have been reused, so only the captured start identities can authorize a signal.
      const root = state.processes.find(process => process.pid === state.rootPid)
      if (!closed && root !== undefined && tree.identities([root.pid]).get(root.pid)?.startedAt === root.startedAt) {
        options.started.kill(signal)
      }
    } catch {
      state.uncertain = true
    }
    if (await wait() === true) {
      await closing
      return true
    }
  }
  const alive = survivors(state, options)
  let quarantined = state.uncertain || alive === undefined || alive.length === 0
  try {
    // A live group with no captured survivor is an unknown descendant, never release proof.
    quarantined ||= alive?.length === 0 && state.rootPid !== undefined
      && (options.processTree ?? ProcessTree).isGroupAlive(state.rootPid)
  } catch {
    quarantined = true
  }
  const retained = await Promise.resolve().then(() =>
    (options.retainResources ?? MachineResources.retain)({
      owners: options.owners,
      processes: alive ?? [],
      processGroupPid: state.rootPid,
      quarantined,
      reason: `Android emulator ${options.avdName} shutdown was not confirmed.`,
      registryRoot: options.registryRoot,
    })
  ).catch(error =>
    Errors.throwHostEnvironment(
      `Could not retain Android emulator ${options.avdName} fences: ${Errors.asError(error).message}`,
      { cause: error, details: { owners: options.owners, processes: alive ?? [], quarantined } },
    )
  )
  options.writeError(
    `Android emulator ${options.avdName} shutdown is unproved; AVD and serial fences remain ${
      quarantined ? 'quarantined' : 'retained'
    }. Recovery generation: ${retained.id}. Run ./agent unsandboxed android recover --avd ${options.avdName} --generation ${retained.id}.`,
  )
  await options.onRetained?.(retained)
  return false
}

async function recover(avdName: string, generation: string, operations: AndroidRecoveryOperations = {}): Promise<void> {
  const tree = operations.processTree ?? ProcessTree
  await (operations.recoverResources ?? MachineResources.recoverRetained)({
    generation,
    name: `android-avd:${avdName}`,
    registryRoot: operations.registryRoot,
    shutdown: async owner => {
      const retention = owner.retention
      if (
        retention === undefined || retention.ownershipRefusal !== undefined || retention.quarantined
        || retention.processes.length === 0
      ) {
        Errors.throwHostEnvironment(
          `Android emulator ${avdName} generation ${generation} is quarantined: ${
            retention?.reason ?? 'missing process identity'
          }. `
            + `Captured process group: ${retention?.processGroupPid ?? 'unknown'}. `
            + 'Run ./agent unsandboxed processes list to investigate surviving descendants; retain these fences until their shutdown is proved.',
        )
      }
      const custody = await (operations.readManagedCustody ?? readManagedAndroidRecoveryCustody)(owner)
      if (custody.kind === 'refused' || custody.kind === 'ambiguous') {
        Errors.throwHostEnvironment(`Android recovery retains managed custody: ${custody.reason}`)
      }
      if (custody.kind === 'known') {
        const controller = custody.receipt.controller!
        if (
          tree.identities([controller.pid]).get(controller.pid) !== undefined
          || (operations.processIsAlive ?? Platform.processIsAlive)(controller.pid)
        ) {
          Errors.throwHostEnvironment('Managed Android recovery cannot prove its captured controller absent.')
        }
      }
      const state: Capture = {
        processes: [...retention.processes],
        rootPid: retention.processGroupPid,
        uncertain: false,
      }
      let refusal: string | undefined
      const observe = (): boolean => {
        try {
          const live = tree.identities(state.processes.map(process => process.pid))
          let closed = true
          for (const expected of state.processes) {
            const current = live.get(expected.pid)
            if (current === undefined && (operations.processIsAlive ?? Platform.processIsAlive)(expected.pid)) {
              refusal = `Captured Android process ${expected.pid} has an unreadable surviving identity.`
              return false
            }
            closed &&= current === undefined || current.startedAt !== expected.startedAt
          }
          if (state.rootPid === undefined) {
            refusal = 'Captured Android process group identity is missing.'
            return false
          }
          const root = state.processes.find(process => process.pid === state.rootPid)
          const currentRoot = live.get(state.rootPid)
          if (root === undefined || currentRoot !== undefined && currentRoot.startedAt !== root.startedAt) {
            refusal = 'Captured Android process group has changed kernel identity.'
            return false
          }
          const groupMembers = operations.processTree === undefined ? ProcessTree.groupMembers : tree.groupMembers
          if (groupMembers === undefined) {
            refusal = 'Captured Android group membership inspection is unavailable.'
            return false
          }
          const members = groupMembers(state.rootPid)
          for (const member of members) {
            if (
              !state.processes.some(expected => expected.pid === member.pid && expected.startedAt === member.startedAt)
            ) {
              refusal = `Captured Android process group ${state.rootPid} contains an unrecorded member ${member.pid}.`
              return false
            }
            const currentMember = tree.identities([member.pid]).get(member.pid)
            if (
              currentMember === undefined
                ? (operations.processIsAlive ?? Platform.processIsAlive)(member.pid)
                : currentMember.startedAt !== member.startedAt
            ) {
              refusal = `Captured Android group member ${member.pid} has unreadable or changed identity.`
              return false
            }
          }
          return closed && members.length === 0 && !tree.isGroupAlive(state.rootPid)
        } catch (error) {
          refusal = `Captured Android ownership inspection failed: ${Errors.messageOf(error).slice(0, 768)}`
          return false
        }
      }
      const retainRefusal = async () => {
        if (refusal === undefined) {
          return
        }
        const owners = await Promise.all(
          retention.resourceNames.map(name =>
            (operations.readOwner ?? MachineResources.readOwner)({ name, registryRoot: operations.registryRoot })
          ),
        )
        if (
          owners.some(current =>
            current?.id !== generation || current.pid !== owner.pid
            || current.processStartedAt !== owner.processStartedAt || current.repositoryRoot !== owner.repositoryRoot
          )
        ) {
          Errors.throwHostEnvironment(
            'Android permanent refusal publication found changed physical owners; fences are preserved.',
          )
        }
        const record = custody.kind === 'known' ? custody.receipt : undefined
        await (operations.retainResources ?? MachineResources.retain)({
          owners: owners.map(current => current!),
          processes: retention.processes,
          processGroupPid: retention.processGroupPid,
          quarantined: retention.quarantined,
          reason: refusal,
          registryRoot: operations.registryRoot,
          ownershipRefusal: {
            version: 1,
            reason: refusal,
            ...(record === undefined ? {} : {
              managed: {
                session: record.session,
                generation: record.generation,
                physicalGeneration: generation,
                checkout: record.checkout,
                controller: record.controller!,
              },
            }),
          },
        })
        Errors.throwHostEnvironment(`Android recovery permanently retains unknown ownership: ${refusal}`)
      }
      if (observe()) {
        return true
      }
      await retainRefusal()
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        tree.signalTracked(state.processes, signal)
        if (
          await Time.pollUntil(() => observe() || refusal !== undefined ? true : undefined, {
            intervalMs: 100,
            timeoutMs: operations.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS,
          }) === true
        ) {
          await retainRefusal()
          return true
        }
      }
      return false
    },
  })
}

export const AndroidRecovery = { capture, recover, stop } as const
