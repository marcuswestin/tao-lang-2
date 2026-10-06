import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, Time } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { AndroidRecovery } from '../simulators/AndroidRecovery'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from './DevLoopStore'

/** Called under the session recovery lock after process and device cleanup has been proved. */
export async function disposeDeadDevLoopConnection(
  receipt: DevLoopReceipt,
  identities: typeof ProcessTree.identities = ProcessTree.identities,
  processIsAlive: (pid: number) => boolean = pid => Platform.signalProcess(pid, 0),
): Promise<DevLoopReceipt> {
  const saved = await readDevLoopReceipt(receipt.session)
  if (
    saved.generation !== receipt.generation
    || (saved.controller !== undefined && !ProcessTree.sameProcess(saved.controller, receipt.controller!))
  ) {
    Errors.throwHostEnvironment('The dev-loop owner changed during private control cleanup.')
  }
  const current = receipt.controller === undefined
    ? undefined
    : identities([receipt.controller.pid]).get(receipt.controller.pid)
  if (receipt.controller === undefined || current !== undefined || processIsAlive(receipt.controller.pid)) {
    Errors.throwHostEnvironment('The old dev-loop controller absence is unproved; private control cleanup is refused.')
  }
  const directory = FS.resolvePath('active-control', devLoopDirectory(receipt.session))
  if (await FS.exists(directory)) {
    const connection = await readDevLoopConnection(receipt.session).catch(() => undefined)
    if (
      connection === undefined || connection.generation !== receipt.generation || receipt.controller === undefined
      || !ProcessTree.sameProcess(connection.controller, receipt.controller)
    ) {
      const message =
        'Private control ownership is unproved; credentials and the receipt are retained for investigation.'
      return {
        ...receipt,
        state: 'cleanup-failed',
        cleanupOutcome: 'retained',
        message,
        failures: [...(receipt.failures ?? []), message],
      }
    }
    await FS.remove(directory)
  }
  return { ...receipt, controllerDisposed: true, cleanupOutcome: 'proved' }
}

type RecoveryOperations = {
  identities: typeof ProcessTree.identities
  descendants: typeof ProcessTree.descendants
  signal: typeof ProcessTree.signalTracked
  sleep: typeof Time.sleep
  now: () => number
  processIsAlive?: (pid: number) => boolean
  groupMembers?: typeof ProcessTree.groupMembers
  isGroupAlive?: typeof ProcessTree.isGroupAlive
  run?: typeof CLI.run
  readOwner?: typeof MachineResources.readOwner
  recoverResources?: typeof MachineResources.recoverRetained
  recoverAndroid?: typeof AndroidRecovery.recover
  readReceipt?: typeof readDevLoopReceipt
  writeReceipt?: typeof writeDevLoopReceipt
  retainResources?: typeof MachineResources.retain
}

const liveOperations: RecoveryOperations = {
  identities: ProcessTree.identities,
  descendants: ProcessTree.descendants,
  signal: ProcessTree.signalTracked,
  sleep: Time.sleep,
  now: Date.now,
}

