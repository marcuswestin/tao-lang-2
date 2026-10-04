import { MachineResources } from '@host-control'
import { Errors, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { recoverDevLoopProcesses } from '../dev-cli-src/dev-loop/DevLoopRecovery'
import {
  classifyManagedAndroidRecoveryCustody,
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopReceipt,
  readManagedAndroidRecoveryCustody,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'
import { AndroidRecovery } from '../dev-cli-src/simulators/AndroidRecovery'

async function custodyFixture() {
  const registryRoot = await mkTestDir('managed-android-custody-')
  const checkout = await FS.realPath(Repo.getRoot())
  const avdName = `SOURCE_${Platform.randomUUID()}`
  const names = [`android-avd:${avdName}`, 'android-emulator:emulator-5586']
  const leases = await Promise.all(names.map(name =>
    MachineResources.acquire({
      name,
      command: 'source fixture',
      registryRoot,
      repositoryRoot: checkout,
    })
  ))
  const process = { pid: 2 ** 29, startedAt: 'original-physical-kernel', command: 'captured emulator' }
  const controller = { pid: 2 ** 29 - 1, startedAt: 'original-controller-kernel', command: 'captured controller' }
  const retained = await MachineResources.retain({
    owners: leases.map(lease => lease.owner),
    processes: [process],
    processGroupPid: process.pid,
    quarantined: false,
    reason: 'known captured shutdown pending',
    registryRoot,
  })
  const stamp = new Date().toISOString()
  const receipt: DevLoopReceipt = {
    version: 1,
    session: Platform.randomUUID(),
    checkout,
    args: [],
    generation: Platform.randomUUID(),
    state: 'interrupted',
    createdAt: stamp,
    updatedAt: stamp,
    controller,
    children: [process],
    processGroups: [process],
    provenance: 'complete',
    devices: [{
      platform: 'android',
      id: 'emulator-5586',
      avdName,
      owned: true,
      state: 'retained',
      consolePort: 5586,
      generation: retained.id,
      holder: controller,
      resources: names.map(name => ({ ...retained, name })),
    }],
  }
  await writeDevLoopReceipt(receipt)
  return {
    registryRoot,
    receipt,
    process,
    retained,
    names,
    avdName,
    cleanup: async () => {
      await FS.remove(devLoopDirectory(receipt.session))
      await FS.remove(registryRoot)
    },
  }
}

for (const crash of [false, true]) {
  Test(
    `unknown Android group custody survives disappearance and ${
      crash ? 'a pre-receipt crash' : 'both recovery routes'
    }`,
    async () => {
      const fixture = await custodyFixture()
      const signals: string[] = []
      let unknown = true
      let targetCalls = 0
      let clock = 0
      const operations = {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: (_processes: unknown, signal: string) => {
          signals.push(signal)
        },
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms
        },
        groupMembers: () =>
          unknown ? [{ command: 'unknown member', pid: 2 ** 29 + 1, startedAt: 'unknown-kernel' }] : [],
        isGroupAlive: () => unknown,
        readOwner: (options: { name: string }) =>
          MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
        retainResources: (options: Parameters<typeof MachineResources.retain>[0]) =>
          MachineResources.retain({ ...options, registryRoot: fixture.registryRoot }),
        recoverAndroid: async () => {
          targetCalls++
        },
        recoverResources: async () => {
          targetCalls++
        },
        writeReceipt: crash
          ? async () => Errors.throwHostEnvironment('source crash after pair publication')
          : writeDevLoopReceipt,
      }
      try {
        if (crash) {
          await Expect(recoverDevLoopProcesses(fixture.receipt, operations)).rejects.toThrow(
            'source crash after pair publication',
          )
          Expect((await readDevLoopReceipt(fixture.receipt.session)).ownershipRefusal).toBeUndefined()
        } else {
          const result = await recoverDevLoopProcesses(fixture.receipt, operations)
          Expect(result.ownershipRefusal?.reason).toContain('unrecorded member')
          Expect(result.provenance).toBe('uncertain')
        }
        const pair = await Promise.all(
          fixture.names.map(name => MachineResources.readOwner({ name, registryRoot: fixture.registryRoot })),
        )
        Expect(pair[0]?.id).not.toBe(fixture.retained.id)
        Expect(pair[1]?.id).toBe(pair[0]?.id)
        Expect(pair[0]?.retention?.ownershipRefusal?.managed?.physicalGeneration).toBe(fixture.retained.id)
        unknown = false
        const repeated = await recoverDevLoopProcesses(await readDevLoopReceipt(fixture.receipt.session), {
          ...operations,
          writeReceipt: writeDevLoopReceipt,
        })
        Expect(repeated.state).toBe('cleanup-failed')
        Expect(repeated.provenance).toBe('uncertain')
        Expect(repeated.devices?.[0]?.generation).toBe(pair[0]?.id)
        let inspected = 0
        await Expect(AndroidRecovery.recover(fixture.avdName, pair[0]!.id, {
          registryRoot: fixture.registryRoot,
          readManagedCustody: async () => {
            inspected++
            return { kind: 'none' }
          },
        })).rejects.toThrow('permanent ownership refusal')
        Expect(inspected).toBe(0)
        Expect(signals).toEqual([])
        Expect(targetCalls).toBe(0)
        Expect(clock).toBe(0)
        Expect((await MachineResources.readOwner({ name: fixture.names[1]!, registryRoot: fixture.registryRoot }))?.id)
          .toBe(pair[0]?.id)
      } finally {
        await fixture.cleanup()
      }
    },
  )
}

Test('known captured Android closure pending receives a typed audit and remains safely retryable', async () => {
  const fixture = await custodyFixture()
  let alive = true
  let clock = 0
  let released = 0
  try {
    const operations = {
      identities: () => new Map(),
      processIsAlive: () => false,
      descendants: () => [],
      signal: () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms
      },
      groupMembers: () => [],
      isGroupAlive: () => alive,
      readOwner: (options: { name: string }) =>
        MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
      recoverAndroid: async () => {
        released++
      },
    }
    const pending = await recoverDevLoopProcesses(fixture.receipt, operations)
    Expect(clock).toBe(10_000)
    Expect(pending.ownershipRefusal).toBeUndefined()
    Expect(pending.recoveryAudit?.outcome).toBe('known-closure-pending')
    await writeDevLoopReceipt(pending)
    const saved = await readDevLoopReceipt(fixture.receipt.session)
    Expect(classifyManagedAndroidRecoveryCustody(fixture.retained, [saved], saved.checkout).kind).toBe('known')
    alive = false
    const finished = await recoverDevLoopProcesses(saved, operations)
    Expect(finished.state).toBe('stopped')
    Expect(finished.recoveryAudit).toBeUndefined()
    Expect(released).toBe(1)
  } finally {
    await fixture.cleanup()
  }
})

