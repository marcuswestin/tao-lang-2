import { CLI, FS, Repo, Switch } from '@shared'
import { TestRunId } from '../test-run-id'
import { Protocol } from './Protocol'
import type * as TestCompiler from './TestCompiler'

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (output: TestCompiler.Worker.Output) => void
}

const WORKER_PATH = Repo.resolvePath('packages/runtime/runtime-src/testing/test-compiler/WorkerProcess.ts')

/** Worker compiles Tao runtime test inputs outside the Jest process. */
export const Worker = {
  compileApp,
  compileTestPlan,
  stop,
} as const

let session: Session | undefined

async function compileApp(
  appPath: string,
  options: TestCompiler.CompileAppOptions,
): Promise<TestCompiler.Worker.AppOutput['app']> {
  const output = await runWorker({
    appPath,
    kind: 'app',
    runtimePackageRoot: options.runtimePackageRoot,
  })
  return Switch.kind<TestCompiler.Worker.Output, TestCompiler.Worker.AppOutput['app']>(output, {
    app: appOutput => appOutput.app,
    testPlan: testPlanOutput => {
      throw new Error(`Test compiler worker returned ${testPlanOutput.kind} for app compilation.`)
    },
  })
}

async function compileTestPlan(testFilePath: string): Promise<TestCompiler.File> {
  const runRoot = FS.resolvePath(
    `_gen_tao-app-test/tao-test-plan/${TestRunId.create()}`,
    Repo.resolvePath('packages/runtime'),
  )
  const output = await runWorker({
    kind: 'testPlan',
    runRoot,
    testFilePath,
  })
  return Switch.kind<TestCompiler.Worker.Output, TestCompiler.File>(output, {
    app: appOutput => {
      throw new Error(`Test compiler worker returned ${appOutput.kind} for Tao test-plan compilation.`)
    },
    testPlan: testPlanOutput => testPlanOutput.file,
  })
}

async function runWorker(input: TestCompiler.Worker.Input): Promise<TestCompiler.Worker.Output> {
  return await workerSession().request(input)
}

async function bunPath(): Promise<string> {
  const devenvBun = Repo.resolvePath('.devenv/profile/bin/bun')
  return await FS.isFile(devenvBun) ? devenvBun : 'bun'
}

function workerSession(): Session {
  session ??= new Session()
  return session
}

async function stop(): Promise<void> {
  const activeSession = session
  session = undefined
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
