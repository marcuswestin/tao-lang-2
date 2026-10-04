import { DEV_LOOP_HELP, type DevLoopRequest, parseDevLoopArgs } from '@agent-cli/agent-config/DevLoopArgs'
import { CLI, Errors, FS, HCI, Platform, Repo, Switch, Time } from '@shared'
import { devLoopRequest } from '@shared/DevLoopControl'
import { ProcessTree } from '@shared/ProcessTree'
import { UiVisibility } from '@verification/UiVisibility'
import { disposeDeadDevLoopConnection, recoverDevLoopProcesses } from './DevLoopRecovery'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from './DevLoopStore'

/** The public surface deliberately excludes the private controller entrypoint. */
type DevLoopCommandOperations = {
  launchController: typeof launchController
  status: typeof statusOf
  beforeRecovery?: () => Promise<void>
  recovery?: Parameters<typeof recoverDevLoopProcesses>[1]
}

export async function runDevLoopCommand(
  args: readonly string[],
  operations: DevLoopCommandOperations = { launchController, status: statusOf },
): Promise<number> {
  const json = args.includes('--json')
  let session: string | undefined
  try {
    const request = parseDevLoopArgs(args)
    if ('session' in request) {
      session = request.session
    }
    const value = await Switch.kind<DevLoopRequest, Promise<unknown>>(request, {
      help: async () => DEV_LOOP_HELP,
      start: async start =>
        startDevLoop(start.args, operations.launchController, value => {
          session = value
        }),
      status: async status => {
        if (status.session !== undefined) {
          return await statusOf(status.session)
        }
        const root = Repo.resolvePath('.artifacts/dev-loops')
        if (!await FS.isDirectory(root)) {
          return { sessions: [] }
        }
        const sessions = []
        for (const name of await FS.listDir(root)) {
          if (/^[0-9a-f-]{36}$/iu.test(name)) {
            sessions.push(await statusOf(name))
          }
        }
        return { sessions }
      },
      logs: async logs => {
        await readDevLoopReceipt(logs.session)
        const path = FS.resolvePath('loop.log', devLoopDirectory(logs.session))
        const read = async () => await FS.isFile(path) ? await FS.readText(path) : ''
        let text = await read()
        const lines = text.trimEnd().split('\n').slice(-logs.lines).join('\n')
        if (!logs.follow) {
          return { session: logs.session, lines }
        }
        HCI.writeLine(lines)
        let following = true
        const remove = Platform.onProcessSignal('SIGINT', () => {
          following = false
        })
        try {
          while (following) {
            await Time.sleep(250)
            const next = await read()
            if (next.length > text.length) {
              HCI.write(next.slice(text.length))
            }
            text = next
            const receipt = await statusOf(logs.session)
            if (receipt.state === 'stopped' || receipt.state === 'interrupted' || receipt.state === 'cleanup-failed') {
              break
            }
          }
        } finally {
          remove()
        }
        return undefined
      },
      stop: async stop => await control(stop.session, 'stop', operations),
      restart: async restart => await control(restart.session, 'restart', operations),
      reload: async reload => await control(reload.session, 'reload', operations),
    })
    if (value !== undefined) {
      HCI.writeLine(json ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    }
    return 0
  } catch (error) {
    const message = Errors.formatForUser(error)
    if (json) {
      const receipt = session === undefined ? undefined : await readDevLoopReceipt(session).catch(() => undefined)
      HCI.writeLine(
        JSON.stringify({
          ...receipt,
          ...(session === undefined ? {} : { session }),
          ok: false,
          error: message,
          failures: [...(receipt?.failures ?? []), message],
        }),
      )
    } else {
      HCI.writeErrorLine(message)
    }
    return 1
  }
}

async function startDevLoop(
  args: readonly string[],
  launch: typeof launchController,
  onSession: (session: string) => void,
): Promise<DevLoopReceipt> {
  const warnings = UiVisibility.warningsForCommand('app-dev', args)
  for (const warning of warnings) {
    HCI.writeErrorLine(`WARNING: ${warning}`)
  }
  // Selection is a pure child phase before any simulator, browser, or project lease side effect.
  const selected = await CLI.run(Repo.resolvePath('tao'), {
    args: ['dev', ...selectionArgs(args)],
    env: { TAO_DEV_LOOP_SELECTION_ONLY: '1', TAO_DEV_LOOP_WORKER_CREDENTIALS: '' },
  })
  if (selected.exitCode !== 0 || selected.error !== undefined) {
    Errors.throwUserInput(selected.stderr.trim() || selected.error?.message || 'Could not select a Tao app.')
  }
  const selection = JSON.parse(selected.stdout.trim()) as NonNullable<DevLoopReceipt['selection']>
  if (
    typeof selection.appName !== 'string' || typeof selection.appPath !== 'string'
    || typeof selection.projectRoot !== 'string'
  ) {
    Errors.throwHostEnvironment('App selection returned an invalid development configuration.')
  }
  const targetArgs: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--app') {
      index++
      continue
    }
    if (!arg.startsWith('--')) {
      continue
    }
    targetArgs.push(arg)
    if (arg === '--simulator' || arg === '--emulator') {
      targetArgs.push(args[++index]!)
    }
  }
  const session = Platform.randomUUID()
  onSession(session)
  const stamp = new Date().toISOString()
  const receipt: DevLoopReceipt = {
    version: 1,
    session,
    checkout: await FS.realPath(Repo.getRoot()),
    args: [selection.projectRoot, '--app', selection.appName, ...targetArgs],
    selection,
    generation: Platform.randomUUID(),
    state: 'starting',
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    warnings,
    failures: [],
    cleanupOutcome: 'pending',
    logPath: `.artifacts/dev-loops/${session}/loop.log`,
  }
  await writeDevLoopReceipt(receipt)
  return await launch(receipt)
}

