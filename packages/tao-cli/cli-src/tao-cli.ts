#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings'
import { Errors, FS, HCI, Platform } from '@shared'
import { runCheck } from './check-command'
import { runCompile } from './compile-command'
import { runFix } from './fix-command'
import { runFmt } from './fmt-command'
import type { InPlaceFileResult } from './in-place-files'
import { findTaoTestFiles, runTest, type TaoTestValidationError, validateTaoTestFiles } from './test-command'

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

const commands = new Command()
  .name('tao')
  .description('Tao language CLI.')

commands
  .command('compile')
  .argument('<appPath>', 'Tao app path to compile into the local runtime package.')
  .description('Compile a Tao app into the local runtime package.')
  .action(async (appPath: string) => {
    try {
      const compiled = await runCompile(appPath)
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
    try {
      const root = FS.resolvePath(path)
      HCI.logProcessInfo('test', `Finding Tao tests under ${displayPath(root)}`)
      const testPaths = await findTaoTestFiles(root)
      if (testPaths.length === 0) {
        HCI.writeLine(`No Tao tests found under ${displayPath(root)}`)
        return
      }
      HCI.logProcessInfo('test', `Found ${testPaths.length} Tao test ${testPaths.length === 1 ? 'file' : 'files'}`)
      HCI.logProcessInfo('test', 'Validating Tao test files')
      const validationErrors = await validateTaoTestFiles(testPaths)
      if (validationErrors.length > 0) {
        writeTaoTestValidationErrors(validationErrors)
        Platform.runtimeProcess.exit(1)
      }
      HCI.logProcessInfo('test', 'Compiling apps and running Tao tests')
      const result = await runTest(root, { stdio: 'inherit', testPaths, skipValidation: true })
      const commandResult = result.commandResult
      if (!commandResult || commandResult.error || commandResult.exitCode !== 0) {
        if (commandResult?.error) {
          HCI.writeErrorLine(Errors.formatForUser(commandResult.error))
        }
        Platform.runtimeProcess.exit(1)
      }
      HCI.logProcessInfo('test', 'Tao tests finished')
    } catch (error) {
      HCI.writeErrorLine(Errors.formatForUser(error))
      Platform.runtimeProcess.exit(1)
    }
  })

await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })

async function runInPlaceCommand(
  paths: string[],
  run: (root: string) => Promise<InPlaceFileResult[]>,
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
    const results: InPlaceFileResult[] = []
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
    if (errored.length > 0 || labels.failOnChanged && changed.length > 0) {
      HCI.writeErrorLine(`${summary}${errored.length > 0 ? `, ${errored.length} failed` : ''}`)
      Platform.runtimeProcess.exit(1)
    }
    HCI.writeSuccess(`${summary}\n`)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

function writeChangedResults(results: readonly InPlaceFileResult[], labels: InPlaceLabels): void {
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

function writeTaoTestValidationErrors(errors: readonly TaoTestValidationError[]): void {
  for (const error of errors) {
    for (const message of error.messages) {
      HCI.writeErrorLine(`${displayPath(error.path)}: ${message}`)
    }
  }
}
