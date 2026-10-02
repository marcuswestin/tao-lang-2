import { runWithCommands } from '@cli-kit/RunWithCommands'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { DeveloperBranchCommand, SyncMainCommand } from '@verification/DeveloperWorkflow'
import { FinalizeCommand, LandCommand, MergeMainCommand, StartBranchCommand } from '@verification/Finalize'
import { GateCatalog } from '@verification/GateCatalog'
import { runGates } from '@verification/GateRunner'
import { GreenTree } from '@verification/GreenTree'
import { LandingLock } from '@verification/LandingLock'
import { landedReport, MergeWithMainCommand } from '@verification/MergeWithMain'
import { formatGateSummary, formatVerdict, gateExitCode } from '@verification/RunSummary'
import { TestRunner } from '@verification/TestRunner'
import { UiVisibility } from '@verification/UiVisibility'
import { VerificationLanes } from '@verification/VerificationLanes'
import { WorkReporter } from '@verification/WorkReporter'
import { CleanCommand } from './clean/CleanCommand'
import { devZshCompletion } from './completion/DevCompletion'
import { readAgentCapabilities, unavailableLandingCapabilities } from './doctor/AgentCapabilities'
import { AgentCapabilitiesCommand } from './doctor/AgentCapabilitiesCommand'
import { BoardCommand } from './doctor/BoardCommand'
import { MyStatusCommand } from './doctor/MyStatusCommand'
import { ReclaimCommand } from './doctor/ReclaimCommand'
import { RepositoryDoctorCommand } from './doctor/RepositoryDoctorCommand'
import { MergeRecovery } from './git/MergeRecovery'
import { OpenPrCommand } from './pr/OpenPrCommand'

/*
 * Studio and Expo command modules load lazily inside their actions. Studio reaches the generated
 * parser through `@studio`, so a static import here would make `gates`, `test`, `doctor`, and
 * `agent-config` unstartable in a checkout that has never generated it — before the graph that
 * generates it can run — and would turn any top-level fault in Studio code into a failure of the
 * gate runner itself. `devLazyStudioImportIssues` in `packages/testing/verification`'s `repo-lint.ts`
 * enforces this.
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
  showStudio?: boolean
  /**
   * Commander reads `--no-cache` as the negation of a `cache` option that defaults to true, so the
   * flag arrives here as `cache === false` rather than as a positive field of its own.
   */
  cache?: boolean
  greenTree?: string[]
  jobs?: string
  json?: string
  lane?: string
  output?: string
  skipUnsandboxed?: boolean
  skipped?: string[]
}

type LandCommandOptions = {
  showStudio?: boolean
  dryRun?: boolean
  messageFile?: string
  redraft?: boolean
  skipVerify?: boolean
  skipVerifyFull?: boolean
}

type MergeCommandOptions = {
  showStudio?: boolean
  abort?: string
  dryRun?: boolean
  messageFile?: string
  skipAll?: boolean
  skipVerify?: boolean
  skipVerifyFull?: boolean
}

/** Help shared by every command that runs a work graph, so the modes are described once. */
const OUTPUT_OPTION_HELP = 'Output mode: tui, lines, or quiet. Defaults to tui on a terminal and quiet in a pipe.'