function selectionArgs(args: readonly string[]): string[] {
  const forwarded: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--simulator' || arg === '--emulator') {
      index++
      continue
    }
    if (['--show-browser', '--show-simulator', '--show-emulator'].includes(arg)) {
      continue
    }
    forwarded.push(arg)
  }
  return forwarded
}

async function launchController(receipt: DevLoopReceipt): Promise<DevLoopReceipt> {
  const session = receipt.session
  const log = await FS.openAppend(FS.resolvePath('controller.log', devLoopDirectory(session)))
  try {
    const child = Platform.spawn(Platform.runtimeProcess.execPath, {
      args: [Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopWorker.ts')],
      cwd: Repo.getRoot(),
      detached: true,
      env: {
        TAO_DEV_LOOP_CONTROLLER_SESSION: session,
        TAO_DEV_LOOP_WORKER_CREDENTIALS: '',
        TAO_DEV_LOOP_SELECTION_ONLY: '',
      },
      stdio: ['ignore', log.fd, log.fd],
    })
    child.unref()
    return await acknowledgeDevLoopController(session, child)
  } finally {
    await log.close()
  }
}

/** Durable terminal receipts acknowledge workers that exit before the launcher can probe control. */
export async function acknowledgeDevLoopController(
  session: string,
  child: { exitCode: number | null },
  operations: { readConnection?: typeof readDevLoopConnection; probe?: typeof devLoopRequest } = {},
): Promise<DevLoopReceipt> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const current = await readDevLoopReceipt(session)
    if (
      current.controllerDisposed || current.state === 'failed' || current.state === 'cleanup-failed'
      || current.state === 'stopped'
    ) {
      return current
    }
    if (current.controller !== undefined) {
      try {
        await (operations.probe ?? devLoopRequest)(
          await (operations.readConnection ?? readDevLoopConnection)(session),
          '/status',
        )
        return current
      } catch (error) {
        const terminal = await readDevLoopReceipt(session)
        if (
          terminal.controllerDisposed || terminal.state === 'failed' || terminal.state === 'cleanup-failed'
          || terminal.state === 'stopped'
        ) {
          return terminal
        }
        throw error
      }
    }
    if (child.exitCode !== null || Date.now() >= deadline) {
      Errors.throwHostEnvironment(`Controller acknowledgement failed; inspect session ${session}.`)
    }
    await Time.sleep(50)
  }
}

async function statusOf(session: string): Promise<DevLoopReceipt> {
  const receipt = await readDevLoopReceipt(session)
  if (receipt.controller === undefined || receipt.controllerDisposed || receipt.state === 'stopped') {
    return receipt
  }
  const current = ProcessTree.identities([receipt.controller.pid]).get(receipt.controller.pid)
  if (!ProcessTree.sameProcess(current, receipt.controller)) {
    return {
      ...receipt,
      state: 'interrupted',
      message: 'The controller ended; owned resources and process records are preserved for explicit recovery.',
    }
  }
  return await devLoopRequest<DevLoopReceipt>(await readDevLoopConnection(session), '/status')
}

async function control(
  session: string,
  action: 'stop' | 'restart' | 'reload',
  operations: DevLoopCommandOperations,
): Promise<DevLoopReceipt> {
  return await controlSession(session, action, operations)
}

