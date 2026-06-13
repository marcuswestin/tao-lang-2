import { CLI, Errors, FS, HCI } from '@shared'
import CommandRunner from './CommandRunner'

/** runJust runs a repo-root Just recipe with prefixed output. */
async function runJust(args: readonly string[]): Promise<void> {
  const recipe = args[0]
  const processLabel = recipe ? JUST_LABELS[recipe] ?? 'just' : 'just'
  const result = await CLI.run('just', {
    prefixedOutput: { processName: processLabel },
    args: ['--justfile', FS.repoPath('Justfile'), ...args],
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

const JUST_LABELS: Record<string, string> = {
  '_parser-gen': 'parser',
  clean: 'clean',
  deps: 'deps',
  fix: 'fix',
  'install-ide-extension': 'extension',
  prep: 'prep',
  test: 'test',
}

/** compileApp runs parser generation when needed and compiles the selected Tao app, returning success. */
async function compileApp(
  repoRoot: string,
  appPath: string,
  reason: string,
  shouldRunParserGen: boolean,
): Promise<boolean> {
  if (!CommandRunner.beginCommand()) {
    HCI.logProcessInfo('dev', `Command running; ignored compile (${reason}).`)
    return true
  }

  try {
    HCI.logProcessInfo('dev', `compiling (${reason})`)
    try {
      if (shouldRunParserGen) {
        await runJust(['_parser-gen'])
      }
      const result = await CLI.run(FS.repoPath('tao'), {
        args: ['compile', appPath],
        prefixedOutput: { processName: 'compile' },
        cwd: repoRoot,
      })
      if (result.exitCode !== 0 || result.error !== undefined) {
        HCI.logProcessError('compile', `compile failed for ${appPath}`)
        return false
      }
      if (!result.stdout.trim()) {
        HCI.logProcessInfo('compile', 'compiled')
      }
      return true
    } catch (error) {
      HCI.writeErrorLine(Errors.formatForLog(error))
      return false
    }
  } finally {
    CommandRunner.endCommand()
  }
}

/** Run provides dev-loop subprocess helpers. */
const Run = {
  compileApp,
  runJust,
}

export default Run
