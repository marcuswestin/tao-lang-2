import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const DEPENDENCY_SCRIPT = 'packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh'
const PROFILE_SCRIPT = 'packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh'

type Fixture = {
  bunLog: string
  env: Platform.ProcessEnv
  root: string
}

async function fixture(): Promise<Fixture> {
  const root = await mkTestDir('tao-agent-config-recovery-')
  const bin = FS.resolvePath('bin', root)
  const bunLog = FS.resolvePath('bun.log', root)
  await FS.mkdir(bin)
  for (
    const path of ['agent', 'dev', DEPENDENCY_SCRIPT, 'packages/cli/dev-cli/dev-cli-src/environment/repo-shell.sh']
  ) {
    await FS.writeText(FS.resolvePath(path, root), await FS.readText(Repo.resolvePath(path)))
  }
  await FS.writeText(
    FS.resolvePath(PROFILE_SCRIPT, root),
    [
      'function tao_activate_devenv_profile() { return 0 }',
      'function tao_bun_temp_dir() { print -r -- "$1/" }',
      'function tao_bun_install_args() { reply=(install --cwd "$1") }',
      'function tao_run_with_lock() { shift 2; "$@" }',
      'function tao_warn_on_detached_head() { return 0 }',
      '',
    ].join('\n'),
  )
  await FS.writeText(
    FS.resolvePath('bun', bin),
    [
      '#!/usr/bin/env zsh',
      'print -r -- "$*" >> "$TAO_TEST_BUN_LOG"',
      'if [[ "$1" == run && "${TAO_TEST_HEALTH_FAIL:-}" == 1 ]]; then exit 1; fi',
      'exit 0',
      '',
    ].join('\n'),
  )
  for (const path of ['agent', 'dev', 'bin/bun']) {
    await FS.chmod(FS.resolvePath(path, root), 0o755)
  }
  return {
    bunLog,
    env: {
      PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_TEST_BUN_LOG: bunLog,
    },
    root,
  }
}

async function bunCommands(fixture: Fixture): Promise<string[]> {
  return await FS.exists(fixture.bunLog)
    ? (await FS.readText(fixture.bunLog)).trim().split('\n').filter(Boolean)
    : []
}

async function runDependencyCheck(fixture: Fixture, env: Platform.ProcessEnv = {}) {
  return await CLI.run('zsh', {
    args: [FS.resolvePath(DEPENDENCY_SCRIPT, fixture.root), fixture.root, '--no-install'],
    cwd: fixture.root,
    env: { ...fixture.env, ...env },
  })
}

Describe('agent-config recovery bootstrap', () => {
  Test('both unsandboxed entrypoints refuse missing dependencies before Bun can install', async () => {
    const test = await fixture()
    try {
      for (const [entrypoint, command] of [['agent', 'fix-agent-config'], ['dev', 'agent-config']] as const) {
        const result = await CLI.run(FS.resolvePath(entrypoint, test.root), {
          args: [command],
          cwd: test.root,
          env: test.env,
        })
        Expect(result.exitCode).not.toBe(0)
        Expect(result.stderr).toContain("Run './agent setup'")
      }
      Expect(await bunCommands(test)).toEqual([])
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('the no-install path rejects stale and unhealthy trees without installing', async () => {
    const test = await fixture()
    try {
      await FS.mkdir(FS.resolvePath('node_modules', test.root))
      const stamp = FS.resolvePath('.artifacts/build/agent-dev/dev-deps.stamp', test.root)
      const packageJson = FS.resolvePath('package.json', test.root)
      await FS.writeText(stamp, '')
      await FS.writeText(packageJson, '{}')
      await FS.setModifiedTimeMs(stamp, Date.now() - 10_000)
      const stale = await runDependencyCheck(test)
      Expect(stale.exitCode).not.toBe(0)
      Expect(stale.stderr).toContain('found stale')
      Expect(await bunCommands(test)).toEqual([])

      await FS.setModifiedTimeMs(stamp, Date.now() + 10_000)
      const unhealthy = await runDependencyCheck(test, { TAO_TEST_HEALTH_FAIL: '1' })
      Expect(unhealthy.exitCode).not.toBe(0)
      Expect(unhealthy.stderr).toContain('unhealthy dependencies')
      Expect(await bunCommands(test)).toEqual([
        `run ${FS.resolvePath('packages/testing/verification/verification-src/DependencyHealth.ts', test.root)}`,
      ])
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('a healthy installed tree passes without an install', async () => {
    const test = await fixture()
    try {
      await FS.mkdir(FS.resolvePath('node_modules', test.root))
      const result = await runDependencyCheck(test)
      Expect(result.exitCode).toBe(0)
      Expect(await bunCommands(test)).toEqual([
        `run ${FS.resolvePath('packages/testing/verification/verification-src/DependencyHealth.ts', test.root)}`,
      ])
      Expect(await FS.exists(FS.resolvePath('.artifacts/build/agent-dev/dev-deps.stamp', test.root))).toBe(true)
    } finally {
      await FS.remove(test.root)
    }
  })
})
