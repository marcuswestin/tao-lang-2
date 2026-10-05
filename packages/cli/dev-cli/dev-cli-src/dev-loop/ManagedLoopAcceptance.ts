import {
  type ManagedLoopAcceptanceRequest,
  parseManagedLoopAcceptanceArgs,
} from '@agent-cli/agent-config/ManagedLoopAcceptanceArgs'
import { CLI, Errors, FS, HCI, Http, Platform, Repo, Switch, Time } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { appDevReservation } from '../simulators/AgentAppDev'
import { devLoopDirectory, type DevLoopReceipt, readDevLoopReceipt } from './DevLoopStore'
import { managedLoopAndroidPrefix } from './ManagedLoopAcceptanceAndroidTarget'
import { runManagedLoopChromeInteraction } from './ManagedLoopAcceptanceChrome'
import {
  captureManagedForegroundProcesses,
  ManagedLoopAcceptanceEvidence,
  type ManagedLoopInventory,
} from './ManagedLoopAcceptanceEvidence'
import {
  admitManagedAndroidAbruptDeath,
  type ManagedIosNativeStopObservation,
  type ManagedLoopFaultScenario,
  startManagedLoopFault,
} from './ManagedLoopAcceptanceFaults'
import {
  cleanupManagedLoopAcceptanceFixtures,
  ManagedLoopAcceptanceFixtures,
  type ManagedLoopFixture,
} from './ManagedLoopAcceptanceFixture'
import type { ManagedIosAsset } from './ManagedLoopAcceptanceIosRuntime'
import { runManagedLoopProcessGroupDiagnostic } from './ManagedLoopProcessGroupDiagnostic'
import { withOwnedBorrowedTarget } from './ManagedLoopTargetBorrowing'
import { runManagedLoopTargetFault } from './ManagedLoopTargetFaults'

type CaseRow = {
  name: string
  disposition: 'real-host pass' | 'real-host failure' | 'capability blocked'
  detail?: unknown
}
type OwnedSession = {
  session: string
  fixture: ManagedLoopFixture
  receipt: DevLoopReceipt
  processes: TrackedProcess[]
  listeners?: NonNullable<ManagedLoopInventory['listeners']>
  collect?: () => Promise<void>
}
type VisibleFlag = '--show-browser' | '--show-simulator' | '--show-emulator'

type ManagedLoopMobileInteraction = (context: {
  receipt: DevLoopReceipt
  target: 'ios' | 'android'
  artifactRoot: string
  phase: string
  assertCurrent: () => Promise<void>
}) => Promise<unknown>

type AcceptanceOperations = {
  run: typeof CLI.run
  start: typeof CLI.start
  inventory: () => Promise<ManagedLoopInventory>
  receipt: typeof readDevLoopReceipt
  identities: typeof ProcessTree.identities
  processIsAlive: (pid: number) => boolean
  signalOwned: typeof ManagedLoopAcceptanceEvidence.signalOwned
  chromeInteraction: typeof runManagedLoopChromeInteraction
  startFault: typeof startManagedLoopFault
  targetFault: typeof runManagedLoopTargetFault
  borrowTarget: typeof withOwnedBorrowedTarget
  processGroupDiagnostic: typeof runManagedLoopProcessGroupDiagnostic
  /** Parent wiring supplies the reviewed driver bridge. It never receives control credentials. */
  mobileInteraction?: ManagedLoopMobileInteraction
  /** Injected source regressions must never produce a real-host pass artifact. */
  evidenceKind?: 'source regression'
}

const liveOperations: AcceptanceOperations = {
  run: CLI.run,
  start: CLI.start,
  inventory: ManagedLoopAcceptanceEvidence.inventory,
  receipt: readDevLoopReceipt,
  identities: ProcessTree.identities,
  processIsAlive: pid => Platform.signalProcess(pid, 0),
  signalOwned: ManagedLoopAcceptanceEvidence.signalOwned,
  chromeInteraction: runManagedLoopChromeInteraction,
  startFault: startManagedLoopFault,
  targetFault: runManagedLoopTargetFault,
  borrowTarget: withOwnedBorrowedTarget,
  processGroupDiagnostic: runManagedLoopProcessGroupDiagnostic,
  mobileInteraction: async context => {
    await context.assertCurrent()
    const { executeManagedMobileAcceptance } = await import('./ManagedMobileAcceptance')
    const evidence = await executeManagedMobileAcceptance(context.receipt.session, context.target, context.artifactRoot)
    await context.assertCurrent()
    return evidence
  },
}

/** Failure publication precedes finally cleanup; recovery waits for the exact holder to finish. */
export async function waitManagedLoopStartupFailureDisposal(
  failed: DevLoopReceipt,
  operations: {
    receipt: typeof readDevLoopReceipt
    identities: typeof ProcessTree.identities
    processIsAlive?: (pid: number) => boolean
  } = { receipt: readDevLoopReceipt, identities: ProcessTree.identities },
): Promise<DevLoopReceipt> {
  if (failed.controller === undefined) {
    Errors.throwHostEnvironment('Startup failure disposal requires its captured managed controller identity.')
  }
  const disposed = await Time.pollUntil(async () => {
    const current = await operations.receipt(failed.session)
    if (
      current.session !== failed.session || current.generation !== failed.generation
      || current.checkout !== failed.checkout
      || !ProcessTree.sameProcess(current.controller, failed.controller!)
      || current.selection?.projectRoot !== failed.selection?.projectRoot
      || current.selection?.appPath !== failed.selection?.appPath
      || current.selection?.appName !== failed.selection?.appName
    ) {
      Errors.throwHostEnvironment('The startup failure owner changed before its disposal was proved.')
    }
    if (current.state === 'ready') {
      Errors.throwHostEnvironment('The failed startup unexpectedly reached readiness during disposal.')
    }
    const pid = failed.controller!.pid
    const alive = (operations.processIsAlive ?? (pid => Platform.signalProcess(pid, 0)))(pid)
    if (current.controllerDisposed !== true || operations.identities([pid]).get(pid) !== undefined || alive) {
      return undefined
    }
    if (await FS.exists(FS.resolvePath('active-control', devLoopDirectory(failed.session)))) {
      Errors.throwHostEnvironment('The failed startup retained its private controller connection after disposal.')
    }
    return current
  }, { intervalMs: 100, timeoutMs: 180_000 })
  if (disposed === undefined) {
    Errors.throwHostEnvironment(
      'Startup failure disposal did not complete within its finite observation budget; ownership remains retained.',
    )
  }
  return disposed
}

type ManagedLoopActionEvidence = { event?: string; action?: string; session?: string; generation?: string }

/** A concurrent old request either ran before restart or was fenced without reaching input. */
export function validateManagedLoopRestartReloadRace(options: {
  before: DevLoopReceipt
  after: DevLoopReceipt
  restart: CLI.CommandResult
  reload: CLI.CommandResult
  events: readonly ManagedLoopActionEvidence[]
}): { reload: 'ordered before restart' | 'fenced'; before: string; successor: string; refusal?: string } {
  const { before, after, restart, reload } = options
  const events = options.events.filter(event => event.action !== undefined)
  const restarted = JSON.parse(restart.stdout.trim()) as DevLoopReceipt
  const reloaded = JSON.parse(reload.stdout.trim()) as DevLoopReceipt & { ok?: boolean; error?: string }
  const sameOwner = (receipt: DevLoopReceipt) =>
    receipt.session === before.session && receipt.checkout === before.checkout
    && before.controller !== undefined && ProcessTree.sameProcess(receipt.controller, before.controller)
    && JSON.stringify(receipt.args) === JSON.stringify(before.args)
    && JSON.stringify(receipt.selection) === JSON.stringify(before.selection)
  const generations = new Set([before.generation, after.generation])
  if (
    restart.exitCode !== 0 || restart.error !== undefined || restart.signal !== null
    || reload.error !== undefined || reload.signal !== null || ![0, 1].includes(reload.exitCode ?? -1)
    || before.state !== 'ready' || after.state !== 'ready' || after.generation === before.generation
    || ![after, restarted, reloaded].every(receipt => sameOwner(receipt) && generations.has(receipt.generation))
    || !['starting', 'ready'].includes(restarted.state)
  ) {
    Errors.throwHostEnvironment(
      'Concurrent restart/reload did not preserve the exact owned session and recorded generation transition.',
    )
  }
  if (events.some(event => event.session !== before.session || !generations.has(event.generation ?? ''))) {
    Errors.throwHostEnvironment('Concurrent control action evidence belongs to an unexpected session or generation.')
  }
  const restartStart = events.findIndex(event => event.event === 'action-start' && event.action === 'restart')
  const restartEnd = events.findIndex(event => event.event === 'action-end' && event.action === 'restart')
  const reloadEvents = events.filter(event => event.action === 'reload')
  if (
    restartStart < 0 || restartEnd <= restartStart || events.filter(event => event.action === 'restart').length !== 2
    || events[restartStart]?.generation !== before.generation
  ) {
    Errors.throwHostEnvironment('Concurrent restart lacks its exact serialized owned action evidence.')
  }
  if (reload.exitCode === 0) {
    const reloadEnd = events.findIndex(event => event.event === 'action-end' && event.action === 'reload')
    if (
      !['starting', 'ready'].includes(reloaded.state) || reloaded.ok === false
      || reloaded.error !== undefined
      || reloadEvents.length !== 2 || reloadEvents[0]?.event !== 'action-start'
      || reloadEvents[1]?.event !== 'action-end'
      || reloadEvents.some(event => event.generation !== before.generation) || reloadEnd >= restartStart
    ) {
      Errors.throwHostEnvironment('Concurrent reload success was not proved ordered before the generation fence.')
    }
    return { reload: 'ordered before restart', before: before.generation, successor: after.generation }
  }
  const knownRefusals = [
    'The dev loop is not ready for this command.',
    'Loop is changing generation.',
    'Stale generation',
  ]
  if (
    reloaded.ok !== false || !knownRefusals.includes(reloaded.error ?? '') || reloadEvents.length !== 0
    || !['starting', 'ready'].includes(reloaded.state)
  ) {
    Errors.throwHostEnvironment(
      'Concurrent reload did not report an exact generation fence refusal without input effects.',
    )
  }
  return { reload: 'fenced', before: before.generation, successor: after.generation, refusal: reloaded.error }
}