async function controlSession(
  session: string,
  action: 'stop' | 'restart' | 'reload',
  operations: DevLoopCommandOperations,
  recoveryLocked = false,
): Promise<DevLoopReceipt> {
  const recover = async () => {
    const directory = devLoopDirectory(session)
    await operations.beforeRecovery?.()
    return await FS.withFileMutationLock(
      FS.resolvePath('recovery.lock', directory),
      directory,
      // The controller or receipt may have changed while this command waited for recovery.
      () => controlSession(session, action, operations, true),
    )
  }
  const receipt = await operations.status(session)
  const recoverStopped = async () => {
    const recovered = await recoverDevLoopProcesses(receipt, operations.recovery)
    const saved = await readDevLoopReceipt(session)
    if (
      saved.generation !== receipt.generation
      || !ProcessTree.sameProcess(saved.controller, receipt.controller!)
    ) {
      Errors.throwHostEnvironment('The dev-loop owner changed during stop recovery; its current records are preserved.')
    }
    if (recovered.state !== 'stopped') {
      await writeDevLoopReceipt(recovered)
      Errors.throwHostEnvironment(recovered.message!)
    }
    // Target fences may already be released. Keep those proved facts retryable if private cleanup
    // fails, while the session remains unsuccessful until every cleanup proof has completed.
    await writeDevLoopReceipt({
      ...recovered,
      state: receipt.state === 'failed' ? 'failed' : 'cleanup-failed',
      cleanupOutcome: 'unknown',
      message: receipt.message ?? 'Private control cleanup remains unproved.',
    })
    const disposed = await disposeDeadDevLoopConnection(
      recovered,
      operations.recovery?.identities,
      operations.recovery?.processIsAlive,
    )
    await writeDevLoopReceipt(disposed)
    if (disposed.state !== 'stopped') {
      Errors.throwHostEnvironment(disposed.message!)
    }
    return disposed
  }
  if (receipt.state === 'stopped') {
    const current = receipt.controller === undefined
      ? undefined
      : ProcessTree.identities([receipt.controller.pid]).get(receipt.controller.pid)
    if (action === 'stop') {
      if (receipt.controllerDisposed || ProcessTree.sameProcess(current, receipt.controller!)) {
        return await confirmStopped(receipt)
      }
      if (!ProcessTree.sameProcess(current, receipt.controller!)) {
        if (!recoveryLocked) {
          return await recover()
        }
        return await recoverStopped()
      }
    }
    if (action !== 'stop' && !receipt.controllerDisposed && ProcessTree.sameProcess(current, receipt.controller!)) {
      Errors.throwUserInput('The dev-loop controller is disposing; retry after cleanup completes.')
    }
    if (action !== 'stop' && (receipt.controllerDisposed || !ProcessTree.sameProcess(current, receipt.controller!))) {
      if (!recoveryLocked) {
        return await recover()
      }
      if (
        action !== 'restart' || receipt.provenance !== 'complete'
        || (receipt.devices ?? []).some(device => device.owned && device.state !== 'released')
      ) {
        Errors.throwHostEnvironment('Restart requires verified process and device cleanup.')
      }
      const disposed = receipt.controllerDisposed ? receipt : await disposeDeadDevLoopConnection(receipt)
      await writeDevLoopReceipt(disposed)
      if (disposed.state !== 'stopped') {
        Errors.throwHostEnvironment(disposed.message!)
      }
      const restarting: DevLoopReceipt = {
        ...receipt,
        generation: Platform.randomUUID(),
        state: 'starting',
        controller: undefined,
        controllerDisposed: undefined,
        children: [],
        cleanupOutcome: 'pending',
        message: undefined,
      }
      await writeDevLoopReceipt(restarting)
      return await operations.launchController(restarting)
    }
  }
  if (receipt.controllerDisposed && action !== 'stop') {
    Errors.throwHostEnvironment(receipt.message ?? 'The dev-loop worker ended without proved cleanup.')
  }
  if (receipt.controllerDisposed || receipt.state === 'interrupted' || receipt.controller === undefined) {
    if (!recoveryLocked) {
      return await recover()
    }
    if (action === 'stop') {
      return await recoverStopped()
    }
    Errors.throwHostEnvironment(
      'The controller is unavailable; process and device cleanup must be verified before recovery.',
    )
  }
  const result = await devLoopRequest<DevLoopReceipt>(await readDevLoopConnection(session), '/command', { action })
  if (action !== 'stop') {
    return result
  }
  return await confirmStopped(result)
}

async function confirmStopped(result: DevLoopReceipt): Promise<DevLoopReceipt> {
  // The response must drain before the server can close; report stop only after disposal and natural process exit.
  const deadline = Date.now() + 30_000
  for (;;) {
    const saved = await readDevLoopReceipt(result.session)
    if (saved.generation !== result.generation) {
      Errors.throwHostEnvironment('The dev-loop generation changed while confirming stop cleanup.')
    }
    const identity = saved.controller === undefined
      ? undefined
      : ProcessTree.identities([saved.controller.pid]).get(saved.controller.pid)
    if (saved.controllerDisposed && !ProcessTree.sameProcess(identity, saved.controller!)) {
      return saved
    }
    if (Date.now() >= deadline) {
      Errors.throwHostEnvironment('The dev-loop controller did not finish disposal; its records are preserved.')
    }
    await Time.sleep(50)
  }
}
