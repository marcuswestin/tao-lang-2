import { type MachineResourceLease, type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Switch, Time, type TrackedProcess } from '@shared'
import { appDevReservation } from '../simulators/AgentAppDev'
import { AndroidRecovery } from '../simulators/AndroidRecovery'
import { ManagedLoopAcceptanceEvidence, type ManagedLoopInventory } from './ManagedLoopAcceptanceEvidence'
import { createManagedIosFixture, type ManagedIosRuntimeOperations } from './ManagedLoopAcceptanceIosRuntime'

type Target = 'ios' | 'android'
export type ManagedLoopTargetBorrowingEvidence = {
  target: Target
  id?: string
  disposition: 'real-host pass' | 'real-host failure' | 'source regression'
  preserved: boolean
  cleanup: 'not allocated' | 'complete' | 'retained'
  artifacts: string
  processes: TrackedProcess[]
  unresolved: { name: string; generation: string }[]
  detail?: string
}
type Sentinel = {
  id: string
  processes: TrackedProcess[]
  assertPreserved: () => Promise<void>
  cleanup: () => Promise<void>
  releaseForBorrow?: () => Promise<void>
}
type ResourceOperations = {
  [Name in 'acquire' | 'tryAcquire' | 'readOwner' | 'retain' | 'recoverRetained' | 'withCurrentOwners']:
    (typeof MachineResources)[Name]
}

/** Injected source checks remain visibly distinct from real-host borrowing acceptance. */
export type ManagedLoopTargetBorrowingSourceOperations = {
  run: typeof CLI.run
  start: typeof CLI.start
  runSync: typeof CLI.mustRunSync
  tree: typeof ProcessTree
  resources: ResourceOperations
  inventory: () => Promise<ManagedLoopInventory>
  iosRuntime?: Partial<ManagedIosRuntimeOperations>
}
const live: ManagedLoopTargetBorrowingSourceOperations = {
  run: CLI.run,
  start: CLI.start,
  runSync: CLI.mustRunSync,
  tree: ProcessTree,
  resources: MachineResources,
  inventory: ManagedLoopAcceptanceEvidence.inventory,
}

/** The callback borrows only this invocation-created sentinel. It must stop its loop before returning. */
export async function withOwnedBorrowedTarget(
  target: Target,
  artifactRoot: string,
  proof: (id: string) => Promise<void>,
): Promise<ManagedLoopTargetBorrowingEvidence> {
  return await run(target, artifactRoot, proof, live, false)
}

export async function withOwnedBorrowedTargetSourceRegression(
  target: Target,
  artifactRoot: string,
  proof: (id: string) => Promise<void>,
  operations: ManagedLoopTargetBorrowingSourceOperations,
): Promise<ManagedLoopTargetBorrowingEvidence> {
  return await run(target, artifactRoot, proof, operations, true)
}