/** Recovery signals only recorded identities and descendants of still-proven owned parents. */
export async function recoverDevLoopProcesses(
  receipt: DevLoopReceipt,
  operations: RecoveryOperations = liveOperations,
): Promise<DevLoopReceipt> {
  const saved = await (operations.readReceipt ?? readDevLoopReceipt)(receipt.session)
  if (
    saved.generation !== receipt.generation || saved.checkout !== receipt.checkout
    || receipt.controller === undefined || saved.controller === undefined
    || saved.controller.pid !== receipt.controller.pid || !ProcessTree.sameProcess(saved.controller, receipt.controller)
  ) {
    Errors.throwHostEnvironment('The durable dev-loop owner changed during interrupted recovery.')
  }
  receipt = {
    ...receipt,
    ...(saved.ownershipRefusal === undefined ? {} : { ownershipRefusal: structuredClone(saved.ownershipRefusal) }),
    recoveryAudit: saved.recoveryAudit,
    provenance: saved.provenance === 'uncertain' ? 'uncertain' : receipt.provenance,
    mobileDriverCleanup: saved.mobileDriverCleanup === undefined || saved.mobileDriverCleanup === 'proved'
      ? receipt.mobileDriverCleanup
      : saved.mobileDriverCleanup,
    devices: structuredClone(saved.devices ?? receipt.devices ?? []),
  }
  let ownershipRefusal = structuredClone(saved.ownershipRefusal ?? receipt.ownershipRefusal)
  // A physical publication can precede the receipt write. Its original-generation custody
  // is the only evidence that may reconnect that rotated pair to this same session.
  for (const device of receipt.devices ?? []) {
    if (
      device.platform !== 'android' || !device.owned || device.state === 'released'
      || device.resources === undefined
    ) {
      continue
    }
    const owners = await Promise.all(
      device.resources.map(owner => (operations.readOwner ?? MachineResources.readOwner)({ name: owner.name })),
    )
    const physical = owners.find(owner => owner?.retention?.ownershipRefusal !== undefined)
    if (physical === undefined) {
      continue
    }
    const refusal = physical.retention!.ownershipRefusal!
    const context = refusal.managed
    const names = [`android-avd:${device.avdName}`, `android-emulator:${device.id}`]
    if (
      context === undefined || context.session !== receipt.session || context.generation !== receipt.generation
      || context.checkout !== receipt.checkout || context.controller.pid !== receipt.controller!.pid
      || !ProcessTree.sameProcess(context.controller, receipt.controller!)
      || device.generation !== context.physicalGeneration && device.generation !== physical.id
      || device.avdName === undefined || !/^emulator-\d+$/u.test(device.id)
      || device.holder?.pid !== receipt.controller!.pid || !ProcessTree.sameProcess(device.holder, receipt.controller!)
      || device.resources.length !== 2 || new Set(device.resources.map(owner => owner.name)).size !== 2
      || !device.resources.every(owner => names.includes(owner.name) && owner.id === device.generation)
      || physical.retention!.resourceNames.length !== 2
      || !device.resources.every(expected => {
        const current = owners.find(owner => owner?.name === expected.name)
        return current?.id === physical.id && current.pid === expected.pid
          && current.processStartedAt === expected.processStartedAt
          && current.repositoryRoot === expected.repositoryRoot
          && physical.retention!.resourceNames.includes(expected.name)
          && JSON.stringify(current.retention?.ownershipRefusal) === JSON.stringify(refusal)
      })
    ) {
      Errors.throwHostEnvironment('Permanent Android refusal custody does not match the original managed session.')
    }
    device.generation = physical.id
    device.resources = owners.map(owner => owner!)
    device.state = 'retained'
    ownershipRefusal ??= { version: 1, generation: receipt.generation, reason: refusal.reason }
  }
  const processIsAlive = operations.processIsAlive ?? (pid => Platform.signalProcess(pid, 0))
  if (
    receipt.controller === undefined
    || operations.identities([receipt.controller.pid]).get(receipt.controller.pid) !== undefined
    || processIsAlive(receipt.controller.pid)
  ) {
    Errors.throwHostEnvironment('The old dev-loop controller absence is unproved; interrupted recovery is refused.')
  }
  const tracked = [...receipt.children]
  const refusals: string[] = []
  let fatalRefusal: string | undefined = ownershipRefusal?.reason
  let pendingReason = 'Recorded owned process closure remains unproved.'
  const refuse = (message: string) => {
    fatalRefusal ??= message.slice(0, 1_024)
  }
  if (
    (saved.state === 'failed' || saved.state === 'cleanup-failed' || saved.cleanupOutcome === 'retained')
    && (saved.devices ?? []).some(device => device.platform === 'android' && device.owned)
    && saved.recoveryAudit === undefined
  ) {
    refuse('Unresolved legacy managed Android custody lacks a known-closure recovery audit.')
  }
  try {
    const current = operations.identities(tracked.map(process => process.pid))
    for (const process of tracked.slice()) {
      if (!ProcessTree.sameProcess(current.get(process.pid), process)) {
        continue
      }
      for (const descendant of operations.descendants(process.pid)) {
        if (!tracked.some(previous => previous.pid === descendant.pid && previous.startedAt === descendant.startedAt)) {
          tracked.push(descendant)
        }
      }
    }
  } catch (error) {
    refuse(`Interrupted recovery descendant capture failed: ${Errors.messageOf(error)}`)
  }
  const observeClosure = (): boolean => {
    let closed = true
    let observation = 'recorded process identities'
    try {
      const live = operations.identities([
        ...new Set([...tracked, ...receipt.processGroups ?? []].map(process => process.pid)),
      ])
      for (const process of tracked) {
        const identity = live.get(process.pid)
        if (identity === undefined && processIsAlive(process.pid)) {
          refuse(`Recorded owned process ${process.pid} has an unreadable surviving identity.`)
          return false
        }
        if (ProcessTree.sameProcess(identity, process)) {
          closed = false
          pendingReason = `Recorded owned process ${process.pid} has not proved its exit.`
        }
      }
      for (const group of receipt.processGroups ?? []) {
        observation = `recorded process group ${group.pid}`
        const identity = live.get(group.pid)
        if (identity !== undefined && !ProcessTree.sameProcess(identity, group)) {
          refuse(`Recorded process group ${group.pid} has a different current kernel identity.`)
          return false
        }
        if (identity === undefined && processIsAlive(group.pid)) {
          refuse(`Recorded process group ${group.pid} has an unreadable surviving root identity.`)
          return false
        }
        const members = (operations.groupMembers ?? ProcessTree.groupMembers)(group.pid)
        for (const member of members) {
          if (!tracked.some(process => process.pid === member.pid && ProcessTree.sameProcess(member, process))) {
            refuse(`Recorded process group ${group.pid} contains an unrecorded member ${member.pid}.`)
            return false
          }
          const currentMember = live.get(member.pid)
          if (
            currentMember !== undefined && !ProcessTree.sameProcess(currentMember, member)
            || currentMember === undefined && processIsAlive(member.pid)
          ) {
            refuse(`Recorded process group ${group.pid} member ${member.pid} has unproved current kernel identity.`)
            return false
          }
        }
        const alive = (operations.isGroupAlive ?? ProcessTree.isGroupAlive)(group.pid)
        if (identity !== undefined || members.length !== 0 || alive) {
          closed = false
          pendingReason = `Recorded process group ${group.pid} has not proved empty membership and kernel absence.`
        }
      }
    } catch (error) {
      refuse(`Interrupted recovery ${observation} inspection failed: ${Errors.messageOf(error)}`)
      return false
    }
    return closed
  }
  // Inspect before signalling as well: unknown members and inspection failures never grant
  // escalation authority. Only the already captured identities remain signal candidates.
  observeClosure()
  if (fatalRefusal === undefined) {
    operations.signal(tracked, 'SIGTERM')
  }
  const wait = async (): Promise<boolean> => {
    const deadline = operations.now() + 5_000
    while (true) {
      if (fatalRefusal !== undefined) {
        return false
      }
      if (observeClosure()) {
        return true
      }
      if (fatalRefusal !== undefined) {
        return false
      }
      if (operations.now() >= deadline) {
        return false
      }
      await operations.sleep(50)
    }
  }
  let stopped = await wait()
  if (!stopped && fatalRefusal === undefined) {
    operations.signal(tracked, 'SIGKILL')
    stopped = await wait()
  }
  if (!stopped) {
    refusals.push(fatalRefusal ?? pendingReason)
  }
  // Refusal belongs to the durable session, including sessions with no eligible devices.
  // Validate its owner before carrying any facts into the incoming snapshot.
  const currentSaved = await (operations.readReceipt ?? readDevLoopReceipt)(receipt.session)
  if (
    currentSaved.generation !== receipt.generation || currentSaved.checkout !== receipt.checkout
    || currentSaved.controller === undefined || currentSaved.controller.pid !== receipt.controller.pid
    || !ProcessTree.sameProcess(currentSaved.controller, receipt.controller)
  ) {
    Errors.throwHostEnvironment('The durable dev-loop owner changed during interrupted recovery.')
  }
  ownershipRefusal ??= structuredClone(currentSaved.ownershipRefusal)
  let physicalPublicationFailure: unknown
  let physicalPublicationFailed = false
  if (fatalRefusal !== undefined) {
    ownershipRefusal ??= { version: 1, generation: receipt.generation, reason: fatalRefusal }
    receipt.ownershipRefusal = ownershipRefusal
    try {
      await sealAndroidRefusal(receipt, operations, ownershipRefusal.reason)
    } catch (error) {
      physicalPublicationFailure = error
      physicalPublicationFailed = true
      ownershipRefusal.physicalPublicationUnproved ??= `Physical Android refusal publication is unproved: ${
        Errors.messageOf(error)
      }`.slice(0, 1_024)
      refusals.push(ownershipRefusal.physicalPublicationUnproved)
      receipt.failures = [...receipt.failures ?? [], ownershipRefusal.physicalPublicationUnproved]
    }
  }
  if (ownershipRefusal !== undefined) {
    receipt = { ...receipt, ownershipRefusal, provenance: 'uncertain', cleanupOutcome: 'retained' }
    // Physical pair publication comes first; a failed receipt write cannot reopen standalone recovery.
    try {
      await (operations.writeReceipt ?? writeDevLoopReceipt)(receipt)
    } catch (error) {
      if (physicalPublicationFailed) {
        Errors.throwHostEnvironment(
          'Physical Android refusal publication and durable session refusal persistence are both unproved.',
          {
            cause: error,
            details: { physicalPublication: ownershipRefusal.physicalPublicationUnproved },
          },
        )
      }
      throw error
    }
    if (physicalPublicationFailed) {
      Errors.throwHostEnvironment(
        'Physical Android refusal publication is unproved; the durable session ownership refusal remains retained.',
        {
          cause: physicalPublicationFailure,
        },
      )
    }
  } else if (!stopped && receipt.provenance === 'complete') {
    receipt.recoveryAudit = {
      version: 1,
      generation: receipt.generation,
      controller: receipt.controller!,
      outcome: 'known-closure-pending',
    }
    await (operations.writeReceipt ?? writeDevLoopReceipt)(receipt)
  }
  const driverProved = receipt.mobileDriverCleanup === undefined || receipt.mobileDriverCleanup === 'proved'
  if (ownershipRefusal !== undefined) {
    refusals.push(
      `Durable dev-loop ownership refusal remains retained: ${ownershipRefusal.reason.slice(0, 1_024)}`,
    )
  }
  let devices = receipt.devices ?? []
  if (stopped && driverProved && receipt.provenance === 'complete' && ownershipRefusal === undefined) {
    devices = await recoverDevLoopDevices(receipt, operations, refusals)
  }
  const devicesProved = devices.every(device => device.state === 'released')
  const complete = stopped && driverProved && receipt.provenance === 'complete'
    && ownershipRefusal === undefined && devicesProved
  return {
    ...receipt,
    recoveryAudit: complete ? undefined : receipt.recoveryAudit,
    ...(ownershipRefusal === undefined ? {} : { ownershipRefusal, provenance: 'uncertain' as const }),
    children: tracked,
    devices,
    state: complete ? 'stopped' : 'cleanup-failed',
    cleanupOutcome: complete ? 'proved' : ownershipRefusal !== undefined || !devicesProved ? 'retained' : 'unknown',
    failures: complete
      ? receipt.failures ?? []
      : [
        ...(receipt.failures ?? []),
        ...refusals,
        'Complete descendant or device cleanup remains unproved; records and resource fences are retained.',
      ],
    updatedAt: new Date().toISOString(),
    message: complete
      ? undefined
      : 'Recorded owned processes were stopped where their identities matched. Complete descendant or device cleanup remains unproved; records and resource fences are retained.',
  }
}

