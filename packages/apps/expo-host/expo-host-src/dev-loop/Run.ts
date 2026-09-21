import { CLI, Errors, Repo, Text } from '@shared'
import CommandRunner from './CommandRunner'
import { DevLoopOutput } from './DevLoopOutput'
import type { ExpoRunnerSession } from './expo-runner/ExpoRunner'

/** runJust runs a repo-root Just recipe with prefixed output. */
async function runJust(args: readonly string[]): Promise<void> {
  const recipe = args[0]
  const processLabel = recipe ? JUST_LABELS[recipe] ?? 'just' : 'just'
  const result = await CLI.run('just', {
    args: ['--justfile', Repo.resolvePath('Justfile'), ...args],
    onOutput: DevLoopOutput.devLoopOutputHandler(processLabel),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

const JUST_LABELS: Record<string, string> = {
  '_compile-word-flower-app': 'compile',
  '_parser-gen': 'parser',
  'clean': 'clean',
  'deps': '_deps',
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
    onOutput: DevLoopOutput.devLoopOutputHandler('test'),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

/** compileApp runs parser generation when needed and compiles the selected Tao app, returning success. */
async function compileApp(options: CompileAppOptions): Promise<boolean> {
  const { reason } = options
  if (!CommandRunner.beginCommand()) {
    DevLoopOutput.logDevLoop('dev', `Command running; ignored compile (${reason}).`)
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
  DevLoopOutput.logDevLoop('dev', `compiling (${reason})`)
  try {
    if (shouldRunParserGen) {
      await runJust(['_parser-gen'])
    }
    const result = await CLI.run(Repo.resolvePath('tao'), {
      args: ['compile', appPath, ...(appName ? ['--app', appName] : [])],
      cwd: repoRoot,
      onOutput: DevLoopOutput.devLoopOutputHandler('compile'),
    })
    if (result.exitCode !== 0 || result.error !== undefined) {
      DevLoopOutput.recordFailure('compile', formatCommandOutput(result) ?? Errors.formatForLog(result.error))
      return false
    }
    if (!result.stdout.trim()) {
      DevLoopOutput.logDevLoop('compile', 'compiled')
    }
    DevLoopOutput.clearFailure('compile')
    return true
  } catch (error) {
    DevLoopOutput.recordFailure('compile', formatDevLoopFailure(error))
    return false
  }
}

/** formatCommandOutput extracts the child process output that explains a failed dev command. */
function formatCommandOutput(result: { stderr: string; stdout: string }): string | undefined {
  const commandOutput = [result.stderr, result.stdout]
    .map(output => Text.stripAnsi(output).trim())
    .filter(output => output.length > 0)
  return commandOutput.length > 0 ? commandOutput.join('\n') : undefined
}

/** formatDevLoopFailure favors the child process output that explains a failed dev command. */
function formatDevLoopFailure(error: unknown): string {
  if (error instanceof Errors.CommandExecutionError) {
    const commandOutput = formatCommandOutput(error.result)
    if (commandOutput !== undefined) {
      return commandOutput
    }
  }
  return Errors.formatForLog(error)
}

/** recompileAndReload recompiles the selected app while a command key owns exclusivity, then reloads Expo. */
async function recompileAndReload(
  repoRoot: string,
  appPath: string,
  expo: ExpoRunnerSession,
  appName?: string,
): Promise<void> {
  CommandRunner.assertCommandRunning('recompile and reload')
  const compiled = await compileAppWithoutCommandLock({
    repoRoot,
    appPath,
    appName,
    reason: 'manual reload',
    shouldRunParserGen: true,
  })
  if (!compiled) {
    Errors.throwUserInput('Reload skipped because compile failed.')
  }
  await expo.reloadExpoApps()
}

/** Run provides dev-loop subprocess helpers. */
const Run = {
  compileApp,
  formatFailure: formatDevLoopFailure,
  recompileAndReload,
  runJust,
  runTests,
}

export default Run
