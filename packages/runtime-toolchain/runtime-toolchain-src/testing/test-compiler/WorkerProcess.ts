import { Errors, Platform, Switch } from '@shared'
import { Protocol } from './Protocol'
import { TestCompiler } from './TestCompiler'
import type * as TestCompilerTypes from './TestCompiler'

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
    response.error = Errors.formatForLog(error)
  }
  Platform.runtimeProcess.stdout.write(Protocol.responseLine(response))
}

async function compileInput(input: TestCompilerTypes.Worker.Input): Promise<TestCompilerTypes.Worker.Output> {
  return await Switch.kind<TestCompilerTypes.Worker.Input, Promise<TestCompilerTypes.Worker.Output>>(input, {
    app: compileApp,
    testPlan: compileTestPlan,
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
  const context: TestCompilerTypes.Context = {
    appModulePaths: new Map<string, string>(),
    runRoot: input.runRoot,
  }
  const options: TestCompilerTypes.CompileFileOptions = { context }
  return {
    file: await TestCompiler.compileTestFile(input.testFilePath, options),
    kind: 'testPlan',
  }
}
