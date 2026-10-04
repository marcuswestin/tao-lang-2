import { warnContainedFailure } from '@runtime/TR-errors'
import { CLI, Errors, FS, Json, Repo, Switch } from '@shared'
import { RuntimeToolchainPaths } from '../../runtime-toolchain-paths'
import { TestRunRoot } from '../test-run-root'
import { Protocol } from './Protocol'
import type * as TestCompiler from './TestCompiler'

type PendingRequest = {
  kind: TestCompiler.Worker.Input['kind']
  reject: (error: Error) => void
  resolve: (output: TestCompiler.Worker.Output) => void
}

type WaitForCommandClose = (
  close: Promise<CLI.CommandCloseResult>,
  timeoutMs: number,
) => Promise<CLI.CommandCloseResult | undefined>

type StopCommandOptions = {
  forceTimeoutMs?: number
  gracefulTimeoutMs?: number
  terminateTimeoutMs?: number
  waitForClose?: WaitForCommandClose
}

const DEFAULT_STOP_TIMEOUT_MS = 250
const WORKER_STDERR_LIMIT = 2_000

const WORKER_PATH = FS.resolvePath(
  'expo-host-src/testing/test-compiler/WorkerProcess.ts',
  RuntimeToolchainPaths.packageRoot,
)

/** Worker compiles Tao runtime test inputs outside the calling process. */
export const Worker = {
  compileApp,
  compileTestPlan,
  createSession,
  stop,
} as const

/** WorkerTesting exposes deterministic lifecycle seams to package tests. */
export const WorkerTesting = {
  formatWorkerClose,
  stopCommand,
} as const

/** CompileTestPlanOptions configures one worker test-plan compilation request. */
export type CompileTestPlanOptions = {
  runRoot?: string
  skipValidation?: boolean
}

/** WorkerSession owns one Tao test compiler process; its requests run serially in that process. */
export class WorkerSession {
  private readonly session: Session

  constructor(startCommand: typeof CLI.start = CLI.start) {
    this.session = new Session(startCommand)
  }

  /** compileApp compiles one Tao app into a runtime test app module. */
  async compileApp(
    appPath: string,
    options: TestCompiler.CompileAppOptions,
  ): Promise<TestCompiler.Worker.AppOutput['app']> {
    const output = await this.session.request({
      appName: options.appName,
      appPath,
      kind: 'app',
      runtimePackageRoot: options.runtimePackageRoot,
    })
    return Switch.kind<TestCompiler.Worker.Output, TestCompiler.Worker.AppOutput['app']>(output, {
      app: appOutput => appOutput.app,
      testPlan: unexpectedOutput('app compilation'),
      validate: unexpectedOutput('app compilation'),
    })
  }

  /** compileTestPlan compiles one Tao test file into precompiled runtime suites. */
  async compileTestPlan(testFilePath: string, options: CompileTestPlanOptions = {}): Promise<TestCompiler.File> {
    const runRoot = options.runRoot ?? await sharedTestPlanRunRoot()
    const output = await this.session.request({
      kind: 'testPlan',
      runRoot,
      skipValidation: options.skipValidation,
      testFilePath,
    })
    return Switch.kind<TestCompiler.Worker.Output, TestCompiler.File>(output, {
      app: unexpectedOutput('Tao test-plan compilation'),
      testPlan: testPlanOutput => testPlanOutput.file,
      validate: unexpectedOutput('Tao test-plan compilation'),
    })
  }

  /** validateTestFile validates one Tao test file and returns its validation errors. */
  async validateTestFile(testFilePath: string): Promise<TestCompiler.ValidationError[]> {
    const output = await this.session.request({ kind: 'validate', testFilePath })
    return Switch.kind<TestCompiler.Worker.Output, TestCompiler.ValidationError[]>(output, {
      app: unexpectedOutput('Tao test validation'),
      testPlan: unexpectedOutput('Tao test validation'),
      validate: validateOutput => validateOutput.errors,
    })
  }

  /** stop ends the worker process and rejects any pending requests. */
  async stop(): Promise<void> {
    await this.session.stop()
  }
}

