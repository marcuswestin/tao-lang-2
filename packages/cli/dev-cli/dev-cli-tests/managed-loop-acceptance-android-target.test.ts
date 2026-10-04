import type { MachineResourceOwner } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Expect, Test } from '@shared/test'
import {
  cleanupManagedLoopAndroidAssets,
  type ManagedAndroidQuarantinePlan,
  type ManagedAndroidTargetShutdown,
  managedLoopAndroidOperations,
  managedLoopAndroidPrefix,
  readManagedAndroidQuarantinePlan,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceAndroidTarget'
import type { AgentAndroidOperations } from '../dev-cli-src/simulators/AgentAndroidEmulator'

Test('Android quarantine child validates its fixed root and captured parent before any allocation', async () => {
  const invocation = Platform.randomUUID()
  const artifactRoot = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)
  const root = FS.resolvePath('android-quarantine', artifactRoot)
  await FS.mkdir(root)
  const parent: TrackedProcess = { pid: 44, startedAt: 'captured-kernel-start', command: 'owned parent' }
  const plan: ManagedAndroidQuarantinePlan = {
    version: 1,
    invocation,
    artifactRoot,
    checkout: await FS.realPath(Repo.getRoot()),
    parent,
    baselineResources: ['android-emulator:emulator-5580', 'android-avd:Tao_Agent_Pixel_1'],
  }
  const operations = {
    identities: () => new Map([[parent.pid, parent]]),
    processTable: () => [{ pid: Platform.runtimeProcess.pid, ppid: parent.pid, startedAt: 'child', command: 'child' }],
  }
  try {
    for (const substitution of ['none', 'generation', 'checkout', 'artifact-root', 'baseline'] as const) {
      const candidate = structuredClone(plan)
      if (substitution === 'generation') {
        candidate.parent.startedAt = 'recycled-pid-kernel-start'
      }
      if (substitution === 'checkout') {
        candidate.checkout = '/other-checkout'
      }
      if (substitution === 'artifact-root') {
        candidate.artifactRoot = FS.resolvePath('other', artifactRoot)
      }
      if (substitution === 'baseline') {
        candidate.baselineResources = [null as unknown as string]
      }
      await FS.writeJson(FS.resolvePath('private-plan.json', root), candidate)
      if (substitution === 'none') {
        Expect(await readManagedAndroidQuarantinePlan(root, operations)).toEqual(plan)
      } else {
        await Expect(readManagedAndroidQuarantinePlan(root, operations)).rejects.toBeInstanceOf(
          Errors.HostEnvironmentError,
        )
      }
    }
    await FS.writeJson(FS.resolvePath('private-plan.json', root), plan)
    await Expect(readManagedAndroidQuarantinePlan(root, {
      ...operations,
      processTable: () => [{ ...operations.processTable()[0]!, ppid: 45 }],
    })).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(ProcessTree.sameProcess(parent, { ...parent, startedAt: 'recycled-pid-kernel-start' })).toBe(false)
  } finally {
    await FS.remove(artifactRoot)
  }
})