Test('legacy failed Android receipts and incomplete or changed custody cannot become cleanup authority', async () => {
  const fixture = await custodyFixture()
  try {
    const legacy = structuredClone(fixture.receipt)
    legacy.state = 'cleanup-failed'
    legacy.cleanupOutcome = 'retained'
    Expect(classifyManagedAndroidRecoveryCustody(fixture.retained, [legacy], legacy.checkout).kind).toBe('refused')
    for (const change of ['generation', 'missing-resource', 'holder', 'audit-generation'] as const) {
      const record = structuredClone(legacy)
      if (change === 'generation') {
        record.devices![0]!.generation = 'changed-generation'
      }
      if (change === 'missing-resource') {
        record.devices![0]!.resources = record.devices![0]!.resources!.slice(0, -1)
      }
      if (change === 'holder') {
        record.devices![0]!.holder = { ...record.devices![0]!.holder!, startedAt: 'different-controller' }
      }
      if (change === 'audit-generation') {
        record.recoveryAudit = {
          version: 1,
          generation: 'changed-loop-generation',
          controller: record.controller!,
          outcome: 'known-closure-pending',
        }
      }
      Expect(classifyManagedAndroidRecoveryCustody(fixture.retained, [record], record.checkout).kind).toBe('ambiguous')
    }
    let signals = 0
    await writeDevLoopReceipt(legacy)
    await Expect(AndroidRecovery.recover(fixture.avdName, fixture.retained.id, {
      registryRoot: fixture.registryRoot,
      readManagedCustody: async owner => classifyManagedAndroidRecoveryCustody(owner, [legacy], legacy.checkout),
      processTree: {
        identities: () => new Map(),
        descendants: () => [],
        groupMembers: () => [],
        isGroupAlive: () => false,
        processGroupOf: pid => pid,
        signalTracked: () => {
          signals++
        },
      },
    })).rejects.toThrow('legacy')
    const repeated = await recoverDevLoopProcesses(legacy, {
      identities: () => new Map(),
      processIsAlive: () => false,
      descendants: () => [],
      signal: () => {
        signals++
      },
      now: () => 0,
      sleep: async () => {},
      groupMembers: () => [],
      isGroupAlive: () => false,
      readOwner: options => MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
      retainResources: options => MachineResources.retain({ ...options, registryRoot: fixture.registryRoot }),
    })
    Expect(repeated.ownershipRefusal?.reason).toContain('legacy')
    Expect(repeated.cleanupOutcome).toBe('retained')
    Expect(signals).toBe(0)
  } finally {
    await fixture.cleanup()
  }
})

