import { CLI, FS, Repo, Switch } from '@shared'
import { RuntimeToolchainPaths } from '../../runtime-toolchain-paths'
import { TestRunId } from '../test-run-id'
import { Protocol } from './Protocol'
import type * as TestCompiler from './TestCompiler'

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (output: TestCompiler.Worker.Output) => void
}

const WORKER_PATH = FS.resolvePath(
  'runtime-toolchain-src/testing/test-compiler/WorkerProcess.ts',
  RuntimeToolchainPaths.packageRoot,
)

/** Worker compiles Tao runtime test inputs outside the calling process. */
export const Worker = {
  compileApp,
  compileTestPlan,
  createSession,
  stop,
} as const

/** CompileTestPlanOptions configures one worker test-plan compilation request. */
export type CompileTestPlanOptions = {
  runRoot?: string
  skipValidation?: boolean
}

/** WorkerSession owns one Tao test compiler process; its requests run serially in that process. */
export class WorkerSession {
  private readonly session = new Session()

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
    const runRoot = options.runRoot ?? FS.resolvePath(
      `_gen_tao-app-test/tao-test-plan/${TestRunId.create()}`,
      RuntimeToolchainPaths.packageRoot,
    )
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
    throw new Error(`Test compiler worker returned ${output.kind} for ${requestDescription}.`)
  }
}

async function bunPath(): Promise<string> {
  const devenvBun = Repo.resolvePath('.devenv/profile/bin/bun')
  return await FS.isFile(devenvBun) ? devenvBun : 'bun'
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
  private nextRequestId = 1
  private pending = new Map<number, PendingRequest>()
  private stderr = ''
  private stdout = { pending: '' }

  async request(input: TestCompiler.Worker.Input): Promise<TestCompiler.Worker.Output> {
    await this.start()
    const command = this.command
    if (command === undefined) {
      throw new Error('Test compiler worker session did not start.')
    }

    const id = this.nextRequestId++
    const output = new Promise<TestCompiler.Worker.Output>((resolve, reject) => {
      this.pending.set(id, { reject, resolve })
    })
    if (!command.writeStdin(Protocol.requestLine({ id, input }))) {
      this.pending.delete(id)
      throw new Error('Test compiler worker session stdin is closed.')
    }
    return await output
  }

  async stop(): Promise<void> {
    const command = this.command
    this.command = undefined
    if (command === undefined) {
      return
    }
    command.endStdin()
    const result = await command.waitForClose()
    command.dispose()
    this.rejectPending(`Test compiler worker stopped with exit ${result.exitCode ?? 'unknown'}.`)
  }

  private async start(): Promise<void> {
    if (this.command !== undefined) {
      return
    }
    const command = CLI.start(await bunPath(), {
      args: ['run', WORKER_PATH],
      cwd: Repo.resolvePath(),
      onOutput: (stream, chunk) => this.handleOutput(stream, chunk),
      stdio: ['pipe', 'pipe', 'pipe'],
      unref: true,
    })
    this.command = command
    command.waitForClose().then(result => {
      this.command = undefined
      command.dispose()
      this.rejectPending(formatWorkerClose(result, this.stderr))
      return result
    })
  }

  private handleOutput(stream: CLI.CommandOutputStream, chunk: Buffer): void {
    if (stream === 'stderr') {
      this.stderr += chunk.toString('utf8')
      return
    }
    for (const line of Protocol.lines(this.stdout, chunk.toString('utf8'))) {
      this.handleResponse(line)
    }
  }

  private handleResponse(line: string): void {
    const response = Protocol.parseResponse(line)
    const pending = this.pending.get(response.id)
    if (pending === undefined) {
      return
    }
    this.pending.delete(response.id)
    if (response.error !== undefined) {
      pending.reject(new Error(response.error))
      return
    }
    if (response.output === undefined) {
      pending.reject(new Error('Test compiler worker returned no output.'))
      return
    }
    pending.resolve(response.output)
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
}

function formatWorkerClose(result: CLI.CommandCloseResult, stderr: string): string {
  return [
    `Test compiler worker exited with ${result.exitCode ?? 'unknown'}.`,
    stderr.trim(),
  ].filter(Boolean).join('\n')
}