async function runReleaseAction(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

/** Repository development CLI behind `./dev`: package tests and low-level Expo device preparation. */
await runWithCommands(commands => {
  commands.name('dev')

  commands
    .command('shell-setup')
    .description('Offer automatic development environments for this repository and its worktrees.')
    .option('--configure', 'Ask again even when this repository already has a saved choice.')
    .option('--prepare', 'Warm this checkout’s environment when automatic activation is already enabled.')
    .action(async (options: { configure?: boolean; prepare?: boolean }) => {
      const { runDirenvSetup } = await import('./shell/DirenvSetup')
      await runDirenvSetup(options)
    })

  commands
    .command('completion')
    .description('Print completion generated from the registered dev commands.')
    .argument('<shell>', 'zsh')
    .action((shell: string) => {
      if (shell !== 'zsh') {
        HCI.writeErrorLine(`Unsupported completion shell: ${shell}. Use zsh.`)
        Platform.runtimeProcess.exit(2)
      }
      HCI.write(devZshCompletion(commands))
    })

  commands
    .command('app-dev')
    .description('Run the agent dev loop with reserved iOS/Android devices and owned Chrome.')
    .argument(
      '[args...]',
      'Arguments for tao dev; --show-simulator, --show-emulator, or --show-browser requests a window.',
    )
    .allowUnknownOption()
    .action(async (args: string[]) => {
      await runExitCommand(async () => {
        const { runAgentAppDev } = await import('./simulators/AgentAppDev')
        return await runAgentAppDev(args)
      })
    })

  commands
    .command('dev-loop')
    .description('Manage recorded background app development loops without a runtime timer.')
    .argument('[args...]', 'start, status, logs, stop, restart, or reload; use --help for options.')
    .allowUnknownOption()
    .action(async (args: string[]) => {
      await runExitCommand(async () => {
        const { runDevLoopCommand } = await import('./dev-loop/DevLoopCommand')
        return await runDevLoopCommand(args)
      })
    })

  commands
    .command('test-host')
    .description('Run the opt-in real-host testing prototype, independently of existing suites.')
    .argument(
      '[mode]',
      'check, lint, typecheck, format, driver, prepare, export, browser, android, ios, device, watchos, catalyst, agents, or setup.',
      'check',
    )
    .option(
      '--app <subject>',
      'Explicit subject: hnreader, clockwork, native-navigation, native-bridge, or watchhello (watchos only).',
      'hnreader',
    )
    .option('--device <id>', 'Explicit simulator or physical-device identifier.')
    .option(
      '--developer-dir <path>',
      'Task-scoped Xcode Contents/Developer directory for ios, device, watchos, or catalyst.',
    )
    .option('--output <path>', 'For ios: retain the built app and provenance in a new directory for manual review.')
    .option('--build-only', 'For ios: build and install for manual review without running or claiming an Appium proof.')
    .option('--seed <seed>', 'Unsigned 32-bit deterministic application seed.', '12345')
    .option('--browser-channel <name>', 'Installed browser channel (chrome), or chromium after setup.', 'chrome')
    .option('--fault', 'Inject a subject application fault for a compiled host journey; expected to exit nonzero.')
    .option('--demo', 'For agents: build the example, print discovery, invoke one command, then stop.')
    .action(async (mode, options) => {
      if (mode === 'watchos') {
        const { runWatchProof } = await import('./watchos/WatchProof')
        await runWatchProof(options)
        return
      }
      if (mode === 'agents') {
        if (options.demo) {
          await CLI.mustRun('just', { args: ['agents-demo'], cwd: Repo.getRoot(), stdio: 'inherit' })
          return
        }
        const { proveDesktopAgent } = await import('@expo-host/desktop-agent-proof')
        await proveDesktopAgent()
        return
      }
      const { runHostTesting } = await import('@e2e-testing')
      await runHostTesting(mode, options)
    })

  commands
    .command('test')
    .description('Run package tests in parallel.')
    .argument('[pattern]', 'Optional test name pattern.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (pattern = '', options: TestCommandOptions = {}) => {
      // `test-all` schedules every suite in the repository, which is the breadth the landing lock
      // exists to serialize. A name pattern filters which tests run inside those suites rather than
      // narrowing the set of suites scheduled, so it is locked too; `test-file` is the narrow one.
      await runExitCommand(async () =>
        await holdingLandingLock('test-all', async () => await TestRunner.runTests(pattern, testRunOptions(options)))
      )
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
    .command('test-mutation')
    .description('Run deliberate mutation checks without retries, flake tolerance or ordinary evidence updates.')
    .argument('<path>', 'Repository-relative test file, or a directory whose test files all run.')
    .option('--output <mode>', OUTPUT_OPTION_HELP)
    .option('--jobs <count>', 'Maximum number of test suites to run in parallel.')
    .action(async (path: string, options: TestCommandOptions = {}) => {
      await runExitCommand(() => TestRunner.runTestMutation(path, testRunOptions(options)))
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
    .command('land')
    .option('--show-studio', 'Permit native Studio windows during landing verification.')
    .description('Land this feature branch: prepare unlocked, then integrate, verify, squash and push under one lock.')
    .option('--dry-run', 'Report readiness and the plan, and change nothing.')
    .option('--message-file <path>', 'Must name the canonical .artifacts/merge/<branch>.msg file.')
    .option('--redraft', 'Replace an existing merge message with a fresh mechanical draft before landing.')
    .option('--skip-verify', 'Skip the staged-squash just verify --complete pass.')
    .option('--skip-verify-full', 'Skip just verify-full; the staged squash then gets just verify --complete.')
    .action(async (options: LandCommandOptions = {}) => {
      try {
        if (options.showStudio === true && options.dryRun !== true && options.skipVerifyFull !== true) {
          UiVisibility.warn(UiVisibility.studioWarnings)
        }
        if (options.dryRun !== true && options.skipVerifyFull !== true) {
          const host = await readAgentCapabilities()
          const missing = unavailableLandingCapabilities(host)
          if (missing.length > 0) {
            Errors.throwHostEnvironment(
              'Landing needs a host-capable unsandboxed shell before entering the ready queue. '
                + missing.map(check => `${check.name}: ${check.detail}. `).join('')
                + 'Run `./agent capabilities` for details, then run `./agent land` in an approved '
                + 'unsandboxed session. Do not retry the host gate inside this sandbox.',
            )
          }
        }
        await LandCommand.run({
          showStudio: options.showStudio,
          dryRun: options.dryRun === true,
          messageFile: options.messageFile,
          redraft: options.redraft === true,
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
    .command('land-lock')
    // Demoted deliberately. It was part of the normal path while a landing was a chain of commands
    // that had to keep one lock between them; `land` now holds the lock across the whole
    // transaction in one process, so claiming it by hand is for recovery and for looking at the
    // machine, not for landing.
    .description('Recovery and debugging: claim the machine-wide landing lock by hand and exit holding it.')
    .option('--label <text>', 'What to tell other agents this lock is being held for.')
    .option('--no-wait', 'Refuse immediately instead of waiting when another worktree holds it.')
    .action(async (options: { label?: string; wait?: boolean } = {}) => {
      await runExitCommand(async () => {
        const repositoryRoot = Repo.getRoot()
        const hold = await LandingLock.acquire({
          durable: true,
          label: options.label ?? `landing from ${FS.basename(repositoryRoot)}`,
          onWaiting: (holder, waitedMs) => {
            HCI.writeErrorLine(LandingLock.describeWaiting(holder, waitedMs))
          },
          repositoryRoot,
          ...(options.wait === false ? { waitTimeoutMs: 0 } : {}),
        })
        HCI.writeLine(
          hold.acquired
            ? `PASS  Landing lock held for ${repositoryRoot}. Release it with ./dev land-unlock.`
            : `PASS  This worktree already held the landing lock, since ${hold.record.acquiredAt}.`,
        )
        return 0
      })
    })

  commands
    .command('land-unlock')
    .description('Release the machine-wide landing lock this worktree holds.')
    .option('--force', 'Release it even when another worktree holds it, after confirming that landing has stopped.')
    .option(
      '--holder <pid>',
      'The PID a held record must belong to, as printed by the waiter message; required with --force '
        + 'against a readable, held record.',
    )
    .action(async (options: { force?: boolean; holder?: string } = {}) => {
      await runExitCommand(async () => {
        if (options.force === true) {
          // Breaking somebody else's lock is the one destructive act this command can perform, and
          // the safety argument for never expiring a lock only holds if breaking one is deliberate.
          const state = await LandingLock.inspectState()
          if (state.kind === 'held' && HCI.isInteractive()) {
            const confirmed = await HCI.askConfirm({
              defaultValue: false,
              message:
                `The landing lock is held by ${
                  LandingLock.describe(state.record)
                }. Breaking it while that landing is still running lets two agents move main at once. `
                + 'Has it really stopped?',
            })
            if (!confirmed) {
              HCI.writeLine('PASS  Left the landing lock alone.')
              return 0
            }
          }
          const previous = await LandingLock.forceRelease(undefined, {
            holder: parseOptionalPositiveInteger(options.holder, '--holder'),
          })
          HCI.writeLine(
            previous === undefined
              ? 'PASS  The landing lock was already free or unreadable; it is clear now.'
              : `PASS  Force-released the landing lock held by ${LandingLock.describe(previous)}.`,
          )
          return 0
        }
        const outcome = await LandingLock.release({ repositoryRoot: Repo.getRoot() })
        HCI.writeLine(
          outcome === 'released'
            ? 'PASS  Released the landing lock.'
            : outcome === 'still-held'
            ? "PASS  Ended this worktree's claim; the lock stays held until the commands still running under it finish."
            : 'PASS  This worktree did not hold the landing lock; nothing to release.',
        )
        return 0
      })
    })

  commands
    .command('gates')
    .option('--show-studio', 'Permit selected native Studio tests to open windows.')
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
    .option('--no-cache', 'Ignore recorded green trees and run every gate.')
    // Through `runExitCommand` because a lane can now decline before it starts: a run refused for
    // want of the machine is an expected answer, and it owes the reader one sentence rather than an
    // uncaught stack with a code frame from inside the error helper.
    .action(async (gates: string[], options: GatesCommandOptions = {}) => {
      await runExitCommand(async () => {
        UiVisibility.preflightGates(
          options.skipUnsandboxed === true
            ? gates.filter(name => GateCatalog.metadata(name).requiresUnsandboxed !== true)
            : gates,
          options.showStudio,
        )
        // Keep this process-wide change at the CLI boundary, not in the reusable gate runner.
        // Gate children inherit it; the invoking shell and landing process keep their priority.
        if (VerificationLanes.VERIFY_OR_WIDER.includes(options.lane ?? VerificationLanes.VERIFY)) {
          try {
            Platform.lowerProcessPriority()
          } catch (error) {
            HCI.logProcessWarn('verify', `${Errors.formatForUser(error)} Continuing at inherited priority.`)
          }
        }
        const outputMode = WorkReporter.resolveMode({ requested: options.output })
        const verdict = { color: WorkReporter.colorizes(outputMode) }
        return await holdingLandingLock(options.lane ?? 'verify', async () => {
          const summary = await runGates({
            showStudio: options.showStudio,
            gates,
            greenTree: options.greenTree === undefined || options.greenTree.length === 0
              ? undefined
              : { lanes: options.greenTree, noCache: options.cache === false },
            jobs: parseOptionalPositiveInteger(options.jobs, '--jobs'),
            jsonPath: options.json,
            lane: options.lane,
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
    })

  commands
    .command('merge-with-main')
    .option('--show-studio', 'Permit native Studio windows during full verification.')
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
          showStudio: options.showStudio,
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
    .command('my-branch')
    .argument('[name]', 'Branch name or suffix; defaults to $TAO_DEV_BRANCH, then your Git identity.')
    .description('Switch this checkout to your own dev/* branch, creating it from main the first time.')
    .action(async (name = '') => {
      try {
        await DeveloperBranchCommand.run(name)
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('my-status')
    .description('Show this checkout’s branch, changes, verification, and next step without changing anything.')
    .action(async () => {
      Platform.runtimeProcess.exit(await MyStatusCommand.run())
    })

  commands
    .command('sync-main')
    .description('Fast-forward main, move the mirrors that follow it, and merge it into this branch.')
    .action(async () => {
      try {
        const outcome = await SyncMainCommand.run()
        Platform.runtimeProcess.exit(outcome.conflicted ? 1 : 0)
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
    .option('--fresh', 'Ignore the recorded finalize state.')
    .option('--redraft', 'Replace an existing merge message with a fresh mechanical draft.')
    .action(async (options: { check?: boolean; fresh?: boolean; redraft?: boolean } = {}) => {
      try {
        const outcome = await FinalizeCommand.run({
          check: options.check === true,
          fresh: options.fresh === true,
          redraft: options.redraft === true,
        })
        Platform.runtimeProcess.exit(outcome.ok ? 0 : 1)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('merge-main')
    .description('Merge current main into this feature branch, and nothing else; no lane, no merge message.')
    .option('--stash', 'Save tracked and untracked work, restore after merging, and retain the backup stash.')
    .option('--keep-stashed', 'With --stash, leave saved work unapplied for selective interrupted-checkout recovery.')
    .action(async (options: { stash?: boolean; keepStashed?: boolean }) => {
      try {
        await MergeMainCommand.run(options)
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('merge-recover')
    .description('Abort an in-progress merge, or explicitly reset a partial merge to ORIG_HEAD on the host.')
    .option('--reset-to <sha>', 'Full pre-merge commit SHA; required when Git left no MERGE_HEAD.')
    .option('--hard', 'Discard tracked worktree changes if git reset --merge cannot recover them.')
    .action(async (options: { hard?: boolean; resetTo?: string } = {}) => {
      try {
        await MergeRecovery.run(options)
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('start-branch')
    .description('Start a new feat/* branch at fetched origin/main after checking every checkout write.')
    .argument('<name>', 'Full feat/* branch name.')
    .action(async (name: string) => {
      try {
        await StartBranchCommand.run(name)
        Platform.runtimeProcess.exit(0)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('capabilities')
    .description('Report host capabilities.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { json?: boolean } = {}) => {
      Platform.runtimeProcess.exit(await AgentCapabilitiesCommand.run({ json: options.json === true }))
    })

  commands
    .command('watchman')
    .description('Manage the shared per-user Watchman daemon; stop affects every worktree.')
    .argument('<action>', 'start, status, or stop')
    .action(async (action: string) => {
      const { WatchmanCommand } = await import('./doctor/WatchmanCommand')
      await runExitCommand(() => WatchmanCommand.run(action))
    })

  commands
    .command('storage')
    .description(
      'Sync the storage submodule, record a QA screenshot run into it, push it, or pin the commit this repository records.',
    )
    .argument('<action>', 'sync, qa, push, or pin')
    .argument(
      '[paths...]',
      'Tao project directories to capture as one commit (default: the reference apps and starters, with --studio).',
    )
    .option('--app <names>', 'Capture only these apps (default: every app in the project).', repeatedOption)
    .option('--scenario <selector>', 'Capture only matching scenarios; see `tao _preview qa --help`.', repeatedOption)
    .option('--device <names>', 'Devices: phone, tablet, laptop (default: all).', repeatedOption)
    .option('--appearance <names>', 'Appearances: light, dark (default: both).', repeatedOption)
    .option('--studio', "Also capture Studio's own layouts, once, on the first project.")
    .option('--note <text>', 'Why this capture was taken; shown in the timeline.')
    .action(async (
      action: string,
      paths: string[],
      options: {
        app?: string[]
        appearance?: string[]
        device?: string[]
        note?: string
        scenario?: string[]
        studio?: boolean
      },
    ) => {
      const { Storage } = await import('./git/Storage')
      await runExitCommand(() => Storage.run(action, paths, options))
    })

  commands
    .command('delegation-report')
    .description('Summarise which subagents this repository spawned, at which model, and for how long.')
    .option('--json', 'Print the structured summary instead of a table.')
    .action(async (options: { json?: boolean } = {}) => {
      const { DelegationReportCommand } = await import('@agent-cli/delegation/DelegationReportCommand')
      Platform.runtimeProcess.exit(await DelegationReportCommand.run({ json: options.json === true }))
    })

  commands
    .command('model-audit')
    .description('Report where the delegation routing table lags the models this machine runs, and measure context.')
    .option('--days <count>', 'How many days of transcripts to read.', '7')
    .option('--until <time>', 'End the window here instead of now, to measure the period before a change.')
    .option('--json', 'Print the structured report instead of prose.')
    .option('--brief', 'Print one line only when routing looks behind, over the last day; silent otherwise.')
    .action(async (options: { brief?: boolean; days?: string; json?: boolean; until?: string } = {}) => {
      const { ModelAuditCommand } = await import('@agent-cli/delegation/ModelAuditCommand')
      Platform.runtimeProcess.exit(
        await ModelAuditCommand.run({
          brief: options.brief === true,
          days: parseOptionalPositiveInteger(options.days, '--days'),
          json: options.json === true,
          until: options.until,
        }),
      )
    })

  commands
    .command('simplify-audit')
    .description('Measure what a simplification pass targets: size, dispatch chains, allowlists, instructions, docs.')
    .option('--json', 'Print the full structured report instead of the summary tables.')
    .action(async (options: { json?: boolean } = {}) => {
      // Loaded lazily: the audit counts `repo-lint`'s allowlists, and `repo-lint` reaches `@studio`.
      const { SimplifyAuditCommand } = await import('@verification/simplify-audit/SimplifyAuditCommand')
      Platform.runtimeProcess.exit(await SimplifyAuditCommand.run({ json: options.json === true }))
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
    .command('setup-ios')
    .description('Inspect or install a requested side-by-side Xcode and iOS Simulator runtime.')
    .requiredOption('--xcode-version <version>', 'The explicit Xcode version to use, such as 27.1.')
    .requiredOption('--runtime-version <version>', 'The explicit iOS Simulator runtime version, such as 27.1.')
    .option('--archive <path>', 'Override automatic detection of the requested Xcode .xip in Downloads.')
    .option('--apply', 'Install requested components; in a terminal, wait for missing Xcode downloads and resume.')
    .option('--json', 'Print the structured setup report.')
    .action(async (options) => {
      const { IosSetupCommand } = await import('./ios-setup/IosSetupCommand')
      await runExitCommand(() => IosSetupCommand.run(options))
    })

  commands
    .command('setup-watchos [project]')
    .description('Guide Apple Watch setup; install the simulator runtime, export, build and run a Tao app.')
    .requiredOption('--xcode-version <version>', 'The Xcode version to reuse or install, such as 27.0.')
    .option('--runtime-version <version>', 'Exact watchOS Simulator runtime; required for simulator setup.')
    .option('--archive <path>', 'Select a local Xcode .xip when the requested version is not installed.')
    .option('--physical', 'Guide physical-watch pairing and signing instead of simulator setup.')
    .option('--device <identifier>', 'Choose an Apple Watch simulator by UUID.')
    .option('--apply', 'Install missing components, export the project, and run it on an available simulator.')
    .option('--json', 'Print a structured report without interactive prompts.')
    .action(async (project: string | undefined, options) => {
      const { WatchosSetupCommand } = await import('./watchos-setup/WatchosSetupCommand')
      await runExitCommand(() => WatchosSetupCommand.run({ ...options, project: project ?? 'Apps/WatchHello' }))
    })

  commands
    .command('setup-visionos [project]')
    .description('Guide Vision Pro setup, pairing, signing, build, installation and launch; inspect by default.')
    .requiredOption('--xcode-version <version>', 'The explicit Xcode version to reuse or install, such as 27.0.')
    .option('--archive <path>', 'Override automatic detection of the requested Xcode .xip in Downloads.')
    .option('--simulator', 'Set up an optional simulator instead of a physical headset; no signing team needed.')
    .option('--runtime-version <version>', 'Exact visionOS Simulator runtime; required only with --simulator.')
    .option('--device <identifier>', 'Choose a physical headset or simulator from the inspected inventory.')
    .option('--team <identifier>', 'Your ten-character Apple development team ID for headset signing.')
    .option('--bundle-id <identifier>', 'Your app bundle identifier; required for physical-device signing.')
    .option('--apply', 'Install missing components, guide personal steps, then build, install and launch the app.')
    .option('--json', 'Print a structured report without interactive prompts.')
    .action(async (project: string | undefined, options) => {
      const { VisionosSetupCommand } = await import('./visionos-setup/VisionosSetupCommand')
      await runExitCommand(() => VisionosSetupCommand.run({ ...options, project: project ?? 'Apps/VisionHello' }))
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
    .command('landed [branch]')
    .description(
      "Report whether a branch landed, by the archive ref the landing pushes; defaults to this worktree's branch.",
    )
    .action(async (branch?: string) => {
      const report = await landedReport(branch)
      HCI.writeLine(
        report.landed
          ? `${report.branch} landed; archived as ${report.archive}.`
          : `${report.branch} has not landed: no ${report.archive} on origin as of this fetch.`,
      )
      Platform.runtimeProcess.setExitCode(report.landed ? 0 : 1)
    })

  commands
    .command('open-pr')
    .description(
      'Push this feature branch, open or reuse its pull request against main, then stream the checks opening it starts.',
    )
    .option('--poll-interval-ms <ms>', 'How often to poll checks when this gh has no `--watch` flag.')
    .action(async (options: { pollIntervalMs?: string } = {}) => {
      await runExitCommand(async () =>
        (await OpenPrCommand.run({
          pollIntervalMs: parseOptionalPositiveInteger(options.pollIntervalMs, '--poll-interval-ms'),
        })).exitCode
      )
    })

  commands
    .command('reclaim')
    .description(
      'Classify every worktree as reclaimable, live, or unclassified, with the evidence; removes nothing without --execute.',
    )
    .option('--execute', 'Remove the reclaimable worktrees, re-checking each one for liveness as it acts.')
    .option('--json', 'Print a versioned structured report instead of the table.')
    .option('--report-json', 'Print a versioned structured report through ./agent instead of the table.')
    .action(async (options: { execute?: boolean; json?: boolean; reportJson?: boolean } = {}) => {
      Platform.runtimeProcess.exit(
        await ReclaimCommand.run({
          execute: options.execute === true,
          json: options.json === true || options.reportJson === true,
        }),
      )
    })

  commands
    .command('worktree-status')
    .description('Report every Git worktree and its latest matching Codex, Claude, or Cursor task; removes nothing.')
    .action(async () => Platform.runtimeProcess.exit(await ReclaimCommand.status()))

  commands
    .command('setup-clerk')
    .description('Guide Clerk development setup and save credentials in the encrypted repository store.')
    .option('--instructions', 'Print setup steps without opening a browser or changing credentials.')
    .action(async (options: { instructions?: boolean }) => {
      const { runSetupClerk } = await import('./clerk/SetupClerkCommand')
      try {
        Platform.runtimeProcess.exit(await runSetupClerk(options))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('clerk-review')
    .description('Run Clerk and local InstantDB in Studio for a connected iPhone review.')
    .option(
      '--device <name-or-udid>',
      'Launch on this connected iPhone or iPad and pair in Terminal without opening a browser.',
    )
    .option('--host <ipv4>', 'The Mac LAN IPv4 address reachable from the phone; detected when omitted.')
    .option('--instant-url <origin>', 'Local InstantDB API origin.', 'http://127.0.0.1:9020')
    .option('--no-browser', 'Start Studio without opening the Mac browser.')
    .action(async (options: { host?: string; instantUrl?: string; browser?: boolean; device?: string }) => {
      const { runClerkReview } = await import('./clerk/ClerkReviewCommand')
      try {
        Platform.runtimeProcess.exit(await runClerkReview(options))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('instant-review')
    .description(
      'Push Auth Review to the stored Instant Cloud app, then run it in tao dev from a disposable copy.',
    )
    .option('--device <name-or-id>', 'Open this physical device after Metro starts.')
    .option('--ios', 'Open an iOS simulator after Metro starts.')
    .option('--web', 'Open the web app after Metro starts.')
    .option('--dry-run', 'Print what the push would change, apply nothing, and start no dev loop.')
    .option('--skip-push', 'Start the dev loop without pushing the schema and rules.')
    .option('--force', 'Push a plan that is not purely additive, leaving undeclared attributes on the app.')
    .option('--clerk', 'Run the variant signed in through Clerk, with the stored Clerk publishable key.')
    .action(
      async (
        options: {
          clerk?: boolean
          device?: string
          ios?: boolean
          web?: boolean
          dryRun?: boolean
          force?: boolean
          skipPush?: boolean
        },
      ) => {
        const { runInstantReview } = await import('./instantdb/InstantReviewCommand')
        try {
          Platform.runtimeProcess.exit(await runInstantReview(options))
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.exit(1)
        }
      },
    )

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
        const { AgentConfigGenerator } = await import('@agent-cli/agent-config/AgentConfigGenerator')
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
      const { runStudioDev } = await import('@studio-tooling/StudioDev')
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
    .option('--show-studio', 'Permit native Studio windows for this canary.')
    .description('Run native Tao Studio against a deterministic project and report what it proved.')
    .option('--project <path>', 'Tao project folder to open.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--artifact-root <path>', 'Where the canary writes its artifacts.')
    .option('--hutch <path>', 'Explicit Hutch executable path.')
    .action(
      async (
        options: { app?: string; artifactRoot?: string; hutch?: string; project?: string; showStudio?: boolean } = {},
      ) => {
        const { StudioCanaryCommand } = await import('@studio-tooling/StudioCanaryCommand')
        Platform.runtimeProcess.exit(
          await StudioCanaryCommand.canary({
            showStudio: options.showStudio === true
              || Platform.runtimeProcess.env[UiVisibility.STUDIO_ENV_KEY] === 'true',
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
    .option('--show-studio', 'Permit native Studio windows and manual interaction.')
    .description('Run native Studio checks that require a person and record their results.')
    .option('--project <path>', 'Tao project folder to open.')
    .option('--app <name>', 'App declaration within the selected project.')
    .option('--artifact-root <path>', 'Where the manual workflow writes its artifacts.')
    .option('--hutch <path>', 'Explicit Hutch executable path.')
    .action(
      async (
        options: { app?: string; artifactRoot?: string; hutch?: string; project?: string; showStudio?: boolean } = {},
      ) => {
        try {
          UiVisibility.requireStudio(options.showStudio)
          UiVisibility.warn(UiVisibility.studioWarnings)
          const { StudioManualChecks } = await import('@studio-tooling/StudioManualChecks')
          Platform.runtimeProcess.exit(
            await StudioManualChecks.run({
              showStudio: options.showStudio,
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
    .option('--first-release', 'No earlier published release exists in this channel, so no patch is expected.')
    .option('--allow-unverified', 'Succeed even when a gate could not be checked on this machine.')
    .action(
      async (
        options: {
          allowUnverified?: boolean
          app?: string
          artifactsRoot: string
          dmg?: string
          firstRelease?: boolean
          payloadRoot: string
          releaseBaseUrl?: string
        },
      ) => {
        const { StudioCanaryCommand } = await import('@studio-tooling/StudioCanaryCommand')
        Platform.runtimeProcess.exit(
          await StudioCanaryCommand.releaseCheck({
            allowUnverified: options.allowUnverified === true,
            appPath: options.app,
            artifactsRoot: options.artifactsRoot,
            diskImagePath: options.dmg,
            firstRelease: options.firstRelease === true,
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
      const { StudioLifecycleCommand } = await import('@studio-tooling/StudioLifecycleCommand')
      Platform.runtimeProcess.exit(await StudioLifecycleCommand.ps({ json: options.json === true }))
    })

  commands
    .command('studio-stop')
    .description('Stop the processes a recorded Tao Studio launch owns.')
    .option('--launch <id>', 'Stop only the launch with this id.')
    .option('--all', 'Stop every recorded launch.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { all?: boolean; json?: boolean; launch?: string } = {}) => {
      const { StudioLifecycleCommand } = await import('@studio-tooling/StudioLifecycleCommand')
      Platform.runtimeProcess.exit(await StudioLifecycleCommand.stop(options))
    })

  commands
    .command('studio-doctor')
    .description('Diagnose Tao Studio on top of the repository doctor, without changing anything.')
    .option('--json', 'Print a versioned structured report.')
    .action(async (options: { json?: boolean } = {}) => {
      const { StudioLifecycleCommand } = await import('@studio-tooling/StudioLifecycleCommand')
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
          const { runStudioCompanionInstallOnSimulator } = await import('@studio-tooling/StudioCompanionSimulator')
          const name = typeof options.simulator === 'string' ? options.simulator : ''
          Platform.runtimeProcess.exit(await runStudioCompanionInstallOnSimulator({ name }))
        }
        if (options.device === undefined) {
          Errors.throwUserInput('Name the target: --device <name> for an iPhone or iPad, or --simulator [name].')
        }
        const { runStudioCompanionInstall } = await import('@studio-tooling/StudioCompanionDevice')
        Platform.runtimeProcess.exit(await runStudioCompanionInstall({ deviceName: options.device }))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('companion-host-build')
    .description(
      'Build the Tao Companion as a prebuilt host into .artifacts/hosts, which tao dev installs on an emulator or simulator in place of Expo Go.',
    )
    .option('--platform <platform>', 'android, or ios-simulator for an iOS Simulator host.', 'android')
    .option('--abi <abis>', 'Comma-separated Android ABIs to build; arm64-v8a,x86_64 by default.')
    .option('--developer-dir <path>', 'Task-scoped Xcode Contents/Developer directory for ios-simulator.')
    .action(async (options: { abi?: string; developerDir?: string; platform: string }) => {
      try {
        if (options.platform !== 'android' && options.platform !== 'ios-simulator') {
          Errors.throwUserInput(`--platform takes android or ios-simulator, not ${options.platform}.`)
        }
        const { runCompanionHostBuild } = await import('@studio-tooling/CompanionHostBuild')
        const architectures = options.abi?.split(',').map(abi => abi.trim()).filter(Boolean)
        Platform.runtimeProcess.exit(
          await runCompanionHostBuild({
            platform: options.platform,
            ...(options.developerDir === undefined ? {} : { developerDir: options.developerDir }),
            ...(architectures === undefined ? {} : { architectures }),
          }),
        )
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('companion-host-publish')
    .description(
      'Publish every host built for the Tao Companion as it stands to its GitHub release, where tao dev downloads it.',
    )
    .action(async () => {
      try {
        const { runCompanionHostPublish } = await import('@studio-tooling/CompanionHostBuild')
        Platform.runtimeProcess.exit(await runCompanionHostPublish())
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('studio-native')
    .description(
      "Launch this worktree's Tao Studio in its local Electrobun shell. When another session in this worktree holds its native host, offers to stop it and proceed.",
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
      const { runStudioDev } = await import('@studio-tooling/StudioDev')
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
    .option('--bundle-identifier <id>', 'macOS application bundle identifier.', 'com.devtao.studio')
    .option('--channel <channel>', 'Electrobun release channel: canary or stable.', 'stable')
    .option('--hutch <path>', 'Explicit Hutch executable path.', 'hutch')
    .option('--node <path>', 'Standalone Node executable to bundle; Nix Node is relocated when needed.')
    .requiredOption('--release-base-url <url>', 'HTTPS base URL for Studio release and update artifacts.')
    .option('--version <version>', 'Studio semantic version.', '0.0.1')
    .action(async options => {
      try {
        const { StudioNative } = await import('@studio-tooling/StudioNative')
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
    .command('prepare-release')
    .description('Prepare a Studio or IDE extension release locally; does not publish.')
    .argument('<target>', 'studio or ide-extension.')
    .option('--repo <owner/name>', 'Public GitHub repository for Studio release assets.')
    .option('--version <version>', 'Three-part Studio version (defaults to 0.0.1).')
    .action(async (target: string, options: { repo?: string; version?: string }) => {
      await runReleaseAction(async () => {
        const { ReleaseWorkflow } = await import('./release/ReleaseWorkflow')
        if (target === 'studio') {
          if (options.repo === undefined) {
            Errors.throwUserInput('Studio preparation needs --repo owner/name.')
          }
          await ReleaseWorkflow.prepareStudio(options.repo, options.version ?? '0.0.1')
        } else if (target === 'ide-extension') {
          if (options.repo !== undefined || options.version !== undefined) {
            Errors.throwUserInput('IDE extension preparation takes no --repo or --version.')
          }
          await ReleaseWorkflow.prepareIde()
        } else {
          Errors.throwUserInput('Expected release target studio or ide-extension.')
        }
      })
    })

  commands
    .command('release-studio-prepare')
    .description('Build and locally validate a signed Studio release for a GitHub Releases host.')
    .requiredOption('--repo <owner/name>', 'Public GitHub repository that will hold Studio releases.')
    .option('--version <version>', 'Three-part Studio version.', '0.0.1')
    .action(async (options: { repo: string; version: string }) => {
      const { ReleaseWorkflow } = await import('./release/ReleaseWorkflow')
      await runReleaseAction(async () => await ReleaseWorkflow.prepareStudio(options.repo, options.version))
    })

  commands
    .command('release-studio-publish')
    .description('Upload prepared Studio artifacts to GitHub and verify public downloads.')
    .requiredOption('--repo <owner/name>', 'Public GitHub repository that will hold Studio releases.')
    .action(async (options: { repo: string }) => {
      const { ReleaseWorkflow } = await import('./release/ReleaseWorkflow')
      await runReleaseAction(async () => await ReleaseWorkflow.publishStudio(options.repo))
    })

  commands
    .command('release-ide-prepare')
    .description('Package the VSIX and prove it installs into an isolated VS Code profile.')
    .action(async () => {
      const { ReleaseWorkflow } = await import('./release/ReleaseWorkflow')
      await runReleaseAction(async () => await ReleaseWorkflow.prepareIde())
    })

  commands
    .command('release-ide-publish')
    .description('Publish the prepared VSIX to Marketplace, Open VSX, or both.')
    .option('--target <target>', 'all, marketplace, or open-vsx.', 'all')
    .action(async (options: { target: string }) => {
      const { ReleaseWorkflow } = await import('./release/ReleaseWorkflow')
      await runReleaseAction(async () => {
        if (options.target !== 'all' && options.target !== 'marketplace' && options.target !== 'open-vsx') {
          Errors.throwUserInput('Expected --target all, marketplace, or open-vsx.')
        }
        await ReleaseWorkflow.publishIde(options.target)
      })
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
    .option('--show-studio', 'Permit native Studio windows for this smoke.')
    .action(async (files, options) => {
      const { StudioSmoke } = await import('@studio-tooling/StudioSmoke')
      Platform.runtimeProcess.exit(
        await StudioSmoke.run({
          files,
          native: options.native,
          showStudio: options.showStudio === true
            || Platform.runtimeProcess.env[UiVisibility.STUDIO_ENV_KEY] === 'true',
          runId: options.runId,
          shardIndex: options.shard === undefined ? undefined : parseNonNegativeInteger(options.shard, '--shard'),
          workerIndex: parseNonNegativeInteger(options.worker, '--worker'),
        }),
      )
    })

  commands
    .command('android-recover')
    .description('Release retained emulator fences only after their owned processes have stopped.')
    .requiredOption('--avd <name>', 'Retained Android virtual device name.')
    .requiredOption('--generation <id>', 'Recovery generation printed by failed cleanup.')
    .action(async (options: { avd: string; generation: string }) => {
      await runExitCommand(async () => {
        const { AndroidRecovery } = await import('./simulators/AndroidRecovery')
        await AndroidRecovery.recover(options.avd, options.generation)
        HCI.writeLine(`Released stopped Android emulator fences for ${options.avd}.`)
        return 0
      })
    })

  commands
    .command('android-emulator')
    .description('Ensure an Android emulator exists and is booted.')
    .action(async () => {
      const { ExpoRunner } = await import('@expo-host/dev-loop/expo-runner/ExpoRunner')
      await ExpoRunner.ensureAndroidEmulator()
    })

  commands
    .command('android-expo-go')
    .description('Ensure Expo Go is installed on the booted Android emulator.')
    .action(async () => {
      const { ExpoRunner } = await import('@expo-host/dev-loop/expo-runner/ExpoRunner')
      await ExpoRunner.ensureAndroidExpoGo()
    })

  commands
    .command('expo-android')
    .description('Start the Expo runtime and open it on the booted Android emulator.')
    .action(async () => {
      const { ExpoRunner } = await import('@expo-host/dev-loop/expo-runner/ExpoRunner')
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
 * Run a lane under the landing lock when its breadth requires one. The wait is here rather than in
 * the caller so no agent ever writes a sleep-poll loop around a lane, and the periodic warning is
 * what escalates a lock that is stuck: nothing in this path ever takes one away.
 */
async function holdingLandingLock<T>(lane: string, work: () => Promise<T>): Promise<T> {
  return await LandingLock.holdingForLane({
    lane,
    onWaiting: (holder, waitedMs) => {
      HCI.writeErrorLine(LandingLock.describeWaiting(holder, waitedMs))
    },
    repositoryRoot: Repo.getRoot(),
  }, work)
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

/** repeatedOption collects every occurrence of a repeatable option, in order. */
function repeatedOption(value: string, previous: string[] = []): string[] {
  return [...previous, value]
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
