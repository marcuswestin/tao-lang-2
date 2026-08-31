import { Errors, HCI, Platform, Switch } from '@shared'
import { runWithCommands } from './cli/run-with-commands'
import { ExpoRunner } from './expo-dev-loop/expo-runner/ExpoRunner'
import { TestRunner } from './repository-tests/TestRunner'
import { TestTUI } from './repository-tests/TestTUI'
import { runStudioDev } from './studio/StudioDev'
import { StudioNative } from './studio/StudioNative'
import { StudioSmoke } from './studio/StudioSmoke'

type TestOutputMode = 'lines' | 'tui'

type TestCommandOptions = {
  jobs?: string
  output?: string
}

/** Repository development CLI behind `./dev`: package tests and low-level Expo device preparation. */
await runWithCommands(commands => {
  commands.name('dev')

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
    .command('studio')
    .description('Launch Tao Studio against a project folder.')
    .argument('[project]', 'Tao project folder.', '.')
    .option('--entry <path>', 'Entry Tao file within the selected project.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--host <hostname>', 'Studio server hostname.', '127.0.0.1')
    .option('--port <port>', 'Studio server port; defaults to an available port.')
    .option('--no-browser', 'Do not open Studio in a browser.')
    .action(async (project, options) => {
      Platform.runtimeProcess.exit(
        await runStudioDev({
          appName: options.app,
          browser: options.browser,
          entryPath: options.entry,
          hostname: options.host,
          port: parseOptionalPositiveInteger(options.port, '--port'),
          projectRoot: project,
        }),
      )
    })

  commands
    .command('studio-native')
    .description('Launch Tao Studio in its local Electrobun shell.')
    .argument('[project]', 'Tao project folder.', '.')
    .option('--entry <path>', 'Entry Tao file within the selected project.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--host <hostname>', 'Studio server hostname.', '127.0.0.1')
    .option('--port <port>', 'Studio server port; defaults to an available port.')
    .option('--artifact-root <path>', 'Generated Electrobun project and runtime artifact root.')
    .option('--hutch <path>', 'Explicit Hutch executable path.', 'hutch')
    .action(async (project, options) => {
      Platform.runtimeProcess.exit(
        await runStudioDev({
          appName: options.app,
          browser: false,
          entryPath: options.entry,
          hostname: options.host,
          native: true,
          nativeArtifactRoot: options.artifactRoot,
          nativeHutchPath: options.hutch,
          port: parseOptionalPositiveInteger(options.port, '--port'),
          projectRoot: project,
        }),
      )
    })

  commands
    .command('package-studio-native')
    .description('Build Tao Studio release artifacts with Electrobun and Hutch.')
    .option('--output-root <path>', 'Application bundle output root.', '.artifacts/build/studio-native')
    .option('--app-name <name>', 'Application display and bundle name.', 'Tao Studio')
    .option('--bundle-identifier <id>', 'macOS application bundle identifier.', 'dev.tao-lang.studio')
    .option('--channel <channel>', 'Electrobun release channel: canary or stable.', 'stable')
    .option('--hutch <path>', 'Explicit Hutch executable path.', 'hutch')
    .option('--node <path>', 'Standalone Node executable to bundle; Nix Node is relocated when needed.')
    .requiredOption('--release-base-url <url>', 'HTTPS base URL for Studio release and update artifacts.')
    .option('--version <version>', 'Studio semantic version.', '0.0.1')
    .action(async options => {
      try {
        const packaged = await StudioNative.packageApp({
          appName: options.appName,
          bundleIdentifier: options.bundleIdentifier,
          channel: parseStudioReleaseChannel(options.channel),
          hutchPath: options.hutch,
          nodePath: options.node,
          outputRoot: options.outputRoot,
          releaseBaseUrl: options.releaseBaseUrl,
          version: options.version,
        })
        HCI.logProcessInfo(
          'studio-native',
          `Hutch completed the ${packaged.channel} build with ${packaged.artifactPaths.length} artifacts.`,
        )
        HCI.logProcessInfo('studio-native', `Artifacts: ${packaged.artifactsRoot}`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        HCI.logProcessError('studio-native', Errors.formatForLog(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('studio-smoke')
    .description('Run explicit slow Studio smoke test files in an isolated resource lane.')
    .argument('<files...>', 'Explicit Studio smoke test files.')
    .requiredOption('--run-id <id>', 'Run identifier used to isolate artifacts.')
    .option('--shard <index>', 'Zero-based smoke shard index.', '0')
    .option('--worker <index>', 'Zero-based worker index.', '0')
    .option('--native', 'Run the shell smoke through Electrobun instead of Chrome.')
    .action(async (files, options) => {
      Platform.runtimeProcess.exit(
        await StudioSmoke.run({
          files,
          native: options.native,
          runId: options.runId,
          shardIndex: parseNonNegativeInteger(options.shard, '--shard'),
          workerIndex: parseNonNegativeInteger(options.worker, '--worker'),
        }),
      )
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

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed
  }
  Errors.throwUserInput(`${label} must be a non-negative integer.`)
}

function parseStudioReleaseChannel(value: string): 'canary' | 'stable' {
  if (value === 'canary' || value === 'stable') {
    return value
  }
  Errors.throwUserInput("--channel must be 'canary' or 'stable'.")
}
