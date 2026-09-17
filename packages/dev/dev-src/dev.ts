import { Errors, HCI, Platform, Repo } from '@shared'
import { AgentConfigGenerator } from './agent-config/AgentConfigGenerator'
import { runWithCommands } from './cli/run-with-commands'
import { AgentCapabilitiesCommand } from './doctor/AgentCapabilitiesCommand'
import { RepositoryDoctorCommand } from './doctor/RepositoryDoctorCommand'
import { runGates } from './repository-tests/GateRunner'
import { GreenTree } from './repository-tests/GreenTree'
import { MergeWithMainCommand } from './repository-tests/MergeWithMain'
import { formatGateSummary, gateExitCode } from './repository-tests/RunSummary'
import { TestRunner } from './repository-tests/TestRunner'
import { WorkReporter } from './repository-tests/WorkReporter'

/*
 * Studio and Expo command modules load lazily inside their actions. Studio reaches the generated
 * parser through `@studio`, so a static import here would make `gates`, `test`, `doctor`, and
 * `agent-config` unstartable in a checkout that has never generated it — before the graph that
 * generates it can run — and would turn any top-level fault in Studio code into a failure of the
 * gate runner itself. `devLazyStudioImportIssues` in `repository-tests/repo-lint.ts` enforces this.
 */

type TestCommandOptions = {
  jobs?: string
  output?: string
}

type GatesCommandOptions = {
  fresh?: boolean
  greenTree?: string[]
  jobs?: string
  json?: string
  lane?: string
  output?: string
  skipUnsandboxed?: boolean
  skipped?: string[]
}

type MergeCommandOptions = {
  abort?: string
  execute?: boolean
  messageFile?: string
  push?: boolean
  skipFullVerify?: boolean
  yes?: boolean
}

/** Help shared by every command that runs a work graph, so the modes are described once. */
const OUTPUT_OPTION_HELP = 'Output mode: tui, lines, or quiet. Defaults to tui on a terminal and quiet in a pipe.'