async function sealAndroidRefusal(
  receipt: DevLoopReceipt,
  operations: RecoveryOperations,
  reason: string,
): Promise<void> {
  for (const device of receipt.devices ?? []) {
    if (device.platform !== 'android' || !device.owned || device.state === 'released') {
      continue
    }
    if (
      device.resources?.length === 2 && device.resources.every(owner => owner.retention?.ownershipRefusal !== undefined)
    ) {
      continue
    }
    // A receipt without a complete owned publication cannot grant a physical write.
    // Its session refusal remains authoritative; explicitly report the missing proof.
    if (device.resources === undefined || device.generation === undefined || device.holder === undefined) {
      receipt.ownershipRefusal!.physicalPublicationUnproved ??=
        'Physical Android refusal publication has no complete original resource and holder snapshot.'
      continue
    }
    const names = [`android-avd:${device.avdName}`, `android-emulator:${device.id}`]
    if (
      device.avdName === undefined || device.generation === undefined || device.resources?.length !== 2
      || device.holder === undefined || device.holder.pid !== receipt.controller!.pid
      || !ProcessTree.sameProcess(device.holder, receipt.controller!)
      || new Set(device.resources.map(owner => owner.name)).size !== 2
      || !device.resources.every(owner => names.includes(owner.name) && owner.id === device.generation)
    ) {
      Errors.throwHostEnvironment(
        'Permanent Android refusal cannot publish without its exact original holder and complete pair.',
      )
    }
    const owners = await Promise.all(
      device.resources.map(expected => (operations.readOwner ?? MachineResources.readOwner)({ name: expected.name })),
    )
    if (
      !device.resources.every(expected => {
        const current = owners.find(owner => owner?.name === expected.name)
        return current?.id === expected.id && current.pid === expected.pid
          && current.processStartedAt === expected.processStartedAt && current.repositoryRoot === receipt.checkout
          && current.repositoryRoot === expected.repositoryRoot
      })
    ) {
      Errors.throwHostEnvironment(
        'Permanent Android refusal publication found a changed physical owner; those fences are preserved.',
      )
    }
    const root = receipt.processGroups?.find(process =>
      process.pid === owners[0]!.pid
      && process.startedAt === owners[0]!.processStartedAt
    )
    if (
      root === undefined
      || !receipt.children.some(process => process.pid === root.pid && ProcessTree.sameProcess(process, root))
    ) {
      Errors.throwHostEnvironment(
        'Permanent Android refusal publication lacks the original captured physical kernel and group.',
      )
    }
    const retained = await (operations.retainResources ?? MachineResources.retain)({
      owners: owners.map(owner => owner!),
      processes: [root, ...(owners[0]!.retention?.processes ?? []).filter(process => process.pid !== root.pid)],
      processGroupPid: root.pid,
      quarantined: owners.some(owner => owner?.retention?.quarantined),
      reason,
      ownershipRefusal: {
        version: 1,
        reason,
        managed: {
          session: receipt.session,
          generation: receipt.generation,
          physicalGeneration: device.generation,
          checkout: receipt.checkout,
          controller: receipt.controller!,
        },
      },
    })
    device.generation = retained.id
    device.resources = names.map(name => ({ ...retained, name }))
    device.state = 'retained'
  }
}

