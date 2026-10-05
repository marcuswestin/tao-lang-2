import { CLI, Errors, FS, Platform, ProcessTree, Time, type TrackedProcess } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { CompanionIdentity } from '../prebuilt-host/CompanionIdentity'

/** Only the simulator launch effects owned by this package can cross this boundary. */
export type FixedIosLaunchIntent =
  | { stage: 'boot'; udid: string }
  | { stage: 'openurl'; udid: string; url: string; metroPort: number }
  | { stage: 'install'; udid: string; appPath: string; artifactRoot: string }

export type FixedIosLaunchCapture = {
  stage: FixedIosLaunchIntent['stage']
  /** Released means the execution acknowledgement was written, not that native exec was observed. */
  phase: 'held' | 'released'
  command: CLI.StartedCommand
  root: TrackedProcess
  observedRoot?: TrackedProcess
  processes: readonly TrackedProcess[]
}

/** Internal test/acceptance observation has no command, PID, or endpoint selection authority. */
export type FixedIosLaunchOperations = {
  onCommand?: (capture: FixedIosLaunchCapture) => Promise<void>
  start?: typeof CLI.start
  tree?: Pick<typeof ProcessTree, 'identities' | 'descendants' | 'sameProcess' | 'processGroupOf'>
  processIsAlive?: typeof Platform.processIsAlive
}

const commandBudgetMs = 120_000
const drainBudgetMs = 10_000
const heldLaunch = 'IFS= read -r action; [ "$action" = run ] || exit 125; exec /usr/bin/xcrun "$@"'
const udidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function inspectionDiagnostic(error: unknown): Errors.ErrorDetails | undefined {
  let current = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current instanceof Errors.HostEnvironmentError) {
      const value = current.details?.['darwinInspection']
      if (typeof value === 'object' && value !== null) {
        const fields = value as Errors.ErrorDetails
        const result: Errors.ErrorDetails = {}
        for (
          const [key, allowed] of [
            ['inspection', ['descendants', 'identities', 'group']],
            ['backend', ['in-process-bun', 'bun-helper']],
            ['failureKind', [
              'identity-unreadable',
              'identity-pid-mismatch',
              'group-enumeration',
              'child-enumeration',
              'group-changed',
              'helper-exit',
              'helper-spawn',
              'backend-exception',
              'invalid-response',
            ]],
            ['routine', ['proc_pidinfo', 'proc_listpids', 'proc_listchildpids']],
            ['probeStatus', ['live', 'uncertain']],
          ] as const
        ) {
          if (typeof fields[key] === 'string' && allowed.some(entry => entry === fields[key])) {
            result[key] = fields[key]
          }
        }
        const pids = fields['requestedPids']
        if (
          Array.isArray(pids) && pids.length <= 64
          && pids.every(pid => Number.isSafeInteger(pid) && pid > 0 && pid <= 2_147_483_647)
        ) {
          result['requestedPids'] = [...pids]
        }
        for (
          const key of [
            'requestedPidCount',
            'pid',
            'returnedCount',
            'returnedBytes',
            'expectedBytes',
            'probeErrno',
            'helperStatus',
          ]
        ) {
          const entry = fields[key]
          if (typeof entry === 'number' && Number.isSafeInteger(entry) && Math.abs(entry) <= 2_147_483_647) {
            result[key] = entry
          }
        }
        for (const key of ['probeCode', 'helperSignal']) {
          const entry = fields[key]
          if (typeof entry === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/u.test(entry)) {
            result[key] = entry
          }
        }
        return result
      }
    }
    current = current.cause
  }
  return undefined
}

function runtimeUrl(value: string): URL {
  try {
    return new URL(value)
  } catch (error) {
    Errors.throwHostEnvironment('iOS launch requires a valid runtime URL.', { cause: error })
  }
}

function argumentsOf(intent: FixedIosLaunchIntent): string[] {
  if (!udidPattern.test(intent.udid)) {
    Errors.throwHostEnvironment('iOS launch requires an exact simulator UDID.')
  }
  if (
    Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_QUIET'] === '1'
    && intent.udid !== Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_UDID']
  ) {
    Errors.throwHostEnvironment('iOS launch does not match the simulator assigned to this loop.')
  }
  if (intent.stage === 'boot') {
    return ['simctl', 'boot', intent.udid]
  }
  if (intent.stage === 'install') {
    if (
      !FS.pathIsWithin(intent.appPath, intent.artifactRoot) || FS.extname(intent.appPath) !== '.app'
      || /[\r\n\0]/u.test(intent.appPath + intent.artifactRoot)
    ) {
      Errors.throwHostEnvironment('iOS launch requires the compatible host artifact inside its recorded directory.')
    }
    return ['simctl', 'install', intent.udid, intent.appPath]
  }
  const url = runtimeUrl(intent.url)
  const companion = url.protocol === `${CompanionIdentity.scheme}:`
  const metro = companion ? runtimeUrl(url.searchParams.get('url') ?? '') : url
  if (
    url.username || url.password || /[\r\n\0]/u.test(intent.url)
    || (companion
      ? url.hostname !== 'expo-development-client' || metro.protocol !== 'http:'
      : !['exp:', 'exps:'].includes(url.protocol))
    || metro.username || metro.password || !metro.hostname || Number(metro.port) !== intent.metroPort
  ) {
    Errors.throwHostEnvironment('iOS launch URL does not name this Metro session and its supported runtime.')
  }
  return ['simctl', 'openurl', intent.udid, intent.url]
}