Test('public unknown-custody publication preserves a changed serial owner and reports its failure', async () => {
  const fixture = await custodyFixture()
  try {
    let publications = 0
    const replacement = { ...fixture.retained, name: fixture.names[1]!, id: 'successor-generation' }
    await Expect(recoverDevLoopProcesses(fixture.receipt, {
      identities: () => new Map(),
      processIsAlive: () => false,
      descendants: () => [],
      signal: () => Errors.throwUnexpected('Unknown custody cannot authorize signals'),
      now: () => 0,
      sleep: async () => {},
      groupMembers: () => [{ command: 'unknown child', pid: 2 ** 29 + 1, startedAt: 'unknown-kernel' }],
      isGroupAlive: () => true,
      readOwner: async ({ name }) => name === fixture.names[1] ? replacement : fixture.retained,
      retainResources: async () => {
        publications++
        return fixture.retained
      },
    })).rejects.toThrow('durable session ownership refusal remains retained')
    Expect(publications).toBe(0)
    const refused = await readDevLoopReceipt(fixture.receipt.session)
    Expect(refused.ownershipRefusal?.reason).toContain('unrecorded member')
    Expect(refused.ownershipRefusal?.physicalPublicationUnproved).toContain('changed physical owner')
    Expect((await MachineResources.readOwner({ name: fixture.names[0]!, registryRoot: fixture.registryRoot }))?.id)
      .toBe(fixture.retained.id)
    Expect(replacement.id).toBe('successor-generation')
  } finally {
    await fixture.cleanup()
  }
})

Test('production Android custody reader refuses a foreign checkout before absence can permit recovery', async () => {
  const registryRoot = await mkTestDir('android-foreign-checkout-custody-')
  try {
    const avdName = `FOREIGN_${Platform.randomUUID()}`
    const names = [`android-avd:${avdName}`, 'android-emulator:emulator-5586']
    const leases = await Promise.all(names.map(name =>
      MachineResources.acquire({
        name,
        command: 'source foreign origin',
        registryRoot,
        repositoryRoot: registryRoot,
      })
    ))
    const captured = { pid: 2 ** 29, startedAt: 'foreign-captured-kernel', command: 'foreign captured target' }
    const owner = await MachineResources.retain({
      owners: leases.map(lease => lease.owner),
      processes: [captured],
      processGroupPid: captured.pid,
      quarantined: false,
      reason: 'known closure pending',
      registryRoot,
    })
    Expect((await readManagedAndroidRecoveryCustody(owner)).kind).toBe('ambiguous')
    let targetOperations = 0
    await Expect(AndroidRecovery.recover(avdName, owner.id, {
      registryRoot,
      processTree: {
        identities: () => {
          targetOperations++
          return new Map()
        },
        descendants: () => {
          targetOperations++
          return []
        },
        groupMembers: () => {
          targetOperations++
          return []
        },
        isGroupAlive: () => {
          targetOperations++
          return false
        },
        processGroupOf: () => {
          targetOperations++
          return captured.pid
        },
        signalTracked: () => {
          targetOperations++
        },
      },
    })).rejects.toThrow('canonical checkout')
    Expect(targetOperations).toBe(0)
    for (const name of names) {
      Expect((await MachineResources.readOwner({ name, registryRoot }))?.id).toBe(owner.id)
    }
  } finally {
    await FS.remove(registryRoot)
  }
})