/** Repository development CLI behind `./dev`: package tests and low-level Expo device preparation. */
await runWithCommands(commands => {
  commands.name('dev')

  commands
    .command('test')
    .description('Run package tests in parallel.')
    .argument('[pattern]', 'Optional test name pattern.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (pattern = '', options: TestCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runTests(pattern, testRunOptions(options)))
    })

  commands
    .command('test-changed')
    .description('Run tests selected by changes since a ref or the main merge base.')
    .argument('[reference]', 'Git ref to compare directly instead of the default main merge base.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (reference: string | undefined, options: TestCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runChangedTests(reference, testRunOptions(options)))
    })

  commands
    .command('test-file')
    .description('Run one exact package Bun or runtime Jest test file.')
    .argument('<path>', 'Repository-relative test file path.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (path: string, options: TestCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runTestFile(path, testRunOptions(options)))
    })

  commands
    .command('test-retry')
    .description("Re-run files not green since this checkout's latest complete test run.")
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (options: TestCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runRetryTests(testRunOptions(options)))
    })

  commands
    .command('test-flakes')
    .description('Report tests whose outcome flipped without their file changing.')
    .option('--limit <count>', 'Maximum tests to print.', '20')
    .action(async (options: { limit: string }) => {
      await runExitCommand(() => TestRunner.printFlakes(parsePositiveInteger(options.limit, '--limit')))
    })

  commands
    .command('test-slowest')
    .description("Report the slowest tests in this checkout's ledger.")
    .option('--limit <count>', 'Maximum tests to print.', '20')
    .action(async (options: { limit: string }) => {
      await runExitCommand(() => TestRunner.printSlowest(parsePositiveInteger(options.limit, '--limit')))
    })

  commands
    .command('gates')
    .description('Run repository gates in parallel and report one verification summary.')
    .argument('<gates...>', 'Just recipe names to run as gates.')
    .option('--jobs <count>', 'Maximum number of gates to run at once.')
    .option('--json <path>', 'Also write the summary as a JSON artifact at this path.')
    .option('--lane <name>', 'Artifact lane the run writes its logs and summary under.', 'verify')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--skip-unsandboxed', 'Skip gates whose catalog metadata requires an unsandboxed host.')
    .option('--skipped <entry...>', 'Gates deliberately not run in this lane, as name=reason.')
    .option(
      '--green-tree <lanes...>',
      'Skip the run when the tree is already recorded green under any of these lanes; record this run under the first.',
    )
    .option('--fresh', 'Ignore recorded green trees and run every gate.')
    .action(async (gates: string[], options: GatesCommandOptions = {}) => {
      const summary = await runGates({
        gates,
        greenTree: options.greenTree === undefined || options.greenTree.length === 0
          ? undefined
          : { fresh: options.fresh === true, lanes: options.greenTree },
        jobs: parseOptionalPositiveInteger(options.jobs, '--jobs'),
        jsonPath: options.json,
        lane: options.lane,
        outputMode: WorkReporter.resolveMode({ requested: options.output }),
        skipUnsandboxed: options.skipUnsandboxed === true,
        skipped: options.skipped,
      })
      if (summary.greenTree !== undefined) {
        HCI.writeSuccess(`${GreenTree.describe(summary.lane, summary.greenTree)}\n`)
        Platform.runtimeProcess.exit(0)
      }
      HCI.writeLine(formatGateSummary(summary))
      Platform.runtimeProcess.exit(gateExitCode(summary))
    })

  commands
    .command('merge-with-main')
    .description('Dry-run the human-only workflow that squash-merges a feature branch into main.')
    .option('--execute', 'Perform the workflow; the first release defaults to a ref-preserving dry run.')
    .option('--yes', 'Confirm the normal execution prompt non-interactively.')
    .option('--push', 'Explicitly authorize pushing from a non-interactive invocation.')
    .option('--skip-full-verify', 'Explicitly omit the otherwise mandatory unsandboxed full verification.')
    .option('--message-file <path>', 'Override .artifacts/merge/<branch>.msg.')
    .option('--abort <snapshot>', 'Restore command-owned local state from a pre-push snapshot.')
    .action(async (options: MergeCommandOptions = {}) => {
      try {
        await MergeWithMainCommand.run({
          abortSnapshot: options.abort,
          execute: options.execute === true,
          messageFile: options.messageFile,
          push: options.push === true,
          skipFullVerify: options.skipFullVerify === true,
          yes: options.yes === true,
        })
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('capabilities')
    .description('Report which host capabilities this agent environment can use without changing anything.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await AgentCapabilitiesCommand.run({ json: options.json === true }))
    })

  commands
    .command('doctor')
    .description('Diagnose this checkout without changing it.')
    .option('--json', 'Print a versioned structured report instead of PASS/WARN/FAIL lines.')
    .option(
      '--fingerprint',
      'Print only the environment fingerprint, which carries nothing personal and always exits 0.',
    )
    .action(async (options: { fingerprint?: boolean; json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(
        await RepositoryDoctorCommand.run({
          fingerprint: options.fingerprint === true,
          json: options.json === true,
        }),
      )
    })

  commands
    .command('secrets')
    .description('Decrypt the repository secrets into .env.secrets, or add, list, or set up.')
    .argument('[action]', 'add <KEY> [note], list, or setup. Omit to decrypt everything.')
    .argument('[rest...]', 'Arguments for the action.')
    .action(async (action: string | undefined, rest: string[] = []) => {
      const { runSecrets } = await import('./secrets/SecretsCommand')
      try {
        Platform.runtimeProcess.exit(await runSecrets(action === undefined ? [] : [action, ...rest]))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('agent-config')
    .description('Generate harness agent adapters and permission config from .rulesync.')
    .action(async () => {
      try {
        await AgentConfigGenerator.generate({ root: Repo.resolvePath() })
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
    .option('--json', 'Print a machine-readable readiness payload once Studio answers.')
    .action(async (project, options) => {
      const { runStudioDev } = await import('./studio/StudioDev')
      Platform.runtimeProcess.exit(
        await runStudioDev({
          appName: options.app,
          browser: options.browser,
          entryPath: options.entry,
          hostname: options.host,
          json: options.json === true,
          port: parseOptionalPositiveInteger(options.port, '--port'),
          projectRoot: project,
        }),
      )
    })

  commands
    .command('studio-canary')
    .description('Run native Tao Studio against a deterministic project and report what it proved.')
    .option('--project <path>', 'Tao project folder to open.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--artifact-root <path>', 'Where the canary writes its artifacts.')
    .option('--hutch <path>', 'Explicit Hutch executable path.')
    .action(
      async (options: { app?: string; artifactRoot?: string; hutch?: string; project?: string } = {}) => {
        const { StudioCanaryCommand } = await import('./studio/StudioCanaryCommand')
        Platform.runtimeProcess.exit(
          await StudioCanaryCommand.canary({
            appName: options.app,
            artifactRoot: options.artifactRoot,
            hutchPath: options.hutch,
            projectRoot: options.project,
          }),
        )
      },
    )

  commands
    .command('studio-manual-checks')
    .description('Run native Studio checks that require a person and record their results.')
    .option('--project <path>', 'Tao project folder to open.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--artifact-root <path>', 'Where the manual workflow writes its artifacts.')
    .option('--hutch <path>', 'Explicit Hutch executable path.')
    .action(
      async (options: { app?: string; artifactRoot?: string; hutch?: string; project?: string } = {}) => {
        try {
          const { StudioManualChecks } = await import('./studio/StudioManualChecks')
          Platform.runtimeProcess.exit(
            await StudioManualChecks.run({
              appName: options.app,
              artifactRoot: options.artifactRoot,
              hutchPath: options.hutch,
              projectRoot: options.project,
            }),
          )
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.exit(1)
        }
      },
    )

  commands
    .command('studio-release-check')
    .description('Validate a built native Studio release without publishing anything.')
    .requiredOption('--payload-root <path>', 'Staged service payload directory.')
    .requiredOption('--artifacts-root <path>', 'Directory the build wrote its artifacts into.')
    .option('--app <path>', 'Built .app bundle, for signature and notarization checks.')
    .option('--dmg <path>', 'Built disk image, for the mount check.')
    .option('--release-base-url <url>', 'The HTTPS host installed copies fetch updates from.')
    .option('--allow-unverified', 'Succeed even when a gate could not be checked on this machine.')
    .action(
      async (
        options: {
          allowUnverified?: boolean
          app?: string
          artifactsRoot: string
          dmg?: string
          payloadRoot: string
          releaseBaseUrl?: string
        },
      ) => {
        const { StudioCanaryCommand } = await import('./studio/StudioCanaryCommand')
        Platform.runtimeProcess.exit(
          await StudioCanaryCommand.releaseCheck({
            allowUnverified: options.allowUnverified === true,
            appPath: options.app,
            artifactsRoot: options.artifactsRoot,
            diskImagePath: options.dmg,
            payloadRoot: options.payloadRoot,
            releaseBaseUrl: options.releaseBaseUrl,
          }),
        )
      },
    )

  commands
    .command('studio-ps')
    .description('List recorded Tao Studio launches and whether each is still live.')
    .option('--json', 'Print a versioned structured listing.')
    .action(async (options: { json?: boolean } = {}) => {
      const { StudioLifecycleCommand } = await import('./studio/StudioLifecycleCommand')
      Platform.runtimeProcess.exit(await StudioLifecycleCommand.ps({ json: options.json === true }))
    })

  commands
    .command('studio-stop')
    .description('Stop the processes a recorded Tao Studio launch owns.')
    .option('--launch <id>', 'Stop only the launch with this id.')
    .option('--all', 'Stop every recorded launch.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { all?: boolean; json?: boolean; launch?: string } = {}) => {
      const { StudioLifecycleCommand } = await import('./studio/StudioLifecycleCommand')
      Platform.runtimeProcess.exit(await StudioLifecycleCommand.stop(options))
    })

  commands
    .command('studio-doctor')
    .description('Diagnose Tao Studio on top of the repository doctor, without changing anything.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { json?: boolean } = {}) => {
      const { StudioLifecycleCommand } = await import('./studio/StudioLifecycleCommand')
      Platform.runtimeProcess.exit(await StudioLifecycleCommand.doctor({ json: options.json === true }))
    })

  commands
    .command('studio-companion-install')
    .description('Build and install the Tao Companion development build on an iPhone, iPad, or iOS simulator.')
    .option('--device <name>', 'The device name as Finder and Xcode show it.')
    .option('--simulator [name]', 'An iOS simulator name or UDID; the booted one by default.')
    .action(async (options: { device?: string; simulator?: boolean | string }) => {
      try {
        if (options.device !== undefined && options.simulator !== undefined) {
          Errors.throwUserInput('Install on one target at a time: pass --device or --simulator, not both.')
        }
        if (options.simulator !== undefined) {
          const { runStudioCompanionInstallOnSimulator } = await import('./studio/StudioCompanionSimulator')
          const name = typeof options.simulator === 'string' ? options.simulator : ''
          Platform.runtimeProcess.exit(await runStudioCompanionInstallOnSimulator({ name }))
        }
        if (options.device === undefined) {
          Errors.throwUserInput('Name the target: --device <name> for an iPhone or iPad, or --simulator [name].')
        }
        const { runStudioCompanionInstall } = await import('./studio/StudioCompanionDevice')
        Platform.runtimeProcess.exit(await runStudioCompanionInstall({ deviceName: options.device }))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('studio-native')
    .description(
      'Launch Tao Studio in its local Electrobun shell. When another session holds the native host, offers to stop it and proceed.',
    )
    .argument('[project]', 'Tao project folder.', '.')
    .option('--entry <path>', 'Entry Tao file within the selected project.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--host <hostname>', 'Studio server hostname.', '127.0.0.1')
    .option('--port <port>', 'Studio server port; defaults to an available port.')
    .option('--artifact-root <path>', 'Generated Electrobun project and runtime artifact root.')
    .option('--hutch <path>', 'Explicit Hutch executable path.', 'hutch')
    .option('--no-browser', 'Open the Welcome window only, with no extra project window.')
    .option('--json', 'Print a machine-readable readiness payload once Studio answers.')
    .action(async (project, options) => {
      const { runStudioDev } = await import('./studio/StudioDev')
      Platform.runtimeProcess.exit(
        await runStudioDev({
          appName: options.app,
          browser: options.browser,
          entryPath: options.entry,
          hostname: options.host,
          json: options.json === true,
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
        const { StudioNative } = await import('./studio/StudioNative')
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
    .option(
      '--shard <index>',
      "Zero-based smoke port block. Defaults to this worktree's own block, then the first free one.",
    )
    .option('--worker <index>', 'Zero-based worker index.', '0')
    .option('--native', 'Run the shell smoke through Electrobun instead of Chrome.')
    .action(async (files, options) => {
      const { StudioSmoke } = await import('./studio/StudioSmoke')
      Platform.runtimeProcess.exit(
        await StudioSmoke.run({
          files,
          native: options.native,
          runId: options.runId,
          shardIndex: options.shard === undefined ? undefined : parseNonNegativeInteger(options.shard, '--shard'),
          workerIndex: parseNonNegativeInteger(options.worker, '--worker'),
        }),
      )
    })

  commands
    .command('android-emulator')
    .description('Ensure an Android emulator exists and is booted.')
    .action(async () => {
      const { ExpoRunner } = await import('./expo-dev-loop/expo-runner/ExpoRunner')
      await ExpoRunner.ensureAndroidEmulator()
    })

  commands
    .command('android-expo-go')
    .description('Ensure Expo Go is installed on the booted Android emulator.')
    .action(async () => {
      const { ExpoRunner } = await import('./expo-dev-loop/expo-runner/ExpoRunner')
      await ExpoRunner.ensureAndroidExpoGo()
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      const { ExpoRunner } = await import('./expo-dev-loop/expo-runner/ExpoRunner')
      await ExpoRunner.startExpo()
    })
})

function testRunOptions(options: TestCommandOptions) {
  return {
    jobs: parseOptionalPositiveInteger(options.jobs, '--jobs'),
    outputMode: WorkReporter.resolveMode({ requested: options.output }),
  }
}

async function runExitCommand(run: () => Promise<number>): Promise<void> {
  try {
    Platform.runtimeProcess.exit(await run())
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  Errors.throwUserInput(`${label} must be a positive integer.`)
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
