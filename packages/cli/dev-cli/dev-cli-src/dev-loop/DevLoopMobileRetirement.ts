import { type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, Repo, Text, Time } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { disposeDeadDevLoopConnection } from './DevLoopRecovery'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from './DevLoopStore'
const DRIVER_REFUSAL = 'Managed mobile driver cleanup is unproved; target and driver fences remain retained.'
const AUDIT_NAME = 'mobile-retirement.json'
const GRACE_MS = 3_000

type RetirementAudit = {
  version: 1
  session: string
  checkout: string
  generation: string
  controller: TrackedProcess
  children: TrackedProcess[]
  groups: TrackedProcess[]
  portFences: MachineResourceOwner[]
  releasedPorts: string[]
  phase:
    | 'admitted'
    | 'term-sent'
    | 'kill-sent'
    | 'processes-proved'
    | 'ports-released'
    | 'target-released'
    | 'proved'
    | 'retained'
  detail?: string
  updatedAt: string
}

type RetirementOperations = {
  readReceipt: typeof readDevLoopReceipt
  writeReceipt: typeof writeDevLoopReceipt
  readConnection: typeof readDevLoopConnection
  controlPresent: (session: string) => Promise<boolean>
  readOwner: typeof MachineResources.readOwner
  listOwners: typeof MachineResources.listOwners
  recoverRetained: typeof MachineResources.recoverRetained
  identities: typeof ProcessTree.identities
  descendants: typeof ProcessTree.descendants
  groupMembers: typeof ProcessTree.groupMembers
  isGroupAlive: typeof ProcessTree.isGroupAlive
  processGroupOf: typeof ProcessTree.processGroupOf
  processTable: typeof ProcessTree.processTable
  signal: typeof ProcessTree.signalTracked
  processIsAlive: (pid: number) => boolean
  run: typeof CLI.run
  now: () => number
  sleep: typeof Time.sleep
  readAudit: (session: string) => Promise<RetirementAudit | undefined>
  writeAudit: (audit: RetirementAudit) => Promise<void>
  disposeConnection: typeof disposeDeadDevLoopConnection
  withLock: (session: string, action: () => Promise<DevLoopReceipt>) => Promise<DevLoopReceipt>
}

async function readAudit(session: string): Promise<RetirementAudit | undefined> {
  const path = FS.resolvePath(AUDIT_NAME, devLoopDirectory(session))
  if (!await FS.exists(path)) {
    return undefined
  }
  if (
    await FS.realPath(path) !== path || await FS.fileMode(path) !== 0o600
    || await FS.byteSize(path) > 256 * 1_024
  ) {
    Errors.throwHostEnvironment('Retained mobile retirement audit storage is not private and bounded.')
  }
  return await FS.readJson<RetirementAudit>(path)
}

async function writeAudit(audit: RetirementAudit): Promise<void> {
  const directory = devLoopDirectory(audit.session)
  const temporary = FS.resolvePath(`mobile-retirement-${Platform.randomUUID()}.tmp`, directory)
  await FS.writeJson(temporary, audit, { mode: 0o600 })
  await FS.chmod(temporary, 0o600)
  await FS.move(temporary, FS.resolvePath(AUDIT_NAME, directory))
}

const defaults: RetirementOperations = {
  readReceipt: readDevLoopReceipt,
  writeReceipt: writeDevLoopReceipt,
  readConnection: readDevLoopConnection,
  controlPresent: async session => await FS.exists(FS.resolvePath('active-control', devLoopDirectory(session))),
  readOwner: MachineResources.readOwner,
  listOwners: MachineResources.listOwners,
  recoverRetained: MachineResources.recoverRetained,
  identities: ProcessTree.identities,
  descendants: ProcessTree.descendants,
  groupMembers: ProcessTree.groupMembers,
  isGroupAlive: ProcessTree.isGroupAlive,
  processGroupOf: ProcessTree.processGroupOf,
  processTable: ProcessTree.processTable,
  signal: ProcessTree.signalTracked,
  processIsAlive: pid => Platform.signalProcess(pid, 0),
  run: CLI.run,
  now: Date.now,
  sleep: Time.sleep,
  readAudit,
  writeAudit,
  disposeConnection: disposeDeadDevLoopConnection,
  withLock: async (session, action) => {
    const directory = devLoopDirectory(session)
    return await FS.withFileMutationLock(FS.resolvePath('recovery.lock', directory), directory, action)
  },
}

