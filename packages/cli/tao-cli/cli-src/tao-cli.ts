#!/usr/bin/env bun
import tab from '@bomb.sh/tab/commander'
import { Command } from '@commander-js/extra-typings'
import { Diagnostic, Errors, FS, HCI, Platform } from '@shared'
import type { Command as BaseCommand } from 'commander'
import * as DiagnosticReport from './diagnostic-report'
import type { InPlace } from './in-place-files'

type InPlaceLabels = {
  /** changed labels per-file and summary output, e.g. `formatted`. */
  changed: string
  /** changedLine prefixes per-file success lines, e.g. `Formatted`. */
  changedLine: string
  /** failedVerb names the operation in failure lines, e.g. `format`. */
  failedVerb: string
  /** failOnChanged makes changed files a command failure for check-style commands. */
  failOnChanged?: boolean
}

await runTaoCliWhenExecutedDirectly(import.meta)

type ExecutableImportMeta = ImportMeta & {
  main?: boolean
}

async function runTaoCliWhenExecutedDirectly(meta: ExecutableImportMeta): Promise<void> {
  // Bun sets import.meta.main only for directly executed modules; tests import this file without running the CLI.
  if (meta.main === true) {
    await runTaoCli()
  }
}

/** runTaoCli runs the Tao CLI for the provided argv. */
export async function runTaoCli(argv = Platform.runtimeProcess.argv): Promise<void> {
  await createCommands().parseAsync(argv, { from: 'node' })
}