/** Finite acceptance budgets observe a loop; they never become a production session lifetime. */
export async function runManagedLoopAcceptance(
  options: { case?: string; session?: string; target?: string },
  overrides: Partial<AcceptanceOperations> = {},
): Promise<number> {
  // Repeat canonical validation for direct callers before any fixture, process or artifact allocation.
  let request: ManagedLoopAcceptanceRequest
  const overrideKeys = Reflect.ownKeys(overrides)
  let injectedDiagnostic: AcceptanceOperations['processGroupDiagnostic'] | undefined
  try {
    for (const key of overrideKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(overrides, key)!
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        Errors.throwUserInput('Managed-loop acceptance operation overrides must be data properties.')
      }
      if (key === 'processGroupDiagnostic' && typeof descriptor.value === 'function') {
        injectedDiagnostic = descriptor.value
      }
    }
    const allowed = ['case', 'session', 'target']
    if (Object.keys(options).some(key => !allowed.includes(key))) {
      Errors.throwUserInput('Managed-loop acceptance accepts only case, session and target.')
    }
    request = parseManagedLoopAcceptanceArgs([
      '--case',
      options.case ?? '',
      ...(options.session === undefined ? [] : ['--session', options.session]),
      ...(options.target === undefined ? [] : ['--target', options.target]),
    ])
    if (
      overrideKeys.length > 0 && request.case === 'commands' && injectedDiagnostic === undefined
    ) {
      Errors.throwUserInput('Injected commands acceptance requires an explicit source process-group diagnostic.')
    }
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    return 1
  }
  const operations = {
    ...liveOperations,
    ...overrides,
    ...(overrideKeys.length === 0 ? {} : { evidenceKind: 'source regression' as const }),
    ...(injectedDiagnostic === undefined ? {} : { processGroupDiagnostic: injectedDiagnostic }),
  }
  const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${Platform.randomUUID()}`)
  await FS.mkdir(root)
  await FS.chmod(root, 0o700)
  const fixtures = new ManagedLoopAcceptanceFixtures(root)
  const owned: OwnedSession[] = []
  const pendingHelpers = new Set<
    { fixture: ManagedLoopFixture; fault: Awaited<ReturnType<typeof startManagedLoopFault>> }
  >()
  const unresolvedFixtures = new Set<ManagedLoopFixture>()
  const rows: CaseRow[] = []
  let commandIndex = 0
  let baseline: ManagedLoopInventory | undefined
  let visibilityWarning: string | undefined
  const pass = (name: string, detail?: unknown): void => {
    rows.push({ name, disposition: 'real-host pass', detail })
  }
  const blocked = (name: string, detail: string): void => {
    rows.push({ name, disposition: 'capability blocked', detail })
  }
  try {
    baseline = await operations.inventory()
    await ManagedLoopAcceptanceEvidence.write(root, 'before', baseline)
    const head = await operations.run('git', { args: ['rev-parse', 'HEAD'] })
    const dirty = await operations.run('git', { args: ['status', '--short'] })
    await ManagedLoopAcceptanceEvidence.write(root, 'invocation', {
      request,
      sourceCommit: head.stdout.trim(),
      dirtyPaths: dirty.stdout,
      owner: operations.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid),
    })
    await Switch<ManagedLoopAcceptanceRequest['case'], Promise<void>>(request.case, {
      commands: commands,
      lifecycle: () => lifecycle([]),
      'lifecycle-faults': lifecycleFaults,
      'combined-lifecycle': () => combined(false),
      'combined-target-failure': () => combined(true),
      'foreground-compatibility': foreground,
      chrome: chrome,
      'chrome-visible': () => visible('web', '--show-browser'),
      'ios-visible': () => visible('ios', '--show-simulator'),
      'android-visible': () => visible('android', '--show-emulator'),
      'mobile-interaction': mobile,
      'mobile-interaction-faults': mobileFaults,
      'android-lifecycle': async () => {
        await lifecycle(['android'])
        await borrowed('android')
      },
      'android-escalation': () => targetFault('android-escalation'),
      'android-abrupt-exit': () => abruptExit(['android']),
      'android-quarantine': () => targetFault('android-quarantine'),
      'android-recovery': () => targetFault('android-recovery'),
      'android-parallel': () => parallel('android'),
      'ios-lifecycle': async () => {
        await lifecycle(['ios'])
        await borrowed('ios')
      },
      'ios-cleanup': iosCleanup,
      'ios-parallel': () => parallel('ios'),
      'ios-recovery': () => targetFault('ios-recovery'),
    })
  } catch (error) {
    rows.push({ name: request.case, disposition: 'real-host failure', detail: Errors.formatForUser(error) })
  } finally {
    // Each independent rollback runs even after another target reports an unsafe/failed shutdown.
    for (const session of owned.toReversed()) {
      try {
        await stop(session)
      } catch (error) {
        rows.push({
          name: `cleanup ${session.session}`,
          disposition: 'real-host failure',
          detail: Errors.formatForUser(error),
        })
      } finally {
        await session.collect?.().catch(error => {
          rows.push({
            name: 'fault output capture',
            disposition: 'real-host failure',
            detail: Errors.formatForUser(error),
          })
        })
      }
    }
    for (const pending of [...pendingHelpers].toReversed()) {
      try {
        const rollback = await pending.fault.rollback()
        if (rollback.proved) {
          unresolvedFixtures.delete(pending.fixture)
        } else {
          Errors.throwHostEnvironment(
            'The unvalidated helper rollback remains uncertain; its source projection is retained.',
          )
        }
      } catch (error) {
        rows.push({
          name: `pending helper cleanup ${pending.fault.session}`,
          disposition: 'real-host failure',
          detail: Errors.formatForUser(error),
        })
      } finally {
        await pending.fault.collect().catch(error => {
          rows.push({
            name: 'pending helper output capture',
            disposition: 'real-host failure',
            detail: Errors.formatForUser(error),
          })
        })
      }
    }
    await cleanupManagedLoopAcceptanceFixtures(fixtures, fixture => {
      const sessions = owned.filter(session => session.fixture === fixture)
      return !unresolvedFixtures.has(fixture)
        && sessions.every(session =>
          session.receipt.state === 'stopped' && session.receipt.cleanupOutcome === 'proved'
          && !liveProcesses(session.processes).length
        )
    }, (fixture, error) => {
      rows.push({
        name: 'source projection retained',
        disposition: 'real-host failure',
        detail: { path: fixture.root, error: Errors.formatForUser(error) },
      })
    })
    try {
      const after = await operations.inventory()
      await ManagedLoopAcceptanceEvidence.write(root, 'after', after)
      await ManagedLoopAcceptanceEvidence.write(
        root,
        'helper-observations',
        baseline === undefined ? [] : ManagedLoopAcceptanceEvidence.helperChanges(baseline, after),
      )
      const changed = baseline === undefined
        ? ['Baseline inventory unavailable.']
        : ManagedLoopAcceptanceEvidence.preserved(baseline, after)
      if (changed.length > 0) {
        rows.push({ name: 'unchanged peer identities', disposition: 'real-host failure', detail: changed })
      } else {
        pass('unchanged primary peer identities', {
          primaryProcesses: baseline!.peers.filter(peer => peer.role !== 'helper').length,
          resources: baseline!.resources.length,
          helperDepartures: ManagedLoopAcceptanceEvidence.helperChanges(baseline!, after).length,
        })
      }
    } catch (error) {
      rows.push({ name: 'final inventory', disposition: 'real-host failure', detail: Errors.formatForUser(error) })
    }
  }
  const exitCode = rows.some(row => row.disposition !== 'real-host pass') ? 1 : 0
  const report = {
    case: request.case,
    evidenceKind: operations.evidenceKind ?? 'real host',
    disposition: exitCode === 0 ? operations.evidenceKind ?? 'real-host pass' : 'incomplete',
    rows: operations.evidenceKind === undefined
      ? rows
      : rows.map(row => ({ ...row, disposition: 'source regression', hostDisposition: row.disposition })),
    artifactRoot: root,
    ...(visibilityWarning === undefined ? {} : { visibilityWarning }),
  }
  await ManagedLoopAcceptanceEvidence.write(root, 'report', report)
  HCI.writeLine(JSON.stringify(ManagedLoopAcceptanceEvidence.sanitize(report)))
  return exitCode

  async function command(args: readonly string[], allowFailure = false): Promise<CLI.CommandResult> {
    const index = ++commandIndex
    const result = await operations.run(Repo.resolvePath('dev'), {
      args: ['dev-loop', ...args],
      cwd: Repo.getRoot(),
      processPolicy: 'test',
      timeoutMs: 180_000,
      stdio: 'pipe',
    })
    await ManagedLoopAcceptanceEvidence.write(root, `command-${index}`, {
      argv: ['./dev', 'dev-loop', ...args],
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error === undefined ? undefined : Errors.formatForUser(result.error),
    })
    if (!allowFailure && (result.exitCode !== 0 || result.error !== undefined)) {
      Errors.throwHostEnvironment(`Managed-loop command ${args[0]} failed; see command-${index}.json.`)
    }
    return result
  }

  function remember(session: OwnedSession, receipt: DevLoopReceipt): void {
    session.receipt = receipt
    for (
      const identity of [
        ...receipt.children,
        ...receipt.processGroups ?? [],
        ...(receipt.controller === undefined ? [] : [receipt.controller]),
        ...receipt.targets?.flatMap(target => target.browser?.process === undefined ? [] : [target.browser.process])
          ?? [],
      ]
    ) {
      if (
        !session.processes.some(process => process.pid === identity.pid && process.startedAt === identity.startedAt)
      ) {
        session.processes.push({ ...identity, command: 'invocation-owned service' })
      }
    }
  }

  async function start(
    fixture: ManagedLoopFixture,
    targets: readonly string[] = [],
    explicitApp = true,
    selectors: readonly string[] = [],
    visibility?: VisibleFlag,
  ): Promise<OwnedSession> {
    if (targets.length === 1 && targets[0] === 'android' && selectors.length === 0) {
      return (await faultSessionFor(
        visibility === '--show-emulator'
          ? 'android-owned-visible'
          : request.case === 'android-parallel'
          ? 'android-owned-parallel'
          : 'android-owned-normal',
        fixture,
      )).session
    }
    if (targets.length === 1 && targets[0] === 'ios' && selectors.length === 0) {
      return (await faultSessionFor(
        visibility === '--show-simulator'
          ? 'ios-owned-visible'
          : request.case === 'ios-parallel'
          ? 'ios-owned-parallel'
          : 'ios-owned-normal',
        fixture,
      )).session
    }
    unresolvedFixtures.add(fixture)
    const result = await command([
      'start',
      fixture.root,
      ...(explicitApp ? ['--app', 'DataMVPApp'] : []),
      ...targets.map(target => `--${target}`),
      ...selectors,
      ...(visibility === undefined ? [] : [visibility]),
      '--json',
    ], true)
    const value = JSON.parse(result.stdout.trim()) as { session?: string }
    if (typeof value.session !== 'string') {
      Errors.throwHostEnvironment('Managed start returned no session UUID; no controller ownership can be adopted.')
    }
    const receipt = await operations.receipt(value.session)
    if (
      receipt.selection?.projectRoot !== fixture.root || receipt.selection.appPath !== fixture.appPath
      || receipt.selection.appName !== 'DataMVPApp' || receipt.checkout !== await FS.realPath(Repo.getRoot())
    ) {
      Errors.throwHostEnvironment(
        'Managed start receipt does not match the invocation-owned fixture; refusing control.',
      )
    }
    const session: OwnedSession = { session: receipt.session, fixture, receipt, processes: [] }
    owned.push(session)
    unresolvedFixtures.delete(fixture)
    remember(session, receipt)
    if (result.exitCode !== 0 || result.error !== undefined) {
      Errors.throwHostEnvironment('Managed start failed after session allocation; owned rollback will run.')
    }
    return session
  }

  async function observe(session: OwnedSession, state: DevLoopReceipt['state'] = 'ready'): Promise<DevLoopReceipt> {
    const receipt = await Time.pollUntil(async () => {
      await command(['status', '--session', session.session, '--json'])
      const current = await operations.receipt(session.session)
      remember(session, current)
      if (current.state === state) {
        return current
      }
      if (['failed', 'cleanup-failed', 'interrupted', 'stopped'].includes(current.state)) {
        Errors.throwHostEnvironment(
          `Managed loop ended ${current.state} before ${state}: ${current.message ?? 'see retained receipt'}`,
        )
      }
      return undefined
    }, { intervalMs: 500, timeoutMs: 360_000 })
    if (receipt === undefined) {
      Errors.throwHostEnvironment(`Managed loop did not reach ${state} within the finite observation budget.`)
    }
    for (
      const target of session.receipt.args.filter(arg => ['--web', '--ios', '--android'].includes(arg)).map(arg =>
        arg.slice(2)
      )
    ) {
      if (!receipt.targets?.some(dispatch => dispatch.target === target && dispatch.dispatched)) {
        Errors.throwHostEnvironment(`Managed readiness did not include requested target ${target}.`)
      }
    }
    const inventory = await operations.inventory()
    session.listeners = [
      ...session.listeners ?? [],
      ...inventory.listeners?.filter(listener =>
        session.processes.some(process => process.pid === listener.pid && process.startedAt === listener.startedAt)
      ) ?? [],
    ]
    return receipt
  }

  function liveProcesses(processes: readonly TrackedProcess[]): TrackedProcess[] {
    const identities = operations.identities(processes.map(process => process.pid))
    return processes.filter(process => ProcessTree.sameProcess(identities.get(process.pid), process))
  }

  async function stop(session: OwnedSession): Promise<void> {
    await command(['stop', '--session', session.session, '--json'])
    remember(session, await operations.receipt(session.session))
    if (
      session.receipt.state !== 'stopped' || session.receipt.cleanupOutcome !== 'proved'
      || session.receipt.devices?.some(device => device.state !== 'released')
    ) {
      Errors.throwHostEnvironment(`Managed cleanup retained or did not prove resources for ${session.session}.`)
    }
    const closed = await Time.pollUntil(() => liveProcesses(session.processes).length === 0 ? true : undefined, {
      intervalMs: 100,
      timeoutMs: 60_000,
    })
    if (closed !== true) {
      Errors.throwHostEnvironment('Owned services survived managed stop; fixture and ownership evidence are retained.')
    }
    const final = await operations.inventory()
    if (
      session.listeners?.some(previous =>
        final.listeners?.some(current =>
          current.port === previous.port && current.pid === previous.pid && current.startedAt === previous.startedAt
        )
      )
    ) {
      Errors.throwHostEnvironment('Owned TCP listener survived managed stop.')
    }
    for (const device of session.receipt.devices ?? []) {
      if (!device.owned) {
        continue
      }
      if (
        final.targetInspection?.[device.platform] !== 'complete'
        || final.targets?.some(current =>
          current.platform === device.platform && current.id === device.id && current.state !== 'Shutdown'
        )
      ) {
        Errors.throwHostEnvironment(
          `Authoritative ${device.platform} target shutdown inspection did not prove ${device.id} closed.`,
        )
      }
    }
    const control = Repo.resolvePath(`.artifacts/dev-loops/${session.session}/active-control`)
    if (await FS.exists(control)) {
      Errors.throwHostEnvironment('Managed stop did not dispose its active control directory.')
    }
    for (const target of session.receipt.targets ?? []) {
      if (target.browser !== undefined && await FS.exists(target.browser.profile)) {
        Errors.throwHostEnvironment('Managed stop retained its Chrome profile.')
      }
    }
    pass('owned cleanup', {
      session: session.session,
      generation: session.receipt.generation,
      receipt: session.receipt,
    })
  }

  async function assertCurrent(receipt: DevLoopReceipt): Promise<void> {
    const current = await operations.receipt(receipt.session)
    if (
      current.state !== 'ready' || current.generation !== receipt.generation || current.checkout !== receipt.checkout
      || current.selection?.appPath !== receipt.selection?.appPath || receipt.controller === undefined
      || !ProcessTree.sameProcess(current.controller, receipt.controller)
      || !ProcessTree.sameProcess(
        operations.identities([receipt.controller.pid]).get(receipt.controller.pid),
        receipt.controller,
      )
    ) {
      Errors.throwHostEnvironment('The managed attachment generation/controller identity is no longer current.')
    }
    if (receipt.selection === undefined || !await FS.isFile(receipt.selection.appPath)) {
      Errors.throwHostEnvironment('The managed source identity is unavailable.')
    }
    if (
      receipt.selection.appName !== 'DataMVPApp'
      || await FS.readText(receipt.selection.appPath)
        !== await FS.readText(Repo.resolvePath('Apps/Test Apps/Data MVP/Data MVP.tao'))
    ) {
      Errors.throwHostEnvironment(
        'The finite managed interaction source no longer matches the Data MVP Memory fixture.',
      )
    }
  }

  async function interaction(session: OwnedSession, phase: string): Promise<void> {
    const receipt = await observe(session)
    if (receipt.args.includes('--web')) {
      pass(
        'managed Chrome input',
        await operations.chromeInteraction({
          receipt,
          phase,
          artifactRoot: root,
          assertCurrent: () => assertCurrent(receipt),
        }),
      )
    }
    for (const target of ['android', 'ios'] as const) {
      if (!receipt.args.includes(`--${target}`)) {
        continue
      }
      if (operations.mobileInteraction === undefined) {
        blocked(
          `managed ${target} input`,
          'The reviewed managed-attach driver bridge is unavailable; lifecycle dispatch does not prove rendered interaction.',
        )
      } else {
        pass(
          `managed ${target} input`,
          await operations.mobileInteraction({
            receipt,
            target,
            phase,
            artifactRoot: root,
            assertCurrent: () => assertCurrent(receipt),
          }),
        )
      }
    }
  }

  async function visible(target: 'web' | 'ios' | 'android', flag: VisibleFlag): Promise<void> {
    visibilityWarning = `Visible managed-loop acceptance opens the owned ${target} target and may take window focus.`
    HCI.writeErrorLine(visibilityWarning)
    await ManagedLoopAcceptanceEvidence.write(root, 'visibility', { warning: visibilityWarning, target, flag })
    await lifecycle([target], flag)
  }

  async function lifecycle(targets: readonly string[], visibility?: VisibleFlag): Promise<void> {
    const fixture = await fixtures.create()
    const session = await start(fixture, targets, true, [], visibility)
    const first = await observe(session)
    pass('finite launcher exit and ready controller', { session: session.session, receipt: first })
    await command(['logs', '--session', session.session, '--lines', '200'])
    await command(['logs', '--session', session.session, '--lines', '200', '--json'])
    if (visibility === undefined) {
      await interaction(session, 'initial')
    } else if (!first.args.includes(visibility)) {
      Errors.throwHostEnvironment('The fixed visible target flag was not preserved in the owned receipt.')
    }
    await command(['reload', '--session', session.session, '--json'])
    const reloaded = await observe(session)
    if (reloaded.generation !== first.generation || !ProcessTree.sameProcess(reloaded.controller, first.controller!)) {
      Errors.throwHostEnvironment('Reload changed the loop generation/controller identity.')
    }
    if (visibility === undefined) {
      await interaction(session, 'reload')
    }
    const port = Number(new URL(reloaded.url!).port)
    const priorMetro = liveProcesses(session.processes).filter(process =>
      session.listeners?.some(listener =>
        listener.port === port && listener.pid === process.pid && listener.startedAt === process.startedAt
      )
    )
    if (priorMetro.length === 0) {
      Errors.throwHostEnvironment(
        'Restart requires a kernel-bound owned Metro listener before old service cleanup can be proved.',
      )
    }
    const priorProcesses = [
      ...priorMetro,
      ...reloaded.targets?.flatMap(target => target.browser?.process === undefined ? [] : [target.browser.process])
        ?? [],
    ]
    await command(['restart', '--session', session.session, '--json'])
    const restarted = await observe(session)
    if (
      restarted.session !== first.session || restarted.generation === first.generation
      || JSON.stringify(restarted.args) !== JSON.stringify(first.args) || liveProcesses(priorProcesses).length > 0
    ) {
      Errors.throwHostEnvironment('Restart did not replace the owned generation after old service cleanup.')
    }
    if (visibility === undefined) {
      await interaction(session, 'restart')
    }
    pass('reload and restart generations', {
      first: first.generation,
      reloaded: reloaded.generation,
      successor: restarted.generation,
    })
    // Mutations are bounded child commands; public controller owns their ordering and completion.
    await Promise.all([
      command(['reload', '--session', session.session, '--json']),
      command(['reload', '--session', session.session, '--json']),
    ])
    await Promise.all([
      command(['stop', '--session', session.session, '--json']),
      command(['stop', '--session', session.session, '--json']),
    ])
    await stop(session)
    await command(['status', '--session', session.session, '--json'])
  }

  async function commands(): Promise<void> {
    const diagnostic = await operations.processGroupDiagnostic(FS.basename(root))
    await ManagedLoopAcceptanceEvidence.write(root, 'process-group-diagnostic', {
      ...diagnostic,
      ...(operations.evidenceKind === undefined ? {} : { evidenceKind: 'source regression' }),
    })
    if (!diagnostic.closureProved || diagnostic.evidenceKind !== (operations.evidenceKind ?? 'real host')) {
      Errors.throwHostEnvironment(
        'The fixed owned process-group diagnostic remains inconclusive; see process-group-diagnostic.json.',
      )
    }
    pass('fixed owned process-group diagnostic', diagnostic)
    const single = await fixtures.create()
    const session = await start(single, [], false)
    await observe(session)
    pass('prompt-free single app selection', { appName: session.receipt.selection!.appName })
    await stop(session)
    const ambiguous = await fixtures.create('ambiguous')
    const refusedArgs: readonly (readonly string[])[] = [
      ['start', ambiguous.root, '--json'],
      ['start', single.root, '--app', 'UnknownAcceptanceApp', '--json'],
      ['start', single.root, '--web', '--web', '--json'],
      ['start', single.root, '--show-browser', '--json'],
      ['start', single.root, '--unsupported', '--json'],
      ['stop', '--json'],
      ['stop', '--session', 'invalid', '--json'],
      ['worker', '--json'],
      ['logs', '--session', session.session, '--follow', '--json'],
    ]
    for (const args of refusedArgs) {
      const before = await operations.inventory()
      const recordsBefore = await sessionNames()
      const result = await command(args, true)
      const after = await operations.inventory()
      const allocated = after.peers.some(peer =>
        peer.role !== 'helper' && !before.peers.some(previous =>
          previous.pid === peer.pid && previous.startedAt === peer.startedAt
        )
      )
        || after.resources.some(resource =>
          !before.resources.some(previous =>
            previous.name === resource.name && previous.generation === resource.generation
          )
        )
      const changed = ManagedLoopAcceptanceEvidence.preserved(before, after)
      await ManagedLoopAcceptanceEvidence.write(root, `command-${commandIndex}-inventory`, {
        before,
        after,
        allocated,
        changed,
        sessionsBefore: recordsBefore,
        sessionsAfter: await sessionNames(),
      })
      if (
        result.exitCode === 0 || allocated || changed.length > 0
        || JSON.stringify(await sessionNames()) !== JSON.stringify(recordsBefore)
      ) {
        Errors.throwHostEnvironment(
          `Invalid managed command ${commandIndex} succeeded, allocated a session or changed primary peer resources; see its inventory artifact.`,
        )
      }
      if (args[1] === ambiguous.root && !`${result.stdout}\n${result.stderr}`.includes('--app')) {
        Errors.throwHostEnvironment('Ambiguous app selection refused without explicit --app guidance.')
      }
      pass('allocation-free command refusal', args)
    }
  }

  async function sessionNames(): Promise<string[]> {
    const path = Repo.resolvePath('.artifacts/dev-loops')
    return await FS.isDirectory(path) ? await FS.listDir(path) : []
  }

  async function chrome(): Promise<void> {
    if (request.session === undefined) {
      await lifecycle(['web'])
      return
    }
    const receipt = await operations.receipt(request.session)
    await assertCurrent(receipt)
    pass(
      'bounded borrowed Chrome interaction',
      await operations.chromeInteraction({
        receipt,
        artifactRoot: root,
        phase: 'borrowed',
        assertCurrent: () => assertCurrent(receipt),
      }),
    )
  }

  async function mobile(): Promise<void> {
    if (operations.mobileInteraction === undefined) {
      blocked(
        'managed mobile interaction',
        'The reviewed managed-attach driver bridge is not available. The supplied session was not mutated.',
      )
      return
    }
    const receipt = await operations.receipt(request.session!)
    await assertCurrent(receipt)
    if (!receipt.targets?.some(dispatch => dispatch.target === request.target && dispatch.dispatched)) {
      Errors.throwHostEnvironment('The requested mobile target was not dispatched by this managed generation.')
    }
    pass(
      'bounded borrowed mobile interaction',
      await operations.mobileInteraction({
        receipt,
        target: request.target!,
        artifactRoot: root,
        phase: 'borrowed',
        assertCurrent: () => assertCurrent(receipt),
      }),
    )
  }

  async function mobileFaults(): Promise<void> {
    if (operations.mobileInteraction === undefined) {
      blocked(
        'managed driver fault interaction',
        'The managed-attach driver bridge is unavailable; no target was allocated.',
      )
      return
    }
    for (const target of ['android', 'ios'] as const) {
      const failure = await faultSessionFor(`mobile-${target}-driver-failure`)
      const ready = await observe(failure.session)
      let actionFailure: unknown
      try {
        await operations.mobileInteraction({
          receipt: ready,
          target,
          artifactRoot: root,
          phase: 'controlled-driver-failure',
          assertCurrent: () => assertCurrent(ready),
        })
      } catch (error) {
        actionFailure = error
      }
      const events = await readFaultEvents(failure.fault.eventRoot, 'controller')
      if (!events.some(event => event.event === 'mobile-action' && event.phase === 'input')) {
        blocked(
          `managed ${target} fault attachment`,
          `The real driver did not reach the fixed fixture input boundary: ${Errors.formatForUser(actionFailure)}`,
        )
        await stop(failure.session)
        continue
      }
      if (
        actionFailure === undefined
        || !Errors.formatForUser(actionFailure).includes('Intentionally injected managed driver action failure')
      ) {
        Errors.throwHostEnvironment(
          'The controlled action fault did not report the exact injected real-driver failure.',
        )
      }
      remember(failure.session, await operations.receipt(failure.session.session))
      if (failure.session.receipt.mobileDriverCleanup !== 'proved') {
        Errors.throwHostEnvironment('Real driver failure did not prove independent driver/server teardown.')
      }
      await assertCurrent(ready)
      await interaction(failure.session, 'after-driver-failure')
      await stop(failure.session)
      pass(`real ${target} driver action failure preserves the managed runtime and reservation`, {
        injected: true,
        events,
      })

      for (const action of ['stop', 'restart'] as const) {
        const delayed = await faultSessionFor(`mobile-${target}-delayed-action`)
        const current = await observe(delayed.session)
        let settled = false
        const pending = operations.mobileInteraction({
          receipt: current,
          target,
          artifactRoot: root,
          phase: `overlap-${action}`,
          assertCurrent: () => assertCurrent(current),
        })
          .then(value => ({ ok: true, value }), error => ({ ok: false, error: Errors.formatForUser(error) }))
          .finally(() => {
            settled = true
          })
        const reached = await Time.pollUntil(async () => {
          const events = await readFaultEvents(delayed.fault.eventRoot, 'controller')
          if (events.some(event => event.event === 'mobile-action' && event.phase === 'input')) {
            return true
          }
          if (settled) {
            Errors.throwHostEnvironment('The managed delayed-action proof ended before real driver attachment.')
          }
          return undefined
        }, { intervalMs: 100, timeoutMs: 180_000 })
        if (reached !== true) {
          Errors.throwHostEnvironment('The managed driver did not enter its finite delayed input gate.')
        }
        await command([action, '--session', delayed.session.session, '--json'])
        const cancelled = await pending
        if (cancelled.ok) {
          Errors.throwHostEnvironment('The revoked delayed managed action unexpectedly completed successfully.')
        }
        if (action === 'restart') {
          const successor = await observe(delayed.session)
          if (successor.generation === current.generation) {
            Errors.throwHostEnvironment('Restart did not revoke the old interaction generation.')
          }
          let stale = false
          try {
            await assertCurrent(current)
          } catch {
            stale = true
          }
          if (!stale) {
            Errors.throwHostEnvironment('The old managed attachment remained valid after restart.')
          }
          await interaction(delayed.session, 'after-overlap-restart')
        }
        await stop(delayed.session)
        pass(`public ${action} cancels and drains real ${target} driver action`, {
          cancelled,
          events: await readFaultEvents(delayed.fault.eventRoot, 'controller'),
        })
      }

      const dead = await faultSessionFor(`mobile-${target}-delayed-action`)
      const deadReady = await observe(dead.session)
      const active = operations.mobileInteraction({
        receipt: deadReady,
        target,
        artifactRoot: root,
        phase: 'owned-controller-death',
        assertCurrent: () => assertCurrent(deadReady),
      })
        .then(() => ({ ok: true }), error => ({ ok: false, error: Errors.formatForUser(error) }))
      await waitFaultEvents(
        dead.fault.eventRoot,
        events => events.some(event => event.event === 'mobile-action' && event.phase === 'input'),
        'controller',
      )
      remember(dead.session, await operations.receipt(dead.session.session))
      if (deadReady.controller === undefined || dead.session.receipt.mobileDriverCleanup !== 'opening') {
        Errors.throwHostEnvironment(
          'Controlled holder-death injection did not capture the real active managed driver generation.',
        )
      }
      operations.signalOwned(deadReady.controller, dead.session.processes, 'SIGKILL')
      const cancelledByDeath = await active
      if (cancelledByDeath.ok) {
        Errors.throwHostEnvironment('The managed driver action survived its owned controller death.')
      }
      await command(['stop', '--session', dead.session.session, '--json'], true)
      remember(dead.session, await operations.receipt(dead.session.session))
      if (
        dead.session.receipt.state !== 'cleanup-failed'
        || !['retained', 'unknown'].includes(dead.session.receipt.cleanupOutcome ?? '')
      ) {
        Errors.throwHostEnvironment('Unproved remote driver deletion after controller death did not retain ownership.')
      }
      pass(`owned ${target} holder death revokes transport and retains unproved driver ownership`, {
        cancelledByDeath,
        receipt: dead.session.receipt,
      })

      const deletion = await faultSessionFor(`mobile-${target}-deletion-failure`)
      const deletionReady = await observe(deletion.session)
      let deletionFailure: unknown
      try {
        await operations.mobileInteraction({
          receipt: deletionReady,
          target,
          artifactRoot: root,
          phase: 'controlled-delete-refusal',
          assertCurrent: () => assertCurrent(deletionReady),
        })
      } catch (error) {
        deletionFailure = error
      }
      remember(deletion.session, await operations.receipt(deletion.session.session))
      if (
        deletionFailure === undefined || deletion.session.receipt.mobileDriverCleanup !== 'retained'
        || !(await readFaultEvents(deletion.fault.eventRoot, 'controller')).some(event =>
          event.event === 'mobile-delete-refused'
        )
      ) {
        Errors.throwHostEnvironment('Controlled real driver deletion refusal did not retain its driver/target fences.')
      }
      const reload = await command(['reload', '--session', deletion.session.session, '--json'], true)
      const restart = await command(['restart', '--session', deletion.session.session, '--json'], true)
      if (reload.exitCode === 0 || restart.exitCode === 0) {
        Errors.throwHostEnvironment('An unproved managed driver deletion permitted another target mutator.')
      }
      pass(`controlled ${target} driver deletion refusal blocks later mutation`, {
        injected: true,
        error: Errors.formatForUser(deletionFailure),
        receipt: deletion.session.receipt,
      })
      // Deliberate uncertainty is kept visible. The final owned rollback attempts public stop and
      // retains the exact generation/source ledger if remote deletion cannot be proved.
    }
  }

  async function parallel(target: 'android' | 'ios'): Promise<void> {
    const first = await start(await fixtures.create(), [target])
    const firstReceipt = await observe(first)
    const second = await start(await fixtures.create(), [target])
    const secondReceipt = await observe(second)
    const device = firstReceipt.devices?.find(device => device.platform === target && device.state === 'booted')
    const peer = secondReceipt.devices?.find(device => device.platform === target && device.state === 'booted')
    if (device === undefined || peer === undefined || device.id === peer.id || firstReceipt.url === secondReceipt.url) {
      Errors.throwHostEnvironment('Parallel loops did not publish distinct target reservations and Metro URLs.')
    }
    await interaction(first, 'parallel-first')
    await interaction(second, 'parallel-second')
    const contender = await fixtures.create()
    const result = await command([
      'start',
      contender.root,
      '--app',
      'DataMVPApp',
      `--${target}`,
      target === 'android' ? '--emulator' : '--simulator',
      device.id,
      '--json',
    ], true)
    const value = JSON.parse(result.stdout.trim()) as { session?: string }
    let refusalDiagnostic = `${result.stdout}\n${result.stderr}`
    if (value.session !== undefined) {
      const receipt = await operations.receipt(value.session)
      if (receipt.selection?.projectRoot !== contender.root) {
        Errors.throwHostEnvironment('Parallel contender receipt is outside its owned fixture.')
      }
      const session: OwnedSession = { session: value.session, fixture: contender, receipt, processes: [] }
      owned.push(session)
      remember(session, receipt)
      const terminal = await Time.pollUntil(async () => {
        await command(['status', '--session', session.session, '--json'])
        remember(session, await operations.receipt(session.session))
        return ['failed', 'cleanup-failed', 'stopped'].includes(session.receipt.state) ? session.receipt : undefined
      }, { intervalMs: 500, timeoutMs: 180_000 })
      if (terminal === undefined || terminal.state === 'ready') {
        Errors.throwHostEnvironment(
          'A contender for the held explicit target was not refused within the finite budget.',
        )
      }
      refusalDiagnostic += `\n${terminal.message ?? ''}\n${terminal.failures?.join('\n') ?? ''}`
    } else if (result.exitCode === 0) {
      Errors.throwHostEnvironment('The explicit held target contender unexpectedly succeeded.')
    }
    if (
      !refusalDiagnostic.includes('Machine resource ') || !refusalDiagnostic.includes(' is busy:')
      || !device.resources?.some(resource => refusalDiagnostic.includes(resource.name))
    ) {
      Errors.throwHostEnvironment('The parallel contender did not prove refusal by the exact held target resource.')
    }
    await assertCurrent(firstReceipt)
    await assertCurrent(secondReceipt)
    pass('parallel target isolation and held-target refusal', {
      first: device,
      second: peer,
      urls: [firstReceipt.url, secondReceipt.url],
    })
    await stop(second)
    await stop(first)
    const oldView = device.resources === undefined ? undefined : appDevReservation(target, device.id, device.resources)
    if (oldView === undefined) {
      Errors.throwHostEnvironment('Parallel target receipts did not publish resource-generation identities.')
    }
    for (const url of [firstReceipt.url, secondReceipt.url]) {
      const parsed = new URL(url!)
      if (parsed.hostname !== '127.0.0.1' || !Number.isInteger(Number(parsed.port))) {
        Errors.throwHostEnvironment('The owned Metro receipt did not contain a bounded loopback port.')
      }
      const probe = Bun.serve({
        hostname: '127.0.0.1',
        port: Number(parsed.port),
        fetch: () => Http.jsonResponse({ ownedPortReacquired: true }),
      })
      await probe.stop(true)
    }
    const successor = await start(await fixtures.create(), [target])
    const successorReceipt = await observe(successor)
    const successorDevice = successorReceipt.devices?.find(device =>
      device.platform === target && device.state === 'booted'
    )
    if (successorDevice?.id !== device.id || successorDevice.resources === undefined) {
      Errors.throwHostEnvironment(
        'Automatic target reacquisition did not reuse the released owned slot; no same-slot proof is claimed.',
      )
    }
    let refused = false
    try {
      await oldView.assertCurrent()
    } catch {
      refused = true
    }
    if (!refused) {
      Errors.throwHostEnvironment('The old resource generation remained valid after owned target reacquisition.')
    }
    await appDevReservation(target, successorDevice.id, successorDevice.resources).assertCurrent()
    await interaction(successor, 'reacquired')
    await stop(successor)
    pass('owned target slot and Metro port reacquisition with stale resource generation refusal', {
      previous: device,
      successor: successorDevice,
    })
  }

  async function targetFault(caseName: Parameters<typeof runManagedLoopTargetFault>[0]): Promise<void> {
    const evidence = await operations.targetFault(caseName, root)
    const retained = evidence.unresolved
    const avd = retained.find(owner =>
      [1, 2, 3, 4].some(slot => owner.name === `android-avd:${managedLoopAndroidPrefix(FS.basename(root))}${slot}`)
    )
    const serial = retained.find(owner =>
      /^android-emulator:emulator-(?:558[02468]|559[02468]|56[0-7][02468]|5680)$/u.test(owner.name)
    )
    const expectedQuarantine = caseName === 'android-quarantine' && retained.length === 2
      && avd !== undefined && serial !== undefined && avd.generation.trim() !== ''
      && avd.generation === serial.generation
      && retained.every(owner => !baseline!.resources.some(resource => resource.name === owner.name))
    if (
      evidence.disposition !== 'real-host pass' || evidence.case !== caseName
      || (caseName === 'android-quarantine' ? !expectedQuarantine : retained.length > 0)
    ) {
      rows.push({ name: caseName, disposition: 'real-host failure', detail: evidence })
      return
    }
    pass(
      caseName,
      caseName === 'android-quarantine'
        ? { ...evidence, outcome: 'recovery refusal with intentional launch-intent retention' }
        : evidence,
    )
  }

  async function borrowed(target: 'android' | 'ios'): Promise<void> {
    const evidence = await operations.borrowTarget(target, root, async id => {
      const session = await start(await fixtures.create(), [target], true, [
        target === 'android' ? '--emulator' : '--simulator',
        id,
      ])
      try {
        const ready = await observe(session)
        if (!ready.devices?.some(device => device.platform === target && device.id === id && !device.owned)) {
          Errors.throwHostEnvironment(
            'The proof-created sentinel target was not recorded as borrowed by the managed loop.',
          )
        }
        await interaction(session, 'borrowed-owned-sentinel')
      } finally {
        await stop(session)
      }
    })
    if (
      evidence.disposition !== 'real-host pass' || !evidence.preserved || evidence.cleanup !== 'complete'
      || evidence.unresolved.length > 0
    ) {
      rows.push({
        name: 'proof-owned borrowed target preservation',
        disposition: 'real-host failure',
        detail: evidence,
      })
    } else {
      pass('proof-owned borrowed target preservation', evidence)
    }
  }

  /** Quiet cleanup proof owns two fresh simulators and does not require a mobile interaction driver. */
  async function iosCleanup(): Promise<void> {
    const successful = await start(await fixtures.create(), ['ios'])
    await observe(successful)
    await stop(successful)
    pass('iOS successful session cleanup', successful.receipt)

    const failed = await start(await fixtures.create('invalid'), ['ios'])
    const terminal = await Time.pollUntil(async () => {
      await command(['status', '--session', failed.session, '--json'])
      remember(failed, await operations.receipt(failed.session))
      if (failed.receipt.state === 'ready') {
        Errors.throwHostEnvironment('Invalid Tao source reached iOS managed readiness.')
      }
      return ['failed', 'stopped', 'cleanup-failed'].includes(failed.receipt.state) ? failed.receipt : undefined
    }, { intervalMs: 500, timeoutMs: 180_000 })
    if (terminal === undefined || !(terminal.failures?.length || terminal.message)) {
      Errors.throwHostEnvironment('The owned iOS compilation failure did not preserve its failure diagnostic.')
    }
    remember(failed, await waitManagedLoopStartupFailureDisposal(terminal, operations))
    const diagnostic = "No value named 'MissingAcceptanceDeclaration' is in scope."
    const output = await FS.readText(FS.resolvePath('loop.log', devLoopDirectory(failed.session)))
    if (!output.includes(diagnostic)) {
      Errors.throwHostEnvironment('The owned iOS startup failed without the intended Tao compiler diagnostic.')
    }
    await stop(failed)
    pass('iOS failed startup cleanup', failed.receipt)
  }

  async function lifecycleFaults(): Promise<void> {
    const session = await start(await fixtures.create('invalid'))
    const failed = await Time.pollUntil(async () => {
      await command(['status', '--session', session.session, '--json'])
      remember(session, await operations.receipt(session.session))
      if (session.receipt.state === 'ready') {
        Errors.throwHostEnvironment('Invalid Tao source reached managed readiness.')
      }
      return ['failed', 'stopped', 'cleanup-failed'].includes(session.receipt.state) ? session.receipt : undefined
    }, { intervalMs: 500, timeoutMs: 180_000 })
    if (failed === undefined || !(failed.failures?.length || failed.message)) {
      Errors.throwHostEnvironment('The real compilation failure did not preserve a failure diagnostic.')
    }
    pass('real disposable compilation failure', {
      receipt: failed,
      injected: 'MissingAcceptanceDeclaration in owned fixture source',
    })
    remember(session, await waitManagedLoopStartupFailureDisposal(failed, operations))
    await stop(session)
    for (const scenario of ['metro-failure', 'dispatch-failure'] as const) {
      const { session: faultSession } = await faultSessionFor(scenario)
      const terminal = await Time.pollUntil(async () => {
        const status = await command(['status', '--session', faultSession.session, '--json'])
        const observed = JSON.parse(status.stdout.trim()) as DevLoopReceipt
        remember(faultSession, await operations.receipt(faultSession.session))
        if (observed.state === 'ready') {
          Errors.throwHostEnvironment(`The intentionally injected ${scenario} reached false readiness.`)
        }
        return ['failed', 'cleanup-failed', 'stopped', 'interrupted'].includes(observed.state) ? observed : undefined
      }, { intervalMs: 500, timeoutMs: 180_000 })
      if (
        terminal === undefined || !`${terminal.message ?? ''} ${(terminal.failures ?? []).join(' ')}`.includes(scenario)
      ) {
        Errors.throwHostEnvironment(`The injected ${scenario} did not preserve its exact phase diagnostic.`)
      }
      remember(faultSession, await waitManagedLoopStartupFailureDisposal(terminal, operations))
      await stop(faultSession)
      pass('real services rolled back after intentional startup fault', { scenario, terminal })
    }
    for (const phase of ['compile', 'metro', 'dispatch'] as const) {
      const { session: paused, fault } = await faultSessionFor(`pause-${phase}`)
      await waitFaultEvents(
        fault.eventRoot,
        events => events.some(event => event.event === 'phase' && event.phase === phase),
      )
      await Promise.all([
        command(['stop', '--session', paused.session, '--json']),
        command(['stop', '--session', paused.session, '--json']),
      ])
      await stop(paused)
      const events = await readFaultEvents(fault.eventRoot)
      if (
        !events.some(event => event.event === 'pause-cancelled' && event.phase === phase)
        || paused.receipt.targets?.some(target => target.dispatched)
      ) {
        Errors.throwHostEnvironment(`Public stop at the owned ${phase} pause did not drain before target dispatch.`)
      }
      pass('public repeated stop during exact startup phase', { phase, events })
    }
    const delayed = await faultSessionFor('delayed-cleanup')
    await observe(delayed.session)
    await Promise.all([
      command(['stop', '--session', delayed.session.session, '--json']),
      command(['stop', '--session', delayed.session.session, '--json']),
    ])
    if (!(await readFaultEvents(delayed.fault.eventRoot)).some(event => event.event === 'delayed-cleanup-completed')) {
      Errors.throwHostEnvironment('Public stop completed before the intentionally delayed real cleanup gate drained.')
    }
    await stop(delayed.session)
    pass('delayed cancellation drains real cleanup')
    const cleanupFault = await faultSessionFor('cleanup-failure')
    await observe(cleanupFault.session)
    const refusedStop = await command(['stop', '--session', cleanupFault.session.session, '--json'], true)
    remember(cleanupFault.session, await operations.receipt(cleanupFault.session.session))
    if (
      refusedStop.exitCode === 0 || cleanupFault.session.receipt.state !== 'cleanup-failed'
      || !(await readFaultEvents(cleanupFault.fault.eventRoot)).some(event => event.event === 'services-closed')
    ) {
      Errors.throwHostEnvironment(
        'The injected cleanup inspection failure did not retain its failure receipt after independent service close.',
      )
    }
    pass('controlled real cleanup-inspection failure and retained receipt', cleanupFault.session.receipt)
    remember(
      cleanupFault.session,
      await waitManagedLoopStartupFailureDisposal(cleanupFault.session.receipt, operations),
    )
    await stop(cleanupFault.session)
    const controls = await faultSessionFor('authenticated-controls')
    const controlsReady = await observe(controls.session)
    pass('real loopback authentication and stale worker event refusal', await controls.fault.probeAuthentication())
    if (controlsReady.controller === undefined) {
      Errors.throwHostEnvironment('The controlled authentication loop did not publish its controller identity.')
    }
    let staleSignalRefused = false
    try {
      const mismatch = { ...controlsReady.controller, startedAt: 'intentional-owned-stale-start-identity' }
      operations.signalOwned(mismatch, [mismatch], 'SIGTERM')
    } catch {
      staleSignalRefused = true
    }
    if (!staleSignalRefused || liveProcesses([controlsReady.controller]).length !== 1) {
      Errors.throwHostEnvironment('Controlled stale process identity injection did not preserve the live owned peer.')
    }
    pass('controlled stale kernel identity refused without signaling live owned peer', {
      injectedMismatch: true,
      literalPidRecyclingObserved: false,
    })
    await Promise.all([
      command(['reload', '--session', controls.session.session, '--json']),
      command(['reload', '--session', controls.session.session, '--json']),
    ])
    const actions = (await readFaultEvents(controls.fault.eventRoot)).filter(event => event.action === 'reload').map(
      event => event.event,
    )
    if (JSON.stringify(actions) !== JSON.stringify(['action-start', 'action-end', 'action-start', 'action-end'])) {
      Errors.throwHostEnvironment('Two real reloads did not serialize through the controller mutation queue.')
    }
    const beforeRace = await observe(controls.session)
    const recordedBeforeRace = (await readFaultEvents(controls.fault.eventRoot)).length
    const [restartResult, reloadResult] = await Promise.all([
      command(['restart', '--session', controls.session.session, '--json']),
      command(['reload', '--session', controls.session.session, '--json'], true),
    ])
    const successor = await observe(controls.session)
    const race = validateManagedLoopRestartReloadRace({
      before: beforeRace,
      after: successor,
      restart: restartResult,
      reload: reloadResult,
      events: (await readFaultEvents(controls.fault.eventRoot)).slice(recordedBeforeRace),
    })
    const freshReload = JSON.parse(
      (await command(['reload', '--session', controls.session.session, '--json'])).stdout.trim(),
    ) as DevLoopReceipt
    if (
      freshReload.generation !== successor.generation || freshReload.session !== successor.session
      || !ProcessTree.sameProcess(freshReload.controller, successor.controller!)
    ) {
      Errors.throwHostEnvironment('Fresh reload did not preserve the ready successor generation/controller.')
    }
    await assertCurrent(successor)
    pass('concurrent restart fences stale reload and fresh successor reload succeeds', race)
    await stop(controls.session)
    const preempted = await faultSessionFor('pause-restart')
    await observe(preempted.session)
    const restarting = command(['restart', '--session', preempted.session.session, '--json'], true)
    await waitFaultEvents(
      preempted.fault.eventRoot,
      events => events.filter(event => event.event === 'phase' && event.phase === 'compile').length === 2,
    )
    await command(['stop', '--session', preempted.session.session, '--json'])
    await restarting
    await stop(preempted.session)
    pass('stop preempts restart at the real successor compile gate')
    for (const stage of ['boot', 'install', 'openurl'] as const) {
      let safeToContinue = false
      try {
        const beforeScope = await operations.inventory()
        const { session: nativeSession, fault } = await faultSessionFor(`ios-owned-stop-${stage}`)
        let observation: ManagedIosNativeStopObservation | undefined
        let inconclusive: string | undefined
        const failures: { boundary: string; error: string }[] = []
        const recordFailure = (boundary: string, error: unknown): void => {
          failures.push({ boundary, error: Errors.formatForUser(error) })
        }
        try {
          const reached = await Time.pollUntil(async () => {
            const events = await readFaultEvents(
              fault.eventRoot,
              stage === 'openurl' ? 'worker' : 'controller',
            ) as (ManagedIosNativeStopObservation & { event?: string })[]
            observation = events.find(event => event.event === 'ios-native-executing' && event.stage === stage)
            remember(nativeSession, await operations.receipt(nativeSession.session))
            if (observation) {
              return true
            }
            return ['ready', 'failed', 'cleanup-failed', 'stopped'].includes(nativeSession.receipt.state)
              ? true
              : undefined
          }, { intervalMs: 25, timeoutMs: 180_000 })
          if (!reached || !observation) {
            inconclusive = 'Native command completed or failed before simctl execution could be observed.'
          } else {
            const device = nativeSession.receipt.devices?.find(device => device.platform === 'ios')
            const native = operations.identities([observation.native.pid]).get(observation.native.pid)
            const inventory = await operations.inventory()
            if (
              observation.session !== nativeSession.session
              || observation.invocation !== FS.basename(root) || observation.scope !== FS.basename(fault.eventRoot)
              || observation.loopGeneration !== nativeSession.receipt.generation
              || device?.id !== observation.id || !device.owned || native?.pid !== observation.native.pid
              || native.command !== 'simctl' || !ProcessTree.sameProcess(native, observation.native)
              || observation.owners.length === 0 || !observation.owners.every(owner =>
                inventory.resources.some(current =>
                  current.name === owner.name && current.generation === owner.id && current.pid === owner.pid
                )
              )
            ) {
              inconclusive = 'Native execution or its target/resource snapshots changed before public stop.'
            }
          }
        } catch (error) {
          recordFailure('native observation', error)
        } finally {
          // Observation failure never suppresses the authorized public stop and independent physical cleanup.
          try {
            await stop(nativeSession)
          } catch (error) {
            recordFailure('public stop', error)
          }
          try {
            await fault.collect()
          } catch (error) {
            recordFailure('independent physical cleanup', error)
          }
          try {
            remember(nativeSession, await operations.receipt(nativeSession.session))
          } catch (error) {
            recordFailure('final receipt', error)
          }
        }
        const entries = await readFaultEvents(
          fault.eventRoot,
          'controller',
        ).catch(error => {
          recordFailure('stop-entry journal', error)
          return []
        }) as (ManagedLoopActionEvidence & {
          proved?: boolean
          stage?: string
          observation?: ManagedIosNativeStopObservation
          reason?: string
        })[]
        const entry = entries.find(event => event.event === 'ios-native-stop-entry' && event.stage === stage)
        const entryObservation = entry?.observation
        if (
          inconclusive || !observation || !entry?.proved || entry.session !== nativeSession.session
          || entry.generation !== observation.loopGeneration
          || !entryObservation || entryObservation.actionGeneration !== observation.actionGeneration
          || entryObservation.native.pid !== observation.native.pid
          || !ProcessTree.sameProcess(entryObservation.native, observation.native)
        ) {
          failures.push({
            boundary: 'stop-entry observation',
            error: inconclusive ?? entry?.reason ?? 'no matching live stop-entry observation',
          })
        }
        const detail = {
          stage,
          observation,
          stopEntry: entry,
          cleanup: nativeSession.receipt,
          resourceProof: 'pre-stop snapshots and generation-fenced physical cleanup; not atomic at stop entry',
          effectProof: 'simctl execution does not prove its target effect started; cleanup is checked independently',
        }
        try {
          const receipt = nativeSession.receipt
          if (
            receipt.provenance !== 'complete'
            || receipt.mobileDriverCleanup !== undefined && receipt.mobileDriverCleanup !== 'proved'
          ) {
            Errors.throwHostEnvironment('Original command or driver provenance remains uncertain.')
          }
          let asset: ManagedIosAsset | undefined
          let captured = [...receipt.children, ...observation?.processes ?? []]
          if (receipt.cleanupOutcome !== 'proved') {
            asset = await FS.readJson<ManagedIosAsset>(
              FS.resolvePath(`ios-${FS.basename(fault.eventRoot)}/asset.json`, fault.eventRoot),
            )
            const action = asset.actions.find(action =>
              action.generation === observation?.actionGeneration && action.stage === stage
            )
            if (
              asset.version !== 2 || asset.invocation !== FS.basename(root)
              || asset.scope !== FS.basename(fault.eventRoot)
              || asset.id !== observation?.id || !observation || !action?.barrier?.drainProved
              || !action.barrier.nativeClose
              || action.barrier.worker.pid !== observation.worker.pid
              || !ProcessTree.sameProcess(action.barrier.worker, observation.worker)
            ) {
              Errors.throwHostEnvironment('Physical target retention lacks exact original native command drain proof.')
            }
            captured = [...captured, ...action.barrier.processes, action.barrier.supervisor, action.barrier.worker]
          }
          const current = operations.identities(captured.map(process => process.pid))
          if (
            captured.some(process => current.get(process.pid) !== undefined || operations.processIsAlive(process.pid))
          ) {
            Errors.throwHostEnvironment('An original captured command kernel remains alive or unreadable.')
          }
          const afterScope = await operations.inventory()
          const changed = ManagedLoopAcceptanceEvidence.preserved(beforeScope, afterScope)
          const owners = [
            ...observation?.owners ?? [],
            ...receipt.devices?.flatMap(device => device.resources ?? []) ?? [],
            ...asset?.creation ? [asset.creation] : [],
          ]
          if (
            receipt.cleanupOutcome !== 'proved'
            && owners.some(owner =>
              !afterScope.resources.some(resource =>
                resource.name === owner.name && resource.generation === owner.id && resource.pid === owner.pid
              )
            )
          ) {
            changed.push('Retained scope resource generations are absent or changed.')
          }
          for (const resource of afterScope.resources) {
            if (
              !beforeScope.resources.some(previous =>
                previous.name === resource.name && previous.generation === resource.generation
                && previous.pid === resource.pid
              )
              && !owners.some(owner =>
                owner.name === resource.name && owner.id === resource.generation && owner.pid === resource.pid
              )
            ) {
              changed.push(`Unrelated resource ${resource.name} appeared.`)
            }
          }
          for (const peer of afterScope.peers) {
            if (
              !beforeScope.peers.some(previous => previous.pid === peer.pid && ProcessTree.sameProcess(previous, peer))
              && !nativeSession.processes.some(process =>
                process.pid === peer.pid && ProcessTree.sameProcess(process, peer)
              )
            ) {
              changed.push(`Unrelated peer ${peer.pid} appeared.`)
            }
          }
          for (const target of afterScope.targets ?? []) {
            if (
              !beforeScope.targets?.some(previous => previous.platform === target.platform && previous.id === target.id)
              && !receipt.devices?.some(device => device.platform === target.platform && device.id === target.id)
            ) {
              changed.push(`Unrelated target ${target.platform}:${target.id} appeared.`)
            }
          }
          if (afterScope.targetInspection?.ios !== 'complete' || changed.length > 0) {
            Errors.throwHostEnvironment(
              `Independent native scope continuation is unsafe: ${
                changed.join(' ') || 'target inspection unavailable'
              }`,
            )
          }
          safeToContinue = true
        } catch (error) {
          recordFailure('next native scope admission', error)
        }
        if (failures.length > 0) {
          rows.push({
            name: `native iOS ${stage} stop outcome`,
            disposition: 'real-host failure',
            detail: { ...detail, failures },
          })
        } else {
          pass('public stop during exact native iOS execution and independent cleanup', detail)
        }
      } catch (error) {
        rows.push({
          name: `native iOS ${stage} stop outcome`,
          disposition: 'real-host failure',
          detail: { stage, boundary: 'independent scenario', error: Errors.formatForUser(error) },
        })
      }
      if (!safeToContinue) {
        return
      }
    }
    await abruptExit([])
  }

  async function combined(failWeb: boolean): Promise<void> {
    const sentinel = await operations.borrowTarget('ios', root, async id => {
      const { session, fault } = await faultSessionFor(
        failWeb ? 'combined-web-failure' : 'combined-owned-normal',
        undefined,
        id,
      )
      try {
        if (failWeb) {
          const terminal = await Time.pollUntil(async () => {
            await command(['status', '--session', session.session, '--json'])
            const receipt = await operations.receipt(session.session)
            remember(session, receipt)
            if (receipt.state === 'ready') {
              Errors.throwHostEnvironment(
                'The combined refused Chrome target incorrectly published all-target readiness.',
              )
            }
            return ['failed', 'cleanup-failed', 'stopped'].includes(receipt.state) ? receipt : undefined
          }, { intervalMs: 100, timeoutMs: 180_000 })
          if (terminal === undefined || !terminal.message?.includes('web')) {
            Errors.throwHostEnvironment('Combined Chrome refusal did not publish the expected failed target.')
          }
          const events = await readFaultEvents(fault.eventRoot) as {
            event?: string
            targets?: { target: string; dispatched: boolean }[]
          }[]
          const dispatch = events.find(event => event.event === 'combined-dispatch')?.targets
          if (
            !events.some(event => event.event === 'combined-web-refused')
            || dispatch?.length !== 3 || !dispatch.some(target => target.target === 'web' && !target.dispatched)
            || !['ios', 'android'].every(target =>
              dispatch.some(result => result.target === target && result.dispatched)
            )
          ) {
            Errors.throwHostEnvironment(
              'Combined failure lacks actual independent mobile dispatch and a single intentional Chrome refusal.',
            )
          }
          pass('combined partial target dispatch before independent rollback', dispatch)
        } else {
          await observe(session)
          await interaction(session, 'combined-initial')
          pass('combined web iOS Android readiness and sequential interaction')
        }
        const receipt = await operations.receipt(session.session)
        const ios = receipt.devices?.find(device => device.platform === 'ios')
        const android = receipt.devices?.find(device => device.platform === 'android')
        if (
          ios?.id !== id || ios.owned || android?.owned !== true
          || !android.avdName?.startsWith(`Tao_Managed_Acceptance_${FS.basename(root).replaceAll('-', '')}_`)
        ) {
          Errors.throwHostEnvironment(
            'Combined targets lost their exact borrowed iOS and private owned Android identity.',
          )
        }
      } finally {
        // The sentinel must stay alive until its managed borrowed lease and owned Android have closed.
        await stop(session)
      }
    })
    await ManagedLoopAcceptanceEvidence.write(root, 'combined-borrowed-ios', sentinel)
    if (
      !sentinel.preserved || sentinel.cleanup !== 'complete'
      || sentinel.disposition !== (operations.evidenceKind ?? 'real-host pass')
    ) {
      Errors.throwHostEnvironment('Combined rollback did not preserve its owned borrowed iOS sentinel until teardown.')
    }
    pass('combined independent cleanup and borrowed iOS preservation', sentinel)
  }

  async function faultSessionFor(
    scenario: ManagedLoopFaultScenario,
    suppliedFixture?: ManagedLoopFixture,
    borrowedIos?: string,
  ): Promise<{ session: OwnedSession; fault: Awaited<ReturnType<typeof startManagedLoopFault>> }> {
    const fixture = suppliedFixture ?? await fixtures.create()
    unresolvedFixtures.add(fixture)
    const fault = await operations.startFault({ artifactRoot: root, fixture, scenario, borrowedIos })
    // A returned minted handle is rollback-owned before any subsequent await can fail.
    const pending = { fixture, fault }
    pendingHelpers.add(pending)
    const receipt = await operations.receipt(fault.session)
    if (
      fault.launcher === undefined || receipt.session !== fault.session
      || receipt.checkout !== await FS.realPath(Repo.getRoot())
      || receipt.selection?.projectRoot !== fixture.root || receipt.selection.appPath !== fixture.appPath
      || receipt.selection.appName !== 'DataMVPApp'
      || (receipt.controller === undefined
        ? receipt.generation !== fault.initialGeneration
        : !ProcessTree.sameProcess(receipt.controller, fault.launcher))
    ) {
      Errors.throwHostEnvironment('The fixed fault helper did not publish its invocation-owned fixture identity.')
    }
    const session: OwnedSession = { session: fault.session, fixture, receipt, processes: [], collect: fault.collect }
    owned.push(session)
    pendingHelpers.delete(pending)
    unresolvedFixtures.delete(fixture)
    remember(session, receipt)
    return { session, fault }
  }

  async function readFaultEvents(
    eventRoot: string,
    role: 'worker' | 'controller' = 'worker',
  ): Promise<(ManagedLoopActionEvidence & { phase?: string })[]> {
    const path = FS.resolvePath(`${role}-events.json`, eventRoot)
    return await FS.isFile(path) ? await FS.readJson(path) : []
  }

  async function waitFaultEvents(
    eventRoot: string,
    condition: (events: Awaited<ReturnType<typeof readFaultEvents>>) => boolean,
    role: 'worker' | 'controller' = 'worker',
  ): Promise<void> {
    const reached = await Time.pollUntil(
      async () => condition(await readFaultEvents(eventRoot, role)) ? true : undefined,
      { intervalMs: 100, timeoutMs: 180_000 },
    )
    if (reached !== true) {
      Errors.throwHostEnvironment(
        'The fixed owned fault worker did not reach its expected phase within the finite observation budget.',
      )
    }
  }

  async function abruptExit(targets: readonly string[]): Promise<void> {
    const android = targets.includes('android')
    const fault = android ? await faultSessionFor('android-owned-normal') : undefined
    const session = fault?.session ?? await start(await fixtures.create(), targets)
    const ready = await observe(session)
    if (ready.controller === undefined || ready.provenance !== 'complete') {
      Errors.throwHostEnvironment(
        'Controller death injection requires durable complete invocation-owned identity publication.',
      )
    }
    // The proof owns the selected project and has captured this exact live controller from its
    // launcher receipt. Inject death into that identity only; never use a caller-supplied session.
    if (fault !== undefined) {
      await admitManagedAndroidAbruptDeath({
        invocation: FS.basename(root),
        scope: FS.basename(fault.fault.eventRoot),
        session: session.session,
        eventRoot: fault.fault.eventRoot,
        signal: controller => operations.signalOwned(controller, session.processes, 'SIGKILL'),
      }, { receipt: operations.receipt })
    } else {
      operations.signalOwned(ready.controller, session.processes, 'SIGKILL')
    }
    const gone = await Time.pollUntil(() => liveProcesses([ready.controller!]).length === 0 ? true : undefined, {
      intervalMs: 100,
      timeoutMs: 30_000,
    })
    if (gone !== true) {
      Errors.throwHostEnvironment('Proof-owned controller did not exit after the controlled death injection.')
    }
    const status = await command(['status', '--session', session.session, '--json'])
    const interrupted = JSON.parse(status.stdout.trim()) as DevLoopReceipt
    if (
      interrupted.session !== session.session || interrupted.generation !== ready.generation
      || interrupted.state !== 'interrupted'
    ) {
      Errors.throwHostEnvironment('Public status did not classify the killed owned controller as interrupted.')
    }
    await stop(session)
    pass('durable controlled controller death and public recovery', {
      session: session.session,
      controller: ready.controller,
      injected: android
        ? 'SIGKILL after fresh durable checkpoint and immediate live comparison'
        : 'SIGKILL after ready identity publication',
      ...(android ? { proofBoundary: 'sampled ancestry and recovery; post-sample forks remain a host boundary' } : {}),
    })
  }

  async function foreground(): Promise<void> {
    const fixture = await fixtures.create()
    unresolvedFixtures.add(fixture)
    const capture = { stdout: '', stderr: '' }
    const child = operations.start(Repo.resolvePath('dev'), {
      args: ['app-dev', fixture.root, '--app', 'DataMVPApp'],
      cwd: Repo.getRoot(),
      processPolicy: 'server',
      stdio: 'pipe',
      onOutput: (stream, chunk) => {
        capture[stream] += chunk.toString('utf8')
      },
    })
    const processes: TrackedProcess[] = []
    let childIdentity: TrackedProcess | undefined
    let uncertain = false
    let proved = false
    const captureProcesses = (): void => {
      if (uncertain) {
        return
      }
      let capture: ReturnType<typeof captureManagedForegroundProcesses>
      try {
        capture = captureManagedForegroundProcesses(child, childIdentity, operations.identities)
      } catch (error) {
        uncertain = true
        throw error
      }
      childIdentity ??= capture.root
      uncertain ||= capture.uncertain
      for (const process of capture.processes) {
        if (!processes.some(known => known.pid === process.pid && known.startedAt === process.startedAt)) {
          processes.push(process)
        }
      }
    }
    // Bind the root immediately, before any asynchronous readiness observation.
    try {
      captureProcesses()
      const ready = await Time.pollUntil(() => {
        captureProcesses()
        if (child.error !== undefined || child.exitCode !== null || child.signalCode !== null) {
          Errors.throwHostEnvironment('The owned foreground dev path exited before readiness.')
        }
        return /(?:http:\/\/[^\s]+|Metro waiting|Development server|ready)/iu.test(capture.stdout) ? true : undefined
      }, { intervalMs: 500, timeoutMs: 360_000 })
      if (ready !== true || child.pid === undefined) {
        Errors.throwHostEnvironment('The owned foreground dev path did not publish readiness within the finite budget.')
      }
      child.writeStdin('q')
      // Piped stdin is intentionally non-interactive. Normal signal cancellation remains controllable.
      const identity = processes.find(process => process.pid === child.pid)
      if (identity === undefined) {
        Errors.throwHostEnvironment('The foreground child did not publish a kernel identity.')
      }
      operations.signalOwned(identity, processes, 'SIGINT')
      const closed = await Time.pollUntil(
        () => child.exitCode !== null || child.signalCode !== null ? true : undefined,
        { intervalMs: 100, timeoutMs: 60_000 },
      )
      if (closed !== true || uncertain || liveProcesses(processes).length > 0) {
        Errors.throwHostEnvironment('Foreground cancellation did not close every captured owned service.')
      }
      proved = true
      unresolvedFixtures.delete(fixture)
      pass('finite foreground startup and controlled cancellation', {
        exitCode: child.exitCode,
        signal: child.signalCode,
      })
    } finally {
      try {
        captureProcesses()
      } catch {
        uncertain = true
      }
      if (!proved && processes.length > 0) {
        // Independent owned rollback; this is failure cleanup, never a claimed graceful host pass.
        ProcessTree.signalTracked(processes.toReversed(), 'SIGTERM')
        await Time.pollUntil(() => liveProcesses(processes).length === 0 ? true : undefined, {
          intervalMs: 100,
          timeoutMs: 30_000,
        })
      }
      await child.closeOutput()
      child.dispose()
      await ManagedLoopAcceptanceEvidence.write(root, 'foreground', {
        argv: ['./dev', 'app-dev', fixture.root, '--app', 'DataMVPApp'],
        ...capture,
        processes: processes.map(process => ({ ...process, command: 'owned foreground service' })),
        proved,
        uncertain,
      })
      if (!proved && !uncertain && liveProcesses(processes).length === 0) {
        unresolvedFixtures.delete(fixture)
      }
    }
  }
}
