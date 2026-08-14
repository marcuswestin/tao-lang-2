#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings'
import { Errors, FS, HCI, Platform } from '@shared'
import { runCompile } from './compile-command'
import { runTaoDev } from './dev-command'
import type { InPlace } from './in-place-files'
import { runCheck, runFix, runFmt } from './source-commands'
import { runTestCommand } from './test-command'

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
    .command('dev')
    .argument('[path]', 'Tao file or directory whose runnable apps should be discovered.', '.')
    .option('--app <name>', 'Select a uniquely named app without prompting.')
    .description('Discover and run Tao apps in the interactive development loop.')
    .action(async (path: string, options: { app?: string }) => {
      try {
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
        const compiled = await runCompile(appPath, { appName: options.app })
        HCI.writeSuccess(`Compiled ${compiled.sourcePath} -> ${compiled.outputPath}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('fmt')
    .argument('[paths...]', 'Tao files or directories to format. Defaults to the current directory.')
    .description('Format .tao files in place.')
    .action(async (paths: string[]) => {
      await runInPlaceCommand(paths, runFmt, { changed: 'formatted', changedLine: 'Formatted', failedVerb: 'format' })
    })

  commands
    .command('fix')
    .argument('[paths...]', 'Tao files or directories to fix. Defaults to the current directory.')
    .description('Apply all Tao source fixes in place: renders last, organized use statements, formatting.')
    .action(async (paths: string[]) => {
      await runInPlaceCommand(paths, runFix, { changed: 'fixed', changedLine: 'Fixed', failedVerb: 'fix' })
    })

  commands
    .command('check')
    .argument('[paths...]', 'Tao files or directories to check. Defaults to the current directory.')
    .description('Check .tao files for the full canonical source form without writing.')
    .action(async (paths: string[]) => {
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
    .description('Run Tao tests declared in .tao files at or under a path.')
    .action(async (path: string) => {
      await runTestCommand(path)
    })

  return commands
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

    writeChangedResults(changed, labels)
    for (const result of errored) {
      HCI.writeErrorLine(`Failed to ${labels.failedVerb} ${displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${roots.map(displayPath).join(', ')}`)
      return
    }

    const unchangedCount = results.length - changed.length - errored.length
    const summary = `${changed.length} ${labels.changed}, ${unchangedCount} unchanged`
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
    const line = `${labels.changedLine} ${displayPath(result.path)}`
    if (labels.failOnChanged) {
      HCI.writeErrorLine(line)
    } else {
      HCI.writeSuccess(`${line}\n`)
    }
  }
}

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.resolvePath('.'), path)
  return relative === '' ? '.' : relative
}