let sharedSession: WorkerSession | undefined
// Every caller without a run root of its own shares this process's run root, so the harness
// process is one prunable unit however many test plans it compiles.
let sharedRunRoot: Promise<string> | undefined

function sharedTestPlanRunRoot(): Promise<string> {
  return sharedRunRoot ??= TestRunRoot.create('tao-test-plan')
}

function createSession(): WorkerSession {
  return new WorkerSession()
}

async function compileApp(
  appPath: string,
  options: TestCompiler.CompileAppOptions,
): Promise<TestCompiler.Worker.AppOutput['app']> {
  return await workerSession().compileApp(appPath, options)
}

async function compileTestPlan(testFilePath: string): Promise<TestCompiler.File> {
  return await workerSession().compileTestPlan(testFilePath)
}

function unexpectedOutput(requestDescription: string): (output: TestCompiler.Worker.Output) => never {
  return output => {
    Errors.throwUnexpected(`Test compiler worker returned ${output.kind} for ${requestDescription}.`)
  }
}

async function bunPath(): Promise<string> {
  const devenvBun = Repo.tryResolvePath('.devenv/profile/bin/bun')
  if (devenvBun === undefined) {
    return 'bun'
  }
  return await FS.isFile(devenvBun) ? devenvBun : 'bun'
}

// Test sources live outside the repository whenever `tao test` runs against an installed
// toolchain or a temporary fixture, so the worker falls back to its own package root.
function workerWorkingDirectory(): string {
  return Repo.tryGetRoot() ?? RuntimeToolchainPaths.packageRoot
}

function workerSession(): WorkerSession {
  sharedSession ??= new WorkerSession()
  return sharedSession
}

async function stop(): Promise<void> {
  const activeSession = sharedSession
  sharedSession = undefined
  await activeSession?.stop()
}

class Session {
  private command: CLI.StartedCommand | undefined
  // Bun can report a child as closed while its process and stdio remain alive. Retain every
  // command the session created so stop owns and terminates the complete worker process set.
  private readonly commands = new Set<CLI.StartedCommand>()
  private nextRequestId = 1
  private pending = new Map<number, PendingRequest>()
  private stderr = ''
  private stopPromise: Promise<void> | undefined
  private stopped = false
  private stdout = { pending: '' }

  constructor(private readonly startCommand: typeof CLI.start) {}

  async request(input: TestCompiler.Worker.Input): Promise<TestCompiler.Worker.Output> {
    if (this.stopped) {
      Errors.throwUnexpected('Test compiler worker session is stopped.')
    }
    await this.start()
    const command = this.command
    if (command === undefined) {
      Errors.throwUnexpected('Test compiler worker session did not start.')
    }

    const id = this.nextRequestId++
    const output = new Promise<TestCompiler.Worker.Output>((resolve, reject) => {
      this.pending.set(id, { kind: input.kind, reject, resolve })
    })
    if (!command.writeStdin(Protocol.requestLine({ id, input }))) {
      this.pending.delete(id)
      Errors.throwHostEnvironment('Test compiler worker session stdin is closed.')
    }
    return await output
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.rejectPending('Test compiler worker session stopped.')
    this.stopPromise ??= this.stopCommands()
    await this.stopPromise
  }

  private async stopCommands(): Promise<void> {
    const commands = [...this.commands]
    this.commands.clear()
    this.command = undefined
    if (commands.length === 0) {
      return
    }
    await Promise.all(commands.map(command => stopCommand(command)))
  }