/** An explicit, finite retirement of one failed owned mobile generation. It cannot change acceptance evidence. */
export async function retireRetainedMobile(
  session: string,
  overrides: Partial<RetirementOperations> = {},
): Promise<DevLoopReceipt> {
  const operations = { ...defaults, ...overrides }
  return await operations.withLock(session, async () => {
    const original = await operations.readReceipt(session)
    const controller = original.controller
    const device = original.devices?.[0]
    const audit = await operations.readAudit(session)
    if (
      controller === undefined || original.session !== session
      || original.checkout !== await FS.realPath(Repo.getRoot())
      || original.ownershipRefusal?.generation !== original.generation
      || original.ownershipRefusal.reason !== DRIVER_REFUSAL
      || original.mobileDriverCleanup !== 'retained'
      || original.provenance !== 'uncertain'
      || original.controllerDisposed === true && audit === undefined
      || original.state === 'stopped' || original.devices?.length !== 1
      || device?.platform !== 'ios' || !device.owned
      || device.state === 'released' && !(audit?.phase === 'proved'
          && original.retirementAudit?.generation === original.generation
          && original.retirementAudit.path === AUDIT_NAME && original.retirementAudit.outcome === 'proved')
      || device.holder?.pid !== controller.pid || !ProcessTree.sameProcess(device.holder, controller)
      || device.resources?.length !== 1 || device.resources[0]?.name !== `ios-simulator:${device.id}`
      || device.generation !== device.resources[0]?.id
      || original.mobileDriverProcesses?.length !== 1
      || !original.children.some(child =>
        ProcessTree.sameProcess(child, original.mobileDriverProcesses![0]!)
        && child.pid === original.mobileDriverProcesses![0]!.pid
      )
      || !original.processGroups?.some(group =>
        group.pid === original.mobileDriverProcesses![0]!.pid
        && ProcessTree.sameProcess(group, original.mobileDriverProcesses![0]!)
      )
      || !singletonRetention(device.resources[0], device.resources[0]!.name)
    ) {
      Errors.throwHostEnvironment(
        'Retained mobile retirement requires the exact failed iOS session and its original fences.',
      )
    }
    const expectedOwner = device.resources[0]!
    if (audit !== undefined && !validAudit(audit, original)) {
      Errors.throwHostEnvironment('Retained mobile retirement audit does not match the original custody.')
    }
    const physicalOwner = await operations.readOwner({ name: expectedOwner.name })
    if (
      audit !== undefined && ['ports-released', 'target-released', 'proved'].includes(audit.phase)
      && physicalOwner === undefined
    ) {
      await assertReleasedCustody(original, audit, expectedOwner, operations)
      if (
        original.retirementAudit?.outcome === 'proved' && device.state === 'released'
        && original.controllerDisposed === true && original.state === 'cleanup-failed'
      ) {
        return original
      }
      const disposed = await operations.disposeConnection(original)
      if (!disposed.controllerDisposed) {
        Errors.throwHostEnvironment('Retained mobile private control cleanup remains unproved.')
      }
      const completed = retiredReceipt(await operations.readReceipt(session), original, device)
      await operations.writeAudit({ ...audit, phase: 'proved', updatedAt: new Date().toISOString() })
      await assertReleasedCustody(original, audit, expectedOwner, operations)
      await operations.writeReceipt(completed)
      return completed
    }
    if (audit !== undefined && ['target-released', 'proved'].includes(audit.phase)) {
      Errors.throwHostEnvironment('Retained mobile target custody changed after release evidence.')
    }
    const controllerAbsent = (): boolean =>
      operations.identities([controller.pid]).get(controller.pid) === undefined
      && !operations.processIsAlive(controller.pid)
    const controlPresent = await operations.controlPresent(session)
    if (controlPresent === (original.controllerDisposed === true)) {
      Errors.throwHostEnvironment('Retained mobile private control and controller disposal disagree.')
    }
    const connection = controlPresent ? await operations.readConnection(session) : undefined
    if (
      connection === undefined
        ? !controllerAbsent()
        : connection.session !== session || connection.generation !== original.generation
          || connection.controller?.pid !== controller.pid
          || !ProcessTree.sameProcess(connection.controller, controller)
    ) {
      Errors.throwHostEnvironment('Retained mobile private control does not match the original custody.')
    }
    const assertCustody = async (): Promise<DevLoopReceipt> => {
      const current = await operations.readReceipt(session)
      const currentControlPresent = await operations.controlPresent(session)
      const privateConnection = currentControlPresent ? await operations.readConnection(session) : undefined
      const owner = await operations.readOwner({ name: expectedOwner.name })
      const privateControlChanged = connection === undefined
        ? currentControlPresent || privateConnection !== undefined || !controllerAbsent()
        : !currentControlPresent || privateConnection === undefined
          || privateConnection.generation !== connection.generation
          || privateConnection.token !== connection.token || privateConnection.origin !== connection.origin
          || privateConnection.controller?.pid !== controller.pid
          || !ProcessTree.sameProcess(privateConnection.controller, controller)
      if (
        current.generation !== original.generation || current.checkout !== original.checkout
        || current.controllerDisposed !== original.controllerDisposed
        || current.controller?.pid !== controller.pid || !ProcessTree.sameProcess(current.controller, controller)
        || current.ownershipRefusal?.reason !== original.ownershipRefusal?.reason
        || current.mobileDriverCleanup !== original.mobileDriverCleanup
        || JSON.stringify(current.mobileDriverProcesses) !== JSON.stringify(original.mobileDriverProcesses)
        || current.devices?.length !== 1 || current.devices[0]?.platform !== 'ios'
        || current.devices[0].id !== device.id || current.devices[0].owned !== true
        || current.devices[0].generation !== device.generation
        || current.devices[0].holder?.pid !== controller.pid
        || !ProcessTree.sameProcess(current.devices[0].holder, controller)
        || current.devices[0].resources?.length !== 1
        || !sameOwner(current.devices[0].resources[0], expectedOwner)
        || privateControlChanged
        || owner?.name !== expectedOwner.name || owner.id !== expectedOwner.id
        || owner.pid !== expectedOwner.pid || owner.processStartedAt !== expectedOwner.processStartedAt
        || owner.startedAt !== expectedOwner.startedAt || owner.repositoryRoot !== original.checkout
        || expectedOwner.repositoryRoot !== original.checkout
        || !singletonRetention(owner, expectedOwner.name)
      ) {
        Errors.throwHostEnvironment(
          'Retained mobile retirement lost exact session, private control, or physical target custody.',
        )
      }
      return current
    }
    await assertCustody()
    let evidence: RetirementAudit
    if (audit !== undefined) {
      evidence = audit
    } else {
      const identity = operations.identities([controller.pid]).get(controller.pid)
      const worker = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopWorker.ts')
      const command = operations.processTable().find(process => process.pid === controller.pid)?.command
      if (
        !ProcessTree.sameProcess(identity, controller)
        || !new RegExp(`^(?:\\S*/)?bun\\s+${Text.escapeRegExp(worker)}$`, 'u').test(command ?? '')
      ) {
        Errors.throwHostEnvironment('Retained mobile retirement cannot capture a changed or absent controller.')
      }
      const children = [...original.children]
      for (const descendant of operations.descendants(controller.pid)) {
        if (!children.some(child => child.pid === descendant.pid && ProcessTree.sameProcess(child, descendant))) {
          children.push(descendant)
        }
      }
      for (const child of children.slice()) {
        if (!ProcessTree.sameProcess(operations.identities([child.pid]).get(child.pid), child)) {
          continue
        }
        for (const descendant of operations.descendants(child.pid)) {
          if (
            !children.some(previous =>
              previous.pid === descendant.pid
              && ProcessTree.sameProcess(previous, descendant)
            )
          ) {
            children.push(descendant)
          }
        }
      }
      const groups = [...original.processGroups ?? []]
      for (const child of children) {
        const groupPid = operations.processGroupOf(child.pid)
        if (groupPid === undefined) {
          const recorded = original.children.some(saved =>
            saved.pid === child.pid && ProcessTree.sameProcess(saved, child)
          )
          if (operations.processIsAlive(child.pid) || !recorded) {
            Errors.throwHostEnvironment('Retained mobile child group identity is unreadable.')
          }
          continue
        }
        if (!groups.some(group => group.pid === groupPid)) {
          const group = children.find(candidate => candidate.pid === groupPid)
          if (group === undefined) {
            Errors.throwHostEnvironment('Retained mobile child has a group outside captured ownership.')
          }
          groups.push(group)
        }
      }
      const ports = (await operations.listOwners()).filter(owner =>
        /^appium-[a-z-]+-port-\d+$/u.test(owner.name)
        && owner.pid === controller.pid && owner.repositoryRoot === original.checkout
        && (owner.processStartedAt === undefined || owner.processStartedAt === controller.startedAt)
      )
      if (
        ports.some(port =>
          port.retention?.quarantined !== true
          || port.retention.resourceNames.length !== 1 || port.retention.resourceNames[0] !== port.name
        )
      ) {
        Errors.throwHostEnvironment('Retained mobile port fence has a grouped or unproved manifest.')
      }
      evidence = {
        version: 1,
        session,
        checkout: original.checkout,
        generation: original.generation,
        controller,
        children,
        groups,
        portFences: ports,
        releasedPorts: [],
        phase: 'admitted',
        updatedAt: new Date().toISOString(),
      }
      // The capture is durable before the first destructive signal.
      await operations.writeAudit(evidence)
    }
    const assertPortInventory = async () => {
      const current = (await operations.listOwners()).filter(owner =>
        /^appium-[a-z-]+-port-\d+$/u.test(owner.name)
        && owner.pid === controller.pid && owner.repositoryRoot === original.checkout
      )
      for (const owner of current) {
        if (!evidence.portFences.some(expected => sameOwner(owner, expected))) {
          Errors.throwHostEnvironment('Retained mobile driver port inventory changed after capture.')
        }
        if (owner.retention?.resourceNames.length !== 1 || owner.retention.resourceNames[0] !== owner.name) {
          Errors.throwHostEnvironment('Retained mobile driver port has a grouped fence manifest.')
        }
      }
    }
    await assertPortInventory()
    const save = async (phase: RetirementAudit['phase'], detail?: string) => {
      evidence.phase = phase
      evidence.updatedAt = new Date().toISOString()
      evidence.detail = detail?.slice(0, 1_024)
      await operations.writeAudit(evidence)
    }
    const observe = (): boolean => observeClosure(evidence, operations)
    const wait = async (): Promise<boolean> => {
      const deadline = operations.now() + GRACE_MS
      for (;;) {
        if (observe()) {
          return true
        }
        if (operations.now() >= deadline) {
          return false
        }
        await operations.sleep(50)
      }
    }
    try {
      await assertCustody()
      await assertPortInventory()
      observe()
      operations.signal(evidence.children, 'SIGTERM')
      operations.signal([controller], 'SIGTERM')
      await save('term-sent')
      let gone = await wait()
      if (!gone) {
        await assertCustody()
        observe()
        operations.signal(evidence.children, 'SIGKILL')
        operations.signal([controller], 'SIGKILL')
        await save('kill-sent')
        gone = await wait()
      }
      if (!gone) {
        Errors.throwHostEnvironment('Retained mobile process and group absence remains unproved.')
      }
      await save('processes-proved')
      await assertCustody()
      await assertPortInventory()
      await assertListenersAbsent(evidence, operations)
      for (const port of evidence.portFences) {
        if (evidence.releasedPorts.includes(port.name)) {
          continue
        }
        await assertCustody()
        await assertPortInventory()
        const current = await operations.readOwner({ name: port.name })
        if (current === undefined) {
          // A prior attempt may have released the fence before its audit update completed.
          evidence.releasedPorts.push(port.name)
          await save('processes-proved')
          continue
        }
        if (!sameOwner(current, port)) {
          Errors.throwHostEnvironment('Retained mobile port fence changed before release.')
        }
        if (current.retention?.resourceNames.length !== 1 || current.retention.resourceNames[0] !== port.name) {
          Errors.throwHostEnvironment('Retained mobile port fence changed its singleton manifest.')
        }
        await operations.recoverRetained({
          name: port.name,
          generation: port.id,
          shutdown: async owner =>
            sameOwner(owner, port) && singletonRetention(owner, port.name)
            && await assertListenersAbsent(evidence, operations),
        })
        evidence.releasedPorts.push(port.name)
        await save('processes-proved')
      }
      for (const port of evidence.portFences) {
        if (await operations.readOwner({ name: port.name }) !== undefined) {
          Errors.throwHostEnvironment('Retained mobile port fence release remains unproved.')
        }
      }
      await save('ports-released')
      await assertCustody()
      await operations.recoverRetained({
        name: expectedOwner.name,
        generation: device.generation!,
        shutdown: async owner => {
          if (
            !sameOwner(owner, expectedOwner) || !singletonRetention(owner, expectedOwner.name)
            || !observe() || !await assertListenersAbsent(evidence, operations)
          ) {
            return false
          }
          await operations.run('xcrun', {
            args: ['simctl', 'shutdown', device.id],
            processPolicy: 'test',
            timeoutMs: 30_000,
          })
          const inventory = await operations.run('xcrun', {
            args: ['simctl', 'list', 'devices', '--json', 'available'],
            processPolicy: 'test',
            timeoutMs: 30_000,
          })
          if (inventory.error !== undefined || inventory.exitCode !== 0) {
            return false
          }
          const parsed = JSON.parse(inventory.stdout) as { devices?: Record<string, { udid: string; state: string }[]> }
          return Object.values(parsed.devices ?? {}).flat().some(candidate =>
            candidate.udid === device.id && candidate.state === 'Shutdown'
          )
        },
      })
      await save('target-released')
      await assertReleasedCustody(original, evidence, expectedOwner, operations)
      const disposed = await operations.disposeConnection(original)
      if (!disposed.controllerDisposed) {
        Errors.throwHostEnvironment('Retained mobile private control cleanup remains unproved.')
      }
      await save('proved')
      const completed = retiredReceipt(await operations.readReceipt(session), original, device)
      await assertReleasedCustody(original, evidence, expectedOwner, operations)
      await operations.writeReceipt(completed)
      return completed
    } catch (error) {
      if (!['ports-released', 'target-released', 'proved'].includes(evidence.phase)) {
        await save('retained', Errors.messageOf(error))
      }
      throw error
    }
  })
}

