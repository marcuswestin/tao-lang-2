#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings'
import { Errors, FS, HCI, Platform } from '@shared'
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
  .argument('[path]', 'Tao file or directory to format. Defaults to the current directory.')
  .description('Format .tao files in place.')
  .action(async (path?: string) => {
    const root = FS.resolvePath(path ?? '.')
    const results = await runFmt(root)
    const formatted = results.filter(result => result.status === 'formatted')
    const errored = results.filter(result => result.status === 'error')

    for (const result of formatted) {
      HCI.writeSuccess(`Formatted ${displayPath(result.path)}\n`)
    }
    for (const result of errored) {
      HCI.writeErrorLine(`Failed to format ${displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${displayPath(root)}`)
      return
    }

    const unchangedCount = results.length - formatted.length - errored.length
    const summary = `${formatted.length} formatted, ${unchangedCount} unchanged`
    if (errored.length > 0) {
      HCI.writeErrorLine(`${summary}, ${errored.length} failed`)
      Platform.runtimeProcess.exit(1)
    }
    HCI.writeSuccess(`${summary}\n`)
  })

await commands.parseAsync(Platform.runtimeProcess.argv, { from: 'node' })

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.resolvePath('.'), path)
  return relative === '' ? '.' : relative
}