for (const audit of [false, true]) {
  for (const driver of ['opening', 'retained', null, 'invalid-state'] as const) {
    Test(
      `Android ${driver} driver custody blocks standalone cleanup ${audit ? 'with' : 'without'} a process audit`,
      async () => {
        const fixture = await custodyFixture()
        try {
          const record = structuredClone(fixture.receipt)
          Object.assign(record, { mobileDriverCleanup: driver })
          if (audit) {
            record.recoveryAudit = {
              version: 1,
              generation: record.generation,
              controller: record.controller!,
              outcome: 'known-closure-pending',
            }
          }
          await writeDevLoopReceipt(record)
          const saved = await readDevLoopReceipt(record.session)
          Expect(classifyManagedAndroidRecoveryCustody(fixture.retained, [saved], saved.checkout).kind).toBe('refused')
          let targetCalls = 0
          await Expect(AndroidRecovery.recover(fixture.avdName, fixture.retained.id, {
            registryRoot: fixture.registryRoot,
            readManagedCustody: async owner => classifyManagedAndroidRecoveryCustody(owner, [saved], saved.checkout),
            processTree: {
              identities: () => {
                targetCalls++
                return new Map()
              },
              descendants: () => {
                targetCalls++
                return []
              },
              groupMembers: () => {
                targetCalls++
                return []
              },
              isGroupAlive: () => {
                targetCalls++
                return false
              },
              processGroupOf: pid => pid,
              signalTracked: () => {
                targetCalls++
              },
            },
          })).rejects.toThrow('driver cleanup remains unproved')
          Expect(targetCalls).toBe(0)
          const recomputed = { ...saved, mobileDriverCleanup: 'proved' as const }
          const refused = await recoverDevLoopProcesses(recomputed, {
            identities: () => new Map(),
            processIsAlive: () => false,
            descendants: () => [],
            signal: () => {},
            now: () => 0,
            sleep: async () => {},
            groupMembers: () => [],
            isGroupAlive: () => false,
            readOwner: options => MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
            recoverAndroid: async () => {
              targetCalls++
            },
            recoverResources: async () => {
              targetCalls++
            },
          })
          Expect(refused.cleanupOutcome).toBe('retained')
          Expect(refused.mobileDriverCleanup).toBe(driver)
          Expect(targetCalls).toBe(0)
          Expect(
            (await MachineResources.readOwner({ name: fixture.names[0]!, registryRoot: fixture.registryRoot }))?.id,
          ).toBe(fixture.retained.id)
        } finally {
          await fixture.cleanup()
        }
      },
    )
  }
}

