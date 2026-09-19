import { Errors, HCI, Platform, Repo } from '@shared'
import { AgentConfigGenerator } from './agent-config/AgentConfigGenerator'
import { CleanCommand } from './clean/CleanCommand'
import { runWithCommands } from './cli/run-with-commands'
import { DelegationReportCommand } from './delegation/DelegationReportCommand'
import { AgentCapabilitiesCommand } from './doctor/AgentCapabilitiesCommand'
import { BoardCommand } from './doctor/BoardCommand'
import { RepositoryDoctorCommand } from './doctor/RepositoryDoctorCommand'
import { FinalizeCommand } from './repository-tests/Finalize'
import { runGates } from './repository-tests/GateRunner'
import { GreenTree } from './repository-tests/GreenTree'
import { MergeWithMainCommand } from './repository-tests/MergeWithMain'
import { formatGateSummary, formatVerdict, gateExitCode } from './repository-tests/RunSummary'
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

/** The changed scope composes with a name filter, so `just test "<name>"` narrows twice rather than once. */
type TestChangedCommandOptions = TestCommandOptions & {
  name?: string
}

type GatesCommandOptions = {
  /**
   * Commander reads `--no-cache` as the negation of a `cache` option that defaults to true, so the
   * flag arrives here as `cache === false` rather than as a positive field of its own.
   */
  cache?: boolean
  greenTree?: string[]
  jobs?: string
  json?: string
  lane?: string
  needsMachine?: boolean
  output?: string
  skipUnsandboxed?: boolean
  skipped?: string[]
}

