import { CLI, Errors, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test } from '@shared/test'
import { runDirenvSetup } from '../dev-cli-src/shell/DirenvSetup'

const packageOutput = '/nix/store/0123456789abcdfghijklmnpqrsvwxyz-direnv-2.37.1'
const identity = 'a'.repeat(40)

async function fixture() {
  const root = await mkTestDir('direnv-setup-')
  const home = FS.resolvePath('developer home', root)
  const common = FS.resolvePath('common git directory', root)
  const shell = FS.resolvePath('.tao-dev/shell', home)
  const choice = FS.resolvePath(`repositories/${identity}/choice`, shell)
  const zshrc = FS.resolvePath('.zshrc', home)
  const profileClient = FS.resolvePath('.devenv/profile/bin/direnv', root)
  const source = FS.resolvePath('packages/cli/dev-cli/dev-cli-src/shell/direnv-activation.zsh', root)
  await FS.mkdir(common)
  await FS.writeText(zshrc, '# personal settings\nexport EDITOR=vim')
  await FS.writeText(profileClient, 'profile client')
  await FS.writeText(source, '# runtime fixture\n')
  await FS.writeText(FS.resolvePath('.envrc', root), '# envrc fixture\n')
  await FS.writeText(FS.resolvePath('.artifacts/cache/dev-shell/completion.zsh', root), '# completion fixture\n')
  const output: string[] = []
  const calls: Array<{ command: string; spec: CLI.CommandSpec }> = []
  const prompts: Parameters<HCIConfirm>[] = []
  const environment: NonNullable<Parameters<typeof runDirenvSetup>[1]> = {
    interactive: () => true,
    confirm: async options => {
      prompts.push([options])
      return true
    },
    write: text => {
      output.push(text)
    },
    root: () => root,
    env: { HOME: home, SHELL: '/bin/zsh' },
    fs: {
      ...FS,
      realPath: async path => path === profileClient ? `${packageOutput}/bin/direnv` : await FS.realPath(path),
    },
    run: async (command, spec = {}) => {
      calls.push({ command, spec })
      const stdout = command === 'git'
        ? spec.args?.[0] === 'rev-parse' ? `${common}\n` : `${identity}\n`
        : ''
      if (command === 'nix-store') {
        await FS.replaceSymlink(spec.args![1]!, spec.args![3]!)
      }
      return { command, args: [...spec.args ?? []], exitCode: 0, signal: null, stdout, stderr: '' }
    },
  }
  return { root, home, common, shell, choice, zshrc, profileClient, source, output, calls, prompts, environment }
}

type HCIConfirm = NonNullable<Parameters<typeof runDirenvSetup>[1]>['confirm']