Test('proved released historical Android custody permits only the exact successor generation', async () => {
  const fixture = await custodyFixture()
  const historicalSession = Platform.randomUUID()
  const historicalDirectory = devLoopDirectory(historicalSession)
  try {
    const historical = structuredClone(fixture.receipt)
    historical.session = historicalSession
    historical.generation = Platform.randomUUID()
    historical.state = 'stopped'
    historical.cleanupOutcome = 'proved'
    historical.devices![0]!.state = 'released'
    historical.devices![0]!.generation = 'completed-physical-generation'
    historical.devices![0]!.resources = historical.devices![0]!.resources!.map(owner => ({
      ...owner,
      id: 'completed-physical-generation',
    }))
    await writeDevLoopReceipt(historical)
    const priorBytes = await FS.readText(FS.resolvePath('receipt.json', historicalDirectory))
    const current = structuredClone(fixture.receipt)
    current.state = 'cleanup-failed'
    current.cleanupOutcome = 'retained'
    current.recoveryAudit = {
      version: 1,
      generation: current.generation,
      controller: current.controller!,
      outcome: 'known-closure-pending',
    }
    let signals = 0
    await AndroidRecovery.recover(fixture.avdName, fixture.retained.id, {
      registryRoot: fixture.registryRoot,
      readManagedCustody: async owner =>
        classifyManagedAndroidRecoveryCustody(owner, [historical, current], current.checkout),
      processIsAlive: () => false,
      processTree: {
        identities: () => new Map(),
        descendants: () => [],
        groupMembers: () => [],
        isGroupAlive: () => false,
        processGroupOf: pid => pid,
        signalTracked: () => {
          signals++
        },
      },
    })
    Expect(signals).toBe(0)
    for (const name of fixture.names) {
      Expect(await MachineResources.readOwner({ name, registryRoot: fixture.registryRoot })).toBeUndefined()
    }
    Expect(await FS.readText(FS.resolvePath('receipt.json', historicalDirectory))).toBe(priorBytes)
    for (const corruption of ['unresolved', 'driver', 'missing-resource'] as const) {
      const prior = structuredClone(historical)
      if (corruption === 'unresolved') {
        prior.cleanupOutcome = 'retained'
      }
      if (corruption === 'driver') {
        prior.mobileDriverCleanup = 'retained'
      }
      if (corruption === 'missing-resource') {
        prior.devices![0]!.resources = prior.devices![0]!.resources!.slice(0, -1)
      }
      Expect(classifyManagedAndroidRecoveryCustody(fixture.retained, [prior, current], current.checkout).kind).toBe(
        'ambiguous',
      )
    }
  } finally {
    await FS.remove(historicalDirectory)
    await fixture.cleanup()
  }
})

for (const persistence of ['receipt-succeeds', 'both-fail'] as const) {
  Test(`physical Android refusal I/O failure remains explicit when ${persistence}`, async () => {
    const fixture = await custodyFixture()
    let unknown = true
    let signals = 0
    let targetCalls = 0
    let publicationAttempts = 0
    try {
      const operations = {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: () => {
          signals++
        },
        now: () => 0,
        sleep: async () => {},
        groupMembers: () =>
          unknown ? [{ command: 'unknown survivor', pid: 2 ** 29 + 1, startedAt: 'unknown-kernel' }] : [],
        isGroupAlive: () => unknown,
        readOwner: (options: { name: string }) =>
          MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
        retainResources: async () => {
          publicationAttempts++
          return Errors.throwHostEnvironment('source physical publication denied')
        },
        writeReceipt: persistence === 'both-fail'
          ? async () => Errors.throwHostEnvironment('source receipt persistence denied')
          : writeDevLoopReceipt,
        recoverAndroid: async () => {
          targetCalls++
        },
        recoverResources: async () => {
          targetCalls++
        },
      }
      await Expect(recoverDevLoopProcesses(fixture.receipt, operations)).rejects.toThrow(
        persistence === 'both-fail' ? 'both unproved' : 'durable session ownership refusal remains retained',
      )
      const saved = await readDevLoopReceipt(fixture.receipt.session)
      if (persistence === 'receipt-succeeds') {
        Expect(saved.ownershipRefusal?.reason).toContain('unrecorded member')
        Expect(saved.ownershipRefusal?.physicalPublicationUnproved).toContain('source physical publication denied')
        Expect(saved.provenance).toBe('uncertain')
        unknown = false
        await Expect(recoverDevLoopProcesses(saved, operations)).rejects.toThrow(
          'durable session ownership refusal remains retained',
        )
        Expect(publicationAttempts).toBe(2)
        const repeated = await readDevLoopReceipt(fixture.receipt.session)
        Expect(repeated.ownershipRefusal).toEqual(saved.ownershipRefusal)
        await Expect(AndroidRecovery.recover(fixture.avdName, fixture.retained.id, {
          registryRoot: fixture.registryRoot,
          readManagedCustody: async owner =>
            classifyManagedAndroidRecoveryCustody(owner, [repeated], repeated.checkout),
          processTree: {
            identities: () => {
              targetCalls++
              return new Map()
            },
            descendants: () => {
              targetCalls++
              return []
            },
            groupMembers: () => {
              targetCalls++
              return []
            },
            isGroupAlive: () => {
              targetCalls++
              return false
            },
            processGroupOf: pid => pid,
            signalTracked: () => {
              signals++
            },
          },
        })).rejects.toThrow('unknown ownership')
      } else {
        Expect(saved.ownershipRefusal).toBeUndefined()
        Expect(publicationAttempts).toBe(1)
      }
      Expect(signals).toBe(0)
      Expect(targetCalls).toBe(0)
      for (const name of fixture.names) {
        Expect((await MachineResources.readOwner({ name, registryRoot: fixture.registryRoot }))?.id).toBe(
          fixture.retained.id,
        )
      }
    } finally {
      await fixture.cleanup()
    }
  })
}