function createCommands(): Command {
  const commands = new Command()
    .name('tao')
    .description('Tao language CLI.')

  commands
    .command('create')
    .argument('<description>', 'What the app is, in a sentence. URLs and image paths in it are read.')
    .option('--id <id>', 'Checked-in project id and directory name. Suggested from the name when omitted.')
    .option('--yes', 'Accept the suggested id, the plan, and the first available AI lane without asking.')
    .option('--ai <lane>', 'How to shape the plan: auto, claude, codex, ollama, apple, or none.', 'auto')
    .option('--skip-tests', "Skip running the new project's tests after creating it.")
    .description('Create a new Tao project from a description.')
    .action(async (description: string, options: { ai: string; id?: string; skipTests?: boolean; yes?: boolean }) => {
      try {
        const { createAiOptions, runCreate } = await import('./create/create-command')
        const ai = createAiOptions.find(candidate => candidate === options.ai)
        if (ai === undefined) {
          Errors.throwUserInput(`--ai must be one of ${createAiOptions.join(', ')}, not '${options.ai}'.`)
        }
        await runCreate(description, {
          ai,
          ...(options.id === undefined ? {} : { id: options.id }),
          ...(options.skipTests === true ? { runTests: false } : {}),
          ...(options.yes === true ? { yes: true } : {}),
        })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('project')
    .description('Manage checked-in Tao project metadata.')
    .command('id')
    .argument('<id>', 'Opaque project id to persist.')
    .argument('[path]', 'Project .tao file or directory to search.', '.')
    .option('--replace', 'Replace an existing id when making an independent project.')
    .description('Add or deliberately replace a project id.')
    .action(async (id: string, path: string, options: { replace?: boolean }) => {
      try {
        const { setProjectId } = await import('./project-command')
        const projectPath = await setProjectId(id, path, options)
        HCI.writeSuccess(`Project id '${id}' in ${FS.displayPath(projectPath)}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('dev')
    .argument('[path]', 'Tao file or directory whose runnable apps should be discovered.', '.')
    .option('--app <name>', 'Select a uniquely named app without prompting.')
    .description('Discover and run Tao apps on an available Expo Metro port.')
    .action(async (path: string, options: { app?: string }) => {
      try {
        // Command implementations load lazily so completion and help paths stay fast.
        const { runTaoDev } = await import('./dev-command')
        Platform.runtimeProcess.setExitCode(await runTaoDev(path, { appName: options.app }))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('review')
    .argument('[path]', 'Tao project directory to capture in Studio.', '.')
    .option('--app <name>', 'Select a named app within the project.')
    .option('--against <review>', 'Compare with an earlier review.json manifest.')
    .option('--output <directory>', 'Write the immutable review artifact to this new directory.')
    .description('Capture every Studio scenario as a portable web visual review.')
    .action(async (path: string, options: { against?: string; app?: string; output?: string }) => {
      try {
        const { runStudioReview } = await import('tao-studio-tooling/studio-review')
        const result = await runStudioReview(path, {
          against: options.against,
          appName: options.app,
          artifactRoot: options.output,
        })
        const counts = Object.entries(result.statusCounts)
          .filter(([, count]) => count > 0)
          .map(([status, count]) => `${count} ${status}`)
          .join(', ')
        HCI.writeSuccess(`Captured Tao visual review: ${FS.displayPath(result.reportPath)} (${counts})\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('compile')
    .argument('<appPath>', 'Tao app path to compile into the local runtime package.')
    .option('--app <name>', 'Select a named app when the file declares multiple apps.')
    .description('Compile a Tao app into the local runtime package.')
    .action(async (appPath: string, options: { app?: string }) => {
      try {
        const { runCompile } = await import('./compile-command')
        const compiled = await runCompile(appPath, { appName: options.app })
        HCI.writeSuccess(`Compiled ${compiled.sourcePath} -> ${compiled.outputPath}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('facts')
    .argument('<projectRoot>', 'Project directory used to resolve a relative entry path.')
    .argument('<entryPath>', 'Tao app entry file, relative to projectRoot or absolute.')
    .argument('<appName>', 'App declaration to inspect.')
    .description('Print versioned, machine-readable semantic facts for one Tao app.')
    .action(async (projectRoot: string, entryPath: string, appName: string) => {
      try {
        const { runSemanticFacts } = await import('./semantic-commands')
        HCI.writeLine(JSON.stringify(await runSemanticFacts({ appName, entryPath, projectRoot })))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('coverage')
    .argument('<projectRoot>', 'Project directory used to resolve a relative entry path.')
    .argument('<entryPath>', 'Tao app entry file, relative to projectRoot or absolute.')
    .argument('<appName>', 'App declaration to inspect.')
    .argument('<view>', 'View declaration to report.')
    .description('Print versioned, machine-readable behavior-test coverage for one Tao view.')
    .action(async (projectRoot: string, entryPath: string, appName: string, view: string) => {
      try {
        const { runSemanticCoverage } = await import('./semantic-commands')
        HCI.writeLine(JSON.stringify(await runSemanticCoverage({ appName, entryPath, projectRoot, view })))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('ship')
    .argument('[path]', 'Tao project file or directory to discover.', '.')
    .option('--app <name>', 'Select a named app instead of the project DefaultApp.')
    .option('--patch', 'Force a patch version bump.')
    .option('--minor', 'Force a minor version bump.')
    .option('--major', 'Force a major version bump.')
    .option('--yes', 'Proceed without the Y/n gate after printing the action list.')
    .option('--ignore-git', 'Allow shipping from a dirty Git working tree.')
    .option('--dry-run', 'Print precursors and the action list without mutating or contacting Apple.')
    .option('--no-wait', 'Return after upload without waiting for Apple processing.')
    .option('--notes <text>', 'Set TestFlight What to Test text instead of deriving it from Git.')
    .option('--beta [emails]', 'Distribute through TestFlight; optionally supply comma-separated recipients.')
    .option('--update', 'Publish a compatible bundle through the Tao update service.')
    .option('--rollback', 'With --update, republish the previously recorded update bundle.')
    .description('Build and ship a Tao app through App Store Connect or TestFlight.')
    .action(async (path: string, options: {
      app?: string
      beta?: boolean | string
      dryRun?: boolean
      ignoreGit?: boolean
      major?: boolean
      minor?: boolean
      wait?: boolean
      notes?: string
      patch?: boolean
      rollback?: boolean
      update?: boolean
      yes?: boolean
    }) => {
      try {
        const { runShipCommand } = await import('./ship-command')
        await runShipCommand(path, {
          appName: options.app,
          betaRecipients: parseBetaRecipients(options.beta),
          bump: shipBump(options),
          dryRun: options.dryRun,
          ignoreGit: options.ignoreGit,
          noWait: options.wait === false,
          notes: options.notes,
          rollback: options.rollback,
          update: options.update,
          yes: options.yes,
        })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('fmt')
    .argument('[paths...]', 'Tao files or directories to format. Defaults to the current directory.')
    .description('Format .tao files in place.')
    .action(async (paths: string[]) => {
      const { runFmt } = await import('./source-commands')
      await runInPlaceCommand(paths, runFmt, {
        changed: 'formatted',
        changedLine: 'Formatted',
        failedVerb: 'format',
      })
    })

  commands
    .command('fix')
    .argument('[paths...]', 'Tao files or directories to fix. Defaults to the current directory.')
    .description('Apply all Tao source fixes in place: renders last, organized use statements, formatting.')
    .action(async (paths: string[]) => {
      const { runFix } = await import('./source-commands')
      await runInPlaceCommand(paths, runFix, {
        changed: 'fixed',
        changedLine: 'Fixed',
        failedVerb: 'fix',
      })
    })

  commands
    .command('check')
    .argument('[paths...]', 'Tao files or directories to check. Defaults to the current directory.')
    .description('Check Tao source without writing: syntax errors, validation errors and warnings, and canonical form.')
    .action(async (paths: string[]) => {
      const { runCheck } = await import('./source-commands')
      await runInPlaceCommand(paths, runCheck, {
        changed: 'noncanonical',
        changedLine: 'Needs fixes',
        failedVerb: 'check',
        failOnChanged: true,
      })
    })

  commands
    .command('test')
    .argument('[paths...]', 'Tao test files or directories to search. Defaults to the current directory.')
    .option(
      '--name <pattern>',
      'Run only the tests whose name matches this pattern, case-insensitively, anywhere in'
        + ' "<file> <suite> > <test>". Runs every discovered test when omitted.',
    )
    .option(
      '--output <mode>',
      'Report the run as streamed lines or as a quiet summary with a log file (tui streams lines).'
        + ' Defaults to lines in a terminal and quiet otherwise.',
    )
    .option(
      '--pass-with-no-tests',
      'Exit with code 0 when --name selects no journey, instead of reporting it as a mistake in the'
        + ' pattern. For a scheduler running one pattern across many suites.',
    )
    .option(
      '--watch',
      'Run the selected tests, then rerun them on any change under the selected paths or the project'
        + ' roots of the selected tests, until Ctrl-C. Every rerun compiles from source; a failing run'
        + ' keeps watching.',
    )
    .description('Run Tao tests declared in .tao files at or under the given paths.')
    .action(
      async (
        paths: string[],
        options: { name?: string; output?: string; passWithNoTests?: boolean; watch?: boolean },
      ) => {
        try {
          const { TestOutput } = await import('./test-output')
          const testPaths = paths.length > 0 ? paths : ['.']
          const testOptions = {
            name: options.name,
            output: TestOutput.resolveMode(options.output),
            passWithNoTests: options.passWithNoTests,
          }
          if (options.watch) {
            const { runTestWatchCommand } = await import('./test-watch')
            await runTestWatchCommand(testPaths, testOptions)
            return
          }
          const { runTestCommand } = await import('./test-command')
          await runTestCommand(testPaths, testOptions)
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.exit(1)
        }
      },
    )

  commands
    .command('completion')
    .description('Manage tao shell completions.')
    .command('install')
    .option('--shell <shell>', 'Install for a specific shell instead of the one $SHELL reports.')
    .description('Add the tao completion hook to your shell startup file.')
    .action(async (options: { shell?: string }) => {
      try {
        const { runCompletionInstall, writeCompletionInstallResult } = await import('./completion-command')
        writeCompletionInstallResult(await runCompletionInstall({ shell: options.shell }))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  // Registers `tao complete <shell>` to print a completion script, and the hidden request protocol it calls.
  // The adapter types against plain Commander, which extra-typings' generic Command does not widen to.
  tab(commands as unknown as BaseCommand)

  return commands
}

function parseBetaRecipients(value: boolean | string | undefined): string[] | undefined {
  if (value === undefined || value === false) {
    return undefined
  }
  if (value === true || value.trim().length === 0) {
    return []
  }
  const recipients = value.split(',').map(email => email.trim()).filter(Boolean)
  const invalid = recipients.find(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  if (invalid) {
    Errors.throwUserInput(`TestFlight recipient '${invalid}' is not an email address.`)
  }
  return [...new Set(recipients)]
}

function shipBump(
  options: { major?: boolean; minor?: boolean; patch?: boolean },
): 'major' | 'minor' | 'patch' | undefined {
  const selected = [
    ...(options.patch ? ['patch' as const] : []),
    ...(options.minor ? ['minor' as const] : []),
    ...(options.major ? ['major' as const] : []),
  ]
  if (selected.length > 1) {
    Errors.throwUserInput('Choose only one of --patch, --minor, or --major.')
  }
  return selected[0]
}

async function runInPlaceCommand(
  paths: string[],
  run: (root: string) => Promise<InPlace.Result[]>,
  labels: InPlaceLabels,
): Promise<void> {
  try {
    const roots = (paths.length > 0 ? paths : ['.']).map(path => FS.resolvePath(path))
    // Validate every root before touching files so a bad path cannot abort a partial run.
    for (const root of roots) {
      if (!await FS.exists(root)) {
        Errors.throwUserInput(`No file or directory found at ${root}`)
      }
    }
    const results: InPlace.Result[] = []
    for (const root of roots) {
      results.push(...await run(root))
    }
    const changed = results.filter(result => result.status === 'changed')
    const errored = results.filter(result => result.status === 'error')
    const diagnosticsOnly = results.filter(result => result.status === 'diagnostics')
    const diagnostics = results.flatMap(result => result.diagnostics ?? [])
    const errorCount = diagnostics.filter(Diagnostic.isError).length
      + results.reduce((held, result) => held + (result.unreportedDiagnostics ?? 0), 0)
      + errored.filter(result => result.error !== undefined).length
    const warningCount = diagnostics.filter(Diagnostic.isWarning).length

    writeChangedResults(changed, labels)
    await writeDiagnosticResults(results, labels)
    for (const result of errored.filter(result => result.error !== undefined)) {
      HCI.writeErrorLine(`Failed to ${labels.failedVerb} ${FS.displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${roots.map(FS.displayPath).join(', ')}`)
      return
    }

    const unchangedCount = results.length - changed.length - errored.length - diagnosticsOnly.length
    const summary = [
      `${changed.length} ${labels.changed}`,
      `${unchangedCount} unchanged`,
      ...countPhrase(errorCount, 'error'),
      ...countPhrase(warningCount, 'warning'),
    ].join(', ')
    const shouldFail = errorCount > 0 || labels.failOnChanged && changed.length > 0
    if (shouldFail) {
      HCI.writeErrorLine(summary)
      Platform.runtimeProcess.exit(1)
    }
    HCI.writeSuccess(`${summary}\n`)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

/**
 * writeDiagnosticResults prints every file's diagnostics with its location and offending source
 * line. The file is re-read for the excerpt because the run reports after all files are processed,
 * and only files that actually carry a diagnostic are read. A file that held findings back says so
 * once at the end of its own block, so the reader knows the list is a starting point.
 */
async function writeDiagnosticResults(results: readonly InPlace.Result[], labels: InPlaceLabels): Promise<void> {
  for (const result of results) {
    if (result.diagnostics === undefined || result.diagnostics.length === 0) {
      continue
    }
    const source = await FS.readText(result.path).catch(() => undefined)
    for (const diagnostic of result.diagnostics) {
      const block = DiagnosticReport.renderDiagnostic(diagnostic, source)
      if (Diagnostic.isError(diagnostic)) {
        HCI.logProcessError(labels.failedVerb, block)
      } else {
        HCI.logProcessWarn(labels.failedVerb, block)
      }
    }
    const held = result.unreportedDiagnostics ?? 0
    if (held > 0) {
      HCI.writeErrorLine(
        `${FS.displayPath(result.path)}: ${held} more error${held === 1 ? '' : 's'} further down this file. `
          + 'Fix these first — one mistake often explains the rest.',
      )
    }
  }
}

/** countPhrase returns a pluralized `N thing` phrase, or nothing at all when the count is zero. */
function countPhrase(count: number, noun: string): string[] {
  return count === 0 ? [] : [`${count} ${noun}${count === 1 ? '' : 's'}`]
}

function writeChangedResults(results: readonly InPlace.Result[], labels: InPlaceLabels): void {
  for (const result of results) {
    const line = `${labels.changedLine} ${FS.displayPath(result.path)}`
    if (labels.failOnChanged) {
      HCI.writeErrorLine(line)
    } else {
      HCI.writeSuccess(`${line}\n`)
    }
  }
}
