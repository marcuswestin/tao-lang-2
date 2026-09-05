import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { runTaoCliForTest } from './test-cli-files'

Describe('tao completion install', () => {
  Test('writes the zsh hook into the startup file $ZDOTDIR names', async () => {
    await withShellHome({ ZDOTDIR: true }, async (homeDir) => {
      const result = await runTaoCliForTest(['completion', 'install', '--shell', 'zsh'])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Installed zsh completions')
      const startupFile = await FS.readText(FS.resolvePath('.zshrc', homeDir))
      Expect(startupFile).toContain('source <(tao complete zsh)')
      Expect(startupFile).toContain('compdef _tao ./tao')
    })
  })

  Test('adds the ./tao binding when an older hook is already present', async () => {
    await withShellHome({ ZDOTDIR: true }, async (homeDir) => {
      const startupFile = FS.resolvePath('.zshrc', homeDir)
      await FS.writeText(startupFile, '# tao shell completion\nsource <(tao complete zsh)\n')

      const result = await runTaoCliForTest(['completion', 'install', '--shell', 'zsh'])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Installed zsh completions')
      Expect(await FS.readText(startupFile)).toContain('compdef _tao ./tao')
    })
  })

  Test('leaves the startup file untouched when rerun', async () => {
    await withShellHome({ ZDOTDIR: true }, async (homeDir) => {
      const startupFile = FS.resolvePath('.zshrc', homeDir)
      await runTaoCliForTest(['completion', 'install', '--shell', 'zsh'])
      const afterFirstInstall = await FS.readText(startupFile)

      const result = await runTaoCliForTest(['completion', 'install', '--shell', 'zsh'])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('already installed')
      Expect(await FS.readText(startupFile)).toBe(afterFirstInstall)
    })
  })

  Test('preserves existing startup file contents', async () => {
    await withShellHome({ ZDOTDIR: true }, async (homeDir) => {
      const startupFile = FS.resolvePath('.zshrc', homeDir)
      await FS.writeText(startupFile, 'export EDITOR=vim')

      await runTaoCliForTest(['completion', 'install', '--shell', 'zsh'])

      const contents = await FS.readText(startupFile)
      Expect(contents).toContain('export EDITOR=vim')
      Expect(contents).toContain('source <(tao complete zsh)')
      Expect(contents).toContain('compdef _tao ./tao')
    })
  })

  Test('writes the fish hook into the fish config file', async () => {
    await withShellHome({ XDG_CONFIG_HOME: true }, async (homeDir) => {
      const result = await runTaoCliForTest(['completion', 'install', '--shell', 'fish'])

      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(FS.resolvePath('fish/config.fish', homeDir)))
        .toContain('tao complete fish | source')
    })
  })

  Test('reports an unsupported shell without writing anything', async () => {
    await withShellHome({ ZDOTDIR: true }, async (homeDir) => {
      const result = await runTaoCliForTest(['completion', 'install', '--shell', 'nushell'])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('nushell')
      Expect(await FS.exists(FS.resolvePath('.zshrc', homeDir))).toBe(false)
    })
  })

  Test('falls back to $SHELL when no shell is requested', async () => {
    await withShellHome({ SHELL: '/bin/bash' }, async (homeDir) => {
      const result = await runTaoCliForTest(['completion', 'install'])

      Expect(result.exitCode).toBe(0)
      const startupFile = await FS.readText(FS.resolvePath('.bashrc', homeDir))
      Expect(startupFile).toContain('source <(tao complete bash)')
      Expect(startupFile).toContain('complete -F __tao_complete ./tao')
    })
  })
})

Describe('tao shell completion surface', () => {
  Test('completes command names for the requested prefix', async () => {
    const lines = await captureCompletionRequest(['c'])

    Expect(lines).toContain('check\tCheck canonical Tao source and report validation warnings without writing.')
    Expect(lines.some(line => line.startsWith('dev\t'))).toBe(false)
  })

  Test('completes nested subcommands', async () => {
    const lines = await captureCompletionRequest(['completion', ''])

    Expect(lines.some(line => line.startsWith('install\t'))).toBe(true)
  })
})

type ShellHomeOverrides = {
  SHELL?: string
  XDG_CONFIG_HOME?: true
  ZDOTDIR?: true
}

/** withShellHome points shell startup-file lookup at a temporary home so tests never edit a real one. */
async function withShellHome(
  overrides: ShellHomeOverrides,
  testFunction: (homeDir: string) => Promise<void>,
): Promise<void> {
  const homeDir = await mkTestDir('tao-completion-test')
  const env = Platform.runtimeProcess.env
  const original = {
    HOME: env['HOME'],
    SHELL: env['SHELL'],
    XDG_CONFIG_HOME: env['XDG_CONFIG_HOME'],
    ZDOTDIR: env['ZDOTDIR'],
  }
  try {
    env['HOME'] = homeDir
    env['SHELL'] = overrides.SHELL ?? ''
    setOrDelete(env, 'ZDOTDIR', overrides.ZDOTDIR === true ? homeDir : undefined)
    setOrDelete(env, 'XDG_CONFIG_HOME', overrides.XDG_CONFIG_HOME === true ? homeDir : undefined)
    await testFunction(homeDir)
  } finally {
    for (const [name, value] of Object.entries(original)) {
      setOrDelete(env, name, value)
    }
    await FS.remove(homeDir)
  }
}

function setOrDelete(env: Platform.ProcessEnv, name: string, value: string | undefined): void {
  if (value === undefined) {
    delete env[name]
    return
  }
  env[name] = value
}

/** captureCompletionRequest runs one completion request and returns the candidate lines it printed. */
async function captureCompletionRequest(words: readonly string[]): Promise<string[]> {
  // The completion library prints candidates with console.log, which the CLI output capture does not observe.
  const log = console.log
  const lines: string[] = []
  console.log = (...values: unknown[]) => void lines.push(values.join(' '))
  try {
    await runTaoCliForTest(['complete', '--', ...words])
  } finally {
    console.log = log
  }
  return lines
}
