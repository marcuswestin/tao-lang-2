import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import {
  type ManagedLoopTargetFaultCase,
  type ManagedLoopTargetFaultSourceOperations,
  runManagedLoopTargetFaultSourceRegression,
} from '../dev-cli-src/dev-loop/ManagedLoopTargetFaults'

import { managedLoopAndroidPrefix } from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceAndroidTarget'
import { managedIosRuntimeSourceOperations } from './managed-loop-acceptance-ios-runtime-fixture'

const peerUdid = '11111111-1111-1111-1111-111111111111'
const ownedUdid = '22222222-2222-2222-2222-222222222222'

async function fixture(unprovedShutdown = false) {
  const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${Platform.randomUUID()}`)
  await FS.mkdir(root)
  const registryRoot = FS.resolvePath('registry', root)
  const calls: string[][] = []
  const peers = [{ udid: peerUdid, name: 'Developer iPhone', state: 'Booted', deviceTypeIdentifier: 'iPhone-type' }]
  let created = false
  let ownedState = 'Shutdown'
  let mintedName = ''
  const bootstrap: TrackedProcess = { pid: 2 ** 29, startedAt: 'owned-source-bootstrap', command: 'launchd_sim' }
  const result = (stdout = ''): CLI.CommandResult => ({
    args: [],
    command: 'source fixture',
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout,
  })
  const resourceOptions = <T extends object>(options: T) => ({ ...options, registryRoot })
  const operations: ManagedLoopTargetFaultSourceOperations = {
    android: {
      acquireResource: options => MachineResources.acquire(resourceOptions(options)),
      tryAcquireResource: options => MachineResources.tryAcquire(resourceOptions(options)),
      run: async () => Errors.throwUnexpected('iOS fault regression must not invoke Android.'),
      start: () => Errors.throwUnexpected('iOS fault regression must not spawn a child.'),
      write: () => {},
      writeError: () => {},
    },
    resources: {
      acquire: options => MachineResources.acquire(resourceOptions(options)),
      readOwner: options => MachineResources.readOwner(resourceOptions(options)),
      listOwners: () => MachineResources.listOwners({ registryRoot }),
      retain: options => MachineResources.retain(resourceOptions(options)),
      recoverRetained: options => MachineResources.recoverRetained(resourceOptions(options)),
      withCurrentOwners: (options, action) => MachineResources.withCurrentOwners(resourceOptions(options), action),
    },
    inventory: async () => ({ processCount: 1, peers: [], resources: [] }),
    processTree: {
      ...ProcessTree,
      identities: pids =>
        new Map(pids.flatMap(pid =>
          pid === bootstrap.pid
            ? (ownedState === 'Booted' ? [[pid, bootstrap] as const] : [])
            : [...ProcessTree.identities([pid])]
        )),
    },
    start: () => Errors.throwUnexpected('iOS fault regression must not spawn a child.'),
    run: async (command, spec) => {
      Expect(command).toBe('xcrun')
      const args = spec?.args ?? []
      calls.push([...args])
      if (args[1] === 'list') {
        return result(JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
              ...peers,
              ...(created
                ? [{ name: mintedName, deviceTypeIdentifier: 'iPhone-type', udid: ownedUdid, state: ownedState }]
                : []),
            ],
          },
        }))
      }
      if (args[1] === 'create') {
        created = true
        mintedName = args[2]!
        return result(ownedUdid)
      }
      Expect(args[2]).toBe(ownedUdid)
      if (args[1] === 'spawn') {
        return result(String(bootstrap.pid))
      }
      if (args[1] === 'boot') {
        ownedState = 'Booted'
      }
      if (args[1] === 'shutdown' && !unprovedShutdown) {
        ownedState = 'Shutdown'
      }
      if (args[1] === 'delete') {
        Expect(ownedState).toBe('Shutdown')
        created = false
      }
      return result()
    },
  }
  operations.iosRuntime = managedIosRuntimeSourceOperations({
    run: (command, spec) => operations.run(command, spec),
    tree: operations.processTree,
    resources: operations.resources,
  })
  return { root, operations, calls, peers, registryRoot }
}

Test('Target-fault source regressions preserve an existing booted simulator and fence stale generations', async () => {
  const f = await fixture()
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('ios-recovery', f.root, f.operations)
    Expect(evidence.disposition).toBe('source regression')
    Expect(evidence.detail).toBeUndefined()
    Expect(evidence.unresolved).toEqual([])
    Expect(evidence.events.some(event => event.action === 'stale iOS generation refused')).toBe(true)
    Expect(
      evidence.events.some(event =>
        event.action === 'owned iOS shutdown deliberately withheld; exact fence retained' && event.injected
      ),
    ).toBe(true)
    Expect(f.calls.filter(args => ['boot', 'shutdown', 'delete'].includes(args[1]!)).map(args => args[2])).toEqual([
      ownedUdid,
      ownedUdid,
      ownedUdid,
    ])
    Expect(f.peers[0]?.state).toBe('Booted')
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
    const receipt = await FS.readJson<{ disposition: string }>(FS.resolvePath('ios-recovery/receipt.json', f.root))
    Expect(receipt.disposition).toBe('source regression')
  } finally {
    await FS.remove(f.root)
  }
})

Test('Target-fault recovery refuses a success exit without genuine shutdown inventory proof', async () => {
  const f = await fixture(true)
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('ios-recovery', f.root, f.operations)
    Expect(evidence.detail).toContain('unresolved bootstrap kernel process')
    Expect(evidence.unresolved).toHaveLength(2)
    Expect(f.calls.some(args => args[1] === 'delete')).toBe(false)
    const owners = await MachineResources.listOwners({ registryRoot: f.registryRoot })
    Expect(owners.filter(owner => owner.name === `ios-simulator:${ownedUdid}`)).toHaveLength(1)
    const deviceOwner = owners.find(owner => owner.name === `ios-simulator:${ownedUdid}`)
    Expect(deviceOwner?.retention?.quarantined).toBe(true)
    Expect(deviceOwner?.id).toBe(
      evidence.unresolved.find(owner => owner.name === `ios-simulator:${ownedUdid}`)?.generation,
    )
  } finally {
    await FS.remove(f.root)
  }
})

Test('Target-fault iOS cleanup rechecks rotation after shutdown and refuses deletion', async () => {
  const f = await fixture()
  const original = f.operations.run
  let rotated = false
  f.operations.run = async (command, spec) => {
    const result = await original(command, spec)
    if (spec?.args?.[1] === 'shutdown' && !rotated) {
      const owner = await f.operations.resources.readOwner({ name: `ios-simulator:${ownedUdid}` })
      Expect(owner).toBeDefined()
      await f.operations.resources.retain({
        owners: [owner!],
        processes: [],
        quarantined: true,
        reason: 'concurrent generation rotation',
      })
      rotated = true
    }
    return result
  }
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('ios-recovery', f.root, f.operations)
    Expect(f.calls.some(args => args[1] === 'delete')).toBe(false)
    Expect(evidence.detail).toContain('generation changed')
    Expect(evidence.unresolved).toHaveLength(2)
    Expect(evidence.createdTargets?.[0]?.cleanup).toBe('retained')
  } finally {
    await FS.remove(f.root)
  }
})

Test('Target-fault iOS retain failure safely deletes its fresh shutdown target under the original lease', async () => {
  const f = await fixture()
  const retain = f.operations.resources.retain
  f.operations.resources.retain = async options =>
    options.owners[0]?.name === `ios-simulator:${ownedUdid}`
      ? Errors.throwHostEnvironment('Injected retain failure')
      : await retain(options)
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('ios-recovery', f.root, f.operations)
    Expect(evidence.detail).toContain('Injected retain failure')
    Expect(f.calls.filter(args => args[1] === 'delete').map(args => args[2])).toEqual([ownedUdid])
    Expect(evidence.unresolved).toEqual([])
    Expect(evidence.createdTargets?.[0]?.cleanup).toBe('complete')
  } finally {
    await FS.remove(f.root)
  }
})

Test(
  'Target-fault iOS post-create acquisition failure records its target and cleans only after acquiring it',
  async () => {
    const f = await fixture()
    const acquire = f.operations.resources.acquire
    let attempts = 0
    f.operations.resources.acquire = async options => {
      if (options.name === `ios-simulator:${ownedUdid}`) {
        attempts++
      }
      if (options.name === `ios-simulator:${ownedUdid}` && attempts === 1) {
        Errors.throwHostEnvironment('Injected initial acquisition failure')
      }
      return await acquire(options)
    }
    try {
      const evidence = await runManagedLoopTargetFaultSourceRegression('ios-recovery', f.root, f.operations)
      Expect(evidence.detail).toContain('Injected initial acquisition failure')
      Expect(attempts).toBe(2)
      Expect(f.calls.filter(args => args[1] === 'delete').map(args => args[2])).toEqual([ownedUdid])
      Expect(evidence.createdTargets?.[0]?.cleanup).toBe('complete')
    } finally {
      await FS.remove(f.root)
    }
  },
)

for (
  const rejection of [
    'wrong-holder',
    'stale-generation',
    'absent-proof',
    'proved-gap',
    'helper-wait-rejected',
    'child-cleanup-rejected',
    'output-close-rejected',
    'dispose-rejected',
    'group-inspection-transient',
    'identity-inspection-transient',
    'group-inspection-EPERM',
    'group-inspection-error',
    'foreign-group-remains',
    'unreadable-live-descendant',
    'liveness-inspection-transient',
    'liveness-inspection-error',
    'readable-foreign-identity',
  ] as const
) {
  Test(`Target-fault quarantine ${rejection} preserves both fences and independent cleanup`, async () => {
    const f = await fixture()
    const helperPid = 2 ** 29 + 10
    const childPid = helperPid + 1
    const helperIdentity: TrackedProcess = {
      pid: helperPid,
      startedAt: 'fresh-helper-kernel-start',
      command: 'owned helper',
    }
    const childIdentity: TrackedProcess = {
      pid: childPid,
      startedAt: 'untrusted-child-start',
      command: 'untrusted child',
    }
    const escapedIdentity: TrackedProcess = {
      pid: childPid + 1,
      startedAt: 'owned-escaped-descendant-start',
      command: 'owned escaped descendant',
    }
    const capturedChildren = rejection === 'unreadable-live-descendant'
        || rejection === 'liveness-inspection-transient' || rejection === 'liveness-inspection-error'
      ? [childIdentity, escapedIdentity]
      : [childIdentity]
    const closed = Deferred<CLI.CommandCloseResult>()
    const childSignals: string[] = []
    const deliveredChildSignals: string[] = []
    const deliveredEscapedSignals: string[] = []
    const cleanupObservations: string[] = []
    const phaseDeadlines: number[] = []
    const livenessCalls: number[] = []
    let clock = 10_000
    let inspectionCalls = 0
    let retainedGeneration = ''
    f.operations.quarantineCleanupClock = {
      now: () => clock,
      sleep: async ms => {
        Expect(ms).toBe(100)
        clock += ms
      },
    }
    f.operations.quarantineCleanupProcessIsAlive = pid => {
      Expect(capturedChildren.map(process => process.pid)).toContain(pid)
      livenessCalls.push(pid)
      if (pid === escapedIdentity.pid) {
        if (
          rejection === 'liveness-inspection-error'
          || (rejection === 'liveness-inspection-transient' && inspectionCalls++ === 0)
        ) {
          Errors.throwHostEnvironment('Could not determine whether the process is alive.', {
            cause: { code: 'EIO', errno: 5, syscall: 'kill', message: 'source liveness inspection failure' },
          })
        }
        return rejection === 'unreadable-live-descendant'
      }
      return false
    }
    const avdName = `${managedLoopAndroidPrefix(FS.basename(f.root))}1`
    const resourceName = `android-avd:${avdName}`
    const serialName = 'android-emulator:emulator-5582'
    let helperAlive = true
    let childAlive = true
    let helperFinished = false
    let waits = 0
    let disposed = false
    let outputClosed = false
    const listed = f.operations.resources.listOwners
    f.operations.resources.listOwners = async () => (await listed()).map(owner => ({ ...owner, pid: helperPid }))
    f.operations.processTree = {
      ...ProcessTree,
      identities: pids =>
        new Map(pids.flatMap(pid => {
          if (pid === helperPid && helperAlive) {
            return [[pid, helperIdentity] as const]
          }
          if (pid === childPid) {
            if (childSignals.length > 0) {
              cleanupObservations.push('identities')
              if (rejection === 'identity-inspection-transient' && inspectionCalls++ === 0) {
                Errors.throwHostEnvironment('Injected identity inspection failure')
              }
            }
            if (childAlive) {
              return [[pid, childIdentity] as const]
            }
            if (rejection === 'foreign-group-remains' || rejection === 'readable-foreign-identity') {
              return [[pid, { ...childIdentity, startedAt: 'foreign-reused-kernel-start' }] as const]
            }
            return []
          }
          if (pid === escapedIdentity.pid) {
            return childSignals.length === 0 ? [[pid, escapedIdentity] as const] : []
          }
          const current = ProcessTree.identities([pid]).get(pid)
          return current === undefined ? [] : [[pid, current] as const]
        })),
      descendants: () => capturedChildren,
      isGroupAlive: group => {
        Expect(group).toBe(childPid)
        cleanupObservations.push('group')
        if (rejection === 'group-inspection-transient' && inspectionCalls++ === 0) {
          Errors.throwHostEnvironment('Injected transient group inspection failure')
        }
        if (rejection === 'group-inspection-EPERM' || rejection === 'group-inspection-error') {
          const code = rejection === 'group-inspection-EPERM' && inspectionCalls++ < 600 ? 'EPERM' : 'EIO'
          Errors.throwHostEnvironment('Could not inspect captured process group.', {
            cause: {
              code,
              errno: code === 'EPERM' ? 1 : 5,
              syscall: 'kill',
              message: 'source inspection failure',
            },
          })
        }
        return rejection === 'foreign-group-remains'
      },
      signalTracked: (processes, signal) => {
        if (processes.some(process => process.pid === childPid)) {
          Expect(processes).toEqual(capturedChildren)
          childSignals.push(signal)
          phaseDeadlines.push(clock + 30_000)
          if (rejection === 'child-cleanup-rejected') {
            Errors.throwHostEnvironment(`Injected child cleanup failure ${childSignals.length}`)
          }
          ProcessTree.signalTracked(processes, signal, {
            identities: () =>
              new Map(
                childAlive
                  ? [[childPid, childIdentity]]
                  : rejection === 'readable-foreign-identity' || rejection === 'foreign-group-remains'
                  ? [[childPid, { ...childIdentity, startedAt: 'foreign-reused-kernel-start' }]]
                  : [],
              ),
            signal: pids => {
              if (pids.includes(childPid)) {
                deliveredChildSignals.push(signal)
                childAlive = false
              }
              if (pids.includes(escapedIdentity.pid)) {
                deliveredEscapedSignals.push(signal)
              }
            },
          })
        }
        if (processes.some(process => process.pid === helperPid)) {
          helperAlive = rejection === 'helper-wait-rejected'
          closed.resolve({ exitCode: null, signal: 'SIGKILL' })
        }
      },
    }
    f.operations.start = (command, spec) => {
      Expect(command).toBe(Platform.runtimeProcess.execPath)
      const artifactRoot = spec!.args![1]!
      void (async () => {
        const lease = await f.operations.resources.acquire({
          name: resourceName,
          command: 'source gap intent',
          repositoryRoot: Repo.getRoot(),
        })
        const serialLease = await f.operations.resources.acquire({
          name: serialName,
          command: 'source private serial',
          repositoryRoot: Repo.getRoot(),
        })
        const owner = await f.operations.resources.retain({
          owners: [lease.owner, serialLease.owner],
          processes: [],
          quarantined: true,
          reason: `Android emulator ${avdName} launch intent; child identity is not yet captured.`,
        })
        Expect(owner.processStartedAt).toBeUndefined()
        retainedGeneration = owner.id
        await FS.writeJson(FS.resolvePath('launch-intent.json', artifactRoot), {
          platform: 'android',
          id: 'emulator-5582',
          avdName,
          owned: true,
          state: 'reserved',
          generation: owner.id,
          holder: helperIdentity,
          resources: [owner, { ...owner, name: serialName }],
        })
        if (rejection !== 'absent-proof') {
          await FS.writeJson(FS.resolvePath('spawn-gap-proof.json', artifactRoot), {
            avdName,
            generation: rejection === 'stale-generation' ? 'stale-generation' : owner.id,
            holder: rejection === 'wrong-holder'
              ? { ...helperIdentity, startedAt: 'stale-holder-start' }
              : helperIdentity,
            resources: [owner, { ...owner, name: serialName }],
            capture: { processes: capturedChildren, rootPid: childPid, uncertain: false },
          })
        } else {
          helperFinished = true
        }
      })()
      return {
        command,
        args: [...spec?.args ?? []],
        pid: helperPid,
        get exitCode() {
          return helperFinished ? 1 : null
        },
        signalCode: null,
        closeOutput: async () => {
          outputClosed = true
          if (rejection === 'output-close-rejected') {
            Errors.throwHostEnvironment('Injected output close failure')
          }
        },
        dispose: () => {
          disposed = true
          if (rejection === 'dispose-rejected') {
            Errors.throwHostEnvironment('Injected dispose failure')
          }
        },
        endStdin: () => {},
        onceClose: () => {},
        onceError: () => {},
        waitForClose: async () => {
          waits++
          if (rejection === 'helper-wait-rejected') {
            Errors.throwHostEnvironment(`Injected helper wait failure ${waits}`)
          }
          return await closed.promise
        },
        writeStdin: () => true,
        kill: () => false,
      }
    }
    try {
      const evidence = await runManagedLoopTargetFaultSourceRegression('android-quarantine', f.root, f.operations)
      if (
        rejection === 'proved-gap' || rejection === 'group-inspection-transient'
        || rejection === 'identity-inspection-transient' || rejection === 'liveness-inspection-transient'
        || rejection === 'readable-foreign-identity'
      ) {
        Expect(evidence.detail).toBeUndefined()
        Expect(childSignals).toEqual(['SIGTERM', 'SIGTERM'])
        Expect(evidence.events.some(event => event.action === 'genuine abrupt owned holder kill completed')).toBe(
          true,
        )
        Expect(
          evidence.events.some(event =>
            event.action === 'unknown quarantine recovery refused without signals; intent retained'
          ),
        ).toBe(true)
        const owners = await f.operations.resources.listOwners()
        Expect(owners.every(owner => owner.retention?.quarantined && owner.retention.processes.length === 0)).toBe(
          true,
        )
        Expect(f.calls.some(args => args.includes('delete'))).toBe(false)
        Expect(evidence.quarantineCleanupInspectionFailure).toBeUndefined()
        if (rejection === 'readable-foreign-identity') {
          Expect(livenessCalls).toEqual([])
          Expect(deliveredChildSignals).toEqual(['SIGTERM'])
          Expect(clock).toBe(10_000)
        } else if (rejection !== 'proved-gap') {
          Expect(clock).toBe(10_100)
          Expect(cleanupObservations).toEqual(
            rejection === 'group-inspection-transient'
              ? ['identities', 'group', 'identities', 'group', 'identities', 'group']
              : ['identities', 'identities', 'group', 'identities', 'group'],
          )
          if (rejection === 'liveness-inspection-transient') {
            Expect(livenessCalls).toEqual([
              childPid,
              escapedIdentity.pid,
              childPid,
              escapedIdentity.pid,
              childPid,
              escapedIdentity.pid,
            ])
          }
        }
      } else if (
        rejection === 'group-inspection-EPERM' || rejection === 'group-inspection-error'
        || rejection === 'foreign-group-remains' || rejection === 'unreadable-live-descendant'
        || rejection === 'liveness-inspection-error'
      ) {
        Expect(evidence.detail).toBeDefined()
        Expect(evidence.detail).toContain('Independent quarantine child cleanup remains unproved')
        Expect(
          evidence.events.some(event =>
            event.action === 'independently captured child stopped; unknown launch intent remains fenced'
          ),
        )
          .toBe(false)
        Expect(childSignals).toEqual(['SIGTERM', 'SIGKILL', 'SIGTERM', 'SIGKILL'])
        Expect(deliveredChildSignals).toEqual(['SIGTERM'])
        Expect(phaseDeadlines).toEqual([40_000, 70_000, 100_000, 130_000])
        Expect(clock).toBe(130_000)
        const livenessRefused = rejection === 'unreadable-live-descendant' || rejection === 'liveness-inspection-error'
        Expect(cleanupObservations).toHaveLength(livenessRefused ? 1200 : 2400)
        Expect(cleanupObservations.filter(stage => stage === 'group')).toHaveLength(livenessRefused ? 0 : 1200)
        if (livenessRefused) {
          Expect(livenessCalls).toHaveLength(2400)
          Expect(livenessCalls.filter(pid => pid === escapedIdentity.pid)).toHaveLength(1200)
        }
        if (rejection === 'foreign-group-remains' || rejection === 'unreadable-live-descendant') {
          Expect(evidence.quarantineCleanupInspectionFailure).toBeUndefined()
        } else {
          Expect(evidence.quarantineCleanupInspectionFailure?.rootPid).toBe(childPid)
          Expect(evidence.quarantineCleanupInspectionFailure?.stage).toBe(
            rejection === 'liveness-inspection-error' ? 'liveness' : 'group',
          )
          Expect(evidence.quarantineCleanupInspectionFailure?.observations).toBe(600)
          Expect(evidence.quarantineCleanupInspectionFailure?.causes).toEqual([
            {},
            {
              code: rejection === 'group-inspection-EPERM' ? 'EPERM' : 'EIO',
              errno: rejection === 'group-inspection-EPERM' ? 1 : 5,
              syscall: 'kill',
            },
          ])
          Expect(evidence.quarantineCleanupInspectionFailure?.diagnostic).toContain(
            rejection === 'liveness-inspection-error'
              ? 'source liveness inspection failure'
              : 'source inspection failure',
          )
          Expect(evidence.quarantineCleanupInspectionFailure?.diagnostic.length).toBeLessThanOrEqual(4096)
        }
      } else if (rejection === 'helper-wait-rejected') {
        Expect(evidence.detail).toContain('Injected helper wait failure 1')
        Expect(waits).toBe(2)
        Expect(childSignals).toEqual(['SIGTERM'])
        Expect(childAlive).toBe(false)
        Expect(evidence.events.some(event => event.action.includes('Injected helper wait failure 2'))).toBe(true)
      } else if (rejection === 'child-cleanup-rejected') {
        Expect(evidence.detail).toContain('Injected child cleanup failure 1')
        Expect(childSignals).toEqual(['SIGTERM', 'SIGTERM'])
        Expect(evidence.events.some(event => event.action.includes('Injected child cleanup failure 2'))).toBe(true)
      } else if (rejection === 'output-close-rejected' || rejection === 'dispose-rejected') {
        Expect(evidence.detail).toContain(
          rejection === 'output-close-rejected' ? 'Injected output close failure' : 'Injected dispose failure',
        )
        Expect(childSignals).toEqual(['SIGTERM', 'SIGTERM'])
        Expect(childAlive).toBe(false)
      } else {
        Expect(evidence.detail).toBeDefined()
        Expect(childSignals).toEqual([])
      }
      Expect(outputClosed).toBe(true)
      Expect(disposed).toBe(true)
      Expect(deliveredEscapedSignals).toEqual([])
      Expect(f.calls.some(args => args.includes('delete'))).toBe(false)
      Expect(evidence.unresolved.map(owner => owner.name)).toEqual([resourceName, serialName])
      Expect(evidence.unresolved.map(owner => owner.generation)).toEqual([retainedGeneration, retainedGeneration])
      const owners = await f.operations.resources.listOwners()
      Expect(owners).toHaveLength(2)
      Expect(owners.map(owner => owner.id)).toEqual([retainedGeneration, retainedGeneration])
      Expect(owners.every(owner => owner.retention?.quarantined && owner.retention.processes.length === 0)).toBe(
        true,
      )
    } finally {
      await FS.remove(f.root)
    }
  })
}

Test('Target-fault public dispatch rejects caller-supplied targets before allocating artifacts', async () => {
  const f = await fixture()
  try {
    await Expect(
      runManagedLoopTargetFaultSourceRegression('emulator-5554' as ManagedLoopTargetFaultCase, f.root, f.operations),
    ).rejects.toBeInstanceOf(Errors.UserInputError)
    Expect(f.calls).toEqual([])
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
    Expect(Platform.runtimeProcess.pid).toBeGreaterThan(0)
  } finally {
    await FS.remove(f.root)
  }
})

async function androidFixture(outputCloseRejected = false) {
  const f = await fixture()
  const process: TrackedProcess = {
    pid: 2 ** 29,
    startedAt: 'independently-captured-source-start',
    command: 'emulator',
  }
  const closed = Deferred<CLI.CommandCloseResult>()
  const calls: string[][] = []
  const signals: string[] = []
  const sequence: string[] = []
  let alive = false
  let suspended = false
  let created = false
  let deleting = false
  const deletionProcess = { ...process, pid: process.pid + 5, startedAt: 'owned-deletion-child' }
  const avdName = `${managedLoopAndroidPrefix(FS.basename(f.root))}1`
  const result = (stdout = ''): CLI.CommandResult => ({
    args: [],
    command: 'source fixture',
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout,
  })
  const finish = () => {
    alive = false
    closed.resolve({ exitCode: null, signal: 'SIGKILL' })
  }
  const tree = {
    ...ProcessTree,
    identities: (pids: readonly number[]) =>
      new Map(pids.flatMap(pid => {
        if (pid === process.pid) {
          return alive ? [[pid, process] as const] : []
        }
        if (pid === deletionProcess.pid) {
          return deleting ? [[pid, deletionProcess] as const] : []
        }
        const real = ProcessTree.identities([pid]).get(pid)
        return real === undefined ? [] : [[pid, real] as const]
      })),
    descendants: () => [],
    groupMembers: (pid: number) =>
      pid === process.pid ? (alive ? [process] : []) : pid === deletionProcess.pid
        ? (deleting ? [deletionProcess] : [])
        : ProcessTree.groupMembers(pid),
    isGroupAlive: (pid: number) => pid === deletionProcess.pid ? deleting : alive,
    processGroupOf: (pid: number) => pid,
    signalTracked: (processes: readonly TrackedProcess[], signal: Platform.ProcessSignal) => {
      signals.push(signal)
      sequence.push(signal)
      Expect(processes.every(expected => expected.pid === process.pid && expected.startedAt === process.startedAt))
        .toBe(true)
      if (signal === 'SIGSTOP') {
        suspended = true
      }
      if (signal === 'SIGCONT') {
        suspended = false
      }
      if (signal === 'SIGKILL' || (signal === 'SIGTERM' && !suspended)) {
        finish()
      }
    },
  }
  f.operations.processTree = tree
  f.operations.android = {
    ...f.operations.android,
    registryRoot: f.registryRoot,
    retainResources: f.operations.resources.retain,
    recoverResources: f.operations.resources.recoverRetained,
    processTree: tree,
    run: async (command, spec) => {
      const args = spec?.args ?? []
      calls.push([command, ...args])
      if (command === 'emulator') {
        return result(created ? `${avdName}\n` : 'Tao_Agent_Pixel_1\n')
      }
      if (command === 'lsof') {
        if (args.includes('-iTCP:5582')) {
          sequence.push('owned-console-listener')
        }
        return spec?.args?.some(arg => /^-iTCP:\d+-\d+$/u.test(arg))
          ? { ...result(), exitCode: 1 }
          : result(alive ? `p${process.pid}\n` : '')
      }
      if (command === 'avdmanager' && args[0] === 'create') {
        Expect(args[args.indexOf('--name') + 1]).toBe(avdName)
        created = true
        return result()
      }
      if (args[0] === 'devices') {
        return result(`emulator-5554\tdevice\n${alive ? 'emulator-5582\tdevice\n' : ''}`)
      }
      if (args[2] === 'emu' && args[3] === 'avd') {
        if (args[1] === 'emulator-5582') {
          sequence.push('owned-serial-name')
          if (suspended) {
            return { ...result(), exitCode: 1 }
          }
        }
        return result(`${args[1] === 'emulator-5554' ? 'Developer_Pixel' : avdName}\nOK\n`)
      }
      if (args[2] === 'shell') {
        return result('1\n')
      }
      Errors.throwUnexpected('Unexpected source Android host request.')
    },
    start: (command, spec) => {
      Expect(command).toBe('emulator')
      Expect(spec?.args).toContain(avdName)
      Expect(spec?.args).toContain('5582')
      alive = true
      return {
        command,
        args: [...spec?.args ?? []],
        pid: process.pid,
        get exitCode() {
          return alive ? null : 0
        },
        get signalCode() {
          return alive ? null : 'SIGKILL' as const
        },
        closeOutput: async () => {
          if (outputCloseRejected) {
            Errors.throwHostEnvironment('Injected owned emulator output close failure')
          }
        },
        dispose: () => {},
        endStdin: () => {},
        onceClose: () => {},
        onceError: () => {},
        waitForClose: () => closed.promise,
        writeStdin: () => true,
        kill: signal => {
          if (signal === 'SIGKILL' || (signal === 'SIGTERM' && !suspended)) {
            finish()
          }
          return true
        },
      }
    },
  }
  f.operations.inventory = async () => ({
    processCount: 1,
    peers: [],
    resources: [{
      name: 'android-emulator:emulator-5580',
      generation: 'preserved-live-generation',
      pid: 44,
      retained: true,
    }],
  })
  f.operations.start = (command, spec) => {
    Expect(command).toBe('avdmanager')
    Expect(spec?.args).toEqual(['delete', 'avd', '--name', avdName])
    calls.push([command, ...spec!.args!])
    deleting = true
    return {
      command,
      args: [...spec!.args!],
      pid: deletionProcess.pid,
      exitCode: 0,
      signalCode: null,
      closeOutput: async () => {},
      dispose: () => {},
      endStdin: () => {},
      onceClose: () => {},
      onceError: () => {},
      waitForClose: async () => {
        deleting = false
        created = false
        return { exitCode: 0, signal: null }
      },
      writeStdin: () => true,
      kill: () => false,
    }
  }
  return { ...f, calls, signals, sequence, avdName }
}

Test('Android target-fault escalation distinguishes rejected owned ADB from tracked TERM and KILL', async () => {
  const f = await androidFixture()
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('android-escalation', f.root, f.operations)
    Expect(evidence.detail).toBeUndefined()
    Expect(evidence.disposition).toBe('source regression')
    Expect(evidence.unresolved).toEqual([])
    Expect(f.calls.some(args => args[0] === 'avdmanager' && args[1] === 'delete' && args.at(-1) === f.avdName)).toBe(
      true,
    )
    Expect(f.calls.some(args => args.includes('Tao_Agent_Pixel_1') && args.includes('delete'))).toBe(false)
    const journal = await FS.readJson<{ state: string }[]>(
      FS.resolvePath('android-escalation/android-assets.json', f.root),
    )
    Expect(journal[0]?.state).toBe('removed')
    Expect(f.signals).toContain('SIGTERM')
    Expect(f.signals).toContain('SIGKILL')
    const suspended = f.sequence.indexOf('SIGSTOP')
    Expect(suspended).toBeGreaterThan(1)
    Expect(f.sequence.slice(suspended - 2, suspended + 1)).toEqual([
      'owned-serial-name',
      'owned-console-listener',
      'SIGSTOP',
    ])
    Expect(evidence.events.some(event => event.action === 'owned adb emu kill deliberately rejected' && event.injected))
      .toBe(true)
    Expect(f.calls.some(args => args[0] === 'adb' && args[2] === 'emulator-5554' && args.includes('kill'))).toBe(false)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Android target-fault failure collects only its genuinely released private asset', async () => {
  const f = await androidFixture(true)
  try {
    const evidence = await runManagedLoopTargetFaultSourceRegression('android-escalation', f.root, f.operations)
    Expect(evidence.detail).toContain(
      'The real owned TERM/KILL escalation and rejected ADB request were not all observed.',
    )
    Expect(evidence.events.some(event => event.action === 'owned Android released')).toBe(true)
    Expect(evidence.events.some(event => event.action === 'owned Android cleanup proved')).toBe(true)
    Expect(evidence.events.some(event => event.action.includes('Injected owned emulator output close failure'))).toBe(
      true,
    )
    Expect(evidence.unresolved).toEqual([])
    Expect(f.calls.filter(args => args[0] === 'avdmanager' && args[1] === 'delete')).toEqual([
      ['avdmanager', 'delete', 'avd', '--name', f.avdName],
    ])
    const journal = await FS.readJson<{ state: string }[]>(
      FS.resolvePath('android-escalation/android-assets.json', f.root),
    )
    Expect(journal[0]?.state).toBe('removed')
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test(
  'Android target-fault retained recovery preserves its rotated generation on refusal then restores genuine proof',
  async () => {
    const f = await androidFixture()
    try {
      const evidence = await runManagedLoopTargetFaultSourceRegression('android-recovery', f.root, f.operations)
      Expect(evidence.detail).toBeUndefined()
      Expect(evidence.unresolved).toEqual([])
      Expect(evidence.events.some(event => event.action === 'rotated retained generation observed')).toBe(true)
      const refused = evidence.events.find(event =>
        event.action === 'owned recovery shutdown proof deliberately withheld; fence preserved'
      )
      const recovered = evidence.events.find(event =>
        event.action === 'genuine recovery completed with exact generation'
      )
      Expect(refused?.generation).toBeDefined()
      Expect(recovered?.generation).toBe(refused?.generation)
      Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
    } finally {
      await FS.remove(f.root)
    }
  },
)
