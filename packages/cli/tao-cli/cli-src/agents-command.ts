import { CLI, Errors, FS, Platform, Time } from '@shared'

type AgentMetadata = { protocolVersion: 1; appId: string; appName: string; buildId: string }
type AgentSession = AgentMetadata & {
  instanceId: string
  pid: number
  launcherPid: number
  url: string
  capability: string
}
type AgentResult = { ok: true; result: unknown } | {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

const startupTimeoutMs = 30_000
const requestTimeoutMs = { ping: 2_000, shutdown: 7_000, commands: 30_000, run: 30_000 } as const

/** runAppAgentCommand controls the background service packaged in one local desktop app. */
export async function runAppAgentCommand(
  action: 'start' | 'ping' | 'stop' | 'commands' | 'run',
  bundlePath: string,
  invocation?: { commandId: string; args: unknown },
): Promise<AgentResult> {
  try {
    const bundle = FS.resolvePath(bundlePath)
    const metadataPath = FS.resolvePath('Contents/Resources/app/tao-agent.json', bundle)
    if (!await FS.exists(metadataPath)) {
      return failure(
        'invalid_app',
        'The app has no background service metadata. Build it with --agents and pass its .app path.',
      )
    }
    const metadata: unknown = await FS.readJson(metadataPath)
    if (
      !isRecord(metadata) || metadata['protocolVersion'] !== 1 || !nonempty(metadata['appId'])
      || !nonempty(metadata['appName']) || !nonempty(metadata['buildId'])
    ) {
      return failure('invalid_app', 'The app has no supported background service metadata. Rebuild with --agents.')
    }
    const app = metadata as AgentMetadata
    const stateRootOverride = Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT']
    const stateRoot = stateRootOverride
      ?? FS.resolvePath('Library/Caches/Tao/agents', FS.homeDir())
    const directory = FS.resolvePath(Platform.sha256Hex(app.appId).slice(0, 24), stateRoot)
    const sessionPath = FS.resolvePath('session.json', directory)
    const session = await readSession(sessionPath)
    if (session && Platform.processIsAlive(session.pid)) {
      const mismatch = sessionMismatch(session, app)
      if (mismatch) {
        return mismatch
      }
      const verified = await ping(session, app)
      if (!verified.ok) {
        return verified
      }
      if (action === 'start' || action === 'ping') {
        return verified
      }
      if (action === 'commands') {
        return await request(session, 'commands')
      }
      if (action === 'run') {
        if (!invocation || !nonempty(invocation.commandId)) {
          return failure('invalid_params', 'Run requires a canonical command id and JSON arguments.')
        }
        return await request(session, 'run', invocation)
      }
      const result = await request(session, 'shutdown')
      if (!result.ok) {
        return result
      }
      const stopped = await Time.pollUntil(async () => {
        const current = await readSession(sessionPath)
        return current?.instanceId !== session.instanceId && !Platform.processIsAlive(session.pid)
          && !Platform.processIsAlive(session.launcherPid)
      }, { intervalMs: 50, timeoutMs: startupTimeoutMs })
      return stopped ? result : failure('stop_timeout', 'The app did not finish shutting down within 30 seconds.')
    }
    if (action !== 'start') {
      return failure('not_running', 'The app background service is not running.')
    }

    const executableResult = await CLI.run('/usr/bin/plutil', {
      args: ['-extract', 'CFBundleExecutable', 'raw', FS.resolvePath('Contents/Info.plist', bundle)],
      stdio: 'pipe',
    })
    const executableName = executableResult.stdout.trim()
    if (executableResult.exitCode !== 0 || !executableName || FS.basename(executableName) !== executableName) {
      return failure('invalid_app', 'The app bundle does not declare a valid executable.')
    }
    await FS.mkdir(directory)
    await FS.chmod(directory, 0o700)
    const logPath = FS.resolvePath('service.log', directory)
    const log = await FS.openAppend(logPath)
    await log.chmod(0o600)
    let child: CLI.StartedCommand
    try {
      child = CLI.start(FS.resolvePath(`Contents/MacOS/${executableName}`, bundle), {
        cwd: bundle,
        env: { TAO_AGENT_MODE: '1', ...(stateRootOverride ? { TAO_AGENT_STATE_ROOT: stateRootOverride } : {}) },
        detached: true,
        unref: true,
        processPolicy: 'server',
        stdio: ['ignore', log.fd, log.fd],
      })
    } finally {
      await log.close()
    }
    const deadline = Date.now() + startupTimeoutMs
    try {
      while (Date.now() < deadline) {
        const ready = await readSession(sessionPath)
        if (ready && Platform.processIsAlive(ready.pid)) {
          const mismatch = sessionMismatch(ready, app)
          if (mismatch) {
            return mismatch
          }
          const result = await ping(ready, app)
          if (result.ok) {
            return result
          }
        }
        if (child.error || (child.exitCode !== null && child.exitCode !== 0) || child.signalCode !== null) {
          // A concurrent launcher can lose the service lock after the winner publishes its session.
          const winner = await readSession(sessionPath)
          if (winner && Platform.processIsAlive(winner.pid)) {
            const mismatch = sessionMismatch(winner, app)
            if (mismatch) {
              return mismatch
            }
            const result = await ping(winner, app)
            if (result.ok) {
              return result
            }
          }
          return failure('startup_failed', `The app exited before becoming ready. See ${logPath}.`)
        }
        // A losing concurrent launcher can exit successfully before the winning service publishes its session.
        await Time.sleep(50)
      }
      return failure(
        'startup_timeout',
        `The app did not become ready within 30 seconds and may still be starting. Inspect ${logPath} or use agents ping to check its status.`,
      )
    } finally {
      child.dispose()
    }
  } catch (error) {
    return failure('agent_unavailable', Errors.formatForUser(error))
  }
}

async function readSession(path: string): Promise<AgentSession | undefined> {
  if (!await FS.exists(path)) {
    return undefined
  }
  const value: unknown = await FS.readJson(path)
  if (
    !isRecord(value) || value['protocolVersion'] !== 1 || !nonempty(value['appId']) || !nonempty(value['buildId'])
    || !nonempty(value['instanceId']) || !nonempty(value['capability']) || typeof value['url'] !== 'string'
    || !Number.isSafeInteger(value['pid']) || Number(value['pid']) <= 0
    || !Number.isSafeInteger(value['launcherPid']) || Number(value['launcherPid']) <= 0
  ) {
    Errors.throwUserInput(
      'The app service session is invalid. Remove it only after confirming its service has stopped.',
    )
  }
  const url = new URL(value['url'])
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
    Errors.throwUserInput('The app service session does not name a local HTTP endpoint.')
  }
  return value as AgentSession
}

