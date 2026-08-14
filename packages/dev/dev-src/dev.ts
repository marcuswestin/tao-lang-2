import { Errors, HCI, Platform, Switch } from '@shared'
import { runWithCommands } from './cli/run-with-commands'
import { ExpoRunner } from './expo-dev-loop/expo-runner/ExpoRunner'
import { TestRunner } from './repository-tests/TestRunner'
import { TestTUI } from './repository-tests/TestTUI'

type TestOutputMode = 'lines' | 'tui'

type TestCommandOptions = {
  jobs?: string
  output?: string
}

/** Internal Justfile CLI: run repository tests and low-level Expo device preparation. */
await runWithCommands(commands => {
  commands.name('tao-dev-internal')

  commands
    .command('test')
    .description('Run package tests in parallel.')
    .argument('[pattern]', 'Optional test name pattern.')
    .option('--output <mode>', 'Output mode: tui or lines.', 'tui')
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (pattern = '', options: TestCommandOptions = {}) => {
      try {
        Platform.runtimeProcess.exit(
          await runTests(pattern, {
            jobs: parseOptionalPositiveInteger(options.jobs, '--jobs'),
            outputMode: parseTestOutputMode(options.output ?? 'tui'),
          }),
        )
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('android-emulator')
    .description('Ensure an Android emulator exists and is booted.')
    .action(async () => {
      await ExpoRunner.ensureAndroidEmulator()
    })

  commands
    .command('android-expo-go')
    .description('Ensure Expo Go is installed on the booted Android emulator.')
    .action(async () => {
      await ExpoRunner.ensureAndroidExpoGo()
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      await ExpoRunner.startExpo()
    })
})

async function runTests(
  pattern: string,
  options: { jobs?: number; outputMode: TestOutputMode },
): Promise<number> {
  return await Switch<TestOutputMode, Promise<number>>(options.outputMode, {
    lines: () => TestRunner.runSuitesInterleaved(pattern, { jobs: options.jobs }),
    tui: () => TestTUI.runTestSuites(pattern, { jobs: options.jobs }),
  })
}

function parseTestOutputMode(value: string): TestOutputMode {
  if (value === 'lines' || value === 'tui') {
    return value
  }
  Errors.throwUserInput(`Unknown test output mode '${value}'. Use 'tui' or 'lines'.`)
}

function parseOptionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  Errors.throwUserInput(`${label} must be a positive integer.`)
}
