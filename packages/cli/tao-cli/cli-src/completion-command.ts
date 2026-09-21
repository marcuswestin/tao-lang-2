import { Errors, FS, HCI, Platform, Switch } from '@shared'

/** CompletionShell names the shells whose startup files `tao completion install` can edit. */
type CompletionShell = 'bash' | 'fish' | 'zsh'

/** CompletionInstallOptions configures which shell the hook is installed for. */
export type CompletionInstallOptions = {
  /** shell overrides shell detection, which otherwise reads $SHELL. */
  shell?: string
}

/** CompletionInstallResult reports what `tao completion install` did so callers can report or assert it. */
export type CompletionInstallResult = {
  /** alreadyInstalled is true when the hook was present and the startup file was left untouched. */
  alreadyInstalled: boolean
  shell: CompletionShell
  startupFile: string
}

// Marks the hook so reinstalling stays idempotent even when the hook line itself changes.
const hookMarker = '# tao shell completion'

const shellNames = ['bash', 'fish', 'zsh'] as const

/** runCompletionInstall adds the tao completion hook to the shell's startup file, and is safe to rerun. */
export async function runCompletionInstall(
  options: CompletionInstallOptions = {},
): Promise<CompletionInstallResult> {
  const shell = resolveShell(options.shell)
  const startupFile = startupFilePath(shell)
  const existing = await FS.exists(startupFile) ? await FS.readText(startupFile) : ''

  if (existing.includes(hookMarker)) {
    const binding = completionBindingLine(shell)
    if (binding === undefined || existing.includes(binding)) {
      return { alreadyInstalled: true, shell, startupFile }
    }
    await FS.writeText(startupFile, `${existing.trimEnd()}\n${binding}\n`)
    return { alreadyInstalled: false, shell, startupFile }
  }

  await FS.mkdir(FS.dirname(startupFile))
  await FS.writeText(startupFile, appendHook(existing, shell))
  return { alreadyInstalled: false, shell, startupFile }
}

/** completionHookLine returns the lines a shell startup file runs to load tao completions. */
function completionHookLine(shell: CompletionShell): string {
  const binding = completionBindingLine(shell)
  // Sourcing the CLI's live output keeps completions correct as commands change, unlike a generated file.
  return binding === undefined ? completionScriptLine(shell) : `${completionScriptLine(shell)}\n${binding}`
}

function completionScriptLine(shell: CompletionShell): string {
  return Switch<CompletionShell, string>(shell, {
    bash: () => 'source <(tao complete bash)',
    fish: () => 'tao complete fish | source',
    zsh: () => 'source <(tao complete zsh)',
  })
}

/** completionBindingLine binds the generated completer to `./tao` once `tao` is on PATH. */
function completionBindingLine(shell: CompletionShell): string | undefined {
  return Switch<CompletionShell, string | undefined>(shell, {
    bash: () => 'complete -F __tao_complete ./tao',
    fish: () => undefined,
    zsh: () => 'compdef _tao ./tao',
  })
}

function appendHook(existing: string, shell: CompletionShell): string {
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  return `${existing}${separator}\n${hookMarker}\n${completionHookLine(shell)}\n`
}

function resolveShell(requested: string | undefined): CompletionShell {
  const name = requested ?? FS.basename(Platform.runtimeProcess.env['SHELL'] ?? '')
  if (isCompletionShell(name)) {
    return name
  }
  Errors.throwUserInput(
    name === ''
      ? `Could not detect the current shell. Pass --shell with one of: ${shellNames.join(', ')}.`
      : `Cannot install completions for '${name}'. Supported shells: ${shellNames.join(', ')}.`,
  )
}

function isCompletionShell(name: string): name is CompletionShell {
  return shellNames.includes(name as CompletionShell)
}

function startupFilePath(shell: CompletionShell): string {
  const env = Platform.runtimeProcess.env
  // Shells resolve startup files against $HOME, so prefer it over the account's system home directory.
  const home = env['HOME'] ?? FS.homeDir()
  return Switch<CompletionShell, string>(shell, {
    bash: () => FS.joinPath(`${home}/.bashrc`),
    // $XDG_CONFIG_HOME and $ZDOTDIR relocate these files, so completions must follow them.
    fish: () => FS.joinPath(`${env['XDG_CONFIG_HOME'] ?? `${home}/.config`}/fish/config.fish`),
    zsh: () => FS.joinPath(`${env['ZDOTDIR'] ?? home}/.zshrc`),
  })
}

/** writeCompletionInstallResult reports the outcome of an install to the user. */
export function writeCompletionInstallResult(result: CompletionInstallResult): void {
  if (result.alreadyInstalled) {
    HCI.writeLine(`Tao completions are already installed in ${result.startupFile}`)
    return
  }
  HCI.writeSuccess(`Installed ${result.shell} completions in ${result.startupFile}\n`)
  HCI.writeLine('Restart your shell or re-source that file to use them.')
}