function sameOwner(current: MachineResourceOwner | undefined, expected: MachineResourceOwner): boolean {
  return current?.name === expected.name && current.id === expected.id && current.pid === expected.pid
    && current.processStartedAt === expected.processStartedAt && current.repositoryRoot === expected.repositoryRoot
}

function singletonRetention(owner: MachineResourceOwner | undefined, name: string): boolean {
  return owner?.retention?.quarantined === true
    && owner.retention.resourceNames.length === 1 && owner.retention.resourceNames[0] === name
}

function retiredReceipt(
  current: DevLoopReceipt,
  original: DevLoopReceipt,
  device: NonNullable<DevLoopReceipt['devices']>[number],
): DevLoopReceipt {
  return {
    ...current,
    controllerDisposed: true,
    state: 'cleanup-failed',
    cleanupOutcome: 'retained',
    devices: [{ ...device, state: 'released' }],
    retirementAudit: { version: 1, generation: original.generation, path: AUDIT_NAME, outcome: 'proved' },
    updatedAt: new Date().toISOString(),
  }
}

function observeClosure(audit: RetirementAudit, operations: RetirementOperations): boolean {
  const tracked = [audit.controller, ...audit.children]
  const live = operations.identities([...new Set(tracked.map(child => child.pid))])
  let gone = true
  for (const child of tracked) {
    const current = live.get(child.pid)
    if (current === undefined && operations.processIsAlive(child.pid)) {
      Errors.throwHostEnvironment(`Recorded process ${child.pid} has unreadable identity.`)
    }
    if (current !== undefined && !ProcessTree.sameProcess(current, child)) {
      Errors.throwHostEnvironment(`Recorded process ${child.pid} has a different kernel identity.`)
    }
    gone &&= current === undefined
  }
  for (const group of audit.groups) {
    const members = operations.groupMembers(group.pid)
    for (const member of members) {
      const captured = tracked.find(child => child.pid === member.pid && ProcessTree.sameProcess(child, member))
      if (captured === undefined) {
        Errors.throwHostEnvironment(`Recorded group ${group.pid} has an unknown member.`)
      }
    }
    gone &&= members.length === 0 && !operations.isGroupAlive(group.pid)
  }
  return gone
}

