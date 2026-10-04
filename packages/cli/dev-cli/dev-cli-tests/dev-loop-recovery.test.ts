import { Errors, FS, Platform, Repo } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { Expect, Test } from '@shared/test'
import { disposeDeadDevLoopConnection, recoverDevLoopProcesses } from '../dev-cli-src/dev-loop/DevLoopRecovery'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'

function receipt(provenance: 'complete' | 'uncertain'): DevLoopReceipt {
  const stamp = new Date().toISOString()
  return {
    version: 1,
    session: Platform.randomUUID(),
    checkout: '.',
    args: [],
    generation: Platform.randomUUID(),
    state: 'interrupted',
    createdAt: stamp,
    updatedAt: stamp,
    children: [{ command: 'owned', pid: 123, startedAt: 'original' }],
    controller: { command: 'old controller', pid: 987, startedAt: 'controller-start' },
    provenance,
  }
}

for (
  const evidence of [
    'known-member-drain',
    'empty-live-drain',
    'kill-only-drain',
    'persistent-known-member',
    'persistent-empty-live',
    'unknown-member',
    'unknown-after-signal',
    'inspection-error',
    'inspection-after-signal',
    'probe-error',
    'reused-root',
    'unreadable-root',
    'reused-member',
    'unreadable-member',
  ] as const
) {
  Test(
    `interrupted recovery observes full group closure for ${evidence} before releasing its exact target`,
    async () => {
      const record = receipt('complete')
      record.checkout = FS.realPathSync(Repo.getRoot())
      record.processGroups = [record.children[0]!]
      const member = { command: 'captured child', pid: 456, startedAt: 'member-start' }
      record.children.push(member)
      const owner = {
        command: 'captured emulator',
        name: 'android-avd:OWNED',
        id: 'physical-generation',
        pid: 123,
        processStartedAt: 'original',
        repositoryRoot: record.checkout,
        startedAt: 'diagnostic timestamp',
      }
      record.devices = [{
        platform: 'android',
        id: 'emulator-5586',
        avdName: 'OWNED',
        consolePort: 5586,
        owned: true,
        state: 'retained',
        generation: 'physical-generation',
        resources: [owner, { ...owner, name: 'android-emulator:emulator-5586' }],
        holder: record.controller,
      }]
      await writeDevLoopReceipt(record)
      let clock = 0
      let groupReads = 0
      let recovered = 0
      const signals: string[] = []
      const live = new Map(record.children.map(process => [process.pid, process]))
      const borrowed = { command: 'borrowed emulator', pid: 777, startedAt: 'borrowed-kernel' }
      live.set(borrowed.pid, borrowed)
      if (evidence === 'reused-root') {
        live.set(123, { ...record.children[0]!, startedAt: 'replacement-root' })
      }
      if (evidence === 'reused-member') {
        live.set(456, { ...member, startedAt: 'replacement-member' })
      }
      if (evidence === 'unreadable-root') {
        live.delete(123)
      }
      if (evidence === 'unreadable-member') {
        live.delete(456)
      }
      const succeeds = evidence === 'known-member-drain' || evidence === 'empty-live-drain'
        || evidence === 'kill-only-drain'
      const persistent = evidence === 'persistent-known-member' || evidence === 'persistent-empty-live'
      try {
        const result = await recoverDevLoopProcesses(record, {
          identities: () => live,
          processIsAlive: pid =>
            live.has(pid)
            || evidence === 'unreadable-root' && pid === 123
            || evidence === 'unreadable-member' && pid === 456,
          descendants: () => [],
          signal: (processes, signal) => {
            signals.push(signal)
            for (const process of processes) {
              if (
                live.get(process.pid)?.startedAt === process.startedAt
                && (evidence !== 'kill-only-drain' || signal === 'SIGKILL')
              ) {
                live.delete(process.pid)
              }
            }
          },
          now: () => clock,
          sleep: async ms => {
            clock += ms
          },
          groupMembers: () => {
            groupReads++
            if (evidence === 'inspection-error' || evidence === 'inspection-after-signal' && signals.length > 0) {
              return Errors.throwHostEnvironment('Source group membership inspection denied')
            }
            if (evidence === 'unknown-member' || evidence === 'unknown-after-signal' && signals.length > 0) {
              return [{ command: 'unknown survivor', pid: 777, startedAt: 'unknown' }]
            }
            if (evidence === 'reused-member' || evidence === 'unreadable-member') {
              return [member]
            }
            return evidence === 'persistent-known-member' || evidence === 'known-member-drain' && clock < 100
                || evidence === 'kill-only-drain' && clock < 5_100
              ? [record.children[0]!]
              : []
          },
          isGroupAlive: () =>
            evidence === 'probe-error'
              ? Errors.throwHostEnvironment('Source group kernel probe denied')
              : persistent || clock < (evidence === 'kill-only-drain' ? 5_100 : 100),
          readOwner: async ({ name }) => ({ ...owner, name }),
          retainResources: async options => ({
            ...owner,
            id: 'sealed-physical-generation',
            retention: {
              processes: [...options.processes],
              processGroupPid: options.processGroupPid,
              quarantined: options.quarantined,
              reason: options.reason,
              resourceNames: options.owners.map(owner => owner.name),
              ownershipRefusal: options.ownershipRefusal,
            },
          }),
          recoverAndroid: async (avd, generation) => {
            Expect(clock).toBe(evidence === 'kill-only-drain' ? 5_100 : 100)
            Expect(groupReads).toBeGreaterThan(1)
            Expect(avd).toBe('OWNED')
            Expect(generation).toBe('physical-generation')
            Expect(live.has(123)).toBe(false)
            Expect(live.has(456)).toBe(false)
            Expect(live.get(777)).toEqual(borrowed)
            recovered++
          },
        })
        Expect(result.state).toBe(succeeds ? 'stopped' : 'cleanup-failed')
        Expect(result.cleanupOutcome).toBe(succeeds ? 'proved' : 'retained')
        Expect(result.devices?.[0]?.state).toBe(succeeds ? 'released' : 'retained')
        Expect(result.devices?.[0]?.generation).toBe(
          succeeds || persistent ? 'physical-generation' : 'sealed-physical-generation',
        )
        Expect(recovered).toBe(succeeds ? 1 : 0)
        Expect(live.get(777)).toEqual(borrowed)
        Expect(signals).toEqual(
          evidence === 'kill-only-drain'
            ? ['SIGTERM', 'SIGKILL']
            : succeeds || evidence === 'unknown-after-signal' || evidence === 'inspection-after-signal'
            ? ['SIGTERM']
            : persistent
            ? ['SIGTERM', 'SIGKILL']
            : [],
        )
        Expect(clock).toBe(evidence === 'kill-only-drain' ? 5_100 : succeeds ? 100 : persistent ? 10_000 : 0)
        if (!succeeds) {
          Expect(result.failures?.join('\n')).toContain(
            evidence === 'inspection-error' || evidence === 'inspection-after-signal'
              ? 'Source group membership inspection denied'
              : evidence === 'probe-error'
              ? 'Source group kernel probe denied'
              : evidence === 'unknown-member' || evidence === 'unknown-after-signal'
              ? 'unrecorded member 777'
              : evidence === 'reused-root'
              ? 'different current kernel identity'
              : evidence === 'unreadable-root' || evidence === 'unreadable-member'
              ? 'unreadable surviving identity'
              : evidence === 'reused-member'
              ? 'unproved current kernel identity'
              : 'empty membership and kernel absence',
          )
        }
        if (evidence === 'inspection-error' || evidence === 'probe-error') {
          Expect(groupReads).toBe(1)
        }
        if (evidence === 'inspection-after-signal' || evidence === 'unknown-after-signal') {
          Expect(groupReads).toBe(2)
        }
        if (evidence === 'reused-root') {
          Expect(live.get(123)?.startedAt).toBe('replacement-root')
        }
        if (evidence === 'reused-member') {
          Expect(live.get(456)?.startedAt).toBe('replacement-member')
        }
      } finally {
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}

Test('interrupted target recovery preserves exact resource-generation refusal details', async () => {
  const record = receipt('complete')
  record.checkout = FS.realPathSync(Repo.getRoot())
  record.processGroups = [record.children[0]!]
  const owner = {
    command: 'captured emulator',
    name: 'android-avd:OWNED',
    id: 'expected-generation',
    pid: 123,
    processStartedAt: 'original',
    repositoryRoot: record.checkout,
    startedAt: '',
  }
  record.devices = [{
    platform: 'android',
    id: 'emulator-5586',
    avdName: 'OWNED',
    owned: true,
    state: 'retained',
    generation: 'expected-generation',
    resources: [owner, { ...owner, name: 'android-emulator:emulator-5586' }],
    holder: record.controller,
  }]
  await writeDevLoopReceipt(record)
  let recovered = 0
  let clock = 0
  try {
    const result = await recoverDevLoopProcesses(record, {
      identities: () => new Map(),
      processIsAlive: () => false,
      descendants: () => [],
      signal: () => {},
      groupMembers: () => [],
      isGroupAlive: () => false,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
      readOwner: async ({ name }) => ({ ...owner, name, id: 'replacement-generation' }),
      recoverAndroid: async () => {
        recovered++
      },
    })
    Expect(result.state).toBe('cleanup-failed')
    Expect(result.cleanupOutcome).toBe('retained')
    Expect(result.devices?.[0]?.generation).toBe('expected-generation')
    Expect(result.failures?.join('\n')).toContain('Retained android target emulator-5586 recovery refused:')
    Expect(result.failures?.join('\n')).toContain('retained mobile resource owner changed')
    Expect(recovered).toBe(0)
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

for (const evidence of ['incoming refusal', 'durable refusal'] as const) {
  Test(`public recovery cannot release a complete-looking target after ${evidence}`, async () => {
    const record = receipt('complete')
    record.checkout = FS.realPathSync(Repo.getRoot())
    record.processGroups = [record.children[0]!]
    record.ownershipRefusal = {
      version: 1,
      generation: record.generation,
      reason: 'Source captured descendant ownership was refused',
      terminal: { exitCode: 1, signal: null },
    }
    record.state = 'stopped'
    const owner = {
      command: 'captured emulator',
      name: 'android-avd:OWNED',
      id: 'physical-generation',
      pid: 123,
      processStartedAt: 'original',
      repositoryRoot: record.checkout,
      startedAt: '',
    }
    record.devices = [{
      platform: 'android',
      id: 'emulator-5586',
      avdName: 'OWNED',
      owned: true,
      state: 'retained',
      generation: 'physical-generation',
      resources: [owner, { ...owner, name: 'android-emulator:emulator-5586' }],
      holder: record.controller,
    }]
    await writeDevLoopReceipt(record)
    let deviceCalls = 0
    let clock = 0
    try {
      const durable = await readDevLoopReceipt(record.session)
      Expect(durable.provenance).toBe('uncertain')
      Expect(durable.cleanupOutcome).toBe('retained')
      Expect(durable.state).toBe('cleanup-failed')
      Expect(durable.ownershipRefusal?.generation).toBe(record.generation)
      Expect(durable.ownershipRefusal?.reason).toBe('Source captured descendant ownership was refused')
      const recomputed = { ...durable, provenance: 'complete' as const }
      if (evidence === 'durable refusal') {
        delete recomputed.ownershipRefusal
      }
      const result = await recoverDevLoopProcesses(recomputed, {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: () => {},
        groupMembers: () => [],
        isGroupAlive: () => false,
        now: () => clock,
        sleep: async ms => {
          clock += ms
        },
        readOwner: async ({ name }) => ({ ...owner, name }),
        retainResources: async options => ({
          ...owner,
          id: 'sealed-refused-physical-generation',
          retention: {
            processes: [...options.processes],
            processGroupPid: options.processGroupPid,
            quarantined: options.quarantined,
            reason: options.reason,
            resourceNames: options.owners.map(owner => owner.name),
            ownershipRefusal: options.ownershipRefusal,
          },
        }),
        recoverAndroid: async () => {
          deviceCalls++
        },
        recoverResources: async () => {
          deviceCalls++
        },
        run: async () => {
          deviceCalls++
          return Errors.throwUnexpected('A refused target must never receive cleanup.')
        },
      })
      Expect(result.state).toBe('cleanup-failed')
      Expect(result.cleanupOutcome).toBe('retained')
      Expect(result.devices?.[0]?.state).toBe('retained')
      Expect(result.devices?.[0]?.generation).toBe('sealed-refused-physical-generation')
      Expect(deviceCalls).toBe(0)
      Expect(result.failures?.join('\n')).toContain(
        'Source captured descendant ownership was refused',
      )
      Expect(result.ownershipRefusal).toEqual(record.ownershipRefusal)
      Expect(result.provenance).toBe('uncertain')
      const saved = await readDevLoopReceipt(record.session)
      Expect(saved.ownershipRefusal?.generation).toBe(record.generation)
      Expect(saved.ownershipRefusal?.terminal).toEqual({ exitCode: 1, signal: null })
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

for (const deviceEvidence of ['empty', 'already released', 'ineligible retained'] as const) {
  Test(`durable ownership refusal prevents stopped classification with ${deviceEvidence} devices`, async () => {
    const record = receipt('complete')
    record.checkout = FS.realPathSync(Repo.getRoot())
    record.processGroups = [record.children[0]!]
    record.ownershipRefusal = {
      version: 1,
      generation: record.generation,
      reason: 'Source immutable descendant refusal',
      terminal: { exitCode: 17, signal: 'SIGKILL' },
    }
    record.devices = deviceEvidence === 'empty'
      ? []
      : [{
        platform: 'android',
        id: 'emulator-5586',
        avdName: 'OWNED',
        owned: true,
        state: deviceEvidence === 'already released' ? 'released' : 'retained',
        generation: 'physical-generation',
      }]
    await writeDevLoopReceipt(record)
    let targetCalls = 0
    let clock = 0
    try {
      const incoming = { ...record, provenance: 'complete' as const }
      delete incoming.ownershipRefusal
      if (deviceEvidence === 'already released') {
        incoming.ownershipRefusal = {
          version: 1,
          generation: record.generation,
          reason: 'Recomputed replacement reason',
          terminal: { exitCode: 0, signal: null },
        }
      }
      const result = await recoverDevLoopProcesses(incoming, {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: () => {},
        groupMembers: () => [],
        isGroupAlive: () => false,
        now: () => clock,
        sleep: async ms => {
          clock += ms
        },
        readOwner: async () => {
          targetCalls++
          return undefined
        },
        recoverAndroid: async () => {
          targetCalls++
        },
        recoverResources: async () => {
          targetCalls++
        },
        run: async () => {
          targetCalls++
          return Errors.throwUnexpected('Skipped devices cannot grant recovery authority.')
        },
      })
      Expect(result.state).toBe('cleanup-failed')
      Expect(result.cleanupOutcome).toBe('retained')
      Expect(result.provenance).toBe('uncertain')
      Expect(result.ownershipRefusal?.version).toBe(1)
      Expect(result.ownershipRefusal?.generation).toBe(record.generation)
      Expect(result.ownershipRefusal?.reason).toBe('Source immutable descendant refusal')
      Expect(result.ownershipRefusal?.terminal).toEqual({ exitCode: 17, signal: 'SIGKILL' })
      Expect(result.devices).toEqual(record.devices)
      Expect(result.controller).toEqual(record.controller)
      Expect(result.generation).toBe(record.generation)
      Expect(result.failures?.join('\n')).toContain('Source immutable descendant refusal')
      Expect(targetCalls).toBe(0)
      await writeDevLoopReceipt(result)
      const persisted = await readDevLoopReceipt(record.session)
      Expect(persisted.state).toBe('cleanup-failed')
      Expect(persisted.ownershipRefusal?.reason).toBe('Source immutable descendant refusal')
      Expect(persisted.ownershipRefusal?.terminal).toEqual({ exitCode: 17, signal: 'SIGKILL' })
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

for (const evidence of ['denied-probe', 'unreadable-members'] as const) {
  Test(`interrupted recovery retains targets and fences after ${evidence} group absence evidence`, async () => {
    const record = receipt('complete')
    record.checkout = FS.realPathSync(Repo.getRoot())
    record.controller = { command: 'old holder', pid: 900, startedAt: 'holder' }
    record.processGroups = [{ command: 'owned driver', pid: 987, startedAt: 'driver' }]
    const owner = {
      name: 'ios-simulator:OWNED',
      id: 'retained',
      pid: 900,
      command: 'retained simulator',
      repositoryRoot: record.checkout,
      startedAt: '',
    }
    record.devices = [{
      platform: 'ios',
      id: 'OWNED',
      owned: true,
      state: 'retained',
      generation: 'retained',
      resources: [owner],
      holder: record.controller,
    }]
    await writeDevLoopReceipt(record)
    let recovered = 0
    try {
      const result = await recoverDevLoopProcesses(record, {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: () => {},
        now: () => 0,
        sleep: async () => {},
        groupMembers: () => evidence === 'unreadable-members' ? Errors.throwHostEnvironment('unreadable members') : [],
        isGroupAlive: group =>
          ProcessTree.isGroupAlive(group, () => Errors.throwHostEnvironment('kernel probe denied'), {
            platform: 'darwin',
          }),
        readOwner: async () => owner,
        recoverResources: async options => {
          recovered++
          Expect(await options.shutdown(owner)).toBe(true)
        },
        run: async (command, spec) => {
          recovered++
          return {
            command,
            args: [...spec?.args ?? []],
            exitCode: 0,
            signal: null,
            stderr: '',
            stdout: JSON.stringify({ devices: { ios: [{ udid: 'OWNED', state: 'Shutdown' }] } }),
          }
        },
      })
      Expect(recovered).toBe(0)
      Expect(result.state).toBe('cleanup-failed')
      Expect(result.cleanupOutcome).toBe('retained')
      Expect(result.devices?.[0]?.state).toBe('retained')
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

for (const evidence of ['unreadable-live', 'mismatched-live', 'probe-unavailable'] as const) {
  Test(
    `recovery refuses ${evidence} controller before signalling, resource recovery, or credential removal`,
    async () => {
      const record = receipt('complete')
      record.checkout = FS.realPathSync(Repo.getRoot())
      await writeDevLoopReceipt(record)
      await writeDevLoopConnection({
        session: record.session,
        origin: 'http://127.0.0.1:1',
        token: 'private',
        generation: record.generation,
        controller: record.controller,
      })
      let mutations = 0
      let clock = 0
      const identities = () =>
        evidence === 'mismatched-live'
          ? new Map([[record.controller!.pid, { ...record.controller!, startedAt: 'new-start' }]])
          : new Map<number, TrackedProcess>()
      const processIsAlive = () =>
        evidence === 'probe-unavailable'
          ? Errors.throwHostEnvironment('OS probe unavailable')
          : true
      try {
        await Expect(recoverDevLoopProcesses(record, {
          identities,
          processIsAlive,
          descendants: () => [],
          signal: () => {
            mutations++
          },
          now: () => clock,
          sleep: async ms => {
            clock += ms
          },
          run: async () => {
            mutations++
            return Errors.throwUnexpected('Must not shut down a target.')
          },
          recoverResources: async () => {
            mutations++
          },
        })).rejects.toThrow(evidence === 'probe-unavailable' ? 'OS probe unavailable' : 'absence is unproved')
        await Expect(disposeDeadDevLoopConnection(record, identities, processIsAlive))
          .rejects.toThrow(evidence === 'probe-unavailable' ? 'OS probe unavailable' : 'absence is unproved')
        Expect(mutations).toBe(0)
        Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(true)
      } finally {
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}

Test('unreadable surviving tracked process prevents cleanup proof after controller absence is proved', async () => {
  const record = receipt('complete')
  let now = 0
  const result = await recoverDevLoopProcesses(record, {
    readReceipt: async () => record,
    writeReceipt: async () => {},
    identities: () => new Map(),
    processIsAlive: pid => pid === 123,
    descendants: () => [],
    signal: () => {},
    now: () => now,
    sleep: async ms => {
      now += ms
    },
  })
  Expect(result.state).toBe('cleanup-failed')
  Expect(result.cleanupOutcome).toBe('retained')
  Expect(result.ownershipRefusal?.reason).toContain('unreadable surviving identity')
  Expect(now).toBe(0)
})

Test('explicit recovery stops proven owned identities and leaves a reused PID untouched', async () => {
  const record = receipt('complete')
  record.children.push({ command: 'reused', pid: 234, startedAt: 'old' })
  const live = new Map<number, TrackedProcess>([[123, record.children[0]!], [234, {
    command: 'stranger',
    pid: 234,
    startedAt: 'new',
  }]])
  const signalled: number[] = []
  const recovered = await recoverDevLoopProcesses(record, {
    readReceipt: async () => record,
    processIsAlive: pid => live.has(pid),
    identities: () => live,
    descendants: pid => {
      Expect(pid).toBe(123)
      return []
    },
    signal: processes => {
      for (const process of processes) {
        if (live.get(process.pid)?.startedAt === process.startedAt) {
          signalled.push(process.pid)
          live.delete(process.pid)
        }
      }
    },
    now: () => 0,
    sleep: async () => {},
  })
  Expect(recovered.state).toBe('stopped')
  Expect(signalled).toEqual([123])
  Expect(live.get(234)?.command).toBe('stranger')
})

for (const ownership of ['matching', 'legacy', 'mismatched'] as const) {
  Test(
    `dead terminal private cleanup ${
      ownership === 'matching' ? 'removes proved' : 'retains unproved'
    } ${ownership} credentials`,
    async () => {
      const record = receipt('complete')
      record.checkout = FS.realPathSync(Repo.getRoot())
      record.state = 'stopped'
      record.controller = { pid: 123, startedAt: 'old-controller', command: 'owned controller' }
      await writeDevLoopReceipt(record)
      await writeDevLoopConnection({
        session: record.session,
        origin: 'http://127.0.0.1:1',
        token: Platform.randomUUID(),
        ...(ownership === 'legacy'
          ? {}
          : {
            generation: ownership === 'matching' ? record.generation : Platform.randomUUID(),
            controller: record.controller,
          }),
      })
      const directory = devLoopDirectory(record.session)
      try {
        const disposed = await FS.withFileMutationLock(
          FS.resolvePath('recovery.lock', directory),
          directory,
          () =>
            disposeDeadDevLoopConnection(
              record,
              () => new Map(),
              () => false,
            ),
        )
        Expect(disposed.state).toBe(ownership === 'matching' ? 'stopped' : 'cleanup-failed')
        Expect(disposed.cleanupOutcome).toBe(ownership === 'matching' ? 'proved' : 'retained')
        Expect(disposed.controllerDisposed).toBe(ownership === 'matching' ? true : undefined)
        Expect(await FS.exists(FS.resolvePath('active-control', directory))).toBe(ownership !== 'matching')
      } finally {
        await FS.remove(directory)
      }
    },
  )
}

Test('recovery preserves uncertainty and device fences after recorded processes are gone', async () => {
  const record = receipt('uncertain')
  record.devices = [{
    platform: 'ios',
    id: 'OWNED-UDID',
    owned: true,
    state: 'retained',
    generation: 'device-generation',
  }]
  const recovered = await recoverDevLoopProcesses(record, {
    readReceipt: async () => record,
    processIsAlive: () => false,
    identities: () => new Map(),
    descendants: () => [],
    signal: () => {},
    sleep: async () => {},
    now: () => 0,
  })
  Expect(recovered.state).toBe('cleanup-failed')
  Expect(recovered.devices).toEqual(record.devices)
  Expect(recovered.children).toEqual(record.children)
  Expect(recovered.message).toContain('unproved')
})

for (const owned of [true, false]) {
  Test(
    `matched interrupted iOS recovery ${
      owned ? 'shuts down only its owned device' : 'preserves the borrowed booted device'
    }`,
    async () => {
      const record = receipt('complete')
      record.checkout = FS.realPathSync(Repo.getRoot())
      record.controller = { command: 'old controller', pid: 900, startedAt: 'old-holder' }
      record.processGroups = [record.children[0]!]
      const owner = {
        command: 'managed simulator',
        id: 'retained-ios-2',
        name: 'ios-simulator:OWNED',
        pid: 900,
        repositoryRoot: record.checkout,
        startedAt: 'diagnostic timestamp',
      }
      record.devices = [{
        platform: 'ios',
        id: 'OWNED',
        owned,
        state: 'retained',
        generation: 'retained-ios-2',
        resources: [owner],
        holder: record.controller,
      }]
      await writeDevLoopReceipt(record)
      let state = 'Booted'
      const shutdowns: string[] = []
      let released = false
      try {
        const result = await recoverDevLoopProcesses(record, {
          processIsAlive: () => false,
          identities: () => new Map(),
          descendants: () => [],
          signal: () => {},
          sleep: async () => {},
          now: () => 0,
          groupMembers: () => [],
          isGroupAlive: () => false,
          readOwner: async () => owner,
          recoverResources: async options => {
            Expect(options.generation).toBe('retained-ios-2')
            Expect(options.name).toBe('ios-simulator:OWNED')
            Expect(await options.shutdown(owner)).toBe(true)
            released = true
          },
          run: async (command, spec) => {
            const args = spec?.args ?? []
            if (args[1] === 'shutdown') {
              shutdowns.push(args[2]!)
              state = 'Shutdown'
            }
            return {
              command,
              args: [...args],
              exitCode: 0,
              signal: null,
              stderr: '',
              stdout: JSON.stringify({ devices: { ios: [{ udid: 'OWNED', state }] } }),
            }
          },
        })
        Expect(result.state).toBe('stopped')
        Expect(result.devices?.[0]?.state).toBe('released')
        Expect(released).toBe(true)
        Expect(shutdowns).toEqual(owned ? ['OWNED'] : [])
        Expect(state).toBe(owned ? 'Shutdown' : 'Booted')
      } finally {
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}

Test('unknown process-group survivors block device recovery after recorded identities exit', async () => {
  const record = receipt('complete')
  record.processGroups = [record.children[0]!]
  record.devices = [{ platform: 'ios', id: 'OWNED', owned: true, state: 'retained', generation: 'retained' }]
  let released = false
  const result = await recoverDevLoopProcesses(record, {
    readReceipt: async () => record,
    writeReceipt: async () => {},
    processIsAlive: () => false,
    identities: () => new Map(),
    descendants: () => [],
    signal: () => {},
    sleep: async () => {},
    now: () => 0,
    groupMembers: () => [{ command: 'unknown orphan', pid: 777, startedAt: 'unknown' }],
    isGroupAlive: () => true,
    recoverResources: async () => {
      released = true
    },
  })
  Expect(result.state).toBe('cleanup-failed')
  Expect(released).toBe(false)
  Expect(result.devices?.[0]?.state).toBe('retained')
})