  private async start(): Promise<void> {
    if (this.command !== undefined) {
      return
    }
    const executable = await bunPath()
    if (this.stopped) {
      Errors.throwUnexpected('Test compiler worker session is stopped.')
    }
    if (this.command !== undefined) {
      return
    }
    const command = this.startCommand(executable, {
      args: ['run', WORKER_PATH],
      cwd: workerWorkingDirectory(),
      onOutput: (stream, chunk) => this.handleOutput(stream, chunk),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.command = command
    this.commands.add(command)
    command.waitForClose().then(result => {
      if (this.command === command) {
        this.command = undefined
      }
      command.dispose()
      this.rejectPending(formatWorkerClose(result, this.stderr))
      return result
    })
  }

  private handleOutput(stream: CLI.CommandOutputStream, chunk: Buffer): void {
    if (this.stopped) {
      return
    }
    if (stream === 'stderr') {
      this.stderr = boundedWorkerStderr(`${this.stderr}${chunk.toString('utf8')}`)
      return
    }
    for (const line of Protocol.lines(this.stdout, chunk.toString('utf8'))) {
      this.handleResponse(line)
      if (this.stopped) {
        break
      }
    }
  }

  private handleResponse(line: string): void {
    let response: TestCompiler.Worker.Response
    try {
      const parsed: unknown = Protocol.parseResponse(line)
      if (!isWorkerResponse(parsed)) {
        this.failProtocol()
        return
      }
      response = parsed
    } catch {
      this.failProtocol()
      return
    }
    const pending = this.pending.get(response.id)
    if (pending === undefined) {
      this.failProtocol()
      return
    }
    if (response.output !== undefined && response.output.kind !== pending.kind) {
      this.failProtocol()
      return
    }
    this.pending.delete(response.id)
    if (response.error !== undefined) {
      pending.reject(Protocol.errorFromFailure(response.error))
      return
    }
    if (response.output === undefined) {
      pending.reject(new Errors.UnexpectedBehaviorError('Test compiler worker returned no output.'))
      return
    }
    pending.resolve(response.output)
  }

  private failProtocol(): void {
    this.rejectPending(
      new Errors.UnexpectedBehaviorError('Test compiler worker returned an invalid protocol response.'),
    )
    void this.stop().catch(error => warnContainedFailure('Test compiler worker cleanup failed.', error))
  }

  private rejectPending(error: string | Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(typeof error === 'string' ? new Errors.HostEnvironmentError(error) : error)
    }
    this.pending.clear()
  }
}

function isWorkerResponse(value: unknown): value is TestCompiler.Worker.Response {
  if (!Json.isRecord(value) || !Number.isSafeInteger(value['id']) || (value['id'] as number) < 1) {
    return false
  }
  const failure = value['error']
  const output = value['output']
  if (failure !== undefined) {
    return output === undefined && Json.isRecord(failure)
      && ['host', 'unexpected', 'user'].includes(failure['category'] as string)
      && typeof failure['message'] === 'string'
  }
  if (!Json.isRecord(output) || typeof output['kind'] !== 'string') {
    return false
  }
  return Switch<string, boolean>(output['kind'], {
    app: () => Json.isRecord(output['app']) && typeof output['app']['testAppPath'] === 'string',
    testPlan: () => isWorkerTestFile(output['file']),
    validate: () =>
      Array.isArray(output['errors'])
      && output['errors'].every(error =>
        Json.isRecord(error) && typeof error['path'] === 'string' && Array.isArray(error['messages'])
        && error['messages'].every(message => typeof message === 'string')
      ),
  })
}

function isWorkerTestFile(value: unknown): boolean {
  return Json.isRecord(value) && value['version'] === 1 && typeof value['sourcePath'] === 'string'
    && Array.isArray(value['suites'])
    && value['suites'].every(suite =>
      Json.isRecord(suite) && typeof suite['name'] === 'string' && isWorkerTestSource(suite['source'])
      && Array.isArray(suite['checks']) && suite['checks'].every(check =>
        Json.isRecord(check) && typeof check['name'] === 'string' && isWorkerTestSource(check['source'])
        && Json.isRecord(check['app']) && typeof check['app']['modulePath'] === 'string'
        && typeof check['app']['sourcePath'] === 'string'
        && Array.isArray(check['steps']) && check['steps'].every(isWorkerTestStep)
      )
    )
}

function isWorkerTestSource(value: unknown): boolean {
  if (!Json.isRecord(value) || typeof value['filePath'] !== 'string') {
    return false
  }
  const range = value['range']
  return range === undefined || (Json.isRecord(range)
    && [range['start'], range['end']].every(position =>
      Json.isRecord(position) && Number.isInteger(position['line']) && Number.isInteger(position['character'])
      && (position['line'] as number) >= 0 && (position['character'] as number) >= 0
    ))
}

function isWorkerTestStep(value: unknown): boolean {
  if (!Json.isRecord(value) || typeof value['kind'] !== 'string' || !isWorkerTestSource(value['source'])) {
    return false
  }
  const strings = (...keys: string[]) => keys.every(key => typeof value[key] === 'string')
  const target = () => strings('selector', 'target')
  const label = () => strings('label')
  const tag = () => strings('tag')
  return Switch<string, boolean>(value['kind'], {
    advance: () => typeof value['milliseconds'] === 'number' && Number.isFinite(value['milliseconds']),
    back: () => true,
    datasourceFailure: () =>
      strings('entity', 'message') && ['create', 'delete', 'update'].includes(value['operation'] as string),
    enter: () => target() && strings('value'),
    expect: () => strings('selector', 'text') && typeof value['missing'] === 'boolean',
    expectCheckboxState: () => tag() && typeof value['checked'] === 'boolean',
    expectFocusRegion: label,
    expectGroup: () =>
      (value['scopeTag'] === undefined || typeof value['scopeTag'] === 'string')
      && Array.isArray(value['expectations']) && value['expectations'].every(expectation =>
        Json.isRecord(expectation) && typeof expectation['kind'] === 'string'
        && Switch<string, boolean>(expectation['kind'], {
          inputValue: () => typeof expectation['value'] === 'string',
          match: () =>
            typeof expectation['missing'] === 'boolean' && typeof expectation['target'] === 'string'
            && ['label', 'placeholder', 'text'].includes(expectation['selector'] as string),
        })
      ),
    expectInputValue: () => target() && strings('value'),
    expectNavigationTitle: () => strings('title'),
    expectTarget: label,
    expectToolbarCommand: () => label() && typeof value['enabled'] === 'boolean',
    expectVerbs: () => Array.isArray(value['labels']) && value['labels'].every(item => typeof item === 'string'),
    focus: tag,
    hover: target,
    narrow: () => strings('text'),
    network: () => ['offline', 'online'].includes(value['mode'] as string),
    press: () => strings('selector', 'text'),
    pressDown: target,
    pressKey: () => strings('key'),
    pressToolbarCommand: label,
    pressUp: target,
    relaunch: () => typeof value['fresh'] === 'boolean',
    select: () =>
      tag() && Number.isInteger(value['index']) && (value['index'] as number) >= 1
      && Array.isArray(value['steps']) && value['steps'].every(isWorkerTestStep),
    submit: target,
    waitForSync: () => true,
  })
}

/** Gives a worker EOF, then escalates through TERM and KILL without waiting forever. */
async function stopCommand(command: CLI.StartedCommand, options: StopCommandOptions = {}): Promise<void> {
  const close = command.waitForClose()
  const waitForClose = options.waitForClose ?? waitForCommandClose
  try {
    command.endStdin()
    if (await waitForClose(close, options.gracefulTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS) !== undefined) {
      return
    }
    command.kill('SIGTERM')
    if (await waitForClose(close, options.terminateTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS) !== undefined) {
      return
    }
    command.kill('SIGKILL')
    await waitForClose(close, options.forceTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
  } finally {
    await command.closeOutput()
    command.dispose()
  }
}

async function waitForCommandClose(
  close: Promise<CLI.CommandCloseResult>,
  timeoutMs: number,
): Promise<CLI.CommandCloseResult | undefined> {
  return await new Promise(resolve => {
    const timeout = setTimeout(() => resolve(undefined), timeoutMs)
    close.then(result => {
      clearTimeout(timeout)
      resolve(result)
      return result
    })
  })
}

function formatWorkerClose(result: CLI.CommandCloseResult, stderr: string): string {
  return [
    `Test compiler worker exited with ${result.exitCode ?? 'unknown'}.`,
    boundedWorkerStderr(stderr).trim(),
  ].filter(Boolean).join('\n')
}

function boundedWorkerStderr(stderr: string): string {
  const safe = stderr.replaceAll(/\u001b\[[0-?]*[ -\/]*[@-~]/gu, '').replaceAll(
    /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]+/gu,
    ' ',
  )
  return safe.length <= WORKER_STDERR_LIMIT ? safe : `…${safe.slice(-(WORKER_STDERR_LIMIT - 1))}`
}