Test(
  'Existing matching Android AVD names require an owned creation journal and exact closed generation before registry contact',
  async () => {
    const invocation = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
    await FS.mkdir(root)
    const avdName = `${managedLoopAndroidPrefix(invocation)}1`
    const owner = {
      id: 'creation-generation',
      name: `android-avd:${avdName}`,
      pid: 44,
      startedAt: 'stamp',
      command: 'owned creation',
      repositoryRoot: Repo.getRoot(),
    }
    const captured = { pid: 55, startedAt: 'owned-emulator-kernel', command: 'owned emulator' }
    let registryCalls = 0
    const calls: string[][] = []
    const operations: AgentAndroidOperations = {
      run: async (
        command: string,
        spec: NonNullable<Parameters<typeof CLI.run>[1]> = {},
      ): Promise<CLI.CommandResult> => {
        calls.push([command, ...spec.args ?? []])
        Expect([command, ...spec.args ?? []]).toEqual(['emulator', '-list-avds'])
        return { command, args: [], exitCode: 0, signal: null, stdout: `${avdName}\n`, stderr: '' }
      },
      acquireResource: async () => {
        registryCalls++
        return { owner, release: async () => {} }
      },
      tryAcquireResource: async request => {
        registryCalls++
        return { owner: { ...owner, name: request.name }, release: async () => {} }
      },
      start: () => Errors.throwUnexpected('Existing-slot admission must not spawn.'),
      write: () => {},
      writeError: () => {},
      readResourceOwner: async () => undefined,
      processTree: { ...ProcessTree, identities: () => new Map(), isGroupAlive: () => false },
    }
    try {
      for (
        const provenance of ['absent', 'foreign', 'unpublished', 'missing-closure', 'stale-creation', 'valid'] as const
      ) {
        registryCalls = 0
        calls.length = 0
        await FS.remove(FS.resolvePath('android-assets.json', root))
        await FS.remove(FS.resolvePath('android-shutdown.json', root))
        if (provenance !== 'absent') {
          await FS.writeJson(FS.resolvePath('android-assets.json', root), [{
            avdName,
            path: 'source-fixture-only',
            owner: provenance === 'foreign' ? '/foreign-artifacts' : root,
            purpose: 'source test',
            cleanupCondition: 'test teardown',
            state: provenance === 'unpublished' ? 'retained' : 'created',
            creation: { invocation, checkout: await FS.realPath(Repo.getRoot()), resource: owner },
          }])
        }
        if (provenance !== 'missing-closure') {
          const proof: ManagedAndroidTargetShutdown = {
            invocation,
            checkout: await FS.realPath(Repo.getRoot()),
            creationGeneration: provenance === 'stale-creation' ? 'foreign-generation' : owner.id,
            capture: { processes: [captured], rootPid: captured.pid, uncertain: false },
            device: {
              platform: 'android',
              id: 'emulator-5582',
              avdName,
              owned: true,
              state: 'released',
              generation: 'closed-generation',
              resources: [
                { ...owner, id: 'closed-generation' },
                { ...owner, id: 'closed-generation', name: 'android-emulator:emulator-5582' },
              ],
            },
          }
          await FS.writeJson(FS.resolvePath('android-shutdown.json', root), proof)
        }
        const guarded = managedLoopAndroidOperations({
          invocation,
          eventRoot: root,
          baselineResources: [],
          operations,
          record: async () => {},
        })
        await guarded.run('emulator', { args: ['-list-avds'] })
        if (provenance === 'valid') {
          Expect((await guarded.tryAcquireResource({ name: owner.name, command: 'owned restart' }))?.owner).toEqual(
            owner,
          )
          Expect(registryCalls).toBe(1)
        } else {
          Expect(await guarded.tryAcquireResource({ name: owner.name, command: 'owned restart' })).toBeUndefined()
          Expect(registryCalls).toBe(0)
          const freshName = `android-avd:${managedLoopAndroidPrefix(invocation)}2`
          Expect((await guarded.tryAcquireResource({ name: freshName, command: 'fresh sibling slot' }))?.owner.name)
            .toBe(freshName)
          Expect(registryCalls).toBe(1)
        }
        Expect(calls).toEqual([['emulator', '-list-avds']])
      }
    } finally {
      await FS.remove(root)
    }
  },
)

