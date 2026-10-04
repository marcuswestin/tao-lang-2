import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import type { ManagedChildCapture } from '../simulators/AgentAppDev'

export type ManagedIosCommandIntent =
  | { stage: 'download' }
  | { stage: 'create'; name: string; type: string; runtime: string }
  | { stage: 'install'; id: string; appPath: string }
  | { stage: 'boot' | 'bootstatus' | 'shutdown' | 'delete'; id: string }
export type ManagedIosCommandPlan = {
  version: 1
  generation: string
  invocation: string
  scope: string
  root: string
  budgetMs: number
  intent: ManagedIosCommandIntent
}
export type ManagedIosCommandEvidence = {
  version: 1
  generation: string
  supervisor: TrackedProcess
  worker: TrackedProcess
  workerParentPid: number
  group: number
  processes: TrackedProcess[]
  released: boolean
  drainProved: boolean
  nativeClose?: CLI.CommandCloseResult
  supervisorClose?: CLI.CommandCloseResult
  outputClosed?: true
  refusal?: string
}
/** Kernel process names corroborate fixed exec intent; they are not authenticated executable paths. */
export type ManagedIosNativeExecution = {
  stage: 'boot' | 'install'
  id: string
  generation: string
  supervisor: TrackedProcess
  worker: TrackedProcess
  native: TrackedProcess
  group: number
  processes: readonly TrackedProcess[]
}
export const managedIosBarrierControlPrefix = 'TAO_IOS_BARRIER '
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export function managedIosCommandArguments(plan: ManagedIosCommandPlan): string[] {
  const intent = plan.intent
  if (
    plan.version !== 1 || !uuid.test(plan.generation) || !uuid.test(plan.invocation) || !uuid.test(plan.scope)
    || !Number.isFinite(plan.budgetMs) || plan.budgetMs <= 0 || plan.budgetMs > 300_000
    || FS.basename(plan.root) !== `ios-${plan.scope}`
  ) {
    Errors.throwHostEnvironment('Private iOS command barrier plan is outside its fixed invocation contract.')
  }
  if (intent.stage === 'create') {
    if (
      intent.name !== `Tao Managed ${plan.invocation}_${plan.scope}_1` || !intent.type || !intent.runtime
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(intent.type)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(intent.runtime)
    ) {
      Errors.throwHostEnvironment('Private iOS create barrier does not match its exact minted intent.')
    }
    return ['simctl', 'create', intent.name, intent.type, intent.runtime]
  }
  if (intent.stage === 'download') {
    if (
      Object.keys(intent).length !== 1
      || !FS.pathIsWithin(plan.root, Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${plan.invocation}`))
    ) {
      Errors.throwHostEnvironment('Private iOS downloader requires its exact invocation-owned fixed plan.')
    }
    return [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime.ts'),
      'download',
      FS.resolvePath('download-plan.json', plan.root),
    ]
  }
  if (!uuid.test(intent.id)) {
    Errors.throwHostEnvironment('Private iOS command barrier requires an exact minted UDID.')
  }
  if (intent.stage === 'install') {
    if (
      !FS.pathIsWithin(intent.appPath, FS.resolvePath('expo-home', plan.root)) || FS.basename(intent.appPath) === '..'
    ) {
      Errors.throwHostEnvironment('Private iOS install barrier requires its invocation-owned verified artifact.')
    }
    return ['simctl', 'install', intent.id, intent.appPath]
  }
  if (intent.stage === 'bootstatus') {
    return ['simctl', 'bootstatus', intent.id, '-b']
  }
  if (!['boot', 'shutdown', 'delete'].includes(intent.stage)) {
    Errors.throwHostEnvironment('Private iOS command barrier refuses an unreviewed native operation.')
  }
  return ['simctl', intent.stage, intent.id]
}
type Operations = Pick<
  typeof ProcessTree,
  'identities' | 'descendants' | 'sameProcess' | 'processGroupOf' | 'groupMembers' | 'isGroupAlive' | 'signalTracked'
>
export async function runManagedIosCommandBarrier(options: {
  plan: ManagedIosCommandPlan
  start: typeof CLI.start
  tree: Operations
  processIsAlive: typeof Platform.processIsAlive
  save: (path: string, value: unknown) => Promise<void>
  shouldStop: () => boolean
  publish: (evidence: ManagedIosCommandEvidence) => Promise<void>
  onChild?: (child: CLI.StartedCommand, capture?: ManagedChildCapture) => Promise<void>
  onNativeExecution?: (execution: ManagedIosNativeExecution, child: CLI.StartedCommand) => Promise<void>
  /** Reacquires current owners; the callback and physical ACK must remain synchronous. */
  admit: (checkAndRelease: () => void) => Promise<void>
}): Promise<CLI.CommandResult> {
  const { plan, tree } = options
  const args = managedIosCommandArguments(plan)
  const deadline = Time.nowMs() + plan.budgetMs
  const remaining = () => Math.max(1, deadline - Time.nowMs())
  const bounded = async <T>(promise: Promise<T>, label: string, cancelSensitive = false): Promise<T> => {
    let settled = false
    let value: T | undefined
    let failure: unknown
    void promise.then(result => {
      value = result
      settled = true
    }, error => {
      failure = error
      settled = true
    })
    if (
      !await Time.pollUntil(() => settled ? true : undefined, {
        intervalMs: 25,
        timeoutMs: remaining(),
        stop: cancelSensitive ? options.shouldStop : undefined,
      })
    ) {
      Errors.throwHostEnvironment(`Private iOS barrier ${label} lost its finite uncancelled publication budget.`)
    }
    if (failure !== undefined) {
      throw failure
    }
    return value as T
  }
  const planPath = FS.resolvePath(`command-${plan.generation}.json`, plan.root)
  await bounded(options.save(planPath, plan), 'plan', true)
  let controls = ''
  let controlError = ''
  const child = options.start(Platform.runtimeProcess.execPath, {
    args: [
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedIosCommandBarrierSupervisor.ts'),
      planPath,
    ],
    cwd: Repo.getRoot(),
    env: plan.intent.stage === 'download'
      ? {
        ...Platform.runtimeProcess.env,
        TAO_DEV_LOOP_WORKER_CREDENTIALS: '',
        __UNSAFE_EXPO_HOME_DIRECTORY: FS.resolvePath('expo-home', plan.root),
        TMPDIR: `${FS.resolvePath('tmp', plan.root)}/`,
      }
      : undefined,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    processPolicy: 'server',
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        controls = (controls + chunk.toString('utf8')).slice(-262_144)
      } else {
        controlError = (controlError + chunk.toString('utf8')).slice(-32_768)
      }
    },
  })
  let outputClosureAttempted = false
  const closeOutput = async () => {
    outputClosureAttempted = true
    let outputClosed = false
    let outputFailure: unknown
    void child.closeOutput().then(() => {
      outputClosed = true
    }, error => {
      outputFailure = error
      outputClosed = true
    })
    if (
      !await Time.pollUntil(() => outputClosed ? true : undefined, {
        intervalMs: 25,
        timeoutMs: Math.min(2_000, plan.budgetMs),
      })
    ) {
      Errors.throwHostEnvironment('Private iOS supervisor output closure exceeded its finite budget.')
    }
    if (outputFailure !== undefined) {
      throw outputFailure
    }
    if (evidence) {
      evidence.outputClosed = true
    }
  }
  let admissionClosed = false
  let evidence: ManagedIosCommandEvidence | undefined
  let close: CLI.CommandCloseResult | undefined
  let closeFailure: unknown
  let nativeObservation: Promise<void> | undefined
  let nativeObservationFailure: unknown
  void child.waitForClose().then(value => {
    close = value
  }, error => {
    closeFailure = error
  })
  const control = () =>
    // Raw stdout chunks may stop inside JSON. Keep that tail until its newline arrives.
    controls.split('\n').slice(0, -1).filter(line => line.startsWith(managedIosBarrierControlPrefix))
      .map(line =>
        JSON.parse(line.slice(managedIosBarrierControlPrefix.length)) as {
          event: 'ready' | 'closed'
          generation: string
          workerPid: number
          workerParentPid: number
          result?: CLI.CommandCloseResult
        }
      )
  const inspectOpen = () => {
    if (
      !evidence || admissionClosed || Time.nowMs() >= deadline || options.shouldStop() || child.error !== undefined
      || close !== undefined
      || closeFailure !== undefined
      || child.exitCode !== null || child.signalCode !== null
    ) {
      Errors.throwHostEnvironment('Private iOS command barrier lost its open uncancelled supervisor.')
    }
    const current = tree.identities([evidence.supervisor.pid, evidence.worker.pid])
    const supervisor = current.get(evidence.supervisor.pid)
    const worker = current.get(evidence.worker.pid)
    const members = tree.groupMembers(evidence.group)
    if (
      !supervisor || !worker || supervisor.pid !== evidence.supervisor.pid || worker.pid !== evidence.worker.pid
      || !tree.sameProcess(supervisor, evidence.supervisor) || !tree.sameProcess(worker, evidence.worker)
      || evidence.workerParentPid !== supervisor.pid || tree.processGroupOf(worker.pid) !== evidence.group
      || tree.processGroupOf(supervisor.pid) !== evidence.group || members.length !== 2
      || !members.every(process =>
        evidence!.processes.some(expected => expected.pid === process.pid && tree.sameProcess(process, expected))
      )
      || !tree.descendants(supervisor.pid).some(process =>
        process.pid === worker.pid && tree.sameProcess(process, worker)
      )
    ) {
      Errors.throwHostEnvironment('Private iOS command barrier original kernels, ancestry, or exact group changed.')
    }
  }
  const drain = () => {
    if (!evidence) {
      Errors.throwHostEnvironment('Private iOS command barrier lacks captured drain authority.')
    }
    if (
      child.error !== undefined || close !== undefined || closeFailure !== undefined
      || child.exitCode !== null || child.signalCode !== null
    ) {
      Errors.throwHostEnvironment('Private iOS barrier lost its live original supervisor before drain acknowledgement.')
    }
    const current = tree.identities(evidence.processes.map(process => process.pid))
    if (
      evidence.processes.some(process =>
        process.pid !== evidence!.supervisor.pid
        && (current.has(process.pid) || options.processIsAlive(process.pid))
      )
    ) {
      Errors.throwHostEnvironment('Private iOS command barrier original worker or known descendant remains live.')
    }
    const members = tree.groupMembers(evidence.group)
    if (
      members.length !== 1 || members[0]!.pid !== evidence.supervisor.pid
      || !tree.sameProcess(members[0], evidence.supervisor)
    ) {
      Errors.throwHostEnvironment('Private iOS command barrier drain lacks its sole original supervisor.')
    }
  }
  try {
    const ready = await Time.pollUntil(() => control().find(value => value.event === 'ready'), {
      intervalMs: 25,
      timeoutMs: Math.min(remaining(), 10_000),
    })
    if (!ready || ready.generation !== plan.generation || !child.pid || ready.workerParentPid !== child.pid) {
      Errors.throwHostEnvironment(`Private iOS held worker readiness is unproved: ${controlError}`)
    }
    const identities = tree.identities([child.pid, ready.workerPid])
    const supervisor = identities.get(child.pid)
    const worker = identities.get(ready.workerPid)
    if (!supervisor || !worker) {
      Errors.throwHostEnvironment('Private iOS held supervisor/worker kernel capture is unreadable.')
    }
    evidence = {
      version: 1,
      generation: plan.generation,
      supervisor,
      worker,
      workerParentPid: ready.workerParentPid,
      group: supervisor.pid,
      processes: [supervisor, worker],
      released: false,
      drainProved: false,
    }
    inspectOpen()
    await bounded(options.publish(evidence), 'capture', true)
    if (options.onChild) {
      await bounded(
        options.onChild(child, { version: 1, root: supervisor, members: [supervisor, worker] }),
        'managed child acknowledgement',
        true,
      )
    }
    await bounded(
      options.admit(() => {
        inspectOpen()
        if (!child.writeStdin(`run ${plan.generation}\n`)) {
          Errors.throwHostEnvironment('Private iOS native execution ACK was refused.')
        }
        evidence!.released = true
      }),
      'owner admission',
      true,
    )
    await bounded(options.publish(evidence), 'capture')
    const completed = await Time.pollUntil(async () => {
      if (nativeObservationFailure !== undefined) {
        throw nativeObservationFailure
      }
      if (options.shouldStop()) {
        child.writeStdin(`cancel ${plan.generation}\n`)
      }
      const observed = control().find(value => value.event === 'closed')
      if (observed) {
        return observed
      }
      const original = tree.identities([worker.pid]).get(worker.pid)
      if (original && tree.sameProcess(original, worker)) {
        const observedProcesses = tree.descendants(worker.pid)
        let added = false
        const after = tree.identities([worker.pid]).get(worker.pid)
        if (after && tree.sameProcess(after, worker)) {
          for (const process of observedProcesses) {
            const prior = evidence!.processes.find(expected => expected.pid === process.pid)
            if (prior && !tree.sameProcess(process, prior)) {
              Errors.throwHostEnvironment('Private iOS barrier descendant kernel was replaced.')
            }
            if (!prior) {
              evidence!.processes.push(process)
              added = true
            }
          }
          if (added) {
            await bounded(options.publish(evidence!), 'descendant capture')
          }
          if (
            options.onNativeExecution && !nativeObservation && !options.shouldStop()
            && (plan.intent.stage === 'boot' || plan.intent.stage === 'install')
          ) {
            const current = tree.identities(evidence!.processes.map(process => process.pid))
            const currentWorker = current.get(worker.pid)
            const currentSupervisor = current.get(supervisor.pid)
            const native = evidence!.processes.map(process => current.get(process.pid)).find(process =>
              process?.command === 'simctl'
              && evidence!.processes.some(expected =>
                expected.pid === process.pid && tree.sameProcess(process, expected)
              )
            )
            if (native) {
              if (
                !currentWorker || !currentSupervisor || !tree.sameProcess(currentWorker, worker)
                || !tree.sameProcess(currentSupervisor, supervisor) || child.error !== undefined
                || close !== undefined || closeFailure !== undefined || child.exitCode !== null
                || child.signalCode !== null || tree.processGroupOf(native.pid) !== evidence!.group
                || tree.processGroupOf(worker.pid) !== evidence!.group
              ) {
                Errors.throwHostEnvironment('Private iOS native execution lost its original kernel/group anchors.')
              }
              const execution: ManagedIosNativeExecution = {
                stage: plan.intent.stage,
                id: plan.intent.id,
                generation: plan.generation,
                supervisor,
                worker,
                native,
                group: evidence!.group,
                processes: [...evidence!.processes],
              }
              // Observer publication never holds up the native cancellation/descendant monitor.
              nativeObservation = options.onNativeExecution(execution, child).catch(error => {
                nativeObservationFailure = error
              })
            }
          }
        } else if (
          observedProcesses.some(process =>
            !evidence!.processes.some(expected => expected.pid === process.pid && tree.sameProcess(process, expected))
          )
        ) {
          Errors.throwHostEnvironment('Private iOS barrier walk crossed an unproved worker exit.')
        }
      }
      return undefined
    }, { intervalMs: 25, timeoutMs: remaining() })
    if (!completed?.result || completed.generation !== plan.generation) {
      Errors.throwHostEnvironment('Private iOS native worker closure is unproved.')
    }
    if (nativeObservation) {
      await bounded(nativeObservation, 'native execution observation')
      if (nativeObservationFailure !== undefined) {
        throw nativeObservationFailure
      }
    }
    evidence.nativeClose = completed.result
    drain()
    await bounded(options.publish(evidence), 'capture')
    drain()
    if (!child.writeStdin(`finish ${plan.generation}\n`)) {
      Errors.throwHostEnvironment('Private iOS supervisor drain ACK was refused.')
    }
    if (
      !await Time.pollUntil(() => close, { intervalMs: 25, timeoutMs: 10_000 }) || close!.exitCode !== 0
      || close!.signal !== null
      || tree.isGroupAlive(evidence.group) || tree.groupMembers(evidence.group).length !== 0
    ) {
      Errors.throwHostEnvironment('Private iOS original supervisor/group closure remains unproved.')
    }
    await closeOutput()
    evidence.supervisorClose = close
    const stdoutPath = FS.resolvePath(`command-${plan.generation}-stdout.txt`, plan.root)
    const stderrPath = FS.resolvePath(`command-${plan.generation}-stderr.txt`, plan.root)
    const stdout = await FS.readText(stdoutPath)
    const stderr = await FS.readText(stderrPath)
    evidence.drainProved = true
    await bounded(options.publish(evidence), 'capture')
    if (options.shouldStop()) {
      throw Errors.abortError('Private iOS native command was cancelled after proven drain.')
    }
    return {
      command: plan.intent.stage === 'download' ? Platform.runtimeProcess.execPath : '/usr/bin/xcrun',
      args,
      stdout: stdout.slice(-32_768),
      stderr: stderr.slice(-32_768),
      ...completed.result,
    }
  } catch (error) {
    if (evidence) {
      evidence.refusal ??= Errors.formatForUser(error)
      try {
        evidence.nativeClose ??= control().find(value => value.event === 'closed')?.result
      } catch {
        // Preserve the first decoder refusal; malformed control is never closure authority.
      }
    }
    admissionClosed = true
    child.endStdin()
    // Keep the original close listener until EOF cancellation has joined the finite supervisor.
    await Time.pollUntil(() => close || closeFailure ? true : undefined, {
      intervalMs: 25,
      timeoutMs: Math.min(2_000, plan.budgetMs),
    })
    let outputFailure: unknown
    if (!outputClosureAttempted) {
      try {
        await closeOutput()
      } catch (failure) {
        outputFailure = failure
      }
    }
    if (evidence) {
      evidence.supervisorClose = close
      await bounded(options.publish(evidence), 'refusal evidence').catch(() => {})
    }
    return Errors.throwHostEnvironment(
      `Private iOS command barrier retained uncertain execution, publication, or drain: ${Errors.formatForUser(error)}${
        outputFailure === undefined ? '' : `; output closure: ${Errors.formatForUser(outputFailure)}`
      }`,
      {
        cause: error,
        details: { retainsTargetLease: true, evidence, outputFailure },
      },
    )
  } finally {
    if (close !== undefined || closeFailure !== undefined) {
      child.dispose()
    } else {
      void child.waitForClose().then(() => child.dispose(), () => child.dispose())
    }
  }
}
