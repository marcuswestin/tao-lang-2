import { type MachineResourceOwner, MachineResources } from '@host-control'
import { Errors, FS, ProcessTree, type TrackedProcess } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  type ManagedLoopAcceptanceRecoverySourceOperations,
  runManagedLoopAcceptanceRecoverySourceRegression,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceRecovery'

const invocation = 'bb7ab550-7b1e-4215-96e0-84a1866bccf1'
const avdName = 'Tao_Borrow_b67e9a7734b74217b4f530af4695ee4e'
const consoleName = 'android-console-port:5582'
const serialName = 'android-emulator:emulator-5582'

type Mutable<T> = { -readonly [Name in keyof T]: T[Name] }
type FixtureOperations = Omit<ManagedLoopAcceptanceRecoverySourceOperations, 'resources' | 'tree'> & {
  resources: Mutable<ManagedLoopAcceptanceRecoverySourceOperations['resources']>
  tree: Mutable<ManagedLoopAcceptanceRecoverySourceOperations['tree']>
}

async function fixture() {
  const checkout = await mkTestDir('managed-borrowing-recovery-')
  const registryRoot = FS.resolvePath('registry', checkout)
  const root = FS.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`, checkout)
  const borrowed = FS.resolvePath('borrowed-android', root)
  const avdHome = FS.resolvePath('.android/avd', checkout)
  const avdPath = FS.resolvePath(`${avdName}.avd`, avdHome)
  const iniPath = FS.resolvePath(`${avdName}.ini`, avdHome)
  await FS.mkdir(borrowed)
  await FS.mkdir(avdPath)
  await FS.writeText(iniPath, 'invocation-owned AVD')
  await FS.mkdir(FS.resolvePath('Foreign.avd', avdHome))
  await FS.writeText(FS.resolvePath('Foreign.ini', avdHome), 'foreign AVD bytes')
  const process: TrackedProcess = { pid: 536_870_912, startedAt: '1791125799:515407', command: 'recorded root' }
  const scope = <T extends object>(options: T) => ({ ...options, registryRoot })
  const lease = await MachineResources.acquire(
    scope({ name: consoleName, command: 'owned sentinel', repositoryRoot: checkout }),
  )
  const initial = await MachineResources.retain(scope({
    owners: [lease.owner],
    processes: [process],
    processGroupPid: process.pid,
    quarantined: false,
    reason: 'borrowed console',
  }))
  const retained = await MachineResources.retain(scope({
    owners: [initial],
    processes: [process],
    processGroupPid: process.pid,
    quarantined: true,
    reason: 'unproved borrower cleanup',
  }))
  const foreignLease = await MachineResources.acquire(
    scope({ name: serialName, command: 'historical foreign custody', repositoryRoot: '/foreign' }),
  )
  const foreign = await MachineResources.retain(scope({
    owners: [foreignLease.owner],
    processes: [],
    quarantined: true,
    reason: 'historical serial fence',
  }))
  const foreignPath = FS.resolvePath(`.retentions/${foreign.id}.json`, registryRoot)
  const foreignBytes = await FS.readText(foreignPath)
  await FS.writeJson(FS.resolvePath('invocation.json', root), {
    request: { case: 'android-lifecycle' },
    sourceCommit: 'b13ddc54d1fff175dfac0da2daddaac245dc1860',
    dirtyPaths: '',
    owner: { command: 'source actor', pid: 123, startedAt: '1791125713:954893' },
  })
  await FS.writeJson(FS.resolvePath('sentinel-identity.json', borrowed), {
    avdName,
    serial: 'emulator-5582',
    consolePort: 5582,
    generation: initial.id,
    processes: [process],
  })
  await FS.writeJson(FS.resolvePath('receipt.json', borrowed), {
    target: 'android',
    disposition: 'real-host failure',
    preserved: false,
    cleanup: 'retained',
    artifacts: borrowed,
    processes: [process],
    unresolved: [{ name: serialName, generation: foreign.id }, { name: consoleName, generation: retained.id }],
    id: 'emulator-5582',
    detail: 'Failure prose is not recovery authority.',
  })
  await FS.writeJson(FS.resolvePath('external-directories.json', borrowed), [{
    path: avdPath,
    companionFile: iniPath,
    owner: borrowed,
    purpose: 'invocation-owned borrowed Android sentinel',
    state: 'active',
    cleanupCondition:
      'Delete only after captured child close, descendant/group/listener disappearance and borrower fence release.',
  }])
  let alive = true
  let deletionFails = false
  let rootIdentity = { ...process }
  const signals: string[] = []
  const deletions: string[][] = []
  const admissions: string[][] = []
  const operations: FixtureOperations = {
    checkout,
    avdHome,
    resources: {
      readOwner: options => MachineResources.readOwner(scope(options)),
      readRetainedLineage: options => MachineResources.readRetainedLineage(scope(options)),
      acquire: options => MachineResources.acquire(scope(options)),
      withCurrentOwners: (options, action) => {
        admissions.push(options.owners.map(owner => owner.name))
        return MachineResources.withCurrentOwners(scope(options), action)
      },
      recoverRetained: options => MachineResources.recoverRetained(scope(options)),
    },
    tree: {
      ...ProcessTree,
      identities: pids =>
        new Map(pids.flatMap(pid => pid === process.pid && alive ? [[pid, { ...rootIdentity }] as const] : [])),
      descendants: () => [],
      groupMembers: () => alive ? [{ ...rootIdentity }] : [],
      processGroupOf: () => alive ? process.pid : undefined,
      isGroupAlive: () => alive,
      signalTracked: (captured, signal) => {
        Expect(captured).toEqual([process])
        signals.push(signal)
        alive = false
      },
    },
    processIsAlive: pid => pid === process.pid && alive,
    runSync: (command, spec) => {
      Expect(command).toBe('lsof')
      Expect(spec?.args).toEqual(['-nP', '-iTCP:5582-5583', '-sTCP:LISTEN', '-Fp'])
      return {
        command,
        args: [...spec?.args ?? []],
        stdout: alive ? `p${process.pid}\n` : '',
        stderr: '',
        exitCode: alive ? 0 : 1,
        signal: null,
      }
    },
    start: (command, spec) => {
      Expect(command).toBe('avdmanager')
      Expect(spec?.args).toEqual(['delete', 'avd', '--name', avdName])
      Expect(alive).toBe(false)
      deletions.push([...spec!.args!])
      return {
        command,
        args: [...spec!.args!],
        exitCode: null,
        signalCode: null,
        waitForClose: async () => {
          if (!deletionFails) {
            await FS.remove(avdPath)
            await FS.remove(iniPath)
          }
          return { exitCode: deletionFails ? 1 : 0, signal: null }
        },
        closeOutput: async () => {},
        dispose: () => {},
        endStdin: () => {},
        onceClose: () => {},
        onceError: () => {},
        writeStdin: () => true,
        kill: () => Errors.throwUnexpected('The recovery must never signal its deletion child.'),
      }
    },
  }
  const run = () => runManagedLoopAcceptanceRecoverySourceRegression({ invocation }, operations)
  const preserveForeign = async () => {
    Expect(await FS.readText(foreignPath)).toBe(foreignBytes)
    Expect(await operations.resources.readOwner({ name: serialName })).toEqual(foreign)
    Expect(await FS.readText(FS.resolvePath('Foreign.ini', avdHome))).toBe('foreign AVD bytes')
    Expect(await FS.exists(FS.resolvePath('Foreign.avd', avdHome))).toBe(true)
  }
  const noDestruction = async () => {
    Expect(signals).toEqual([])
    Expect(deletions).toEqual([])
    Expect(await FS.exists(avdPath)).toBe(true)
    await preserveForeign()
  }
  return {
    checkout,
    root,
    borrowed,
    registryRoot,
    operations,
    process,
    initial,
    retained,
    avdPath,
    iniPath,
    signals,
    deletions,
    admissions,
    run,
    noDestruction,
    preserveForeign,
    setAlive: (value: boolean) => {
      alive = value
    },
    reusePid: () => {
      rootIdentity = { ...process, startedAt: 'reused-root-kernel' }
    },
    failDeletion: (value: boolean) => {
      deletionFails = value
    },
  }
}

Test(
  'recorded Android borrowing recovery follows console rotation, signals original kernels, and preserves a foreign serial byte for byte',
  async () => {
    const f = await fixture()
    try {
      const receipt = await f.run()
      Expect(receipt.disposition).toBe('source regression')
      Expect(receipt.phase).toBe('released')
      Expect(f.signals).toEqual(['SIGTERM'])
      Expect(f.deletions).toEqual([['delete', 'avd', '--name', avdName]])
      Expect(await f.operations.resources.readOwner({ name: consoleName })).toBeUndefined()
      Expect(await f.operations.resources.readOwner({ name: `android-avd:${avdName}` })).toBeUndefined()
      Expect(f.admissions.some(names => names.includes(consoleName) && names.includes(`android-avd:${avdName}`))).toBe(
        true,
      )
      await f.preserveForeign()
    } finally {
      await FS.remove(f.checkout)
    }
  },
)

for (
  const problem of [
    'malformed',
    'symlink',
    'avd-symlink',
    'foreign-checkout',
    'foreign-path',
    'wrong-case',
    'missing-root',
  ] as const
) {
  Test(`recorded borrowing recovery refuses ${problem} evidence before allocating a target fence`, async () => {
    const f = await fixture()
    const receiptPath = FS.resolvePath('receipt.json', f.borrowed)
    try {
      if (problem === 'malformed') {
        await FS.writeText(receiptPath, '{broken')
      } else if (problem === 'symlink') {
        const copy = FS.resolvePath('receipt-copy.json', f.root)
        await FS.move(receiptPath, copy)
        await FS.symlink(copy, receiptPath)
      } else if (problem === 'avd-symlink') {
        await FS.remove(f.avdPath)
        await FS.symlink(FS.resolvePath('Foreign.avd', f.operations.avdHome), f.avdPath)
      } else if (problem === 'foreign-checkout') {
        const receipt = await FS.readJson<Record<string, unknown>>(receiptPath)
        await FS.writeJson(receiptPath, { ...receipt, artifacts: '/foreign/borrowed-android' })
      } else if (problem === 'foreign-path') {
        const path = FS.resolvePath('external-directories.json', f.borrowed)
        const external = await FS.readJson<Record<string, unknown>[]>(path)
        await FS.writeJson(path, [{ ...external[0], path: '/foreign/Foreign.avd' }])
      } else if (problem === 'wrong-case') {
        const path = FS.resolvePath('invocation.json', f.root)
        const record = await FS.readJson<Record<string, unknown>>(path)
        await FS.writeJson(path, { ...record, request: { case: 'android-recovery' } })
      } else {
        const path = FS.resolvePath('sentinel-identity.json', f.borrowed)
        const record = await FS.readJson<Record<string, unknown>>(path)
        await FS.writeJson(path, { ...record, processes: [] })
      }
      const receipt = await f.run()
      Expect(receipt.disposition).toBe('retained')
      Expect(receipt.phase).toBe('unproved')
      Expect(f.admissions).toEqual([])
      Expect(await f.operations.resources.readOwner({ name: `android-avd:${avdName}` })).toBeUndefined()
      await f.noDestruction()
    } finally {
      await FS.remove(f.checkout)
    }
  })
}

for (
  const problem of [
    'lineage-mismatch',
    'permanent-refusal',
    'PID-reuse',
    'unknown-group',
    'unknown-descendant',
    'read-failure',
    'listener-read-failure',
    'unknown-listener',
    'missing-ancestry',
    'foreign-AVD',
  ] as const
) {
  Test(`recorded borrowing recovery refuses ${problem} without signals or AVD deletion`, async () => {
    const f = await fixture()
    try {
      if (problem === 'lineage-mismatch') {
        f.operations.resources.readRetainedLineage = async () => [{ ...f.retained, repositoryRoot: '/foreign' }]
      } else if (problem === 'permanent-refusal') {
        await MachineResources.retain({
          registryRoot: f.registryRoot,
          owners: [f.retained],
          processes: [f.process],
          processGroupPid: f.process.pid,
          quarantined: true,
          reason: 'uncertain capture',
          ownershipRefusal: { version: 1, reason: 'Permanent capture refusal' },
        })
      } else if (problem === 'PID-reuse') {
        f.reusePid()
      } else if (problem === 'unknown-group') {
        f.operations.tree.groupMembers =
          () => [f.process, { pid: 536_870_913, startedAt: 'foreign', command: 'stranger' }]
      } else if (problem === 'unknown-descendant') {
        f.operations.tree.descendants = () => [{ pid: 536_870_913, startedAt: 'foreign', command: 'stranger' }]
      } else if (problem === 'read-failure') {
        f.operations.tree.identities = () => Errors.throwHostEnvironment('Kernel inspection unavailable')
      } else if (problem === 'listener-read-failure') {
        f.operations.runSync = () => Errors.throwHostEnvironment('Listener inspection unavailable')
      } else if (problem === 'unknown-listener') {
        f.operations.runSync = () => ({
          command: 'lsof',
          args: [],
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: 'p536870913\n',
        })
      } else if (problem === 'missing-ancestry') {
        f.setAlive(false)
      } else {
        await f.operations.resources.acquire({
          name: `android-avd:${avdName}`,
          command: 'foreign AVD fence',
          repositoryRoot: '/foreign',
        })
      }
      Expect((await f.run()).disposition).toBe('retained')
      await f.noDestruction()
    } finally {
      await FS.remove(f.checkout)
    }
  })
}

Test(
  'recorded borrowing recovery stops when the console generation rotates across an awaited AVD reservation',
  async () => {
    const f = await fixture()
    const acquire = f.operations.resources.acquire
    let successor: MachineResourceOwner | undefined
    f.operations.resources.acquire = async options => {
      const lease = await acquire(options)
      successor = await MachineResources.retain({
        registryRoot: f.registryRoot,
        owners: [f.retained],
        processes: [f.process],
        processGroupPid: f.process.pid,
        quarantined: true,
        reason: 'rotated during reservation',
      })
      return lease
    }
    try {
      Expect((await f.run()).disposition).toBe('retained')
      Expect(successor).toBeDefined()
      Expect((await f.operations.resources.readOwner({ name: consoleName }))?.id).toBe(successor!.id)
      await f.noDestruction()
    } finally {
      await FS.remove(f.checkout)
    }
  },
)

Test('recorded borrowing recovery rechecks the root kernel inside the final synchronous admission', async () => {
  const f = await fixture()
  const admission = f.operations.resources.withCurrentOwners
  let replaced = false
  f.operations.resources.withCurrentOwners = (options, action) =>
    admission(options, () => {
      if (!replaced && options.owners.some(owner => owner.name === `android-avd:${avdName}`)) {
        f.reusePid()
        replaced = true
      }
      return action()
    })
  try {
    Expect((await f.run()).disposition).toBe('retained')
    Expect(replaced).toBe(true)
    await f.noDestruction()
  } finally {
    await FS.remove(f.checkout)
  }
})

Test(
  'recorded borrowing recovery resumes a proved closed deletion phase without deriving ownership from absence',
  async () => {
    const f = await fixture()
    try {
      f.failDeletion(true)
      const failed = await f.run()
      Expect(failed.phase).toBe('deleting')
      Expect(failed.disposition).toBe('retained')
      Expect(f.signals).toEqual(['SIGTERM'])
      Expect(await f.operations.resources.readOwner({ name: consoleName })).toEqual(f.retained)
      f.failDeletion(false)
      const resumed = await f.run()
      Expect(resumed.phase).toBe('released')
      Expect(resumed.disposition).toBe('source regression')
      Expect(f.signals).toEqual(['SIGTERM'])
      Expect(f.deletions).toHaveLength(2)
      await f.preserveForeign()
    } finally {
      await FS.remove(f.checkout)
    }
  },
)

Test('a failed unproved recovery receipt cannot turn later kernel absence into cleanup authority', async () => {
  const f = await fixture()
  try {
    const group = f.operations.tree.groupMembers
    f.operations.tree.groupMembers = () => Errors.throwHostEnvironment('Group inspection unavailable')
    Expect((await f.run()).phase).toBe('unproved')
    f.operations.tree.groupMembers = group
    f.setAlive(false)
    Expect((await f.run()).disposition).toBe('retained')
    await f.noDestruction()
  } finally {
    await FS.remove(f.checkout)
  }
})