/**
 * Hold the child before exec so even a fast native command has an original kernel capture. It
 * stays in its caller's group. This proves captured command closure, never simctld rollback.
 */
export async function runFixedIosLaunchCommand(
  intent: FixedIosLaunchIntent,
  shouldStop: () => boolean,
  operations: FixedIosLaunchOperations = {},
): Promise<CLI.CommandResult> {
  const args = argumentsOf(intent)
  if (shouldStop()) {
    throw Errors.abortError('iOS launch cancelled before starting.')
  }
  let stdout = ''
  let stderr = ''
  const command = (operations.start ?? CLI.start)('/bin/sh', {
    args: ['-c', heldLaunch, 'tao-ios-launch', ...args],
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    processPolicy: 'tool',
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        stdout = (stdout + chunk.toString('utf8')).slice(-32_768)
      } else {
        stderr = (stderr + chunk.toString('utf8')).slice(-32_768)
      }
    },
  })
  const tree = operations.tree ?? ProcessTree
  const isAlive = operations.processIsAlive ?? Platform.processIsAlive
  const recorded: TrackedProcess[] = []
  let root: TrackedProcess | undefined
  let close: CLI.CommandCloseResult | undefined
  let closeFailure: unknown
  let monitorFailure: unknown
  let interrupted = false
  let released = false
  let stopping = false
  let done = false
  let result: CLI.CommandResult | undefined
  let primaryFailure: unknown
  let cleanupUnproved = false
  let outputClosed = false
  const refusalDetails: Errors.ErrorDetails[] = []
  const secondaryFailures: Array<{ stage: string; error: unknown }> = []
  const attempt = async <T>(stage: string, operation: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      return await operation()
    } catch (error) {
      secondaryFailures.push({ stage, error })
      return undefined
    }
  }
  const startedAt = Date.now()
  try {
    void command.waitForClose().then(value => {
      close = value
    }, error => {
      closeFailure = error
    })
  } catch (error) {
    closeFailure = error
  }
  function retain(message: string, cause?: unknown): never {
    const diagnostic = inspectionDiagnostic(cause)
    const details: Errors.ErrorDetails = {
      retainsTargetLease: true,
      stage: intent.stage,
      released,
      processes: [...recorded],
      secondaryFailures: [...secondaryFailures],
      ...close ? { commandClose: { exitCode: close.exitCode, signal: close.signal } } : {},
      outputClosed,
      ...diagnostic ? { darwinInspection: diagnostic } : {},
    }
    refusalDetails.push(details)
    Errors.throwHostEnvironment(message, {
      cause,
      details,
    })
  }
  const captureDescendants = () => {
    if (!root) {
      return
    }
    const current = tree.identities([root.pid]).get(root.pid)
    if (!current || !tree.sameProcess(current, root)) {
      return
    }
    const descendants = tree.descendants(root.pid)
    const after = tree.identities([root.pid]).get(root.pid)
    if (!after || !tree.sameProcess(after, root)) {
      if (
        descendants.some(process =>
          !recorded.some(expected => expected.pid === process.pid && tree.sameProcess(process, expected))
        )
      ) {
        retain('iOS launch descendant capture crossed an uncertain command exit.')
      }
      return
    }
    for (const process of descendants) {
      const previous = recorded.find(expected => expected.pid === process.pid)
      if (previous && !tree.sameProcess(process, previous)) {
        retain('iOS launch descendant kernel changed.')
      }
      if (!previous) {
        recorded.push(process)
      }
    }
  }
  const stop = () => {
    if (stopping || close || closeFailure) {
      return
    }
    if (!root || !tree.sameProcess(tree.identities([root.pid]).get(root.pid), root)) {
      retain('iOS launch cancellation lacks its original command kernel.')
    }
    captureDescendants()
    stopping = true
    command.kill('SIGTERM')
  }
  // Start cancellation monitoring before either observer can wait on an acceptance barrier.
  const monitoring = (async () => {
    while (!done && close === undefined && closeFailure === undefined) {
      try {
        captureDescendants()
        if (shouldStop() || Date.now() - startedAt >= commandBudgetMs) {
          interrupted = true
          stop()
        }
      } catch (error) {
        monitorFailure = error
        await attempt('monitor stdin closure', () => command.endStdin())
        break
      }
      await Time.sleep(25)
    }
  })()
  const observe = async (phase: FixedIosLaunchCapture['phase']) => {
    if (!operations.onCommand || !root) {
      return
    }
    let settled = false
    let failure: unknown
    const observedRoot = tree.identities([root.pid]).get(root.pid)
    const observation = operations.onCommand({
      stage: intent.stage,
      phase,
      command,
      root,
      observedRoot: tree.sameProcess(observedRoot, root) ? observedRoot : undefined,
      processes: [...recorded],
    })
      .then(() => {
        settled = true
      }, error => {
        failure = error
        settled = true
        if (done) {
          DevLoopOutput.recordFailure('dev', `Late iOS launch observer failure: ${Errors.formatForUser(error)}`)
        }
      })
    await Time.pollUntil(() =>
      settled || interrupted || close !== undefined || closeFailure !== undefined
      || monitorFailure !== undefined, { intervalMs: 25, timeoutMs: commandBudgetMs })
    if (settled) {
      await observation
    }
    if (failure !== undefined) {
      throw failure
    }
  }
  try {
    root = command.pid === undefined ? undefined : tree.identities([command.pid]).get(command.pid)
    if (!root) {
      retain('iOS launch original held command kernel could not be captured.')
    }
    recorded.push(root)
    captureDescendants()
    const group = tree.processGroupOf(root.pid)
    if (group === undefined || group === root.pid || group !== tree.processGroupOf(Platform.runtimeProcess.pid)) {
      retain('iOS launch left its existing worker process group.')
    }
    await observe('held')
    if (!shouldStop() && !interrupted && !close && !closeFailure && !monitorFailure) {
      if (!tree.sameProcess(tree.identities([root.pid]).get(root.pid), root)) {
        retain('iOS held launch kernel changed.')
      }
      captureDescendants()
      if (!command.writeStdin('run\n')) {
        retain('iOS held launch refused its execution acknowledgement.')
      }
      released = true
      await observe('released')
    } else {
      interrupted = true
      stop()
    }
    const closed = await Time.pollUntil(
      () => close !== undefined || closeFailure !== undefined || monitorFailure !== undefined,
      { intervalMs: 25, timeoutMs: interrupted ? drainBudgetMs : commandBudgetMs + drainBudgetMs },
    )
    if (!closed || closeFailure || monitorFailure || !close) {
      retain('iOS launch command closure is unproved.', closeFailure ?? monitorFailure)
    }
    try {
      await command.closeOutput()
      outputClosed = true
    } catch (error) {
      retain('iOS launch output drain failed.', error)
    }
    const current = tree.identities(recorded.map(process => process.pid))
    if (recorded.some(process => current.has(process.pid) || isAlive(process.pid))) {
      retain('iOS launch captured command or descendant remains live after closure.')
    }
    if (shouldStop() || interrupted) {
      if (released) {
        retain('iOS launch cancelled after native admission; simulator effects remain uncertain.')
      }
      throw Errors.abortError('iOS launch cancelled before native admission after command drain.')
    }
    result = { command: '/usr/bin/xcrun', args, ...close, stdout, stderr, error: command.error }
  } catch (error) {
    primaryFailure = error
    await attempt('owned command stop', stop)
    // Closing stdin cannot select or signal a different process when kernel inspection failed.
    if (!stopping && close === undefined && closeFailure === undefined) {
      await attempt('cleanup stdin closure', () => command.endStdin())
    }
    const drained = await attempt(
      'command closure',
      () =>
        Time.pollUntil(() => close !== undefined || closeFailure !== undefined, {
          intervalMs: 25,
          timeoutMs: drainBudgetMs,
        }),
    )
    await attempt('output drain', async () => {
      await command.closeOutput()
      outputClosed = true
    })
    const kernelsGone = await attempt('captured kernel drain inspection', () => {
      if (!root) {
        return false
      }
      const current = tree.identities(recorded.map(process => process.pid))
      return recorded.every(process => !current.has(process.pid) && !isAlive(process.pid))
    })
    cleanupUnproved = !drained || closeFailure !== undefined || kernelsGone !== true
      || (!(error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true)
        && (released || Errors.asError(error).name !== 'AbortError'))
  }
  done = true
  await attempt('cancellation monitor closure', () => monitoring)
  await attempt('command handle disposal', () => command.dispose())
  // These are our own refusal objects: add eventual close/output facts without replacing the primary cause.
  for (const details of refusalDetails) {
    if (close) {
      details['commandClose'] = { exitCode: close.exitCode, signal: close.signal }
    }
    details['outputClosed'] = outputClosed
  }
  if (cleanupUnproved || secondaryFailures.length > 0) {
    retain('iOS launch cleanup remains uncertain.', primaryFailure)
  }
  if (primaryFailure !== undefined) {
    throw primaryFailure
  }
  if (result === undefined) {
    retain('iOS launch completion has no command result.')
  }
  return result
}
