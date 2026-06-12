#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings'
import { FS, HCI, Platform } from '@shared'
import { runCompile } from './compile-command'
import { runFmt } from './fmt-command'

const commands = new Command()
  .name('tao')
  .description('Tao language CLI.')

commands
  .command('compile')
  .argument('<appPath>', 'Tao app path to compile into the local runtime package.')
  .description('Compile a Tao app into the local runtime package.')
  .action(async (appPath: string) => {
    const compiled = await runCompile(appPath)
    HCI.writeLine(`Compiled ${compiled.sourcePath} -> ${compiled.outputPath}`)
  })

commands
  .command('fmt')
  .argument('[path]', 'Tao file or directory to format. Defaults to the current directory.')
  .description('Format .tao files in place.')
  .action(async (path?: string) => {
    const root = FS.resolvePath(path ?? '.')
    const results = await runFmt(root)
    const formatted = results.filter(result => result.status === 'formatted')
    const errored = results.filter(result => result.status === 'error')

    for (const result of formatted) {
      HCI.writeLine(`Formatted ${displayPath(result.path)}`)
    }
    for (const result of errored) {
      HCI.writeErrorLine(`Failed to format ${displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${displayPath(root)}`)
      return
    }

    const unchangedCount = results.length - formatted.length - errored.length
    const failedSummary = errored.length > 0 ? `, ${errored.length} failed` : ''
    HCI.writeLine(`${formatted.length} formatted, ${unchangedCount} unchanged${failedSummary}`)
    if (errored.length > 0) {
      Platform.runtimeProcess.exit(1)
    }
  })

await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.resolvePath('.'), path)
  return relative === '' ? '.' : relative
}