/** Called only under the existing stop lock, after the dead controller and all recorded groups are proved gone. */
async function recoverDevLoopDevices(receipt: DevLoopReceipt, operations: RecoveryOperations, refusals: string[]) {
  const devices = structuredClone(receipt.devices ?? [])
  for (const device of devices) {
    if (device.state === 'released') {
      continue
    }
    if (
      receipt.controller === undefined || device.holder === undefined || device.holder.pid !== receipt.controller.pid
      || !ProcessTree.sameProcess(device.holder, receipt.controller)
      || device.resources === undefined || device.resources.length === 0 || device.generation === undefined
      || (receipt.processGroups?.length ?? 0) === 0
    ) {
      continue
    }
    try {
      const saved = await (operations.readReceipt ?? readDevLoopReceipt)(receipt.session)
      if (saved.ownershipRefusal !== undefined) {
        Errors.throwHostEnvironment('The durable dev-loop ownership refusal prevents target recovery.')
      }
      if (
        saved.generation !== receipt.generation || saved.controller === undefined
        || saved.controller.pid !== receipt.controller.pid
        || !ProcessTree.sameProcess(saved.controller, receipt.controller)
      ) {
        Errors.throwHostEnvironment('The durable dev-loop generation changed during target recovery.')
      }
      const readOwner = operations.readOwner ?? MachineResources.readOwner
      if (
        device.platform === 'ios'
          && (device.resources.length !== 1 || device.resources[0]?.name !== `ios-simulator:${device.id}`)
        || device.platform === 'android' && (device.resources.length !== 2 || device.avdName === undefined
            || !device.resources.some(owner => owner.name === `android-emulator:${device.id}`)
            || !device.resources.some(owner => owner.name === `android-avd:${device.avdName}`))
      ) {
        Errors.throwHostEnvironment('The retained mobile target has no complete published resource identity.')
      }
      for (const expected of device.resources) {
        const owner = await readOwner({ name: expected.name })
        if (
          owner?.id !== expected.id || owner.pid !== expected.pid
          || owner.processStartedAt !== expected.processStartedAt
          || owner.repositoryRoot !== expected.repositoryRoot
        ) {
          Errors.throwHostEnvironment('The retained mobile resource owner changed; recovery is refused.')
        }
      }
      if (device.platform === 'android' && device.owned) {
        if (
          device.avdName === undefined || device.resources.length !== 2
          || !device.resources.some(owner => owner.name === `android-emulator:${device.id}`)
          || !device.resources.some(owner => owner.name === `android-avd:${device.avdName}`)
        ) {
          Errors.throwHostEnvironment('The retained Android target does not have both published fences.')
        }
        await (operations.recoverAndroid ?? AndroidRecovery.recover)(device.avdName, device.generation)
      } else {
        await (operations.recoverResources ?? MachineResources.recoverRetained)({
          name: device.resources[0]!.name,
          generation: device.generation,
          shutdown: async owner => {
            if (owner.id !== device.generation) {
              return false
            }
            if (!device.owned) {
              return true
            }
            const run = operations.run ?? CLI.run
            await run('xcrun', {
              args: ['simctl', 'shutdown', device.id],
              processPolicy: 'test',
              timeoutMs: 30_000,
            })
            // Shutdown can report nonzero when already shut down. The exact authoritative
            // device state proves closure; the resource owner/generation fences still govern release.
            const inventory = await run('xcrun', {
              args: ['simctl', 'list', 'devices', '--json', 'available'],
              processPolicy: 'test',
              timeoutMs: 30_000,
            })
            if (inventory.exitCode !== 0 || inventory.error !== undefined) {
              return false
            }
            const parsed = JSON.parse(inventory.stdout) as {
              devices?: Record<string, Array<{ udid: string; state: string }>>
            }
            return Object.values(parsed.devices ?? {}).flat().some(candidate =>
              candidate.udid === device.id && candidate.state === 'Shutdown'
            )
          },
        })
      }
      device.state = 'released'
    } catch (error) {
      refusals.push(
        `Retained ${device.platform} target ${device.id} recovery refused: ${Errors.messageOf(error).slice(0, 1_024)}`,
      )
    }
  }
  return devices
}
