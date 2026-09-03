#!/usr/bin/env bun
import tab from '@bomb.sh/tab/commander'
import { Command } from '@commander-js/extra-typings'
import { Errors, FS, HCI, Platform } from '@shared'
import type { Command as BaseCommand } from 'commander'
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
    .argument('<id>', 'Checked-in project id and new directory name.')
    .description('Create a new Tao project with an immutable project id.')
    .action(async (id: string) => {
      try {
        const { createProject } = await import('./project-command')
        const appPath = await createProject(id)
        HCI.writeSuccess(`Created ${FS.displayPath(appPath)}\n`)
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
    .description('Discover and run Tao apps in the interactive development loop.')
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
      noWait?: boolean
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
          noWait: options.noWait,
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
    .description('Check canonical Tao source and report validation warnings without writing.')
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
    .argument('[path]', 'Tao test file or directory to search. Defaults to the current directory.', '.')
    .option(
      '--output <mode>',
      'Report the run as streamed lines or as a quiet summary with a log file (tui streams lines).'
        + ' Defaults to lines in a terminal and quiet otherwise.',
    )
    .description('Run Tao tests declared in .tao files at or under a path.')
    .action(async (path: string, options: { output?: string }) => {
      try {
        const { TestOutput } = await import('./test-output')
        const { runTestCommand } = await import('./test-command')
        await runTestCommand(path, { output: TestOutput.resolveMode(options.output) })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

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
    const warnings = results.flatMap(result => result.warnings ?? [])

    writeChangedResults(changed, labels)
    for (const warning of warnings) {
      HCI.logProcessWarn(labels.failedVerb, warning)
    }
    for (const result of errored) {
      HCI.writeErrorLine(`Failed to ${labels.failedVerb} ${FS.displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${roots.map(FS.displayPath).join(', ')}`)
      return
    }

    const unchangedCount = results.length - changed.length - errored.length
    const warningSummary = warnings.length === 0
      ? ''
      : ', ' + String(warnings.length) + ' warning' + (warnings.length === 1 ? '' : 's')
    const summary = `${changed.length} ${labels.changed}, ${unchangedCount} unchanged` + warningSummary
    const shouldFail = errored.length > 0 || labels.failOnChanged && changed.length > 0
    if (shouldFail) {
      HCI.writeErrorLine(`${summary}${errored.length > 0 ? `, ${errored.length} failed` : ''}`)
      Platform.runtimeProcess.exit(1)
    }
    HCI.writeSuccess(`${summary}\n`)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
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
