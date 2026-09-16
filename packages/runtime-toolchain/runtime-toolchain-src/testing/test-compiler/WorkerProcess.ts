import { Errors, Platform, Switch } from '@shared'
import { Protocol } from './Protocol'
import { TestCompiler } from './TestCompiler'
import type * as TestCompilerTypes from './TestCompiler'

// Contexts are shared per runRoot so one run's requests reuse compiled app modules. Declared
// before the top-level `await main()` entry call: bindings below it stay uninitialized while
// the session loop runs.
const contextsByRunRoot = new Map<string, TestCompilerTypes.Context>()

await main()

async function main(): Promise<void> {
  try {
    await runSession()
  } catch (error) {
    Platform.runtimeConsole.error(Errors.formatForLog(error))
    Platform.runtimeProcess.exit(1)
  }
}

async function runSession(): Promise<void> {
  const buffer = { pending: '' }
  for await (const chunk of Platform.runtimeProcess.stdin) {
    for (const line of Protocol.lines(buffer, String(chunk))) {
      await handleSessionLine(line)
    }
  }
  const finalLine = Protocol.pendingLine(buffer)
  if (finalLine !== undefined) {
    await handleSessionLine(finalLine)
  }
}

async function handleSessionLine(line: string): Promise<void> {
  const request = Protocol.parseRequest(line)
  const response: TestCompilerTypes.Worker.Response = { id: request.id }
  try {
    response.output = await compileInput(request.input)
  } catch (error) {
    response.error = Protocol.failureFromError(error)
  }
  Platform.runtimeProcess.stdout.write(Protocol.responseLine(response))
}

async function compileInput(input: TestCompilerTypes.Worker.Input): Promise<TestCompilerTypes.Worker.Output> {
  return await Switch.kind<TestCompilerTypes.Worker.Input, Promise<TestCompilerTypes.Worker.Output>>(input, {
    app: compileApp,
    testPlan: compileTestPlan,
    validate: validateTestFile,
  })
}

async function compileApp(input: TestCompilerTypes.Worker.AppInput): Promise<TestCompilerTypes.Worker.AppOutput> {
  return {
    app: { testAppPath: await TestCompiler.compileApp(input.appPath, input) },
    kind: 'app',
  }
}

async function compileTestPlan(
  input: TestCompilerTypes.Worker.TestPlanInput,
): Promise<TestCompilerTypes.Worker.TestPlanOutput> {
  const options: TestCompilerTypes.CompileFileOptions = {
    context: contextForRunRoot(input.runRoot),
    skipValidation: input.skipValidation,
  }
  return {
    file: await TestCompiler.compileTestFile(input.testFilePath, options),
    kind: 'testPlan',
  }
}

async function validateTestFile(
  input: TestCompilerTypes.Worker.ValidateInput,
): Promise<TestCompilerTypes.Worker.ValidateOutput> {
  return {
    errors: await TestCompiler.validateTestFile(input.testFilePath),
    kind: 'validate',
  }
}

function contextForRunRoot(runRoot: string): TestCompilerTypes.Context {
  const existing = contextsByRunRoot.get(runRoot)
  if (existing !== undefined) {
    return existing
  }
  const created: TestCompilerTypes.Context = { appModulePaths: new Map<string, string>(), runRoot }
  contextsByRunRoot.set(runRoot, created)
  return created
}
