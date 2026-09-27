import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

type SetupEnvironment = {
  interactive: () => boolean
  confirm: typeof HCI.askConfirm
  write: (message: string) => void
  root: () => string
  env: Readonly<Record<string, string | undefined>>
  fs: typeof FS
  run: typeof CLI.run
}

function liveEnvironment(): SetupEnvironment {
  return {
    interactive: () => HCI.isInteractive(),
    confirm: HCI.askConfirm,
    write: HCI.writeLine,
    root: Repo.getRoot,
    env: Platform.runtimeProcess.env,
    fs: FS,
    run: CLI.run,
  }
}

/** Offers developer-owned shell activation only when a terminal can ask for consent. */
export async function runDirenvSetup(
  options: { configure?: boolean } = {},
  environment: SetupEnvironment = liveEnvironment(),
): Promise<number> {
  if (environment.env['TAO_DEV_SHELL_SETUP'] === '0' || !environment.interactive()) {
    return 0
  }
  const { fs, env, run, write } = environment
  if (FS.basename(env['SHELL'] ?? '') !== 'zsh') {
    write('Automatic development shell activation currently supports zsh. Shell configuration was left unchanged.')
    return 0
  }
  const root = environment.root()
  const home = env['HOME']
  if (!home) {
    Errors.throwHostEnvironment('Shell setup needs HOME to locate developer shell configuration.')
  }
  rejectLineBreaks(root, home, env['ZDOTDIR'] ?? '')
  const git = await run('git', {
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    cwd: root,
    stdio: 'pipe',
  })
  if (git.exitCode !== 0) {
    Errors.throwHostEnvironment('Shell setup requires Git and a working repository checkout.')
  }
  const commonPath = git.stdout.replace(/\n$/, '')
  rejectLineBreaks(commonPath)
  const commonDirectory = await fs.realPath(commonPath)
  rejectLineBreaks(commonDirectory)
  const hash = await run('git', {
    args: ['hash-object', '--stdin'],
    stdin: `${commonDirectory}\n`,
    cwd: root,
    stdio: 'pipe',
  })
  const identity = hash.stdout.trim()
  if (hash.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(identity)) {
    Errors.throwHostEnvironment('Git could not identify this repository for shell setup.')
  }
  const shellRoot = FS.resolvePath('.tao-dev/shell', home)
  const repository = FS.resolvePath(`repositories/${identity}`, shellRoot)
  const choicePath = FS.resolvePath('choice', repository)
  const previousChoice = await readOptional(fs, choicePath)
  if (!options.configure && ['enabled\n', 'disabled\n'].includes(previousChoice)) {
    return 0
  }
  const activation = FS.resolvePath('activation.zsh', shellRoot)
  const zshrc = FS.resolvePath('.zshrc', env['ZDOTDIR'] || home)
  const sourceLine = `[[ ! -r ${quote(activation)} ]] || source ${quote(activation)}`
  const accepted = await environment.confirm({
    defaultValue: false,
    message:
      `Enable automatic development shell activation for this repository and all its current and future registered worktrees? This trusts their root environment configuration, installs pinned direnv under ${shellRoot}, adds one source line to ${zshrc}, and remembers your choice.`,
  })

  // No host path is created until the developer explicitly accepts or declines the offer.
  await fs.mkdir(shellRoot)
  const canonicalShellRoot = await fs.realPath(shellRoot)
  return await fs.withFileMutationLock(
    FS.resolvePath('configuration', canonicalShellRoot),
    canonicalShellRoot,
    async () => {
      // A concurrent setup may have finished while this terminal was asking.
      if (!options.configure && ['enabled\n', 'disabled\n'].includes(await readOptional(fs, choicePath))) {
        return 0
      }
      await atomicWrite(fs, FS.resolvePath('common-dir', repository), `${commonDirectory}\n`)
      await atomicWrite(fs, choicePath, 'disabled\n')
      if (!accepted) {
        write(
          'Automatic trust is disabled for this repository; existing direnv authorizations are unchanged. Run `./agent shell-setup` to change it.',
        )
        return 0
      }
      const profileClient = FS.resolvePath('.devenv/profile/bin/direnv', root)
      const resolvedClient = await fs.realPath(profileClient).catch(() => '')
      const output = resolvedClient.match(/^(\/nix\/store\/[a-z0-9]{32}-[^/]+)\/bin\/direnv$/)?.[1]
      if (output === undefined) {
        Errors.throwHostEnvironment(
          `Pinned direnv is missing from this checkout's environment. Rebuild it, then configure again:\ncd ${
            quote(root)
          }\n./agent setup --environment\n./agent shell-setup`,
        )
      }
      const devenv = await run('devenv', { args: ['--version'], cwd: root, stdio: 'pipe' })
      if (devenv.exitCode !== 0) {
        Errors.throwHostEnvironment('Automatic shell activation requires an existing host devenv installation.')
      }
      const runtime = await fs.readText(
        FS.resolvePath('packages/cli/dev-cli/dev-cli-src/shell/direnv-activation.zsh', root),
      )
      const envrc = await fs.readText(FS.resolvePath('.envrc', root))
      const completion = await fs.readText(FS.resolvePath('.artifacts/cache/dev-shell/completion.zsh', root))
      const rooted = await run('nix-store', {
        args: ['--realise', output, '--add-root', FS.resolvePath('direnv', shellRoot), '--indirect'],
        cwd: root,
        stdio: 'pipe',
      })
      if (rooted.exitCode !== 0) {
        Errors.throwHostEnvironment(
          `Could not retain the pinned direnv package with a Nix GC root. Shell activation remains disabled.\n${rooted.stderr.trim()}`,
        )
      }
      await atomicWrite(fs, activation, runtime)
      await atomicWrite(fs, FS.resolvePath('envrc', shellRoot), envrc)
      await atomicWrite(fs, FS.resolvePath('completion.zsh', shellRoot), completion)
      // Resolve an existing symlink rather than replacing the developer's managed dotfile link.
      let target = zshrc
      try {
        if (await fs.exists(zshrc) || await fs.isSymbolicLink(zshrc)) {
          target = await fs.realPath(zshrc)
        }
        const existing = await readOptional(fs, target)
        if (!existing.split('\n').some(line => line.trim() === sourceLine)) {
          await fs.writeText(target, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${sourceLine}\n`)
        }
      } catch (cause) {
        Errors.throwHostEnvironment(
          `Could not update shell configuration at ${target}. Add this exact line to its managed source, then configure again:\n${sourceLine}\ncd ${
            quote(root)
          }\n./agent shell-setup`,
          { cause },
        )
      }
      // The runtime treats this final atomic publication as the activation permission.
      await atomicWrite(fs, choicePath, 'enabled\n')
      write(`Automatic shell activation is enabled for this repository. Open a new zsh terminal or run:\n${sourceLine}`)
      return 0
    },
  )
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function rejectLineBreaks(...paths: string[]): void {
  if (paths.some(path => /[\r\n]/.test(path))) {
    Errors.throwHostEnvironment('Automatic shell activation does not support paths containing line breaks.')
  }
}

async function readOptional(fs: typeof FS, path: string): Promise<string> {
  return await fs.exists(path) ? await fs.readText(path) : ''
}

async function atomicWrite(fs: typeof FS, path: string, content: string): Promise<void> {
  const staged = `${path}.${Platform.randomUUID()}.tmp`
  try {
    await fs.writeText(staged, content)
    await fs.move(staged, path)
  } finally {
    await fs.remove(staged)
  }
}
