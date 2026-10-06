import { MachineResources } from '@host-control'
import { Errors, FS, Http, Platform, Repo } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { Deferred, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { acknowledgeDevLoopController, runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'

type RecoveryOperations = NonNullable<Parameters<typeof runDevLoopCommand>[1]>['recovery']

function disposedFailure(state: 'failed' | 'cleanup-failed' = 'failed'): DevLoopReceipt {
  const stamp = new Date().toISOString()
  return {
    version: 1,
    session: Platform.randomUUID(),
    checkout: FS.realPathSync(Repo.getRoot()),
    args: [],
    generation: Platform.randomUUID(),
    state,
    provenance: 'complete',
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    controller: { command: 'old controller', pid: 987, startedAt: 'old-start' },
    controllerDisposed: true,
    failures: ['Intentional compile failure'],
    cleanupOutcome: 'unknown',
    message: 'Intentional compile failure',
  }
}

function deadRecovery(): NonNullable<RecoveryOperations> {
  return {
    identities: () => new Map(),
    descendants: () => [],
    signal: () => {},
    sleep: async () => {},
    now: () => 0,
    processIsAlive: () => false,
    groupMembers: () => [],
    isGroupAlive: () => false,
  }
}

for (
  const evidence of [
    'owned',
    'retained-owner-without-stamp',
    'changed-owner-stamp',
    'changed-resource-generation',
    'reused-pid',
    'wrong-command',
    'changed-holder',
    'changed-generation',
    'active-proof',
    'retained-proof',
    'changed-control-controller',
    'changed-control-generation',
    'changed-control-token',
    'changed-control-origin',
    'term-exit-control-token',
    'term-exit-resource-owner',
    'fresh-stop',
    'not-stopping',
  ] as const
) {
  Test(`controller recovery respects ${evidence} custody and preserves other sessions`, async () => {
    const owned = evidence === 'owned' || evidence === 'retained-owner-without-stamp'
    const earlyExit = evidence === 'term-exit-control-token' || evidence === 'term-exit-resource-owner'
    const record = disposedFailure()
    record.controller = { command: 'bun', pid: 98_765, startedAt: 'recorded-controller-start' }
    record.controllerDisposed = undefined
    record.state = 'stopping'
    record.cleanupOutcome = 'pending'
    record.processGroups = [{ command: 'owned worker group', pid: 98_766, startedAt: 'worker-start' }]
    const child = { command: 'owned child', pid: 98_767, startedAt: 'child-start' }
    if (earlyExit) {
      record.children = [child]
    }
    const other = disposedFailure()
    other.state = 'ready'
    other.controller = { command: 'other controller', pid: 12_345, startedAt: 'other-controller-start' }
    await writeDevLoopReceipt(other)
    const otherPath = FS.resolvePath('receipt.json', devLoopDirectory(other.session))
    const otherBefore = await FS.readText(otherPath)
    const owner = {
      name: 'ios-simulator:OWNED-RECOVERY-FIXTURE',
      id: 'owned-generation',
      pid: record.controller.pid,
      processStartedAt: evidence === 'retained-owner-without-stamp' ? undefined : record.controller.startedAt,
      repositoryRoot: record.checkout,
      command: 'fixture',
      startedAt: 'acquired',
    }
    record.devices = [{
      platform: 'ios',
      id: 'OWNED-RECOVERY-FIXTURE',
      owned: true,
      state: 'booted',
      holder: record.controller,
      resources: [owner],
      generation: owner.id,
    }]
    if (evidence === 'active-proof' || evidence === 'retained-proof') {
      record.mobileDriverCleanup = evidence === 'active-proof' ? 'opening' : 'retained'
    }
    if (evidence === 'not-stopping') {
      record.state = 'ready'
    }
    await writeDevLoopReceipt(record)
    await writeDevLoopConnection({
      session: record.session,
      generation: record.generation,
      controller: record.controller,
      origin: 'http://127.0.0.1:1',
      token: 'private-control-test-secret',
    })
    const signals: { pids: number[]; signal: string }[] = []
    let live = true
    let childLive = earlyExit
    let clock = Date.now() + (evidence === 'fresh-stop' ? 0 : 60_000)
    const recovery = deadRecovery()
    recovery.now = () => clock
    recovery.sleep = async milliseconds => {
      clock += milliseconds
      if (
        evidence === 'changed-control-token' || evidence === 'changed-control-origin'
        || evidence === 'term-exit-control-token'
      ) {
        await writeDevLoopConnection({
          session: record.session,
          generation: record.generation,
          controller: record.controller!,
          origin: evidence === 'changed-control-origin' ? 'http://127.0.0.1:2' : 'http://127.0.0.1:1',
          token: evidence === 'changed-control-token' || evidence === 'term-exit-control-token'
            ? 'replacement-control-test-secret'
            : 'private-control-test-secret',
        })
      }
    }
    let earlyExitDriftPublished = false
    recovery.identities = pids => {
      if (!live && evidence === 'term-exit-control-token' && !earlyExitDriftPublished) {
        earlyExitDriftPublished = true
        // The recorded token drifts when the owned controller exits before the TERM grace ends.
        FS.writeTextSync(
          FS.resolvePath('active-control/credentials.json', devLoopDirectory(record.session)),
          JSON.stringify({
            session: record.session,
            generation: record.generation,
            controller: record.controller!,
            origin: 'http://127.0.0.1:1',
            token: 'replacement-control-test-secret',
          }),
        )
      }
      return new Map(pids.flatMap(pid =>
        pid === child.pid && childLive
          ? [[pid, child] as const]
          : pid === record.controller!.pid && live
          ? [
            [
              pid,
              evidence === 'reused-pid' ? { ...record.controller!, startedAt: 'different-start' } : record.controller!,
            ] as const,
          ]
          : []
      ))
    }
    recovery.processIsAlive = pid => pid === record.controller!.pid && live || pid === child.pid && childLive
    recovery.signal = (processes, signal) => {
      if (processes.length > 0) {
        signals.push({ pids: processes.map(process => process.pid), signal })
      }
      if (processes.some(process => process.pid === child.pid)) {
        childLive = false
      }
      if (
        signal === 'SIGKILL'
        || signal === 'SIGTERM' && (evidence === 'term-exit-control-token' || evidence === 'term-exit-resource-owner')
      ) {
        live = false
      }
    }
    recovery.readOwner = async () => owner
    recovery.recoverResources = async options => {
      Expect(await options.shutdown(owner)).toBe(true)
    }
    recovery.run = async (command, spec) => ({
      command,
      args: [...(spec?.args ?? [])],
      exitCode: 0,
      signal: null,
      stderr: '',
      stdout: spec?.args?.[1] === 'list'
        ? JSON.stringify({ devices: { fixture: [{ udid: 'OWNED-RECOVERY-FIXTURE', state: 'Shutdown' }] } })
        : '',
    })
    try {
      const result = await withCapturedOutput(() =>
        runDevLoopCommand([
          'stop',
          '--session',
          record.session,
          '--recover-controller',
          '--json',
        ], {
          status: async () =>
            Errors.throwUnexpected('Opt-in recovery must not call a blocked controller status route.'),
          launchController: async () => Errors.throwUnexpected('Stop recovery must not launch a controller.'),
          recovery,
          controllerCommandLine: () =>
            evidence === 'wrong-command'
              ? 'bun /other/worker.ts'
              : `bun ${Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopWorker.ts')}`,
          readControllerResource: async () =>
            evidence === 'changed-holder' || evidence === 'term-exit-resource-owner' && !live
              ? { ...owner, pid: 12_345 }
              : evidence === 'changed-owner-stamp'
              ? { ...owner, processStartedAt: 'successor-start' }
              : evidence === 'changed-resource-generation'
              ? { ...owner, id: 'successor-resource-generation' }
              : owner,
          beforeRecovery: async () => {
            if (evidence === 'changed-control-controller' || evidence === 'changed-control-generation') {
              await writeDevLoopConnection({
                session: record.session,
                generation: evidence === 'changed-control-generation' ? 'other-generation' : record.generation,
                controller: evidence === 'changed-control-controller'
                  ? { ...record.controller!, startedAt: 'other-start' }
                  : record.controller!,
                origin: 'http://127.0.0.1:1',
                token: 'private-control-test-secret',
              })
            }
            if (evidence === 'changed-generation') {
              await writeDevLoopReceipt({ ...record, generation: 'successor-generation' })
            }
          },
        })
      )
      if (owned) {
        Expect(JSON.parse(result.stdout).error).toBeUndefined()
      }
      Expect(result.stdout.trim().split('\n').length).toBe(1)
      Expect(result.stdout + result.stderr).not.toContain('private-control-test-secret')
      Expect(result.stdout + result.stderr).not.toContain('replacement-control-test-secret')
      Expect(result.stderr).toContain('Shutting down…')
      Expect(result.result).toBe(owned ? 0 : 1)
      Expect(await FS.readText(otherPath)).toBe(otherBefore)
      if (owned) {
        Expect(result.stderr.trim().split('\n')).toEqual([
          'Shutting down…',
          'Rechecking recorded controller ownership…',
          'Stopping the owned controller…',
          'Recovering recorded services and Simulator…',
        ])
        Expect(signals).toEqual([
          { pids: [98_765], signal: 'SIGTERM' },
          { pids: [98_765], signal: 'SIGKILL' },
        ])
        const saved = await readDevLoopReceipt(record.session)
        Expect(saved.state).toBe('stopped')
        Expect(saved.cleanupOutcome).toBe('proved')
        Expect(saved.devices![0]!.state).toBe('released')
        Expect(saved.failures).toEqual(['Intentional compile failure'])
      } else {
        Expect(signals).toEqual(
          evidence === 'changed-control-token' || evidence === 'changed-control-origin'
            || evidence === 'term-exit-control-token' || evidence === 'term-exit-resource-owner'
            ? [{ pids: [98_765], signal: 'SIGTERM' }]
            : [],
        )
        Expect(live).toBe(!earlyExit)
        if (earlyExit) {
          const saved = await readDevLoopReceipt(record.session)
          Expect(saved.state).toBe('interrupted')
          Expect(saved.cleanupOutcome).toBe('retained')
          Expect(saved.provenance).toBe('uncertain')
          Expect(saved.ownershipRefusal?.reason).toContain('lost recorded cleanup custody')
          Expect(saved.devices![0]!.state).toBe('booted')
          const retry = await withCapturedOutput(() =>
            runDevLoopCommand(['stop', '--session', record.session, '--json'], {
              status: readDevLoopReceipt,
              launchController: async () => Errors.throwUnexpected('Refused cleanup must never launch a controller.'),
              recovery,
            })
          )
          Expect(retry.result).toBe(1)
          Expect(childLive).toBe(true)
          Expect(signals).toEqual([{ pids: [98_765], signal: 'SIGTERM' }])
          const retained = await readDevLoopReceipt(record.session)
          Expect(retained.ownershipRefusal).toEqual(saved.ownershipRefusal)
          Expect(retained.devices![0]!.state).toBe('booted')
        }
      }
    } finally {
      await FS.remove(devLoopDirectory(record.session))
      await FS.remove(devLoopDirectory(other.session))
    }
  })
}

async function stopDisposed(
  record: DevLoopReceipt,
  recovery: RecoveryOperations,
  beforeRecovery?: () => Promise<void>,
) {
  return await withCapturedOutput(() =>
    runDevLoopCommand(['stop', '--session', record.session, '--json'], {
      status: () => readDevLoopReceipt(record.session),
      launchController: async () => Errors.throwUnexpected('Stop must not launch a controller.'),
      recovery,
      beforeRecovery,
    })
  )
}

for (const state of ['failed', 'cleanup-failed'] as const) {
  Test(`stop recovers a disposed ${state} controller only under the recovery lock and preserves failures`, async () => {
    const record = disposedFailure(state)
    await writeDevLoopReceipt(record)
    await writeDevLoopConnection({
      session: record.session,
      generation: record.generation,
      controller: record.controller,
      origin: 'http://127.0.0.1:1',
      token: 'private-fixture-token',
    })
    let enteredRecovery = 0
    try {
      const recovery = deadRecovery()
      recovery.identities = () => {
        Expect(enteredRecovery).toBe(1)
        Expect(FS.existsSync(FS.resolvePath('recovery.lock.tao-file-mutation.lock', devLoopDirectory(record.session))))
          .toBe(true)
        return new Map()
      }
      const result = await stopDisposed(record, recovery, async () => {
        enteredRecovery += 1
      })
      Expect(result.result).toBe(0)
      const saved = await readDevLoopReceipt(record.session)
      Expect(saved.state).toBe('stopped')
      Expect(saved.cleanupOutcome).toBe('proved')
      Expect(saved.controllerDisposed).toBe(true)
      Expect(saved.generation).toBe(record.generation)
      Expect(saved.failures).toEqual(['Intentional compile failure'])
      Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

for (
  const evidence of [
    'live-controller',
    'unknown-controller',
    'controller-pid-reuse',
    'unavailable-probe',
    'uncertain-tree',
    'unknown-group',
    'retained-driver',
    'changed-device-fence',
    'proved-device-fence',
  ] as const
) {
  Test(`disposed failure stop respects ${evidence} and cannot release unproved device fences`, async () => {
    const record = disposedFailure('cleanup-failed')
    const owner = {
      name: 'ios-simulator:FIXTURE',
      id: 'retained-owner',
      pid: record.controller!.pid,
      processStartedAt: record.controller!.startedAt,
      repositoryRoot: record.checkout,
      command: 'retained simulator',
      startedAt: '',
    }
    record.processGroups = [{ command: 'old group', pid: 654, startedAt: 'group-start' }]
    record.devices = [{
      platform: 'ios',
      id: 'FIXTURE',
      owned: true,
      state: 'retained',
      generation: owner.id,
      holder: record.controller,
      resources: [owner],
    }]
    if (evidence === 'uncertain-tree') {
      record.provenance = 'uncertain'
    }
    if (evidence === 'retained-driver') {
      record.mobileDriverCleanup = 'retained'
    }
    const mutations: string[] = []
    const recovery = deadRecovery()
    if (evidence === 'live-controller') {
      recovery.identities = () => new Map([[987, record.controller!]])
    }
    if (evidence === 'unknown-controller') {
      recovery.processIsAlive = () => true
    }
    if (evidence === 'controller-pid-reuse') {
      recovery.identities = () => new Map([[987, { ...record.controller!, startedAt: 'reused-start' }]])
    }
    if (evidence === 'unavailable-probe') {
      recovery.processIsAlive = () => Errors.throwHostEnvironment('Kernel absence probe unavailable')
    }
    if (evidence === 'unknown-group') {
      recovery.groupMembers = () => Errors.throwHostEnvironment('Group inspection unavailable')
    }
    recovery.signal = processes => {
      if (processes.length > 0) {
        mutations.push('signal')
      }
    }
    recovery.readOwner = async () => evidence === 'changed-device-fence' ? { ...owner, id: 'new-owner' } : owner
    recovery.recoverResources = async options => {
      mutations.push('recover-fence')
      Expect(await options.shutdown(owner)).toBe(true)
    }
    recovery.run = async (command, spec) => {
      mutations.push(spec!.args!.includes('shutdown') ? 'shutdown' : 'confirm-shutdown')
      return {
        command,
        args: [...spec!.args!],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: JSON.stringify({ devices: { ios: [{ udid: 'FIXTURE', state: 'Shutdown' }] } }),
      }
    }
    await writeDevLoopReceipt(record)
    await writeDevLoopConnection({
      session: record.session,
      generation: record.generation,
      controller: record.controller,
      origin: 'http://127.0.0.1:1',
      token: 'private-fixture-token',
    })
    try {
      const result = await stopDisposed(record, recovery)
      const saved = await readDevLoopReceipt(record.session)
      const proved = evidence === 'proved-device-fence'
      Expect(result.result).toBe(proved ? 0 : 1)
      if (!proved) {
        const error = JSON.parse(result.stdout).error as string
        Expect(error).toContain(
          evidence === 'unavailable-probe'
            ? 'Kernel absence probe unavailable'
            : ['live-controller', 'unknown-controller', 'controller-pid-reuse'].includes(evidence)
            ? 'controller absence is unproved'
            : 'cleanup remains unproved',
        )
      }
      Expect(saved.state).toBe(proved ? 'stopped' : 'cleanup-failed')
      Expect(saved.failures).toContain('Intentional compile failure')
      Expect(saved.devices![0]!.state).toBe(proved ? 'released' : 'retained')
      Expect(mutations).toEqual(proved ? ['recover-fence', 'shutdown', 'confirm-shutdown'] : [])
      Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(!proved)
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

Test('a late controller absence failure preserves the failed receipt and private credentials', async () => {
  const record = disposedFailure()
  await writeDevLoopReceipt(record)
  await writeDevLoopConnection({
    session: record.session,
    generation: record.generation,
    controller: record.controller,
    origin: 'http://127.0.0.1:1',
    token: 'private-fixture-token',
  })
  const recovery = deadRecovery()
  let absenceProbes = 0
  recovery.processIsAlive = () => {
    absenceProbes += 1
    if (absenceProbes === 2) {
      Errors.throwHostEnvironment('Private cleanup absence probe unavailable')
    }
    return false
  }
  try {
    const result = await stopDisposed(record, recovery)
    Expect(result.result).toBe(1)
    Expect(JSON.parse(result.stdout).error).toContain('Private cleanup absence probe unavailable')
    Expect(absenceProbes).toBe(2)
    const saved = await readDevLoopReceipt(record.session)
    Expect(saved.state).toBe('failed')
    Expect(saved.cleanupOutcome).toBe('unknown')
    Expect(saved.failures).toEqual(['Intentional compile failure'])
    Expect(saved.generation).toBe(record.generation)
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(true)
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop recovery cannot overwrite a generation rotated while process exit was being proved', async () => {
  const record = disposedFailure()
  const child = { command: 'recorded child', pid: 123, startedAt: 'child-start' }
  record.children = [child]
  const replacement = { ...record, generation: Platform.randomUUID(), state: 'starting' as const }
  let childAlive = true
  const recovery = deadRecovery()
  recovery.identities = pids => new Map(childAlive && pids.includes(child.pid) ? [[child.pid, child]] : [])
  recovery.sleep = async () => {
    await writeDevLoopReceipt(replacement)
    childAlive = false
  }
  await writeDevLoopReceipt(record)
  await writeDevLoopConnection({
    session: record.session,
    generation: record.generation,
    controller: record.controller,
    origin: 'http://127.0.0.1:1',
    token: 'private-fixture-token',
  })
  try {
    const result = await stopDisposed(record, recovery)
    Expect(result.result).toBe(1)
    Expect(JSON.parse(result.stdout).error).toContain('The durable dev-loop owner changed during interrupted recovery.')
    const saved = await readDevLoopReceipt(record.session)
    Expect(saved.generation).toBe(replacement.generation)
    Expect(saved.state).toBe('starting')
    Expect(saved.failures).toEqual(['Intentional compile failure'])
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(true)
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test(
  'stop preserves a released target fence through late private failure and retries without touching its next owner',
  async () => {
    const record = disposedFailure()
    const registryRoot = await mkTestDir('disposed-stop-fence')
    const name = 'ios-simulator:FIXTURE'
    let replacement: Awaited<ReturnType<typeof MachineResources.acquire>> | undefined
    try {
      const lease = await MachineResources.acquire({
        name,
        registryRoot,
        repositoryRoot: record.checkout,
        command: 'fixture simulator',
      })
      const owner = await MachineResources.retain({
        owners: [lease.owner],
        processes: [record.controller!],
        registryRoot,
        quarantined: false,
        reason: 'Fixture interrupted shutdown',
      })
      record.processGroups = [{ command: 'old group', pid: 654, startedAt: 'group-start' }]
      record.devices = [{
        platform: 'ios',
        id: 'FIXTURE',
        owned: true,
        state: 'retained',
        generation: owner.id,
        holder: record.controller,
        resources: [owner],
      }]
      await writeDevLoopReceipt(record)
      await writeDevLoopConnection({
        session: record.session,
        generation: record.generation,
        controller: record.controller,
        origin: 'http://127.0.0.1:1',
        token: 'private-fixture-token',
      })
      const recovery = deadRecovery()
      const effects: string[] = []
      let controllerAbsenceProbes = 0
      recovery.processIsAlive = pid => {
        if (pid !== record.controller!.pid) {
          return false
        }
        controllerAbsenceProbes += 1
        if (controllerAbsenceProbes === 2) {
          Errors.throwHostEnvironment('Late private absence unavailable')
        }
        return false
      }
      recovery.readOwner = options => MachineResources.readOwner({ ...options, registryRoot })
      recovery.recoverResources = async options => {
        effects.push('release-fence')
        await MachineResources.recoverRetained({ ...options, registryRoot })
      }
      recovery.run = async (command, spec) => {
        effects.push(spec!.args!.includes('shutdown') ? 'shutdown' : 'confirm-shutdown')
        return {
          command,
          args: [...spec!.args!],
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: JSON.stringify({ devices: { ios: [{ udid: 'FIXTURE', state: 'Shutdown' }] } }),
        }
      }
      const failed = await stopDisposed(record, recovery)
      Expect(failed.result).toBe(1)
      Expect(JSON.parse(failed.stdout).error).toContain('Late private absence unavailable')
      Expect(controllerAbsenceProbes).toBe(2)
      Expect(await MachineResources.readOwner({ name, registryRoot })).toBeUndefined()
      const intermediate = await readDevLoopReceipt(record.session)
      Expect(intermediate.state).toBe('failed')
      Expect(intermediate.cleanupOutcome).toBe('unknown')
      Expect(intermediate.devices![0]!.state).toBe('released')
      Expect(intermediate.failures).toEqual(['Intentional compile failure'])
      Expect(intermediate.generation).toBe(record.generation)
      Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(true)

      replacement = await MachineResources.acquire({
        name,
        registryRoot,
        repositoryRoot: record.checkout,
        command: 'next simulator owner',
      })
      Expect(replacement.owner.id).not.toBe(owner.id)
      recovery.processIsAlive = () => false
      const retried = await stopDisposed(intermediate, recovery)
      Expect(retried.result).toBe(0)
      const stopped = await readDevLoopReceipt(record.session)
      Expect(stopped.state).toBe('stopped')
      Expect(stopped.cleanupOutcome).toBe('proved')
      Expect(stopped.devices![0]!.state).toBe('released')
      Expect(stopped.failures).toEqual(['Intentional compile failure'])
      Expect((await MachineResources.readOwner({ name, registryRoot }))?.id).toBe(replacement.owner.id)
      Expect(effects).toEqual(['release-fence', 'shutdown', 'confirm-shutdown'])
      Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
    } finally {
      await replacement?.release()
      await FS.remove(registryRoot)
      await FS.remove(devLoopDirectory(record.session))
    }
  },
)

for (const controllerDiesDuringStatus of [false, true]) {
  Test(
    `concurrent restart launches one replacement when the first controller is ${
      controllerDiesDuringStatus ? 'live during the initial status read' : 'already dead'
    }`,
    async () => {
      const stamp = new Date().toISOString()
      let current: DevLoopReceipt = {
        version: 1,
        session: Platform.randomUUID(),
        checkout: FS.realPathSync(Repo.getRoot()),
        args: [],
        generation: Platform.randomUUID(),
        state: 'stopped',
        provenance: 'complete',
        createdAt: stamp,
        updatedAt: stamp,
        children: [],
        controller: controllerDiesDuringStatus
          ? ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
          : undefined,
        controllerDisposed: controllerDiesDuringStatus ? undefined : true,
      }
      const session = current.session
      await writeDevLoopReceipt(current)
      const launched = Deferred<void>()
      const releaseLaunch = Deferred<void>()
      const secondRead = Deferred<void>()
      const releaseSecond = Deferred<void>()
      const initialStatus = Deferred<void>()
      const controllerDied = Deferred<void>()
      let launches = 0
      let reads = 0
      let statusReads = 0
      const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Http.jsonResponse(current) })
      const operations = {
        beforeRecovery: async () => {
          reads++
          if (reads === 2) {
            secondRead.resolve()
            await releaseSecond.promise
          }
        },
        status: async () => {
          statusReads++
          if (controllerDiesDuringStatus && statusReads === 1) {
            // This read begins with a live controller, then observes its exit before returning.
            Expect(current.controller).toBeDefined()
            initialStatus.resolve()
            await controllerDied.promise
          }
          return structuredClone(current)
        },
        launchController: async (receipt: DevLoopReceipt) => {
          launches++
          launched.resolve()
          await releaseLaunch.promise
          current = {
            ...receipt,
            controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
            state: 'starting',
          }
          await writeDevLoopReceipt(current)
          await writeDevLoopConnection({
            session,
            origin: `http://127.0.0.1:${server.port}`,
            token: Platform.randomUUID(),
          })
          return current
        },
      }
      try {
        await withCapturedOutput(async () => {
          const first = runDevLoopCommand(['restart', '--session', session, '--json'], operations)
          if (controllerDiesDuringStatus) {
            await initialStatus.promise
            current = { ...current, controller: undefined, controllerDisposed: true }
            await writeDevLoopReceipt(current)
            controllerDied.resolve()
          }
          await launched.promise
          const second = runDevLoopCommand(['restart', '--session', session, '--json'], operations)
          await secondRead.promise
          releaseSecond.resolve()
          // Let the second command reach the recovery lock before acknowledging the first launch.
          await Promise.resolve()
          await Promise.resolve()
          releaseLaunch.resolve()
          Expect(await Promise.all([first, second])).toEqual([0, 0])
        })
        Expect(launches).toBe(1)
        Expect(current.session).toBe(session)
      } finally {
        releaseSecond.resolve()
        controllerDied.resolve()
        releaseLaunch.resolve()
        server.stop(true)
        await FS.remove(devLoopDirectory(session))
      }
    },
  )
}

Test('a disposed controller can restart with the same session while its old process is still alive', async () => {
  const stamp = new Date().toISOString()
  const record: DevLoopReceipt = {
    version: 1,
    session: Platform.randomUUID(),
    checkout: FS.realPathSync(Repo.getRoot()),
    args: ['recorded-project', '--web'],
    generation: Platform.randomUUID(),
    state: 'stopped',
    provenance: 'complete',
    controllerDisposed: true,
    controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    warnings: ['Recorded warning'],
    failures: ['Earlier generation failure'],
    cleanupOutcome: 'proved',
  }
  await writeDevLoopReceipt(record)
  let replacement: DevLoopReceipt | undefined
  try {
    const refused = await withCapturedOutput(() =>
      runDevLoopCommand(['reload', '--session', record.session, '--json'], {
        status: async () => structuredClone(record),
        launchController: async next => next,
      })
    )
    Expect(refused.result).toBe(1)
    Expect(refused.stdout.trim().split('\n').length).toBe(1)
    const report = JSON.parse(refused.stdout)
    Expect(report.session).toBe(record.session)
    Expect(report.logPath).toBe(record.logPath)
    Expect(report.warnings).toEqual(record.warnings)
    Expect(report.cleanupOutcome).toBe('proved')
    Expect(report.failures).toEqual(['Earlier generation failure', report.error])
    await withCapturedOutput(async () => {
      Expect(
        await runDevLoopCommand(['restart', '--session', record.session, '--json'], {
          status: async () => structuredClone(record),
          launchController: async next => {
            replacement = next
            return next
          },
        }),
      ).toBe(0)
    })
    Expect(replacement!.session).toBe(record.session)
    Expect(replacement!.generation).not.toBe(record.generation)
    Expect(replacement!.args).toEqual(record.args)
    Expect(replacement!.controllerDisposed).toBeUndefined()
    Expect(replacement!.warnings).toEqual(record.warnings)
    Expect(replacement!.failures).toEqual(record.failures)
    Expect(replacement!.logPath).toBe(record.logPath)
    Expect(replacement!.cleanupOutcome).toBe('pending')
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test(
  'launcher preserves the durable failure receipt when credentials disappear during its acknowledgement probe',
  async () => {
    const stamp = new Date().toISOString()
    const record: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout: FS.realPathSync(Repo.getRoot()),
      args: [],
      generation: Platform.randomUUID(),
      state: 'starting',
      createdAt: stamp,
      updatedAt: stamp,
      children: [],
      controller: ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    }
    await writeDevLoopReceipt(record)
    try {
      const terminal = {
        ...record,
        state: 'failed' as const,
        controllerDisposed: true,
        message: 'Immediate worker failure',
        cleanupOutcome: 'unknown' as const,
      }
      const result = await acknowledgeDevLoopController(record.session, { exitCode: null }, {
        readConnection: async () => {
          await writeDevLoopReceipt(terminal)
          Errors.throwHostEnvironment('The private endpoint already disposed')
        },
      })
      Expect(result.session).toBe(record.session)
      Expect(result.state).toBe('failed')
      Expect(result.message).toBe('Immediate worker failure')
      Expect(result.controllerDisposed).toBe(true)
    } finally {
      await FS.remove(devLoopDirectory(record.session))
    }
  },
)
