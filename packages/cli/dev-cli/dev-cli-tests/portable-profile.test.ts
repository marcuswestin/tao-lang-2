import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const SHELL_SCRIPT = 'packages/cli/dev-cli/dev-cli-src/environment/repo-shell.sh'
const PROFILE_SCRIPT = 'packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh'
const DEPENDENCY_SCRIPT = 'packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh'

type Fixture = {
  root: string
  env: Platform.ProcessEnv
  shellLog: string
  zsh: string
}

Describe('portable profile shell dispatch', () => {
  for (const entrypoint of ['agent', 'dev', 'tao']) {
    Test(`${entrypoint} starts through pinned zsh with no tools on PATH and preserves arguments`, async () => {
      const fixture = await createFixture()
      try {
        await writeShell(fixture, '.devenv/profile/bin/zsh')
        const result = await CLI.run(FS.resolvePath(entrypoint, fixture.root), {
          args: ['a spaced argument', '', '--flag=value'],
          cwd: FS.resolvePath('elsewhere', fixture.root),
          env: fixture.env,
        })
        Expect(result.exitCode).toBe(0)
        Expect(result.stdout.trimEnd().split('\n').slice(-3)).toEqual(['a spaced argument', '', '--flag=value'])
        Expect(result.stdout).toContain(fixture.root)
        Expect((await FS.readText(fixture.shellLog)).split('\n').slice(0, 4)).toEqual([
          FS.resolvePath(entrypoint, fixture.root),
          'a spaced argument',
          '',
          '--flag=value',
        ])
      } finally {
        await FS.remove(fixture.root)
      }
    })
  }

  Test('an older profile reuses host zsh without provisioning tools', async () => {
    const fixture = await createFixture()
    try {
      await writeShell(fixture, 'host-bin/zsh')
      const result = await CLI.run(FS.resolvePath('tao', fixture.root), {
        args: ['--version'],
        env: { ...fixture.env, PATH: FS.resolvePath('host-bin', fixture.root) },
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trimEnd().split('\n')).toEqual([
        FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', fixture.root),
        '--version',
      ])
      Expect(await FS.exists(FS.resolvePath('.devenv/profile/bin/zsh', fixture.root))).toBe(false)
    } finally {
      await FS.remove(fixture.root)
    }
  })

  Test('a symlink entrypoint keeps the original repository directory', async () => {
    const fixture = await createFixture()
    try {
      await writeShell(fixture, '.devenv/profile/bin/zsh')
      const link = FS.resolvePath('elsewhere/tao-link', fixture.root)
      await FS.symlink('../tao', link)
      const result = await CLI.run(link, {
        args: ['--help'],
        env: { ...fixture.env, PATH: Platform.runtimeProcess.env['PATH'] ?? '' },
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trimEnd().split('\n')).toEqual([
        FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', fixture.root),
        '--help',
      ])
    } finally {
      await FS.remove(fixture.root)
    }
  })

  Test('an explicit zsh invocation still runs the original launcher body', async () => {
    const fixture = await createFixture()
    try {
      await FS.symlink(fixture.zsh, FS.resolvePath('.devenv/profile/bin/zsh', fixture.root))
      const result = await CLI.run(fixture.zsh, {
        args: [FS.resolvePath('agent', fixture.root), 'help'],
        env: fixture.env,
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trimEnd().split('\n')).toEqual([
        FS.resolvePath('.artifacts/build/agent-dev/agent-dev.js', fixture.root),
        'help',
      ])
      Expect(await FS.exists(fixture.shellLog)).toBe(false)
    } finally {
      await FS.remove(fixture.root)
    }
  })

  Test('missing profile and host zsh fail with the explicit bootstrap command', async () => {
    const fixture = await createFixture()
    try {
      await FS.remove(FS.resolvePath('.devenv', fixture.root))
      const result = await CLI.run(FS.resolvePath('tao', fixture.root), { env: fixture.env })
      Expect(result.exitCode).toBe(1)
      Expect(result.stdout).toBe('')
      Expect(result.stderr).toContain("Tao's pinned profile or zsh is unavailable.")
      Expect(result.stderr).toContain('./.config/bootstrap-tao-dev-env')
      Expect(await FS.exists(FS.resolvePath('.devenv', fixture.root))).toBe(false)
    } finally {
      await FS.remove(fixture.root)
    }
  })
})

async function createFixture(): Promise<Fixture> {
  const root = await mkTestDir('tao-portable-profile-')
  const resolvedZsh = await CLI.run('zsh', { args: ['-c', 'print -r -- "$commands[zsh]"'] })
  Expect(resolvedZsh.exitCode).toBe(0)
  const zsh = resolvedZsh.stdout.trim()
  const shellLog = FS.resolvePath('shell.log', root)
  await FS.mkdir(FS.resolvePath('elsewhere', root))
  for (const path of ['agent', 'dev', 'tao', SHELL_SCRIPT]) {
    await FS.writeText(FS.resolvePath(path, root), await FS.readText(Repo.resolvePath(path)))
    await FS.chmod(FS.resolvePath(path, root), 0o755)
  }
  await FS.writeText(
    FS.resolvePath(PROFILE_SCRIPT, root),
    [
      'function tao_activate_devenv_profile() { export PATH="$2/bin:/usr/bin:/bin" }',
      'function tao_bun_temp_dir() { print -r -- "$1/" }',
      'function tao_run_with_lock() { shift 2; "$@" }',
      'function tao_warn_on_detached_head() { return 0 }',
      '',
    ].join('\n'),
  )
  await FS.writeText(FS.resolvePath(DEPENDENCY_SCRIPT, root), 'exit 0\n')
  await FS.writeText(
    FS.resolvePath('.devenv/profile/bin/bun', root),
    '#!/bin/sh\n[ "$1" = build ] && exit 0\nprintf "%s\\n" "$@"\n',
  )
  await FS.chmod(FS.resolvePath('.devenv/profile/bin/bun', root), 0o755)
  return { root, shellLog, zsh, env: { PATH: '', TAO_TEST_ZSH: zsh, TAO_TEST_SHELL_LOG: shellLog } }
}

async function writeShell(fixture: Fixture, path: string): Promise<void> {
  const target = FS.resolvePath(path, fixture.root)
  await FS.writeText(
    target,
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$TAO_TEST_SHELL_LOG"\nexec "$TAO_TEST_ZSH" "$@"\n',
  )
  await FS.chmod(target, 0o755)
}