async function assertReleasedCustody(
  original: DevLoopReceipt,
  audit: RetirementAudit,
  expectedOwner: MachineResourceOwner,
  operations: RetirementOperations,
): Promise<void> {
  const current = await operations.readReceipt(original.session)
  const device = original.devices![0]!
  const currentDevice = current.devices?.[0]
  if (
    current.generation !== original.generation || current.checkout !== original.checkout
    || current.controller?.pid !== original.controller?.pid
    || !ProcessTree.sameProcess(current.controller, original.controller!)
    || current.ownershipRefusal?.generation !== original.generation
    || current.ownershipRefusal.reason !== original.ownershipRefusal?.reason
    || current.mobileDriverCleanup !== original.mobileDriverCleanup
    || JSON.stringify(current.mobileDriverProcesses) !== JSON.stringify(original.mobileDriverProcesses)
    || current.provenance !== 'uncertain'
    || current.devices?.length !== 1 || currentDevice?.id !== device.id
    || currentDevice.platform !== 'ios' || currentDevice.owned !== true
    || currentDevice.generation !== device.generation
    || currentDevice.holder?.pid !== original.controller?.pid
    || !ProcessTree.sameProcess(currentDevice.holder, original.controller!)
    || currentDevice.resources?.length !== 1 || !sameOwner(currentDevice.resources[0], expectedOwner)
    || !singletonRetention(currentDevice.resources[0], expectedOwner.name)
    || await operations.readOwner({ name: expectedOwner.name }) !== undefined
  ) {
    Errors.throwHostEnvironment('Retained mobile retirement lost the released target or original session custody.')
  }
  if (!observeClosure(audit, operations)) {
    Errors.throwHostEnvironment('Retained mobile recorded process and group absence remains unproved.')
  }
  const currentPorts = (await operations.listOwners()).filter(owner =>
    /^appium-[a-z-]+-port-\d+$/u.test(owner.name)
    && owner.pid === audit.controller.pid && owner.repositoryRoot === audit.checkout
  )
  if (currentPorts.length !== 0 || audit.portFences.some(port => !audit.releasedPorts.includes(port.name))) {
    Errors.throwHostEnvironment('Retained mobile port fence release remains unproved.')
  }
  for (const port of audit.portFences) {
    if (await operations.readOwner({ name: port.name }) !== undefined) {
      Errors.throwHostEnvironment('Retained mobile port fence has a new owner.')
    }
  }
  await assertListenersAbsent(audit, operations)
  const inventory = await operations.run('xcrun', {
    args: ['simctl', 'list', 'devices', '--json', 'available'],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
  if (inventory.error !== undefined || inventory.exitCode !== 0) {
    Errors.throwHostEnvironment('Retained mobile Simulator state is unreadable.')
  }
  let shutdown = false
  try {
    const parsed = JSON.parse(inventory.stdout) as { devices?: Record<string, { udid: string; state: string }[]> }
    shutdown = Object.values(parsed.devices ?? {}).flat().some(candidate =>
      candidate.udid === device.id && candidate.state === 'Shutdown'
    )
  } catch {
    Errors.throwHostEnvironment('Retained mobile Simulator inventory is malformed.')
  }
  if (!shutdown) {
    Errors.throwHostEnvironment('Retained mobile Simulator shutdown remains unproved.')
  }
}

function validTracked(value: unknown): value is TrackedProcess {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const process = value as Partial<TrackedProcess>
  return Number.isSafeInteger(process.pid) && process.pid! > 1 && process.pid! <= 2_147_483_647
    && typeof process.startedAt === 'string' && process.startedAt.length > 0
    && typeof process.command === 'string' && process.command.length > 0
}

function validAudit(audit: RetirementAudit, receipt: DevLoopReceipt): boolean {
  const controller = receipt.controller
  if (
    audit === null || typeof audit !== 'object' || controller === undefined
    || audit.version !== 1 || audit.session !== receipt.session || audit.checkout !== receipt.checkout
    || audit.generation !== receipt.generation || !validTracked(audit.controller)
    || 'kind' in audit
    || audit.controller.pid !== controller.pid || !ProcessTree.sameProcess(audit.controller, controller)
    || !Array.isArray(audit.children) || !audit.children.every(validTracked)
    || new Set(audit.children.map(child => child.pid)).size !== audit.children.length
    || !Array.isArray(audit.groups) || !audit.groups.every(validTracked)
    || new Set(audit.groups.map(group => group.pid)).size !== audit.groups.length
    || !Array.isArray(audit.portFences) || !Array.isArray(audit.releasedPorts)
    || ![
      'admitted',
      'term-sent',
      'kill-sent',
      'processes-proved',
      'ports-released',
      'target-released',
      'proved',
      'retained',
    ]
      .includes(audit.phase)
    || !receipt.children.every(child =>
      audit.children.some(saved => saved.pid === child.pid && ProcessTree.sameProcess(saved, child))
    )
    || !(receipt.processGroups ?? []).every(group =>
      audit.groups.some(saved => saved.pid === group.pid && ProcessTree.sameProcess(saved, group))
    )
    || !audit.groups.every(group =>
      audit.children.some(child => child.pid === group.pid && ProcessTree.sameProcess(child, group))
    )
    || audit.portFences.some(owner =>
      owner === null || typeof owner !== 'object'
      || !/^appium-[a-z-]+-port-\d+$/u.test(owner.name) || owner.pid !== controller.pid
      || owner.repositoryRoot !== receipt.checkout || owner.retention?.quarantined !== true
      || owner.retention.resourceNames.length !== 1 || owner.retention.resourceNames[0] !== owner.name
      || owner.processStartedAt !== undefined && owner.processStartedAt !== controller.startedAt
    )
    || new Set(audit.portFences.map(owner => owner.name)).size !== audit.portFences.length
    || audit.releasedPorts.some(name =>
      typeof name !== 'string'
      || !audit.portFences.some(owner => owner.name === name)
    )
    || new Set(audit.releasedPorts).size !== audit.releasedPorts.length
  ) {
    return false
  }
  return true
}

async function assertListenersAbsent(audit: RetirementAudit, operations: RetirementOperations): Promise<boolean> {
  const result = await operations.run('lsof', {
    args: ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
  if (
    result.error !== undefined || result.stderr.trim() !== ''
    || result.exitCode !== 0 && (result.exitCode !== 1 || result.stdout.trim() !== '')
  ) {
    Errors.throwHostEnvironment('Retained mobile TCP listener inspection is incomplete.')
  }
  const ports = new Set(audit.portFences.map(owner => Number(owner.name.match(/-(\d+)$/u)?.[1])))
  const pids = new Set([audit.controller.pid, ...audit.children.map(child => child.pid)])
  let pid: number | undefined
  let sawPort = false
  let awaitingName = false
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line === '') {
      continue
    }
    if (/^p\d+$/u.test(line)) {
      if (pid !== undefined && (!sawPort || awaitingName)) {
        Errors.throwHostEnvironment('Retained mobile listener output lacks a port for one descriptor.')
      }
      pid = Number(line.slice(1))
      sawPort = false
      awaitingName = false
    } else if (/^f\d+$/u.test(line)) {
      if (pid === undefined || awaitingName) {
        Errors.throwHostEnvironment('Retained mobile listener descriptor has no complete process and port.')
      }
      awaitingName = true
    } else if (line.startsWith('n')) {
      const port = Number(line.match(/:(\d+)$/u)?.[1])
      if (pid === undefined || !awaitingName || !Number.isInteger(port) || port < 1 || port > 65_535) {
        Errors.throwHostEnvironment(
          'Retained mobile listener output lacks complete PID, descriptor, and port evidence.',
        )
      }
      if (pids.has(pid) || ports.has(port)) {
        Errors.throwHostEnvironment('A recorded mobile driver or server port still has a TCP listener.')
      }
      sawPort = true
      awaitingName = false
    } else {
      Errors.throwHostEnvironment('Retained mobile listener output has an unknown field.')
    }
  }
  if (pid !== undefined && (!sawPort || awaitingName)) {
    Errors.throwHostEnvironment('Retained mobile listener output ends without a descriptor port.')
  }
  return true
}