Test(
  'Private Android restart reuses only its recorded creation and independently captured released child',
  async () => {
    const invocation = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
    await FS.mkdir(root)
    const avdName = `${managedLoopAndroidPrefix(invocation)}1`
    const owner = {
      id: 'original-creation-generation',
      name: `android-avd:${avdName}`,
      pid: 44,
      startedAt: 'stamp',
      command: 'owned creation',
      repositoryRoot: Repo.getRoot(),
    }
    const process = { pid: 55, startedAt: 'owned-emulator-kernel', command: 'emulator' }
    let created = false
    let alive = false
    let registryCalls = 0
    const operations: AgentAndroidOperations = {
      acquireResource: async () => {
        registryCalls++
        return { owner, release: async () => {} }
      },
      tryAcquireResource: async () => {
        registryCalls++
        return { owner, release: async () => {} }
      },
      readResourceOwner: async () => undefined,
      write: () => {},
      writeError: () => {},
      processTree: {
        ...ProcessTree,
        identities: () => new Map(alive ? [[process.pid, process]] : []),
        descendants: () => [],
        processGroupOf: () => process.pid,
        isGroupAlive: () => alive,
      },
      run: async (
        command: string,
        spec: NonNullable<Parameters<typeof CLI.run>[1]> = {},
      ): Promise<CLI.CommandResult> => {
        if (command === 'avdmanager') {
          Expect(spec.args).toEqual(['create', 'avd', '--name', avdName])
          created = true
        } else {
          Expect([command, ...spec.args ?? []]).toEqual(['emulator', '-list-avds'])
        }
        return {
          command,
          args: [],
          exitCode: 0,
          signal: null,
          stdout: command === 'emulator' && created ? `${avdName}\n` : '',
          stderr: '',
        }
      },
      start: (): CLI.StartedCommand => {
        alive = true
        return {
          command: 'emulator',
          args: [],
          pid: process.pid,
          exitCode: null,
          signalCode: null,
          closeOutput: async () => {},
          dispose: () => {},
          endStdin: () => {},
          onceClose: () => {},
          onceError: () => {},
          waitForClose: async () => ({ exitCode: 0, signal: null }),
          writeStdin: () => true,
          kill: () => false,
        }
      },
    }
    const device = {
      platform: 'android' as const,
      id: 'emulator-5582',
      avdName,
      owned: true,
      state: 'booted' as const,
      generation: 'released-target-generation',
      resources: [{ ...owner, id: 'released-target-generation' }, {
        ...owner,
        id: 'released-target-generation',
        name: 'android-emulator:emulator-5582',
      }],
    }
    try {
      const first = managedLoopAndroidOperations({
        invocation,
        eventRoot: root,
        baselineResources: [],
        operations,
        record: async () => {},
      })
      await first.run('emulator', { args: ['-list-avds'] })
      await first.acquireResource({ name: owner.name, command: 'owned first creation', repositoryRoot: Repo.getRoot() })
      await first.run('avdmanager', { args: ['create', 'avd', '--name', avdName] })
      first.start('emulator', {})
      await first.observeAndroidDevice(device)
      alive = false
      await first.observeAndroidDevice({ ...device, state: 'released' })
      const closure = await FS.readJson<ManagedAndroidTargetShutdown>(FS.resolvePath('android-shutdown.json', root))
      Expect(closure.creationGeneration).toBe('original-creation-generation')
      Expect(closure.capture.processes).toEqual([process])
      Expect(closure.device.generation).toBe('released-target-generation')
      const restart = managedLoopAndroidOperations({
        invocation,
        eventRoot: root,
        baselineResources: [],
        operations,
        record: async () => {},
      })
      await restart.run('emulator', { args: ['-list-avds'] })
      await restart.tryAcquireResource({ name: owner.name, command: 'owned restart' })
      Expect(registryCalls).toBe(2)
      alive = true
      Expect(await restart.tryAcquireResource({ name: owner.name, command: 'live child refusal' })).toBeUndefined()
      Expect(registryCalls).toBe(2)
    } finally {
      await FS.remove(root)
    }
  },
)

Test('Android target disposal refuses retained generations, live kernels, and a sibling private AVD', async () => {
  const invocation = Platform.randomUUID()
  const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
  await FS.mkdir(root)
  const avdName = `${managedLoopAndroidPrefix(invocation)}1`
  const generation = Platform.randomUUID()
  const captured = { pid: 55, startedAt: 'captured-emulator-kernel', command: 'owned emulator' }
  const owner = { id: generation, pid: 44, startedAt: 'holder', command: 'owned', repositoryRoot: Repo.getRoot() }
  const proof: ManagedAndroidTargetShutdown = {
    invocation,
    checkout: await FS.realPath(Repo.getRoot()),
    capture: { rootPid: captured.pid, processes: [captured], uncertain: false },
    device: {
      platform: 'android',
      id: 'emulator-5582',
      avdName,
      owned: true,
      state: 'released',
      generation,
      resources: [{ ...owner, name: `android-avd:${avdName}` }, { ...owner, name: 'android-emulator:emulator-5582' }],
    },
  }
  let acquisitions = 0
  try {
    for (
      const refusal of [
        'retained-resource',
        'live-kernel',
        'live-group',
        'sibling-asset',
        'unpublished-capture',
        'generation',
      ] as const
    ) {
      const candidate = structuredClone(proof)
      if (refusal === 'unpublished-capture') {
        candidate.capture.uncertain = true
      }
      if (refusal === 'generation') {
        candidate.device.resources![1]!.id = 'stale-generation'
      }
      await FS.writeJson(FS.resolvePath('android-shutdown.json', root), candidate)
      await FS.writeJson(FS.resolvePath('android-assets.json', root), [{
        avdName: refusal === 'sibling-asset' ? `${managedLoopAndroidPrefix(invocation)}2` : avdName,
        path: 'source-fixture-only',
        owner: root,
        purpose: 'source regression',
        cleanupCondition: 'test teardown',
        state: 'created',
      }])
      await Expect(cleanupManagedLoopAndroidAssets(
        {
          artifactRoot: root,
          targetProof: FS.resolvePath('android-shutdown.json', root),
          baselineResources: [],
        },
        root,
        {
          identities: () => new Map(refusal === 'live-kernel' ? [[captured.pid, captured]] : []),
          groupAlive: () => refusal === 'live-group',
          readOwner: async request =>
            refusal === 'retained-resource' && request.name === 'android-emulator:emulator-5582'
              ? proof.device.resources![1]
              : undefined,
          tryAcquire: async () => {
            acquisitions++
            return undefined
          },
        },
      )).rejects.toThrow('assets remain retained')
      Expect(acquisitions).toBe(0)
      const assets = await FS.readJson<{ state: string }[]>(FS.resolvePath('android-assets.json', root))
      Expect(assets[0]?.state).toBe('retained')
    }
  } finally {
    await FS.remove(root)
  }
})