for (const mismatch of ['session', 'loop-generation', 'controller', 'physical-generation', 'resource-id'] as const) {
  Test(`crash reconstruction refuses a different ${mismatch} without adoption or cleanup`, async () => {
    const fixture = await custodyFixture()
    try {
      const context = {
        session: mismatch === 'session' ? Platform.randomUUID() : fixture.receipt.session,
        generation: mismatch === 'loop-generation' ? Platform.randomUUID() : fixture.receipt.generation,
        physicalGeneration: mismatch === 'physical-generation'
          ? 'different-original-physical-generation'
          : fixture.retained.id,
        checkout: fixture.receipt.checkout,
        controller: mismatch === 'controller'
          ? { ...fixture.receipt.controller!, startedAt: 'different-controller-kernel' }
          : fixture.receipt.controller!,
      }
      const sealed = await MachineResources.retain({
        owners: fixture.names.map(name => ({ ...fixture.retained, name })),
        processes: [fixture.process],
        processGroupPid: fixture.process.pid,
        quarantined: false,
        reason: 'source unknown ownership',
        registryRoot: fixture.registryRoot,
        ownershipRefusal: { version: 1, reason: 'source unknown ownership', managed: context },
      })
      if (mismatch === 'resource-id') {
        fixture.receipt.devices![0]!.resources![1]!.id = 'different-recorded-resource-id'
        await writeDevLoopReceipt(fixture.receipt)
      }
      let sideEffects = 0
      await Expect(recoverDevLoopProcesses(fixture.receipt, {
        identities: () => new Map(),
        processIsAlive: () => false,
        descendants: () => [],
        signal: () => {
          sideEffects++
        },
        now: () => 0,
        sleep: async () => {},
        groupMembers: () => [],
        isGroupAlive: () => false,
        readOwner: options => MachineResources.readOwner({ ...options, registryRoot: fixture.registryRoot }),
        writeReceipt: async () => {
          sideEffects++
        },
        retainResources: async () => {
          sideEffects++
          return sealed
        },
        recoverAndroid: async () => {
          sideEffects++
        },
        recoverResources: async () => {
          sideEffects++
        },
      })).rejects.toThrow('does not match the original managed session')
      Expect(sideEffects).toBe(0)
      Expect((await readDevLoopReceipt(fixture.receipt.session)).ownershipRefusal).toBeUndefined()
      for (const name of fixture.names) {
        Expect((await MachineResources.readOwner({ name, registryRoot: fixture.registryRoot }))?.id).toBe(sealed.id)
      }
    } finally {
      await fixture.cleanup()
    }
  })
}