async function run(
  target: Target,
  artifactRoot: string,
  proof: (id: string) => Promise<void>,
  operations: ManagedLoopTargetBorrowingSourceOperations,
  source: boolean,
): Promise<ManagedLoopTargetBorrowingEvidence> {
  if (target !== 'ios' && target !== 'android') {
    Errors.throwUserInput('Owned borrowing acceptance supports only iOS or Android.')
  }
  const root = FS.resolvePath(`borrowed-${target}`, artifactRoot)
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
  const evidence: ManagedLoopTargetBorrowingEvidence = {
    target,
    disposition: source ? 'source regression' : 'real-host failure',
    preserved: false,
    cleanup: 'not allocated',
    artifacts: root,
    processes: [],
    unresolved: [],
  }
  let sentinel: Sentinel | undefined
  let before: ManagedLoopInventory | undefined
  const save = () => ManagedLoopAcceptanceEvidence.write(root, 'receipt', evidence)
  const failed = (error: unknown): void => {
    evidence.detail = Errors.formatForUser(error)
    if (!source) {
      evidence.disposition = 'real-host failure'
    }
  }
  try {
    before = await operations.inventory()
    await ManagedLoopAcceptanceEvidence.write(root, 'before', before)
    sentinel = await Switch<Target, Promise<Sentinel>>(target, { ios: ios, android: android })
    evidence.id = sentinel.id
    evidence.processes = sentinel.processes.map(process => ({
      ...process,
      command: 'invocation-owned borrowing sentinel',
    }))
    await save()
    await sentinel.assertPreserved()
    await sentinel.releaseForBorrow?.()
    // The sentinel owns no managed AVD/serial or iOS-device lease while the loop borrows it.
    await proof(sentinel.id)
    await sentinel.assertPreserved()
    evidence.preserved = true
    await save()
  } catch (error) {
    failed(error)
  } finally {
    if (sentinel !== undefined) {
      try {
        await sentinel.cleanup()
        evidence.cleanup = 'complete'
      } catch (error) {
        evidence.cleanup = 'retained'
        failed(error)
      }
    }
    try {
      const after = await operations.inventory()
      await ManagedLoopAcceptanceEvidence.write(root, 'after', after)
      const changed = before === undefined ? [] : ManagedLoopAcceptanceEvidence.preserved(before, after)
      await ManagedLoopAcceptanceEvidence.write(root, 'peer-preservation', changed)
      if (changed.length > 0) {
        Errors.throwHostEnvironment(changed.join(' '))
      }
    } catch (error) {
      failed(error)
    }
    if (evidence.preserved && evidence.cleanup === 'complete' && evidence.detail === undefined && !source) {
      evidence.disposition = 'real-host pass'
    }
    await save()
  }
  return evidence

  async function ios(): Promise<Sentinel> {
    const helper = await createManagedIosFixture({
      invocation: FS.basename(artifactRoot),
      scope: Platform.randomUUID(),
      artifactRoot: root,
      baselineResources: before!.resources.map(resource => resource.name),
      shouldStop: () => false,
      externalLedger: false,
    }, {
      run: operations.run,
      start: operations.start,
      tree: operations.tree,
      resources: operations.resources,
      ...operations.iosRuntime,
    })
    const mutate = async (args: string[]) => {
      const result = await helper.run('xcrun', { args, processPolicy: 'test', timeoutMs: 30_000 })
      if (result.error || result.exitCode !== 0) {
        Errors.throwHostEnvironment('Private iOS sentinel operation failed.')
      }
      return result
    }
    type Device = { udid: string; name: string; state?: string; deviceTypeIdentifier?: string; runtime: string }
    const list = async (): Promise<Device[]> => {
      const result = await fixedRun('xcrun', ['simctl', 'list', 'devices', '--json', 'available'])
      const parsed = JSON.parse(result.stdout) as { devices?: Record<string, Omit<Device, 'runtime'>[]> }
      return Object.entries(parsed.devices ?? {}).filter(([runtime]) => runtime.includes('.iOS-')).flatMap((
        [runtime, devices],
      ) => devices.map(device => ({ ...device, runtime })))
    }
    const peers = await list()
    const template = peers.find(device => device.name.includes('iPhone') && device.deviceTypeIdentifier !== undefined)
    if (template?.deviceTypeIdentifier === undefined) {
      Errors.throwHostEnvironment('Owned iOS borrowing requires an installed iPhone simulator runtime.')
    }
    const intent = {
      name: `${helper.selection.namePrefix}1`,
      type: template.deviceTypeIdentifier,
      runtime: template.runtime,
    }
    evidence.cleanup = 'retained'
    const reportOwnedRetention = async () => {
      const names = new Set([
        ...(helper.asset.creation ? [helper.asset.creation.name] : []),
        ...(helper.asset.resources ?? []).map(owner => owner.name),
      ])
      for (const name of names) {
        const owner = await operations.resources.readOwner({ name })
        if (owner && !evidence.unresolved.some(item => item.name === name)) {
          evidence.unresolved.push({ name, generation: owner.id })
        }
      }
    }
    let created: CLI.CommandResult
    try {
      await helper.selection.beforeCreate(intent)
      created = await mutate([
        'simctl',
        'create',
        intent.name,
        template.deviceTypeIdentifier,
        template.runtime,
      ])
      await helper.selection.afterCreate({ ...intent, id: created.stdout.trim() })
    } catch (error) {
      await reportOwnedRetention()
      throw error
    }
    const udid = created.stdout.trim()
    if (!/^[0-9a-f-]{36}$/iu.test(udid) || peers.some(device => device.udid === udid)) {
      Errors.throwHostEnvironment('iOS borrowing did not create a fresh simulator UDID; refusing target control.')
    }
    evidence.id = udid
    evidence.cleanup = 'retained'
    let identity: TrackedProcess | undefined
    let deleted = false
    let producer: MachineResourceLease | undefined
    let producerOwner: MachineResourceOwner | undefined
    let preparationUncertain = false
    const publish = async (owner: MachineResourceOwner) =>
      helper.observeDevice({
        platform: 'ios',
        id: udid,
        owned: true,
        state: 'booted',
        resources: [owner],
        holder: helper.asset.holder,
      })
    const cleanup = async (): Promise<void> => {
      if (deleted) {
        return
      }
      if (preparationUncertain) {
        await reportOwnedRetention()
        Errors.throwHostEnvironment(
          'Private sentinel preparation is uncertain; target and creation fences remain quarantined.',
        )
      }
      const loopOwner = await operations.resources.readOwner({ name: `ios-simulator:${udid}` })
      if (loopOwner !== undefined && (producerOwner === undefined || !sameOwner(loopOwner, producerOwner))) {
        evidence.unresolved = [{ name: loopOwner.name, generation: loopOwner.id }]
        await reportOwnedRetention()
        Errors.throwHostEnvironment('Borrowed iOS loop still holds its device fence; sentinel cleanup is retained.')
      }
      // Reserve only after the borrower releases, so deletion cannot race a fresh reservation.
      const lease = producer ?? await operations.resources.acquire({
        name: `ios-simulator:${udid}`,
        command: 'owned iOS borrowing sentinel cleanup',
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      const expected = producerOwner ?? lease.owner
      try {
        await helper.assertOwners([expected])
        await publish(expected)
        if ((await list()).some(device => device.udid === udid && device.state !== 'Shutdown')) {
          await helper.assertOwners([expected])
          await mutate(['simctl', 'shutdown', udid])
          await helper.assertOwners([expected])
        }
        if (!(await list()).some(device => device.udid === udid && device.state === 'Shutdown')) {
          Errors.throwHostEnvironment('Owned borrowed iOS sentinel shutdown remains unproved.')
        }
        if (
          identity !== undefined
          && operations.tree.sameProcess(operations.tree.identities([identity.pid]).get(identity.pid), identity)
        ) {
          Errors.throwHostEnvironment('Owned borrowed iOS sentinel kernel process remains alive after shutdown.')
        }
        await helper.assertOwners([expected])
        await mutate(['simctl', 'delete', udid])
        await helper.assertOwners([expected])
        if ((await list()).some(device => device.udid === udid)) {
          Errors.throwHostEnvironment('Owned borrowed iOS sentinel deletion remains unproved.')
        }
        await helper.finishProducerDeletion([expected])
        deleted = true
        if (producerOwner !== undefined) {
          await operations.resources.recoverRetained({
            name: expected.name,
            generation: expected.id,
            shutdown: async () => true,
          })
        } else {
          await lease.release()
        }
        producerOwner = undefined
        producer = undefined
        evidence.cleanup = 'complete'
        await external([])
      } catch (error) {
        const current = await operations.resources.readOwner({ name: lease.owner.name })
        if (sameOwner(current, expected)) {
          try {
            const retained = await operations.resources.retain({
              owners: [expected],
              processes: identity === undefined ? [] : [identity],
              quarantined: true,
              reason: 'Owned borrowing sentinel cleanup was not proved.',
            })
            evidence.unresolved = [{ name: retained.name, generation: retained.id }]
          } catch {
            const successor = await operations.resources.readOwner({ name: lease.owner.name })
            evidence.unresolved = successor === undefined ? [] : [{ name: successor.name, generation: successor.id }]
          }
        } else {
          evidence.unresolved = current === undefined ? [] : [{ name: current.name, generation: current.id }]
        }
        await reportOwnedRetention()
        throw error
      }
    }
    try {
      await external([{
        path: FS.resolvePath(`Library/Developer/CoreSimulator/Devices/${udid}`, FS.homeDir()),
        owner: root,
        purpose: 'invocation-owned borrowed iOS sentinel',
        cleanupCondition: 'Remove only after callback completion and verified shutdown.',
        state: 'active',
      }])
      producer = await operations.resources.acquire({
        name: `ios-simulator:${udid}`,
        command: 'private iOS sentinel provisioning',
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
      })
      producerOwner = await operations.resources.retain({
        owners: [producer.owner],
        processes: [],
        quarantined: true,
        reason: 'Private iOS sentinel preparation pending exact child closure.',
      })
      await publish(producerOwner)
      await mutate(['simctl', 'boot', udid])
      const ready = await Time.pollUntil(
        async () => (await list()).some(device => device.udid === udid && device.state === 'Booted') ? true : undefined,
        { intervalMs: 100, timeoutMs: 60_000 },
      )
      if (!ready) {
        Errors.throwHostEnvironment('Owned iOS borrowing sentinel failed to boot.')
      }
      identity = await kernelIdentity()
      try {
        await helper.prepare({
          device: {
            platform: 'ios',
            id: udid,
            owned: true,
            state: 'booted',
            resources: [producerOwner],
            holder: helper.asset.holder,
          },
          reservation: appDevReservation('ios', udid, [producerOwner], operations.resources.readOwner),
          shouldStop: () => false,
        })
      } catch (error) {
        preparationUncertain = error instanceof Errors.HostEnvironmentError
          && error.details?.['retainsTargetLease'] === true
        throw error
      }
      await operations.resources.recoverRetained({
        name: producerOwner.name,
        generation: producerOwner.id,
        shutdown: async () => true,
      })
      producerOwner = undefined
      producer = undefined
      await ManagedLoopAcceptanceEvidence.write(root, 'sentinel-identity', {
        id: udid,
        process: { ...identity, command: 'invocation-created simulator bootstrap' },
      })
      return {
        id: udid,
        processes: [identity],
        cleanup,
        assertPreserved: async () => {
          const current = await kernelIdentity()
          if (
            !(await list()).some(device => device.udid === udid && device.state === 'Booted')
            || current.pid !== identity!.pid || !operations.tree.sameProcess(current, identity!)
          ) {
            Errors.throwHostEnvironment(
              'Stopping the borrower changed the owned iOS sentinel boot state or kernel identity.',
            )
          }
        },
      }
    } catch (error) {
      await cleanup().catch(cleanupError => failed(cleanupError))
      await reportOwnedRetention()
      throw error
    }

    async function kernelIdentity(): Promise<TrackedProcess> {
      const result = await fixedRun('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'managerpid'])
      const pid = Number(result.stdout.trim())
      if (!Number.isSafeInteger(pid) || pid <= 1) {
        Errors.throwHostEnvironment(
          'The owned iOS simulator bootstrap did not expose a host kernel PID; borrowing preservation is unavailable.',
        )
      }
      const current = operations.tree.identities([pid]).get(pid)
      if (current === undefined || !/launchd_sim/iu.test(current.command)) {
        Errors.throwHostEnvironment('The owned iOS simulator bootstrap kernel identity could not be proved.')
      }
      return current
    }
  }

  async function android(): Promise<Sentinel> {
    const avdName = `Tao_Borrow_${Platform.randomUUID().replaceAll('-', '')}`
    const androidUserHome = Platform.runtimeProcess.env['ANDROID_USER_HOME'] ?? FS.resolvePath('.android', FS.homeDir())
    const avdHome = Platform.runtimeProcess.env['ANDROID_AVD_HOME'] ?? FS.resolvePath('avd', androidUserHome)
    const listed = await fixedRun('emulator', ['-list-avds'])
    if (listed.stdout.split(/\r?\n/u).some(name => name.trim() === avdName)) {
      Errors.throwHostEnvironment('The invocation AVD name already exists; refusing adoption.')
    }
    let portLease: MachineResourceLease | undefined
    let serialLease: MachineResourceLease | undefined
    let avdLease: MachineResourceLease | undefined
    let port: number | undefined
    for (let candidate = 5580; candidate <= 5680; candidate += 2) {
      const serialName = `android-emulator:emulator-${candidate}`
      if (await operations.resources.readOwner({ name: serialName }) !== undefined) {
        continue
      }
      const reservation = await operations.resources.tryAcquire({
        name: serialName,
        command: 'owned Android borrowing sentinel provisioning',
        repositoryRoot: Repo.getRoot(),
        // Even a dead foreign generation is a fence here, not allocation authority.
        processIdentity: async () => ({ evidence: 'unknown' }),
      })
      if (reservation === undefined) {
        continue
      }
      let lease: MachineResourceLease | undefined
      try {
        lease = await operations.resources.tryAcquire({
          name: `android-console-port:${candidate}`,
          command: 'owned Android borrowing sentinel',
          repositoryRoot: Repo.getRoot(),
        })
      } catch (error) {
        await reservation.release()
        throw error
      }
      if (lease === undefined) {
        await reservation.release()
        continue
      }
      let transferred = false
      try {
        const busy = await operations.run('lsof', {
          args: ['-nP', `-iTCP:${candidate}-${candidate + 1}`, '-sTCP:LISTEN', '-Fp'],
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        if (busy.error !== undefined || ![0, 1].includes(busy.exitCode ?? -1) || busy.stderr.trim() !== '') {
          Errors.throwHostEnvironment('Borrowing console-port inspection is unavailable; refusing sentinel allocation.')
        }
        if (busy.error === undefined && busy.exitCode === 1 && busy.stdout.trim() === '' && busy.stderr.trim() === '') {
          portLease = lease
          serialLease = reservation
          port = candidate
          transferred = true
          break
        }
      } finally {
        if (!transferred) {
          await lease.release()
          await reservation.release()
        }
      }
    }
    if (portLease === undefined || port === undefined) {
      Errors.throwHostEnvironment(
        'No exclusive console-port pair could be proved for an owned Android borrowing sentinel.',
      )
    }
    let started: CLI.StartedCommand | undefined
    let capture: ReturnType<typeof AndroidRecovery.capture> | undefined
    let provenanceFailed = false
    let retained: MachineResourceOwner | undefined
    let created = false
    let disposed = false
    const cleanupLeases: MachineResourceLease[] = []
    const serial = `emulator-${port}`
    const cleanup = async (): Promise<void> => {
      try {
        await cleanupBody()
      } catch (error) {
        // Retain only generations this sentinel acquired. A borrower owner is report-only.
        const expected = [
          retained ?? portLease!.owner,
          ...[serialLease, avdLease, ...cleanupLeases].flatMap(lease => lease === undefined ? [] : [lease.owner]),
        ]
        const owners: MachineResourceOwner[] = []
        for (const original of expected) {
          const current = await operations.resources.readOwner({ name: original.name })
          if (
            current?.id === original.id && current.pid === original.pid
            && current.processStartedAt === original.processStartedAt
          ) {
            owners.push(original)
          } else if (current !== undefined) {
            evidence.unresolved.push({ name: current.name, generation: current.id })
          }
        }
        if (owners.length > 0) {
          retained = await operations.resources.retain({
            owners,
            processes: capture?.processes ?? [],
            processGroupPid: capture?.rootPid,
            quarantined: true,
            reason: 'Invocation-owned borrowing sentinel cleanup remains unproved.',
          })
          evidence.unresolved = [
            ...evidence.unresolved,
            ...retained.retention!.resourceNames.map(name => ({ name, generation: retained!.id })),
          ]
        }
        throw error
      } finally {
        // Dropping parent pipes is not target shutdown. Retained custody stays published.
        if (!disposed && started !== undefined) {
          await started.closeOutput().catch(() => {})
          started.dispose()
        }
      }
    }
    const cleanupBody = async (): Promise<void> => {
      if (disposed) {
        return
      }
      for (const lease of [serialLease, avdLease]) {
        if (lease !== undefined) {
          cleanupLeases.push(lease)
        }
      }
      serialLease = undefined
      avdLease = undefined
      for (const name of [`android-avd:${avdName}`, `android-emulator:${serial}`]) {
        const owner = await operations.resources.readOwner({ name })
        if (owner !== undefined && !cleanupLeases.some(lease => sameOwner(owner, lease.owner))) {
          evidence.unresolved = [{ name, generation: owner.id }]
          Errors.throwHostEnvironment(
            'Borrowed Android loop still holds its device fence; sentinel cleanup is retained.',
          )
        }
      }
      for (const name of [`android-avd:${avdName}`, `android-emulator:${serial}`]) {
        if (!cleanupLeases.some(lease => lease.owner.name === name)) {
          cleanupLeases.push(
            await operations.resources.acquire({
              name,
              command: 'owned Android borrowing sentinel cleanup',
              repositoryRoot: Repo.getRoot(),
              waitTimeoutMs: 0,
              processIdentity: async () => ({ evidence: 'unknown' }),
            }),
          )
        }
      }
      const assertCleanup = async () => {
        for (const lease of cleanupLeases) {
          await lease.assertCurrent(lease.generation)
        }
        const expected = retained ?? portLease!.owner
        const current = await operations.resources.readOwner({ name: expected.name })
        if (
          current?.id !== expected.id || current.pid !== expected.pid
          || current.processStartedAt !== expected.processStartedAt
        ) {
          Errors.throwHostEnvironment(
            'Owned Android borrowing sentinel console generation changed; refusing cleanup continuation.',
          )
        }
      }
      await assertCleanup()
      if (started !== undefined) {
        if (capture === undefined || capture.uncertain || provenanceFailed) {
          Errors.throwHostEnvironment(
            'Owned Android borrowing sentinel provenance failed; refusing fresh cleanup authority.',
          )
        }
        capture = AndroidRecovery.capture(started, { processTree: operations.tree }, capture)
        if (capture.uncertain) {
          provenanceFailed = true
          Errors.throwHostEnvironment(
            'Owned Android borrowing sentinel kernel provenance changed; refusing cleanup signals.',
          )
        }
        const guardedRun: typeof CLI.run = async (command, spec) => {
          await assertCleanup()
          if (
            command === 'adb' && spec?.args?.[0] === '-s' && spec.args[1] === serial && spec.args[2] === 'emu'
            && spec.args[3] === 'kill'
          ) {
            // Kernel authority must be fresh after the last awaited registry check.
            assertKernel()
          }
          const result = await operations.run(command, spec)
          await assertCleanup()
          return result
        }
        const assertKernel = (): void => {
          if (capture === undefined || capture.uncertain || provenanceFailed) {
            Errors.throwHostEnvironment('Owned Android borrowing sentinel no longer has cleanup provenance.')
          }
          const current = operations.tree.identities(capture.processes.map(process => process.pid))
          if (
            capture.processes.some(expected =>
              (current.has(expected.pid) && !operations.tree.sameProcess(current.get(expected.pid), expected))
              || (!current.has(expected.pid) && Platform.processIsAlive(expected.pid))
            )
          ) {
            provenanceFailed = true
            Errors.throwHostEnvironment(
              'Owned Android borrowing sentinel kernel changed before a destructive continuation.',
            )
          }
        }
        let closed = false
        const closing = started.waitForClose().then(() => {
          closed = true
        }).catch(() => {})
        const waitStopped = async (): Promise<boolean> =>
          await Time.pollUntil(async () => {
            await assertCleanup()
            assertKernel()
            const current = operations.tree.identities(capture!.processes.map(process => process.pid))
            return closed && capture!.processes.every(process =>
                !operations.tree.sameProcess(current.get(process.pid), process)
              )
                && (capture!.rootPid === undefined || !operations.tree.isGroupAlive(capture!.rootPid))
              ? true
              : undefined
          }, { intervalMs: 100, timeoutMs: 30_000 }) === true
        // Inspection failures and generation changes propagate before any fallback signal.
        await ownsConsole(false, guardedRun)
        await assertCleanup()
        assertKernel()
        await guardedRun('adb', { args: ['-s', serial, 'emu', 'kill'], processPolicy: 'test', timeoutMs: 30_000 })
        let stopped = await waitStopped()
        for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
          if (stopped) {
            break
          }
          await assertCleanup()
          capture = AndroidRecovery.capture(started, { processTree: operations.tree }, capture)
          assertKernel()
          await assertCleanup()
          assertKernel()
          operations.tree.signalTracked(capture!.processes, signal)
          stopped = await waitStopped()
        }
        if (!stopped) {
          evidence.unresolved = [{ name: retained!.name, generation: retained!.id }]
          Errors.throwHostEnvironment(
            'Owned borrowed Android sentinel shutdown remains unproved; console fence is retained.',
          )
        }
        await closing
        await assertCleanup()
        const remaining = await guardedRun('lsof', {
          args: ['-nP', `-iTCP:${port}-${port! + 1}`, '-sTCP:LISTEN', '-Fp'],
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        if (
          remaining.error !== undefined || remaining.exitCode !== 1 || remaining.stdout.trim() !== ''
          || remaining.stderr.trim() !== ''
        ) {
          Errors.throwHostEnvironment(
            'Owned borrowed Android sentinel console listener disappearance remains unproved.',
          )
        }
        await started.closeOutput()
        started.dispose()
      }
      if (created) {
        await assertCleanup()
        await fixedRun('avdmanager', ['delete', 'avd', '--name', avdName])
        await assertCleanup()
        if ((await fixedRun('emulator', ['-list-avds'])).stdout.split(/\r?\n/u).some(name => name.trim() === avdName)) {
          Errors.throwHostEnvironment('Owned borrowed Android sentinel AVD deletion remains unproved.')
        }
      }
      await assertCleanup()
      if (retained !== undefined) {
        await operations.resources.recoverRetained({
          name: retained.name,
          generation: retained.id,
          shutdown: async () => true,
        })
      } else {
        await portLease!.release()
      }
      disposed = true
      for (const lease of cleanupLeases) {
        await lease.release()
      }
      evidence.cleanup = 'complete'
      await external([])
    }
    try {
      avdLease = await operations.resources.acquire({
        name: `android-avd:${avdName}`,
        command: 'owned Android borrowing sentinel provisioning',
        repositoryRoot: Repo.getRoot(),
        waitTimeoutMs: 0,
        processIdentity: async () => ({ evidence: 'unknown' }),
      })
      await operations.resources.withCurrentOwners(
        { owners: [portLease.owner, serialLease!.owner, avdLease.owner] },
        () => undefined,
      )
      await fixedRun('avdmanager', [
        'create',
        'avd',
        '--name',
        avdName,
        '--package',
        'system-images;android-36;google_apis;arm64-v8a',
        '--device',
        'pixel',
      ], 'no\n')
      created = true
      evidence.cleanup = 'retained'
      await external([{
        path: FS.resolvePath(`${avdName}.avd`, avdHome),
        companionFile: FS.resolvePath(`${avdName}.ini`, avdHome),
        owner: root,
        purpose: 'invocation-owned borrowed Android sentinel',
        cleanupCondition:
          'Delete only after captured child close, descendant/group/listener disappearance and borrower fence release.',
        state: 'active',
      }])
      const stdoutPath = FS.resolvePath(`sentinel-${Platform.randomUUID()}.stdout.log`, root)
      const stderrPath = FS.resolvePath(`sentinel-${Platform.randomUUID()}.stderr.log`, root)
      await FS.writeExclusiveFile(stdoutPath, '', { mode: 0o600 })
      await FS.writeExclusiveFile(stderrPath, '', { mode: 0o600 })
      const stdout = await FS.openAppend(stdoutPath)
      let stderr: Awaited<ReturnType<typeof FS.openAppend>> | undefined
      try {
        stderr = await FS.openAppend(stderrPath)
        started = await operations.resources.withCurrentOwners({
          owners: [portLease.owner, serialLease!.owner, avdLease.owner],
        }, () => {
          let listeners: CLI.CommandResult
          try {
            listeners = operations.runSync('lsof', {
              args: ['-nP', `-iTCP:${port}-${port! + 1}`, '-sTCP:LISTEN', '-Fp'],
            })
          } catch (error) {
            if (!(error instanceof Errors.CommandExecutionError)) {
              throw error
            }
            const result = error.result
            if (result.exitCode !== 1 || result.error !== undefined || result.stdout !== '' || result.stderr !== '') {
              throw error
            }
            listeners = { ...result, args: [...result.args], signal: null }
          }
          if (
            listeners.error !== undefined || listeners.exitCode !== 1 || listeners.stdout.trim() !== ''
            || listeners.stderr.trim() !== ''
          ) {
            Errors.throwHostEnvironment('The reserved borrowing console acquired a listener before launch.')
          }
          return operations.start('emulator', {
            args: [
              '-avd',
              avdName,
              '-port',
              String(port),
              '-memory',
              '2048',
              '-no-window',
              '-no-audio',
              '-netdelay',
              'none',
              '-netspeed',
              'full',
            ],
            detached: true,
            processPolicy: 'server',
            // File descriptors remain writable by a retained child after this parent exits.
            stdio: ['ignore', stdout.fd, stderr!.fd],
            unref: true,
          })
        })
      } finally {
        await stdout.close()
        await stderr?.close()
      }
      const captured = await Time.pollUntil(() => {
        const state = AndroidRecovery.capture(started!, { processTree: operations.tree }, capture)
        capture = state
        provenanceFailed ||= state.uncertain
        return !state.uncertain && state.processes.length > 0 ? true : undefined
      }, {
        intervalMs: 25,
        // budget-ok: source regressions exercise synthetic missing capture, not host timing.
        timeoutMs: source ? 10 : 30_000,
      })
      if (!captured || capture === undefined) {
        Errors.throwHostEnvironment('Owned Android borrowing sentinel kernel capture is unavailable.')
      }
      retained = await operations.resources.retain({
        owners: [portLease.owner],
        processes: capture.processes,
        processGroupPid: capture.rootPid,
        quarantined: false,
        reason: 'External-style invocation-owned borrowing sentinel console port.',
      })
      const ready = await Time.pollUntil(async () => {
        capture = AndroidRecovery.capture(started!, { processTree: operations.tree }, capture)
        if (!await ownsConsole(true)) {
          return undefined
        }
        const boot = await operations.run('adb', {
          args: ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
          timeoutMs: 30_000,
          processPolicy: 'test',
        })
        if (boot.error !== undefined || boot.exitCode !== 0) {
          return undefined
        }
        return boot.stdout.trim() === '1' ? true : undefined
      }, {
        intervalMs: 1_000,
        timeoutMs: 180_000,
        stop: () => started?.error !== undefined || started?.exitCode !== null || started?.signalCode !== null,
      })
      if (!ready) {
        Errors.throwHostEnvironment('Owned Android borrowing sentinel failed to boot; no emulator was adopted.')
      }
      const rootProcess = capture.processes.find(process => process.pid === capture!.rootPid)
      if (rootProcess === undefined) {
        Errors.throwHostEnvironment('Owned Android borrowing sentinel root identity is unavailable.')
      }
      await ManagedLoopAcceptanceEvidence.write(root, 'sentinel-identity', {
        avdName,
        serial,
        consolePort: port,
        generation: retained.id,
        processes: capture.processes.map(process => ({ ...process, command: 'invocation-owned Android sentinel' })),
      })
      return {
        id: serial,
        processes: capture.processes,
        cleanup,
        releaseForBorrow: async () => {
          await serialLease!.assertCurrent(serialLease!.generation)
          await avdLease!.assertCurrent(avdLease!.generation)
          await operations.resources.withCurrentOwners(
            { owners: [retained!, serialLease!.owner, avdLease!.owner] },
            () => undefined,
          )
          await serialLease!.release()
          serialLease = undefined
          await avdLease!.release()
          avdLease = undefined
          await operations.resources.withCurrentOwners({ owners: [retained!] }, () => undefined)
        },
        assertPreserved: async () => {
          const current = operations.tree.identities([rootProcess.pid]).get(rootProcess.pid)
          if (!operations.tree.sameProcess(current, rootProcess)) {
            Errors.throwHostEnvironment('Stopping the borrower changed the owned Android sentinel kernel identity.')
          }
          await ownsConsole()
          const boot = await fixedRun('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])
          if (boot.stdout.trim() !== '1') {
            Errors.throwHostEnvironment('Stopping the borrower changed the owned Android sentinel boot state.')
          }
        },
      }
    } catch (error) {
      await cleanup().catch(cleanupError => failed(cleanupError))
      throw error
    }

    async function ownsConsole(booting = false, run: typeof CLI.run = operations.run): Promise<boolean> {
      const name = await run('adb', {
        args: ['-s', serial, 'emu', 'avd', 'name'],
        timeoutMs: 30_000,
        processPolicy: 'test',
      })
      if (name.error !== undefined || name.exitCode !== 0) {
        if (booting) {
          return false
        }
        Errors.throwHostEnvironment('The owned borrowing console cannot be inspected.')
      }
      if (name.stdout.split(/\r?\n/u).find(line => line.trim() !== '' && line.trim() !== 'OK')?.trim() !== avdName) {
        Errors.throwHostEnvironment('The allocated borrowing console does not belong to the invocation-created AVD.')
      }
      const listener = await run('lsof', {
        args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'],
        timeoutMs: 30_000,
        processPolicy: 'test',
      })
      if (
        booting && listener.error === undefined && listener.exitCode === 1 && listener.stdout.trim() === ''
        && listener.stderr.trim() === ''
      ) {
        return false
      }
      if (listener.error !== undefined || listener.exitCode !== 0) {
        Errors.throwHostEnvironment('The owned borrowing console listener cannot be inspected.')
      }
      const pids = listener.stdout.split(/\r?\n/u).flatMap(line =>
        /^p(\d+)$/u.test(line) ? [Number(line.slice(1))] : []
      )
      const identities = operations.tree.identities(pids)
      if (
        pids.length === 0 || capture === undefined || capture.uncertain
        || pids.some(pid =>
          !capture!.processes.some(expected =>
            expected.pid === pid && operations.tree.sameProcess(identities.get(pid), expected)
          )
        )
      ) {
        Errors.throwHostEnvironment('The borrowing console listener lacks invocation-owned kernel proof.')
      }
      return true
    }
  }

  async function fixedRun(
    command: 'xcrun' | 'emulator' | 'avdmanager' | 'adb' | 'lsof',
    args: string[],
    stdin?: string,
  ): Promise<CLI.CommandResult> {
    const result = await operations.run(command, { args, stdin, processPolicy: 'test', timeoutMs: 60_000 })
    if (result.error !== undefined || result.exitCode !== 0) {
      Errors.throwHostEnvironment(
        `Owned borrowing sentinel ${command} operation is unavailable or failed; no dependency installation is attempted.`,
      )
    }
    return result
  }

  async function external(records: unknown[]): Promise<void> {
    await ManagedLoopAcceptanceEvidence.write(root, 'external-directories', records)
    await save()
  }
}

function sameOwner(current: MachineResourceOwner | undefined, expected: MachineResourceOwner): boolean {
  return current?.id === expected.id && current.pid === expected.pid
    && current.processStartedAt === expected.processStartedAt && current.repositoryRoot === expected.repositoryRoot
}
