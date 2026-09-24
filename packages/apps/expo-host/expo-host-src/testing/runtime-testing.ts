import { JestTransformCache } from './jest-transform-cache'
import {
  type JourneyCheckObservation,
  JourneyObservations,
  type JourneyObservationsArtifact as JourneyObservationsArtifactType,
} from './journey-observations'
import type { RuntimeApp } from './RuntimeApp'
import { TestCaseName } from './test-case-name'
import { TestCompiler as CoreTestCompiler } from './test-compiler/TestCompiler'
import type * as TestCompilerTypes from './test-compiler/TestCompiler'
import { type GeneratedEntrypoints, TestHarnessFiles } from './test-harness-files'
import { TestRunId } from './test-run-id'
import { TestRunRoot } from './test-run-root'

const COMPILE_APP_MODULE_PATH = './compile-app'
const TEST_RUNNER_MODULE_PATH = './test-runner'
const TAO_TEST_PLAN_MODULE_PATH = './tao-test-plan'

// Keep the RN/Jest harness modules lazy so CLI imports of this public entrypoint do not parse React Native.
// Jest in this setup also cannot use dynamic import without VM module support, so use require here.

/** TEST_MANIFEST_ENV names the Jest environment variable that points at the Tao test manifest. */
const TEST_MANIFEST_ENV = 'TAO_TEST_RUNTIME_MANIFEST'

type CompileAppModule = {
  compileAndRenderApp(appPath: string, options?: { appName?: string }): Promise<RuntimeApp.Screen>
}

type TestRunnerModule = {
  runTestCheck(suiteName: string, check: TestCompilerTypes.Check): Promise<JourneyCheckObservation>
}

type TaoTestPlanModule = {
  runTaoTestPlan(testFilePath: string): Promise<void>
  stopTestCompiler(): Promise<void>
}

let compileAppModule: CompileAppModule | undefined
let testRunnerModule: TestRunnerModule | undefined
let taoTestPlanModule: TaoTestPlanModule | undefined

/** RuntimeTesting exposes the public Tao runtime test harness API. */
export const RuntimeTesting = {
  compileAndRenderApp,
  runTaoTestPlan,
  runTestCheck,
  stopTestCompiler,
  TEST_MANIFEST_ENV,
  TestCaseName,
  TestCompiler: CoreTestCompiler,
  TestHarnessFiles,
  JourneyObservations,
  JestTransformCache,
  TestRunId,
  TestRunRoot,
}

export namespace RuntimeTesting {
  /** CompiledApp represents an isolated generated app module ready to render in Jest. */
  export type CompiledApp = RuntimeApp.Compiled

  /** Screen represents a rendered React Native Testing Library app screen. */
  export type Screen = RuntimeApp.Screen
  export type JourneyObservationsArtifact = JourneyObservationsArtifactType

  /** TestHarnessFiles groups the generated Jest entrypoint types under RuntimeTesting. */
  export namespace TestHarnessFiles {
    export type Generated = GeneratedEntrypoints
  }

  /** TestCompiler groups runtime test compiler types under RuntimeTesting. */
  export namespace TestCompiler {
    export type Context = TestCompilerTypes.Context
    export type Source = TestCompilerTypes.Source
    export type Step = TestCompilerTypes.Step
    export type App = TestCompilerTypes.App
    export type Check = TestCompilerTypes.Check
    export type Suite = TestCompilerTypes.Suite
    export type File = TestCompilerTypes.File
    export type Manifest = TestCompilerTypes.Manifest
    export type ValidationOptions = TestCompilerTypes.ValidationOptions
    export type ValidationError = TestCompilerTypes.ValidationError
    export type CompileAppOptions = TestCompilerTypes.CompileAppOptions
    export type CompileFileOptions = TestCompilerTypes.CompileFileOptions

    export namespace Worker {
      export type Input = TestCompilerTypes.Worker.Input
      export type Output = TestCompilerTypes.Worker.Output
      export type AppInput = TestCompilerTypes.Worker.AppInput
      export type TestPlanInput = TestCompilerTypes.Worker.TestPlanInput
      export type AppOutput = TestCompilerTypes.Worker.AppOutput
      export type TestPlanOutput = TestCompilerTypes.Worker.TestPlanOutput
      export type Request = TestCompilerTypes.Worker.Request
      export type Response = TestCompilerTypes.Worker.Response
      export type LineBuffer = TestCompilerTypes.Worker.LineBuffer
    }
  }
}

async function compileAndRenderApp(
  appPath: string,
  options: { appName?: string } = {},
): Promise<RuntimeApp.Screen> {
  const module = compileAppModule ??= require(COMPILE_APP_MODULE_PATH) as CompileAppModule
  return await module.compileAndRenderApp(appPath, options)
}

async function runTestCheck(suiteName: string, check: TestCompilerTypes.Check): Promise<JourneyCheckObservation> {
  const module = testRunnerModule ??= require(TEST_RUNNER_MODULE_PATH) as TestRunnerModule
  return await module.runTestCheck(suiteName, check)
}

async function runTaoTestPlan(testFilePath: string): Promise<void> {
  const module = taoTestPlanModule ??= require(TAO_TEST_PLAN_MODULE_PATH) as TaoTestPlanModule
  await module.runTaoTestPlan(testFilePath)
}

async function stopTestCompiler(): Promise<void> {
  const module = taoTestPlanModule ??= require(TAO_TEST_PLAN_MODULE_PATH) as TaoTestPlanModule
  await module.stopTestCompiler()
}
