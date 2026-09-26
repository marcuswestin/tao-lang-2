import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('pinned environment setup', () => {
  Test('can provision before a profile exists and propagates setup failure', async () => {
    const root = await mkTestDir('tao-environment-setup-')
    try {
      const entry = FS.resolvePath('agent', root)
      await FS.writeText(entry, await FS.readText(Repo.resolvePath('agent')))
      const bootstrap = FS.resolvePath('enter-tao-dev-env', root)
      await FS.writeText(bootstrap, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 23\n')
      await FS.chmod(bootstrap, 0o755)
      const result = await CLI.run('zsh', { args: [entry, 'setup', '--environment'], cwd: root })
      Expect(result.stdout.trim()).toBe('--setup-only')
      Expect(result.exitCode).toBe(23)
      Expect(await FS.exists(FS.resolvePath('.devenv', root))).toBe(false)
      const extra = await CLI.run('zsh', { args: [entry, 'setup', '--environment', '--extra'], cwd: root })
      Expect(extra.exitCode).toBe(2)
      Expect(extra.stdout).toBe('')
      Expect(extra.stderr).toContain('Usage: ./agent setup --environment')
    } finally {
      await FS.remove(root)
    }
  })

  Test('materializes the environment and runs setup without opening an interactive shell', async () => {
    const root = await mkTestDir('tao-environment-noninteractive-')
    try {
      const entry = FS.resolvePath('enter-tao-dev-env', root)
      await FS.writeText(entry, await FS.readText(Repo.resolvePath('enter-tao-dev-env')))
      const devenv = FS.resolvePath('bin/devenv', root)
      await FS.writeText(devenv, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n')
      await FS.chmod(devenv, 0o755)
      const result = await CLI.run('/bin/sh', {
        args: [entry, '--setup-only'],
        env: { PATH: `${FS.dirname(devenv)}:/usr/bin:/bin`, SHELL: '/bin/zsh' },
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim().split('\n')).toEqual([root, 'shell', '--no-tui', './agent', 'setup'])
      Expect(await FS.exists(FS.resolvePath('.artifacts/cache/dev-shell', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})
