import { CLI, Errors, Repo } from '@shared'
import { OutputText } from '../cli/OutputText'
import CommandRunner from './CommandRunner'
import { DevLoopTUI } from './DevLoopTUI'
import { ExpoRunner } from './expo-runner/ExpoRunner'

/** runJust runs a repo-root Just recipe with prefixed output. */
async function runJust(args: readonly string[]): Promise<void> {
  const recipe = args[0]
  const processLabel = recipe ? JUST_LABELS[recipe] ?? 'just' : 'just'
  const result = await CLI.run('just', {
    args: ['--justfile', Repo.resolvePath('Justfile'), ...args],
    onOutput: DevLoopTUI.devLoopOutputHandler(processLabel),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

const JUST_LABELS: Record<string, string> = {
  '_compile-word-flower-app': 'compile',
  '_parser-gen': 'parser',
  'clean': 'clean',
  'deps': 'deps',
  'fix': 'fix',
  'install-ide-extension': 'extension',
  'verify': 'verify',
  'test': 'test',
}

type CompileAppOptions = {
  repoRoot: string
  appPath: string
  appName?: string
  reason: string
  shouldRunParserGen: boolean
}

/** runTests runs repository tests in line-output mode for the Expo dev-loop dashboard. */
async function runTests(repoRoot: string): Promise<void> {
  await runJust(['_compile-word-flower-app'])
  const result = await CLI.run('bun', {
    args: ['run', Repo.resolvePath('packages/dev/dev-src/dev.ts'), 'test', '--output', 'lines'],
    cwd: repoRoot,
    onOutput: DevLoopTUI.devLoopOutputHandler('test'),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

/** compileApp runs parser generation when needed and compiles the selected Tao app, returning success. */
async function compileApp(options: CompileAppOptions): Promise<boolean> {
  const { reason } = options
  if (!CommandRunner.beginCommand()) {
    DevLoopTUI.logDevLoop('dev', `Command running; ignored compile (${reason}).`)
    return true
  }

  try {
    return await compileAppWithoutCommandLock(options)
  } finally {
    CommandRunner.endCommand()
  }
}

/** compileAppWithoutCommandLock compiles the selected Tao app while the caller owns command exclusivity. */
async function compileAppWithoutCommandLock(options: CompileAppOptions): Promise<boolean> {
  const { repoRoot, appPath, appName, reason, shouldRunParserGen } = options
  DevLoopTUI.logDevLoop('dev', `compiling (${reason})`)
  try {
    if (shouldRunParserGen) {
      await runJust(['_parser-gen'])
    }
    const result = await CLI.run(Repo.resolvePath('tao'), {
      args: ['compile', appPath, ...(appName ? ['--app', appName] : [])],
      cwd: repoRoot,
      onOutput: DevLoopTUI.devLoopOutputHandler('compile'),
    })
    if (result.exitCode !== 0 || result.error !== undefined) {
      DevLoopTUI.recordFailure('compile', formatDevLoopFailure(new Errors.CommandExecutionError(result)))
      return false
    }
    if (!result.stdout.trim()) {
      DevLoopTUI.logDevLoop('compile', 'compiled')
    }
    return true
  } catch (error) {
    DevLoopTUI.recordFailure('compile', formatDevLoopFailure(error))
    return false
  }
}

/** formatDevLoopFailure favors the child process output that explains a failed dev command. */
function formatDevLoopFailure(error: unknown): string {
  if (error instanceof Errors.CommandExecutionError) {
    const commandOutput = [error.result.stderr, error.result.stdout]
      .map(output => OutputText.stripAnsi(output).trim())
      .filter(output => output.length > 0)
    if (commandOutput.length > 0) {
      return commandOutput.join('\n')
    }
  }
  return Errors.formatForLog(error)
}

/** recompileAndReload recompiles the selected app while a command key owns exclusivity, then reloads Expo. */
async function recompileAndReload(repoRoot: string, appPath: string, appName?: string): Promise<void> {
  CommandRunner.assertCommandRunning('recompile and reload')
  const compiled = await compileAppWithoutCommandLock({
    repoRoot,
    appPath,
    appName,
    reason: 'manual reload',
    shouldRunParserGen: true,
  })
  if (!compiled) {
    throw new Errors.UserInputError('Reload skipped because compile failed.')
  }
  await ExpoRunner.reloadExpoApps()
}

/** Run provides dev-loop subprocess helpers. */
const Run = {
  compileApp,
  failureDiagnostics: { format: formatDevLoopFailure },
  recompileAndReload,
  runJust,
  runTests,
}

export default Run
