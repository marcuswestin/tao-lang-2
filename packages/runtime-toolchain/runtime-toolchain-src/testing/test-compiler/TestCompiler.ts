import { Diagnostics, FS } from '@shared'
import type Workspace from '@workspace'
import type { RuntimeApp } from '../RuntimeApp'
import { TestRunId } from '../test-run-id'
import { Worker as CompilerWorker } from './Worker'

type CompiledTestPlan = Awaited<ReturnType<typeof Workspace.compileTestPlan>>
type CompiledTestSuite = CompiledTestPlan['suites'][number]
type CompiledTestCheck = CompiledTestSuite['checks'][number]

type RuntimeModule = {
  default: {
    generateApp(appPath: string, options: TestCompiler.CompileAppOptions): Promise<{ outputPath: string }>
  }
}

type WorkspaceModule = {
  default: {
    compileTestPlan: typeof Workspace.compileTestPlan
    shared: typeof Workspace.shared
  }
}

let runtimeModule: RuntimeModule | undefined
let workspaceModule: WorkspaceModule | undefined

/** TestCompiler compiles Tao apps and test plans into runtime-test inputs. */
export const TestCompiler = {
  compileApp,
  compileTestFile,
  validateTestFile,
  Worker: CompilerWorker,
} as const

namespace TestCompiler {
  /** Context keeps generated app module paths for one Tao test compilation run. */
  export type Context = {
    appModulePaths: Map<string, string>
    runRoot: string
  }

  /** ValidationOptions configures Tao validation for compiler-owned test compilation. */
  export type ValidationOptions = {
    skipValidation?: boolean
  }

  /** CompileAppOptions configures where a generated runtime test app is written. */
  export type CompileAppOptions = {
    appName?: string
    runtimePackageRoot: string
  }

  /** CompileFileOptions declares the state and toggles for compiling one Tao test file. */
  export type CompileFileOptions = ValidationOptions & {
    context: Context
  }

  /** Source declares where one runtime test manifest item came from. */
  export type Source = CompiledTestCheck['source']

  /** Step declares one ordered runtime test operation after app launch. */
  export type Step = CompiledTestCheck['steps'][number]

  /** App declares a precompiled app module for a check. */
  export type App = {
    modulePath: string
    sourcePath: string
  }

  /** Check declares one executable precompiled Tao check. */
  export type Check = Omit<CompiledTestCheck, 'run'> & {
    app: App
  }

  /** Suite declares one precompiled Tao test suite. */
  export type Suite = Omit<CompiledTestSuite, 'checks'> & {
    checks: Check[]
  }

  /** File declares precompiled suites for one Tao test file. */
  export type File = Omit<CompiledTestPlan, 'suites'> & {
    suites: Suite[]
  }

  /** Manifest declares every precompiled Tao test file for one Jest harness run. */
  export type Manifest = {
    files: File[]
  }

  /** ValidationError declares validation error messages for one file of a Tao test run. */
  export type ValidationError = {
    path: string
    messages: readonly string[]
  }

  export namespace Worker {
    /** Input declares requests sent from a harness to the compiler worker. */
    export type Input = AppInput | TestPlanInput | ValidateInput

    /** Output declares responses returned from the compiler worker. */
    export type Output = AppOutput | TestPlanOutput | ValidateOutput

    export type AppInput = CompileAppOptions & {
      appPath: string
      kind: 'app'
    }

    export type TestPlanInput = {
      kind: 'testPlan'
      runRoot: string
      skipValidation?: boolean
      testFilePath: string
    }

    export type ValidateInput = {
      kind: 'validate'
      testFilePath: string
    }

    export type AppOutput = {
      app: RuntimeApp.Compiled
      kind: 'app'
    }

    export type TestPlanOutput = {
      file: File
      kind: 'testPlan'
    }

    export type ValidateOutput = {
      errors: ValidationError[]
      kind: 'validate'
    }

    export type Request = {
      id: number
      input: Input
    }

    export type Response = {
      error?: WorkerFailure
      id: number
      output?: Output
    }

    export type WorkerFailure = {
      category: 'host' | 'unexpected' | 'user'
      message: string
    }

    export type LineBuffer = {
      pending: string
    }
  }
}

export type Context = TestCompiler.Context
export type Source = TestCompiler.Source
export type Step = TestCompiler.Step
export type App = TestCompiler.App
export type Check = TestCompiler.Check
export type Suite = TestCompiler.Suite
export type File = TestCompiler.File
export type Manifest = TestCompiler.Manifest
export type ValidationOptions = TestCompiler.ValidationOptions
export type ValidationError = TestCompiler.ValidationError
export type CompileAppOptions = TestCompiler.CompileAppOptions
export type CompileFileOptions = TestCompiler.CompileFileOptions