Describe('optional developer shell setup', () => {
  Test('noninteractive setup neither prompts nor reads or writes host state, even with configure', async () => {
    const f = await fixture()
    try {
      f.environment.interactive = () => false
      f.environment.root = () => Errors.throwUnexpected('No repository inspection')
      f.environment.confirm = async () => Errors.throwUnexpected('No prompt')
      f.environment.fs = {
        ...f.environment.fs,
        exists: async () => Errors.throwUnexpected('No host reads'),
        mkdir: async () => Errors.throwUnexpected('No host writes'),
      }
      Expect(await runDirenvSetup({ configure: true }, f.environment)).toBe(0)
      f.environment.interactive = () => true
      f.environment.env = { ...f.environment.env, TAO_DEV_SHELL_SETUP: '0' }
      Expect(await runDirenvSetup({ configure: true }, f.environment)).toBe(0)
      Expect(f.calls).toEqual([])
      Expect(await FS.exists(f.shell)).toBe(false)
      Expect(await FS.readText(f.zshrc)).toBe('# personal settings\nexport EDITOR=vim')
    } finally {
      await FS.remove(f.root)
    }
  })

  Test('declining remembers this repository without installing or changing shell settings', async () => {
    const f = await fixture()
    try {
      f.environment.confirm = async options => {
        Expect(options.defaultValue).toBe(false)
        Expect(await FS.exists(f.shell)).toBe(false)
        f.prompts.push([options])
        return false
      }
      await runDirenvSetup({}, f.environment)
      await runDirenvSetup({}, f.environment)
      Expect(f.prompts).toHaveLength(1)
      Expect(await FS.readText(f.choice)).toBe('disabled\n')
      Expect(await FS.readText(FS.resolvePath(`repositories/${identity}/common-dir`, f.shell))).toBe(`${f.common}\n`)
      Expect(f.calls.every(call => call.command === 'git')).toBe(true)
      Expect(await FS.exists(FS.resolvePath('activation.zsh', f.shell))).toBe(false)
      Expect(await FS.readText(f.zshrc)).toBe('# personal settings\nexport EDITOR=vim')
      f.environment.confirm = async options => {
        f.prompts.push([options])
        return true
      }
      await runDirenvSetup({ configure: true }, f.environment)
      Expect(f.prompts).toHaveLength(2)
      Expect(await FS.readText(f.choice)).toBe('enabled\n')
      f.environment.confirm = async () => false
      await runDirenvSetup({ configure: true }, f.environment)
      Expect(await FS.readText(f.choice)).toBe('disabled\n')
      Expect(await FS.exists(FS.resolvePath('activation.zsh', f.shell))).toBe(true)
    } finally {
      await FS.remove(f.root)
    }
  })

  Test(
    'roots the exact Nix package, copies the runtime, preserves symlinked settings and configures idempotently',
    async () => {
      const f = await fixture()
      try {
        const managed = FS.resolvePath('machine/dotfiles/zshrc', f.root)
        const dotdir = FS.resolvePath('zsh settings', f.home)
        const link = FS.resolvePath('.zshrc', dotdir)
        await FS.writeText(managed, '# managed personal settings\nexport EDITOR=vim')
        await FS.symlink(managed, link)
        f.environment.env = { ...f.environment.env, ZDOTDIR: dotdir }
        f.environment.confirm = async options => {
          Expect(await FS.exists(f.shell)).toBe(false)
          Expect(options.defaultValue).toBe(false)
          f.prompts.push([options])
          return true
        }
        await runDirenvSetup({}, f.environment)
        await runDirenvSetup({}, f.environment)
        Expect(f.prompts).toHaveLength(1)
        f.environment.confirm = async options => {
          f.prompts.push([options])
          return true
        }
        await runDirenvSetup({ configure: true }, f.environment)
        Expect(f.prompts).toHaveLength(2)
        const rooted = FS.resolvePath('direnv', f.shell)
        Expect(f.calls.filter(call => call.command === 'nix-store').map(call => call.spec.args)).toEqual([
          ['--realise', packageOutput, '--add-root', rooted, '--indirect'],
          ['--realise', packageOutput, '--add-root', rooted, '--indirect'],
        ])
        Expect((await FS.entryMetadata(rooted)).linkTarget).toBe(packageOutput)
        Expect(f.calls.find(call => call.spec.args?.[0] === 'hash-object')?.spec.stdin).toBe(`${f.common}\n`)
        Expect(await FS.isSymbolicLink(link)).toBe(true)
        Expect(await FS.realPath(link)).toBe(managed)
        Expect(await FS.readText(managed)).toBe(
          `# managed personal settings\nexport EDITOR=vim\n[[ ! -r '${f.shell}/activation.zsh' ]] || source '${f.shell}/activation.zsh'\n`,
        )
        await FS.remove(f.source)
        Expect(await FS.readText(FS.resolvePath('activation.zsh', f.shell))).toBe('# runtime fixture\n')
        Expect(await FS.readText(FS.resolvePath('envrc', f.shell))).toBe('# envrc fixture\n')
        Expect(await FS.readText(FS.resolvePath('completion.zsh', f.shell))).toBe('# completion fixture\n')
        Expect(await FS.readText(f.choice)).toBe('enabled\n')
        Expect(await FS.readText(f.zshrc)).toBe('# personal settings\nexport EDITOR=vim')
      } finally {
        await FS.remove(f.root)
      }
    },
  )

  Test('missing pinned tools, root failures and protected dotfiles never publish enablement', async () => {
    for (const failure of ['profile', 'devenv', 'nix-store', 'zshrc']) {
      const f = await fixture()
      try {
        const run = f.environment.run
        f.environment.run = async (command, spec) => {
          if (command === failure) {
            return { command, args: [], exitCode: 1, signal: null, stdout: '', stderr: 'unavailable' }
          }
          return await run(command, spec)
        }
        const realPath = f.environment.fs.realPath
        f.environment.fs.realPath = async path =>
          failure === 'profile' && path === f.profileClient
            ? `${f.root}/worktree/.devenv/profile/bin/direnv`
            : await realPath(path)
        f.environment.fs.writeText = async (path, content, options) => {
          if (failure === 'zshrc' && path === f.zshrc) {
            Errors.throwHostEnvironment('Managed file is unwritable')
          }
          await FS.writeText(path, content, options)
        }
        await Expect(runDirenvSetup({}, f.environment)).rejects.toThrow(
          failure === 'profile'
            ? `cd '${f.root}'\n./agent setup --environment`
            : failure === 'zshrc'
            ? `[[ ! -r '${f.shell}/activation.zsh' ]] || source '${f.shell}/activation.zsh'`
            : failure === 'devenv'
            ? 'existing host devenv'
            : 'Nix GC root',
        )
        Expect(await FS.readText(f.choice)).toBe('disabled\n')
        Expect(await FS.readText(f.zshrc)).toBe('# personal settings\nexport EDITOR=vim')
        if (failure === 'profile') {
          Expect(f.calls.some(call => call.command === 'nix-store')).toBe(false)
        }
      } finally {
        await FS.remove(f.root)
      }
    }
  })

  Test('unsupported shells and newline paths fail before prompting or creating host state', async () => {
    const f = await fixture()
    try {
      f.environment.env = { ...f.environment.env, SHELL: '/bin/bash' }
      Expect(await runDirenvSetup({}, f.environment)).toBe(0)
      Expect(f.output.join('\n')).toContain('supports zsh')
      f.environment.env = { ...f.environment.env, SHELL: '/bin/zsh', HOME: `${f.home}\ninvalid` }
      await Expect(runDirenvSetup({}, f.environment)).rejects.toThrow('line breaks')
      Expect(f.prompts).toEqual([])
      Expect(f.calls).toEqual([])
      Expect(await FS.exists(f.shell)).toBe(false)
    } finally {
      await FS.remove(f.root)
    }
  })

  Test('concurrent repositories serialize shared host writes and preserve both permissions', async () => {
    const f = await fixture()
    const held = Deferred()
    const release = Deferred()
    let first: Promise<number> | undefined
    let second: Promise<number> | undefined
    try {
      const otherCommon = FS.resolvePath('other git directory', f.root)
      await FS.mkdir(otherCommon)
      const secondIdentity = 'b'.repeat(40)
      const run = f.environment.run
      let roots = 0
      f.environment.run = async (command, spec) => {
        if (command === 'nix-store' && ++roots === 1) {
          held.resolve()
          await release.promise
        }
        return await run(command, spec)
      }
      const secondLockEntered = Deferred()
      const other = {
        ...f.environment,
        fs: {
          ...f.environment.fs,
          withFileMutationLock: (async (...args) => {
            secondLockEntered.resolve()
            return await FS.withFileMutationLock(...args)
          }) as typeof FS.withFileMutationLock,
        },
        run: (async (command, spec) => {
          const result = await f.environment.run(command, spec)
          if (command === 'git') {
            result.stdout = `${spec?.args?.[0] === 'rev-parse' ? otherCommon : secondIdentity}\n`
          }
          return result
        }) as typeof CLI.run,
      }
      first = runDirenvSetup({}, f.environment)
      await Promise.race([held.promise, first])
      second = runDirenvSetup({}, other)
      await Promise.race([
        secondLockEntered.promise,
        second.then(() =>
          Errors.throwUnexpected('The second installation completed while the first held configuration.')
        ),
      ])
      Expect(roots).toBe(1)
      Expect(await FS.readText(f.choice)).toBe('disabled\n')
      release.resolve()
      Expect(await Promise.all([first, second])).toEqual([0, 0])
      Expect(roots).toBe(2)
      Expect(await FS.readText(f.choice)).toBe('enabled\n')
      Expect(await FS.readText(FS.resolvePath(`repositories/${secondIdentity}/choice`, f.shell))).toBe('enabled\n')
      Expect((await FS.readText(f.zshrc)).split('\n').filter(line => line.includes('source '))).toHaveLength(1)
    } finally {
      release.resolve()
      await Promise.allSettled([first, second])
      await FS.remove(f.root)
    }
  })
})