for (
  const observation of [
    'transient-offline',
    'persistent-offline',
    'adb-error',
    'adb-timeout',
    'listener-error',
    'initial-listener-stderr',
    'reused-listener',
    'owner-rotation',
    'serial-owner-rotation',
    'kernel-revival',
    'group-revival',
    'proof-rotation',
    'predelete-listener',
    'predelete-listener-stderr',
    'atomic-rotation',
    'atomic-kernel',
  ] as const
) {
  Test(`Private Android serial observation ${observation} preserves exact pair authority`, async () => {
    const invocation = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
    await FS.mkdir(root)
    const avdName = `${managedLoopAndroidPrefix(invocation)}1`
    const names = [`android-avd:${avdName}`, 'android-emulator:emulator-5582']
    const captured = { pid: 55, startedAt: 'closed-emulator-kernel', command: 'owned emulator' }
    const holder = { pid: 44, startedAt: 'holder', command: 'source holder', repositoryRoot: Repo.getRoot() }
    const proof: ManagedAndroidTargetShutdown = {
      invocation,
      checkout: await FS.realPath(Repo.getRoot()),
      capture: { processes: [captured], rootPid: captured.pid, uncertain: false },
      device: {
        platform: 'android',
        id: 'emulator-5582',
        avdName,
        owned: true,
        state: 'released',
        generation: 'released-generation',
        resources: names.map(name => ({ ...holder, name, id: 'released-generation' })),
      },
    }
    const owners = new Map<string, MachineResourceOwner>()
    let now = 0
    let samples = 0
    let retains = 0
    let starts = 0
    let revived = false
    let childAlive = false
    const child = { pid: 56, startedAt: 'owned-deletion-kernel', command: 'owned deletion' }
    const timeouts: number[] = []
    const sleeps: number[] = []
    const admissions: string[][] = []
    const result = (stdout = '', exitCode = 0): CLI.CommandResult => ({
      command: 'source observation',
      args: [],
      stdout,
      stderr: '',
      exitCode,
      signal: null,
    })
    const rotate = (name: string) => {
      owners.set(name, { ...owners.get(name)!, id: 'foreign-generation' })
    }
    const targetProof = FS.resolvePath('android-shutdown.json', root)
    await FS.writeJson(targetProof, proof)
    await FS.writeJson(FS.resolvePath('android-assets.json', root), [{
      avdName,
      path: 'source fixture only',
      owner: root,
      purpose: 'source regression',
      cleanupCondition: 'exact pair proof only',
      state: 'created',
    }])
    try {
      const cleanup = cleanupManagedLoopAndroidAssets(
        { artifactRoot: root, targetProof, baselineResources: ['android-emulator:emulator-5580'] },
        root,
        {
          observationClock: {
            now: () => now,
            sleep: async ms => {
              sleeps.push(ms)
              now += ms
            },
          },
          identities: () =>
            new Map([
              ...revived && (observation === 'kernel-revival' || observation === 'atomic-kernel')
                ? [[captured.pid, captured] as const]
                : [],
              ...childAlive ? [[child.pid, child] as const] : [],
            ]),
          groupAlive: pid => pid === child.pid ? childAlive : revived && observation === 'group-revival',
          readOwner: async request => owners.get(request.name),
          tryAcquire: async request => {
            Expect(names).toContain(request.name)
            const owner = { ...holder, name: request.name, id: `fresh-${request.name}` }
            owners.set(request.name, owner)
            return {
              owner,
              generation: owner.id,
              assertCurrent: async () => {},
              release: async () => Errors.throwUnexpected('Unproved pair must not be released.'),
            }
          },
          run: async (command, spec = {}) => {
            if (command === 'emulator') {
              return result()
            }
            Expect(command === 'adb' || command === 'lsof').toBe(true)
            Expect(spec.timeoutMs).toBeGreaterThan(0)
            Expect(spec.timeoutMs!).toBeLessThanOrEqual(5_000 - now)
            timeouts.push(spec.timeoutMs!)
            now += 5
            if (command === 'lsof') {
              Expect(spec.args).toEqual(['-nP', '-iTCP:5582-5583', '-sTCP:LISTEN', '-Fp'])
              if (
                observation === 'initial-listener-stderr' || retains > 0 && observation === 'predelete-listener-stderr'
              ) {
                return { ...result('', 1), stderr: 'Inspection could not enumerate the owned console pair.' }
              }
              if (samples > 0 && observation === 'listener-error') {
                return result('', 2)
              }
              if (
                samples > 0 && observation === 'reused-listener' || retains > 0 && observation === 'predelete-listener'
              ) {
                return result('p999\n')
              }
              return result('', 1)
            }
            Expect(spec.args).toEqual(['devices'])
            samples++
            if (observation === 'adb-error') {
              return result('', 1)
            }
            if (observation === 'adb-timeout') {
              now = 5_001
              return result()
            }
            if (samples === 1) {
              if (observation === 'owner-rotation') {
                rotate(names[0]!)
              }
              if (observation === 'serial-owner-rotation') {
                rotate(names[1]!)
              }
              if (observation === 'kernel-revival' || observation === 'group-revival') {
                revived = true
              }
              if (observation === 'proof-rotation') {
                await FS.writeJson(targetProof, { ...proof, invocation: Platform.randomUUID() })
              }
            }
            return result(observation === 'persistent-offline' || samples === 1 ? 'emulator-5582\toffline\n' : '')
          },
          retain: async request => {
            for (const expected of request.owners) {
              Expect(owners.get(expected.name)?.id).toBe(expected.id)
            }
            retains++
            const owner: MachineResourceOwner = {
              ...request.owners[0]!,
              id: `retained-${retains}`,
              retention: {
                processes: [...request.processes],
                processGroupPid: request.processGroupPid,
                quarantined: true,
                reason: request.reason,
                resourceNames: request.owners.map(owner => owner.name),
              },
            }
            for (const expected of request.owners) {
              owners.set(expected.name, { ...owner, name: expected.name })
            }
            return owner
          },
          withCurrentOwners: async (request, action) => {
            admissions.push(request.owners.map(owner => owner.name))
            if (observation === 'atomic-rotation') {
              rotate(names[1]!)
            }
            for (const expected of request.owners) {
              if (owners.get(expected.name)?.id !== expected.id) {
                Errors.throwHostEnvironment('Changed serial generation at atomic admission.')
              }
            }
            if (observation === 'atomic-kernel') {
              revived = true
            }
            return action()
          },
          start: (command, spec = {}) => {
            starts++
            Expect([command, ...spec.args ?? []]).toEqual(['avdmanager', 'delete', 'avd', '--name', avdName])
            childAlive = true
            return {
              command,
              args: [...spec.args ?? []],
              pid: child.pid,
              exitCode: 0,
              signalCode: null,
              waitForClose: async () => {
                childAlive = false
                return { exitCode: 0, signal: null }
              },
              closeOutput: async () => {},
              dispose: () => {},
              endStdin: () => {},
              kill: () => false,
              onceClose: () => {},
              onceError: () => {},
              writeStdin: () => false,
            }
          },
          recover: async request => {
            Expect(await request.shutdown(owners.get(request.name)!)).toBe(true)
            Expect(request.generation).toBe(owners.get(request.name)!.id)
            for (const name of names) {
              owners.delete(name)
            }
          },
        },
      )
      if (observation === 'transient-offline') {
        await cleanup
        Expect(samples).toBe(3)
        Expect(sleeps).toEqual([100])
        Expect(admissions).toEqual([names])
        Expect(starts).toBe(1)
        Expect(owners.size).toBe(0)
      } else {
        await Expect(cleanup).rejects.toThrow('assets remain retained')
        Expect(starts).toBe(0)
        Expect([...owners.keys()]).toEqual(names)
        for (const owner of owners.values()) {
          if (owner.id === 'foreign-generation') {
            continue
          }
          Expect(owner.retention?.quarantined).toBe(true)
        }
        if (observation === 'persistent-offline') {
          Expect(now).toBe(5_000)
          Expect(samples).toBeGreaterThan(1)
          Expect(sleeps.every(ms => ms > 0 && ms <= 100)).toBe(true)
        }
      }
      Expect(timeouts.every((timeout, index) => index === 0 || timeout < timeouts[index - 1]!)).toBe(true)
      const journal = await FS.readJson<{ state: string; deletion?: { resources?: MachineResourceOwner[] } }[]>(
        FS.resolvePath('android-assets.json', root),
      )
      Expect(journal[0]!.state).toBe(observation === 'transient-offline' ? 'removed' : 'retained')
      if (journal[0]!.deletion !== undefined) {
        Expect(journal[0]!.deletion!.resources!.map(owner => owner.name)).toEqual(names)
      }
    } finally {
      await FS.remove(root)
    }
  })
}
