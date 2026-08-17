import { Completion, Errors, HCI, Platform, Switch } from '@shared'
import { runWithCommands } from './commands/commands-utils'
import { runDevLoop } from './dev-loop/dev-loop'
import { ExpoRunner } from './dev-loop/expo-runner/ExpoRunner'
import { TestRunner } from './dev-loop/test-runner/TestRunner'
import { TUI } from './dev-loop/TUI'

type TestOutputMode = 'lines' | 'tui'

type TestCommandOptions = {
  jobs?: string
  output?: string
}

await runWithCommands(commands => {
  commands
    .name('dev')
    .argument('[appPath]', 'Tao app path to run in the dev loop.')
    .action(async (appPath?: string) => {
      try {
        const devLoop = await runDevLoop(appPath)
        Platform.runtimeProcess.exit(devLoop)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

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

  Completion.register(commands, {
    commandNames: ['./dev', 'dev'],
    executableName: 'dev',
  })
})

async function runTests(
  pattern: string,
  options: { jobs?: number; outputMode: TestOutputMode },
): Promise<number> {
  return await Switch<TestOutputMode, Promise<number>>(options.outputMode, {
    lines: () => TestRunner.runSuitesInterleaved(pattern, { jobs: options.jobs }),
    tui: () => TUI.runTestSuites(pattern, { jobs: options.jobs }),
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