type MergeCommandOptions = {
  abort?: string
  dryRun?: boolean
  messageFile?: string
  skipAll?: boolean
  skipVerify?: boolean
  skipVerifyFull?: boolean
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
    .option('--name <pattern>', 'Filter the selected suites to the tests matching this name pattern.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (reference: string | undefined, options: TestChangedCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runChangedTests(reference, options.name, testRunOptions(options)))
    })

  commands
    .command('test-file')
    .description('Run one package Bun or runtime Jest test file, or every test file under a directory.')
    .argument('<path>', 'Repository-relative test file, or a directory whose test files all run.')
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
    .option('--needs-machine', 'Refuse to start while another lane is registered on this machine.')
    .option('--skip-unsandboxed', 'Skip gates whose catalog metadata requires an unsandboxed host.')
    .option('--skipped <entry...>', 'Gates deliberately not run in this lane, as name=reason.')
    .option(
      '--green-tree <lanes...>',
      'Skip the run when the tree is already recorded green under any of these lanes; record this run under the first.',
    )
    .option('--no-cache', 'Ignore recorded green trees and run every gate.')
    // Through `runExitCommand` because a lane can now decline before it starts: a run refused for
    // want of the machine is an expected answer, and it owes the reader one sentence rather than an
    // uncaught stack with a code frame from inside the error helper.
    .action(async (gates: string[], options: GatesCommandOptions = {}) => {
      await runExitCommand(async () => {
        const outputMode = WorkReporter.resolveMode({ requested: options.output })
        const verdict = { color: WorkReporter.colorizes(outputMode) }
        const summary = await runGates({
          gates,
          greenTree: options.greenTree === undefined || options.greenTree.length === 0
            ? undefined
            : { lanes: options.greenTree, noCache: options.cache === false },
          jobs: parseOptionalPositiveInteger(options.jobs, '--jobs'),
          jsonPath: options.json,
          lane: options.lane,
          needsMachine: options.needsMachine === true,
          outputMode,
          skipUnsandboxed: options.skipUnsandboxed === true,
          skipped: options.skipped,
        })
        if (summary.greenTree !== undefined) {
          // A lane that ran nothing still states its verdict, and states it the same way: the record
          // it stood on is the explanation, the last line is the answer.
          HCI.writeLine(GreenTree.describe(summary.lane, summary.greenTree))
          HCI.writeLine(formatVerdict(summary, verdict))
          return 0
        }
        HCI.writeLine(formatGateSummary(summary, verdict))
        return gateExitCode(summary)
      })
    })

  commands
    .command('merge-with-main')
    .description('Squash-merge the current feature branch into main and push it; flags only remove work.')
    .option('--skip-verify', 'Skip the staged-squash just verify --complete pass.')
    .option(
      '--skip-verify-full',
      'Skip just verify-full on the feature branch; the staged squash then gets just verify --complete instead.',
    )
    .option('--skip-all', 'Skip every check after one confirmation that defaults to No. Needs a terminal.')
    .option('--dry-run', 'Report the plan and change nothing.')
    .option('--message-file <path>', 'Override .artifacts/merge/<branch>.msg.')
    .option('--abort <snapshot>', 'Restore command-owned local state from a pre-push snapshot.')
    .action(async (options: MergeCommandOptions = {}) => {
      try {
        await MergeWithMainCommand.run({
          abortSnapshot: options.abort,
          dryRun: options.dryRun === true,
          messageFile: options.messageFile,
          skipAll: options.skipAll === true,
          skipVerify: options.skipVerify === true,
          skipVerifyFull: options.skipVerifyFull === true,
        })
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('clean')
    .description('Remove build artifacts and installed dependencies, reporting each step and what it cost.')
    .option('--all', 'Also remove every remaining artifact and the generated native projects.')
    .action(async (options: { all?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await CleanCommand.run({ scope: options.all === true ? 'all' : 'checkout' }))
    })

  commands
    .command('finalize')
    .description('Bring a feature branch to the state where merge-with-main can run; safe to re-run.')
    .option('--check', 'Report without mutating anything: no merge, no verification lane, no file written.')
    .option('--fresh', 'Ignore the recorded finalize state and redraft the merge message.')
    .action(async (options: { check?: boolean; fresh?: boolean } = {}) => {
      try {
        const outcome = await FinalizeCommand.run({ check: options.check === true, fresh: options.fresh === true })
        Platform.runtimeProcess.exit(outcome.ok ? 0 : 1)
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
    .command('delegation-report')
    .description('Summarise which subagents this repository spawned, at which model, and for how long.')
    .option('--json', 'Print the structured summary instead of a table.')
    .action(async (options: { json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await DelegationReportCommand.run({ json: options.json === true }))
    })

  commands
    .command('doctor')
    .description('Diagnose this checkout without changing it.')
    .option('--json', 'Print a versioned structured report instead of PASS/WARN/FAIL lines.')
    .action(async (options: { json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await RepositoryDoctorCommand.run({ json: options.json === true }))
    })

  commands
    .command('board')
    .description(
      'Show every worktree, the machine-wide lane and lease registry, and whether this machine is busy, without changing anything.',
    )
    .option('--json', 'Print a versioned structured report instead of the table.')
    .action(async (options: { json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await BoardCommand.run({ json: options.json === true }))
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
    .command('native-module-check')
    .description('Compile every Tao native module for the iOS simulator in an isolated generated host.')
    .action(async () => {
      const { NativeModuleCheck } = await import('./native-module-check/NativeModuleCheck')
      Platform.runtimeProcess.exit(await NativeModuleCheck.run())
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

/**
 * runExitCommand runs one command and owns its exit code.
 *
 * An unexpected error reaches a Tao developer as the bare sentence "Something went wrong." — right
 * for a product user, useless for whoever has to find the cause, and the failure mode is that the
 * reader has no path at all: no name, no stack, and no log, because the command died before it
 * created a run directory. Two agents lost time to exactly that in one afternoon. The remedy is one
 * line naming the switch that turns the sentence back into a stack.
 */
async function runExitCommand(run: () => Promise<number>): Promise<void> {
  try {
    Platform.runtimeProcess.exit(await run())
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    if (!Errors.isTaoError(error)) {
      HCI.writeErrorLine(`Re-run with ${Errors.DEBUG_ERRORS_ENV}=1 for the error's name, cause, and stack.`)
    }
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
