import { TestCompiler } from './test-compiler/TestCompiler'
import { runTestFile } from './test-runner'

/** stopTestCompiler stops the shared Tao test compiler worker session. */
export async function stopTestCompiler(): Promise<void> {
  await TestCompiler.Worker.stop()
}

/** runTaoTestPlan runs a v0 Tao test-plan file through the Expo render harness. */
export async function runTaoTestPlan(testFilePath: string): Promise<void> {
  await runTestFile(await TestCompiler.Worker.compileTestPlan(testFilePath))
}
