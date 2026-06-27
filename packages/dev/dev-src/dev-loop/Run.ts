import { CLI, Errors, Repo } from '@shared'
import CommandRunner from './CommandRunner'
import { ExpoRunner } from './expo-runner/ExpoRunner'
import { TUI } from './TUI'

/** runJust runs a repo-root Just recipe with prefixed output. */
async function runJust(args: readonly string[]): Promise<void> {
  const recipe = args[0]
  const processLabel = recipe ? JUST_LABELS[recipe] ?? 'just' : 'just'
  const result = await CLI.run('just', {
    args: ['--justfile', Repo.resolvePath('Justfile'), ...args],
    onOutput: TUI.devLoopOutputHandler(processLabel),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

const JUST_LABELS: Record<string, string> = {
  '_compile-kitchen-sink-app': 'compile',
  '_parser-gen': 'parser',
  'clean': 'clean',
  'deps': 'deps',
  'fix': 'fix',
  'install-ide-extension': 'extension',
  'verify': 'verify',
  'test': 'test',
}

/** runTests runs the dev test runner in line-output mode for the dev-loop TUI. */
async function runTests(repoRoot: string): Promise<void> {
  await runJust(['_compile-kitchen-sink-app'])
  const result = await CLI.run('bun', {
    args: ['run', Repo.resolvePath('packages/dev/dev-src/dev.ts'), 'test', '--output', 'lines'],
    cwd: repoRoot,
    onOutput: TUI.devLoopOutputHandler('test'),
  })
  if (result.exitCode !== 0 || result.error !== undefined) {
    throw new Errors.CommandExecutionError(result)
  }
}

/** compileApp runs parser generation when needed and compiles the selected Tao app, returning success. */
async function compileApp(
  repoRoot: string,
  appPath: string,
  reason: string,
  shouldRunParserGen: boolean,
): Promise<boolean> {
  if (!CommandRunner.beginCommand()) {
    TUI.logDevLoop('dev', `Command running; ignored compile (${reason}).`)
    return true
  }

  try {
    return await compileAppWithoutCommandLock(repoRoot, appPath, reason, shouldRunParserGen)
  } finally {
    CommandRunner.endCommand()
  }
}

/** compileAppWithoutCommandLock compiles the selected Tao app while the caller owns command exclusivity. */
async function compileAppWithoutCommandLock(
  repoRoot: string,
  appPath: string,
  reason: string,
  shouldRunParserGen: boolean,
): Promise<boolean> {
  TUI.logDevLoop('dev', `compiling (${reason})`)
  try {
    if (shouldRunParserGen) {
      await runJust(['_parser-gen'])
    }
    const result = await CLI.run(Repo.resolvePath('tao'), {
      args: ['compile', appPath],
      cwd: repoRoot,
      onOutput: TUI.devLoopOutputHandler('compile'),
    })
    if (result.exitCode !== 0 || result.error !== undefined) {
      TUI.logDevLoop('compile', `compile failed for ${appPath}`, 'error')
      return false
    }
    if (!result.stdout.trim()) {
      TUI.logDevLoop('compile', 'compiled')
    }
    return true
  } catch (error) {
    TUI.logDevLoop('compile', Errors.formatForLog(error), 'error')
    return false
  }
}

/** recompileAndReload recompiles the selected app while a command key owns exclusivity, then reloads Expo. */
async function recompileAndReload(repoRoot: string, appPath: string): Promise<void> {
  CommandRunner.assertCommandRunning('recompile and reload')
  const compiled = await compileAppWithoutCommandLock(repoRoot, appPath, 'manual reload', true)
  if (!compiled) {
    throw new Errors.UserInputError('Reload skipped because compile failed.')
  }
  await ExpoRunner.reloadExpoApps()
}

/** Run provides dev-loop subprocess helpers. */
const Run = {
  compileApp,
  recompileAndReload,
  runJust,
  runTests,
}

export default Run