function sessionMismatch(session: AgentSession, app: AgentMetadata): AgentResult | undefined {
  return session.appId !== app.appId || session.buildId !== app.buildId
    ? failure('build_mismatch', 'A different build is running for this app. Stop it using its original bundle first.')
    : undefined
}

async function ping(session: AgentSession, app: AgentMetadata): Promise<AgentResult> {
  const result = await request(session, 'ping')
  if (!result.ok) {
    return result
  }
  const value = result.result
  if (
    !isRecord(value) || value['message'] !== 'pong' || value['appId'] !== app.appId || value['buildId'] !== app.buildId
    || value['instanceId'] !== session.instanceId || value['pid'] !== session.pid
    || value['launcherPid'] !== session.launcherPid
    || !['absent', 'starting', 'ready', 'failed'].includes(String(value['renderer']))
  ) {
    return failure('identity_mismatch', 'The service response does not match this app session.')
  }
  return result
}

async function request(
  session: AgentSession,
  method: 'ping' | 'shutdown' | 'commands' | 'run',
  params?: { commandId: string; args: unknown },
): Promise<AgentResult> {
  const id = Platform.randomUUID()
  try {
    const response = await fetch(session.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.capability}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, id, method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(requestTimeoutMs[method]) as unknown as RequestInit['signal'],
      redirect: 'error',
    })
    const value: unknown = await response.json()
    if (!isRecord(value) || value['version'] !== 1 || value['id'] !== id) {
      return method === 'run'
        ? unknownRunOutcome()
        : failure('invalid_response', 'The app returned an invalid response or request identity.')
    }
    const error = value['error']
    if (value['ok'] === false && isRecord(error) && nonempty(error['code']) && nonempty(error['message'])) {
      return {
        ok: false,
        error: {
          code: error['code'],
          message: error['message'],
          ...(Object.hasOwn(error, 'details') ? { details: error['details'] } : {}),
        },
      }
    }
    return response.ok && value['ok'] === true && Object.hasOwn(value, 'result')
      ? { ok: true, result: value['result'] }
      : method === 'run'
      ? unknownRunOutcome()
      : failure('invalid_response', 'The app returned an invalid response.')
  } catch (error) {
    if (method === 'run') {
      return unknownRunOutcome()
    }
    return failure('transport_error', `Could not reach the app background service: ${Errors.formatForUser(error)}`)
  }
}

function unknownRunOutcome(): AgentResult {
  return failure(
    'outcome_unknown',
    'The command response was lost or timed out. Its outcome is unknown; it may have run. It was not retried.',
  )
}

function failure(code: string, message: string): AgentResult {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
