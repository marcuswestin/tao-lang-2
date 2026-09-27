import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const HOOK = 'packages/cli/agent-cli/agent-cli-src/cli/agent-session-start.zsh'

async function withCloudFixture(run: (root: string, env: Record<string, string>) => Promise<void>): Promise<void> {
  const directory = await mkTestDir('tao-cloud-setup-')
  const root = FS.resolvePath("checkout with 'quotes' and $literal", directory)
  try {
    await FS.writeText(FS.resolvePath(HOOK, root), await FS.readText(Repo.resolvePath(HOOK)))
    await FS.chmod(FS.resolvePath(HOOK, root), 0o755)
    await FS.writeText(
      FS.resolvePath('agent', root),
      '#!/bin/sh\nprintf "agent %s\\n" "$*" >> "$TAO_TEST_CALLS"\necho "setup chatter"\nexit "${TAO_TEST_SETUP_STATUS:-0}"\n',
    )
    await FS.chmod(FS.resolvePath('agent', root), 0o755)
    await FS.writeText(
      FS.resolvePath('bootstrap-tao-dev-env', root),
      '#!/bin/sh\nprintf "bootstrap %s\\n" "$*" >> "$TAO_TEST_CALLS"\necho "bootstrap detail" >&2\nexit "${TAO_TEST_BOOTSTRAP_STATUS:-0}"\n',
    )
    await FS.chmod(FS.resolvePath('bootstrap-tao-dev-env', root), 0o755)
    await FS.writeText(FS.resolvePath('bin/uname', root), '#!/bin/sh\nprintf "%s\\n" "$TAO_TEST_OS"\n')
    await FS.chmod(FS.resolvePath('bin/uname', root), 0o755)
    await run(root, {
      CLAUDE_CODE_REMOTE: '',
      CLAUDE_ENV_FILE: '',
      PATH: `${FS.resolvePath('bin', root)}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_TEST_BOOTSTRAP_STATUS: '0',
      TAO_TEST_CALLS: FS.resolvePath('calls', root),
      TAO_TEST_OS: 'Linux',
      TAO_TEST_SETUP_STATUS: '0',
    })
  } finally {
    await FS.remove(directory)
  }
}

async function writeProfileTool(root: string, name: string): Promise<void> {
  const path = FS.resolvePath(`.devenv/profile/bin/${name}`, root)
  await FS.writeText(path, '#!/bin/sh\nexit 0\n')
  await FS.chmod(path, 0o755)
}

Describe('cloud setup lifecycle', () => {
  Test('fresh remote Linux bootstraps from a nested working directory and hides success output', async () => {
    await withCloudFixture(async (root, env) => {
      const result = await CLI.run('sh', {
        args: [FS.resolvePath(HOOK, root)],
        cwd: FS.resolvePath('packages/cli', root),
        env: { ...env, CLAUDE_CODE_REMOTE: 'true' },
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toBe('')
      Expect(result.stderr).toBe('')
      Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('bootstrap --install-nix\n')
    })
  })

  Test('cached remote profiles reach bootstrap on every session across lock changes', async () => {
    await withCloudFixture(async (root, env) => {
      await writeProfileTool(root, 'bun')
      await writeProfileTool(root, 'node')
      // Bootstrap owns lock identity; the hook must reach it even when cached executables exist.
      for (const revision of ['first', 'changed']) {
        await FS.writeText(FS.resolvePath('devenv.lock', root), JSON.stringify({ revision }))
        const result = await CLI.run(FS.resolvePath(HOOK, root), {
          cwd: root,
          env: { ...env, CLAUDE_CODE_REMOTE: 'true' },
        })
        Expect(result.exitCode).toBe(0)
      }
      Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('bootstrap --install-nix\nbootstrap --install-nix\n')
    })
  })

  Test('an incomplete profile still bootstraps the missing tool', async () => {
    await withCloudFixture(async (root, env) => {
      await writeProfileTool(root, 'bun')
      const result = await CLI.run(FS.resolvePath(HOOK, root), {
        cwd: root,
        env: { ...env, CLAUDE_CODE_REMOTE: 'true' },
      })
      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('bootstrap --install-nix\n')
    })
  })

  Test('local sessions and non-Linux hosts never bootstrap automatically', async () => {
    for (const [remote, os] of [['', 'Linux'], ['false', 'Linux'], ['1', 'Linux'], ['true', 'Darwin']]) {
      await withCloudFixture(async (root, env) => {
        const result = await CLI.run(FS.resolvePath(HOOK, root), {
          cwd: root,
          env: { ...env, CLAUDE_CODE_REMOTE: remote!, TAO_TEST_OS: os! },
        })
        Expect(result.exitCode).toBe(0)
        Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('agent setup\n')
      })
    }
  })

  Test('bootstrap failure reaches the hook caller and prevents environment publication', async () => {
    await withCloudFixture(async (root, env) => {
      await writeProfileTool(root, 'bun')
      const envFile = FS.resolvePath('tool-shell', root)
      const result = await CLI.run(FS.resolvePath(HOOK, root), {
        cwd: root,
        env: { ...env, CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile, TAO_TEST_BOOTSTRAP_STATUS: '9' },
      })
      Expect(result.exitCode).toBe(9)
      Expect(result.stdout).toBe('')
      Expect(result.stderr).toContain('bootstrap detail')
      Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('bootstrap --install-nix\n')
      Expect(await FS.exists(envFile)).toBe(false)
    })
  })

  Test('publishes a literal profile PATH that can be sourced repeatedly', async () => {
    await withCloudFixture(async (root, env) => {
      await writeProfileTool(root, 'bun')
      await writeProfileTool(root, 'node')
      const envFile = FS.resolvePath('tool-shell', root)
      const result = await CLI.run(FS.resolvePath(HOOK, root), {
        cwd: root,
        env: { ...env, CLAUDE_ENV_FILE: envFile },
      })
      Expect(result.exitCode).toBe(0)
      const shell = await CLI.run('sh', {
        args: ['-c', '. "$1"; . "$1"; printf "%s" "$PATH"', 'sh', envFile],
        cwd: root,
        env,
      })
      Expect(shell.exitCode).toBe(0)
      Expect(shell.stdout).toBe(`${FS.resolvePath('.devenv/profile/bin', root)}:${env['PATH']}`)
    })
  })

  for (const phase of ['install', 'start'] as const) {
    Test(`Cursor ${phase} invokes the common bootstrap and propagates its failure`, async () => {
      await withCloudFixture(async (root, env) => {
        const config = JSON.parse(await FS.readText(Repo.resolvePath('.cursor/environment.json'))) as Record<
          'install' | 'start',
          string
        >
        Expect(config[phase]).toBe('./bootstrap-tao-dev-env --install-nix')
        const result = await CLI.run('sh', {
          args: ['-c', config[phase]],
          cwd: root,
          env: { ...env, TAO_TEST_BOOTSTRAP_STATUS: '8' },
        })
        Expect(result.exitCode).toBe(8)
        Expect(await FS.readText(env['TAO_TEST_CALLS']!)).toBe('bootstrap --install-nix\n')
      })
    })
  }
})