export namespace Worker {
  export type Input = TestCompiler.Worker.Input
  export type Output = TestCompiler.Worker.Output
  export type AppInput = TestCompiler.Worker.AppInput
  export type TestPlanInput = TestCompiler.Worker.TestPlanInput
  export type ValidateInput = TestCompiler.Worker.ValidateInput
  export type AppOutput = TestCompiler.Worker.AppOutput
  export type TestPlanOutput = TestCompiler.Worker.TestPlanOutput
  export type ValidateOutput = TestCompiler.Worker.ValidateOutput
  export type Request = TestCompiler.Worker.Request
  export type Response = TestCompiler.Worker.Response
  export type WorkerFailure = TestCompiler.Worker.WorkerFailure
  export type LineBuffer = TestCompiler.Worker.LineBuffer
}

async function compileApp(appPath: string, options: TestCompiler.CompileAppOptions): Promise<string> {
  return (await runtime().generateApp(appPath, {
    appName: options.appName,
    runtimePackageRoot: options.runtimePackageRoot,
  })).outputPath
}

async function compileTestFile(
  testFilePath: string,
  options: TestCompiler.CompileFileOptions,
): Promise<TestCompiler.File> {
  const entryPath = FS.resolvePath(testFilePath)
  const plan = await (await workspace().shared(FS.dirname(entryPath))).compileTestPlan(entryPath, {
    skipValidation: options.skipValidation,
  })
  return await fileForPlan(plan, options.context)
}

async function validateTestFile(testFilePath: string): Promise<TestCompiler.ValidationError[]> {
  const entryPath = FS.resolvePath(testFilePath)
  const validation = await (await workspace().shared(FS.dirname(entryPath))).validate(entryPath)
  const messagesByPath = new Map<string, string[]>()
  for (const diagnostic of Diagnostics.errors(validation.diagnostics)) {
    const path = diagnostic.filePath ?? entryPath
    const messages = messagesByPath.get(path) ?? []
    messages.push(diagnostic.message)
    messagesByPath.set(path, messages)
  }
  return [...messagesByPath].map(([path, messages]) => ({ messages, path }))
}

function runtime(): RuntimeModule['default'] {
  return (runtimeModule ??= require('@runtime-toolchain') as RuntimeModule).default
}

function workspace(): WorkspaceModule['default'] {
  return (workspaceModule ??= require('@workspace') as WorkspaceModule).default
}

async function fileForPlan(
  plan: CompiledTestPlan,
  context: TestCompiler.Context,
): Promise<TestCompiler.File> {
  const suites: TestCompiler.Suite[] = []
  for (const suite of plan.suites) {
    suites.push(await suiteForPlan(suite, context))
  }
  return { sourcePath: plan.sourcePath, suites }
}

async function suiteForPlan(
  suite: CompiledTestSuite,
  context: TestCompiler.Context,
): Promise<TestCompiler.Suite> {
  const checks: TestCompiler.Check[] = []
  for (const check of suite.checks) {
    checks.push(await checkForPlan(check, context))
  }
  return { checks, name: suite.name, source: suite.source }
}

async function checkForPlan(
  check: CompiledTestCheck,
  context: TestCompiler.Context,
): Promise<TestCompiler.Check> {
  return {
    app: {
      modulePath: await appModulePath(check.run.appSourcePath, check.run.appName, context),
      sourcePath: check.run.appSourcePath,
    },
    name: check.name,
    source: check.source,
    steps: check.steps,
  }
}

const inflightAppCompiles = new WeakMap<TestCompiler.Context, Map<string, Promise<string>>>()

async function appModulePath(appSourcePath: string, appName: string, context: TestCompiler.Context): Promise<string> {
  const cacheKey = `${appSourcePath}#${appName}`
  const cached = context.appModulePaths.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  const inflight = inflightCompiles(context)
  const pending = inflight.get(cacheKey)
  if (pending !== undefined) {
    return await pending
  }
  const compile = compileApp(appSourcePath, {
    appName,
    runtimePackageRoot: FS.resolvePath(`app-${TestRunId.create()}`, context.runRoot),
  }).then(outputPath => {
    context.appModulePaths.set(cacheKey, outputPath)
    return outputPath
  })
  inflight.set(cacheKey, compile)
  return await compile
}

function inflightCompiles(context: TestCompiler.Context): Map<string, Promise<string>> {
  const existing = inflightAppCompiles.get(context)
  if (existing !== undefined) {
    return existing
  }
  const created = new Map<string, Promise<string>>()
  inflightAppCompiles.set(context, created)
  return created
}
