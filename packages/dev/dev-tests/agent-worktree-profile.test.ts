import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const PROFILE_SCRIPT = Repo.resolvePath('packages/dev/dev-src/cli/agent-worktree-profile.zsh')

type ProfileFixture = {
  env: Platform.ProcessEnv
  primaryProfile: string
  systemTemp: string
  worktree: string
}

Describe('agent worktree profile bootstrap', () => {
  Test('links and activates the primary pinned profile idempotently', async () => {
    const testRoot = await mkTestDir('tao-agent-profile-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const profile = FS.resolvePath('profile', testRoot)
      const result = await runProfileScript(
        [
          'tao_activate_devenv_profile "$2" "$3"',
          'tao_activate_devenv_profile "$2" "$3"',
          'command -v node',
          'node --version',
        ].join('\n'),
        fixture,
        profile,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim().split('\n')).toEqual([
        FS.resolvePath('bin/node', profile),
        'v24.test',
      ])
      Expect(await FS.realPath(profile)).toBe(await FS.realPath(fixture.primaryProfile))
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('tolerates concurrent first links', async () => {
    const testRoot = await mkTestDir('tao-agent-profile-race-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const profile = FS.resolvePath('profile', testRoot)
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          () => runProfileScript('tao_link_primary_devenv_profile "$2" "$3"', fixture, profile),
        ),
      )

      Expect(results.map(result => result.exitCode)).toEqual(Array.from({ length: 8 }, () => 0))
      Expect(await FS.realPath(profile)).toBe(await FS.realPath(fixture.primaryProfile))
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('declines a linked worktree when the primary profile is missing', async () => {
    const testRoot = await mkTestDir('tao-agent-profile-missing-')
    try {
      const fixture = await createProfileFixture(testRoot, false)
      const profile = FS.resolvePath('profile', testRoot)
      const result = await runProfileScript(
        'if tao_activate_devenv_profile "$2" "$3"; then exit 9; fi',
        fixture,
        profile,
      )

      Expect(result.exitCode).toBe(0)
      Expect(await FS.exists(profile)).toBe(false)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('uses the macOS per-user temporary directory for Bun bootstrap', async () => {
    const testRoot = await mkTestDir('tao-agent-temp-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const fallback = FS.resolvePath('fallback-temp', testRoot)
      await FS.mkdir(fallback)
      const result = await runProfileScript('tao_bun_temp_dir "$2"', fixture, fallback)

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(await FS.realPath(fixture.systemTemp))
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('uses the sandbox-compatible Bun installation contract', async () => {
    const source = await FS.readText(Repo.resolvePath('agent'))

    Expect(source).toContain('TMPDIR="$BUN_TEMP_DIR" bun install --backend=copyfile')
    Expect(source).not.toContain('BUN_TMPDIR=')
  })
})

async function createProfileFixture(testRoot: string, withPrimaryProfile: boolean): Promise<ProfileFixture> {
  const fakeBin = FS.resolvePath('bin', testRoot)
  const fakeGit = FS.resolvePath('git', fakeBin)
  const fakeGetconf = FS.resolvePath('getconf', fakeBin)
  const primaryRoot = FS.resolvePath('primary', testRoot)
  const primaryProfile = FS.resolvePath('.devenv/profile', primaryRoot)
  const systemTemp = FS.resolvePath('system-temp', testRoot)
  const systemTempAlias = FS.resolvePath('system-temp-alias', testRoot)
  const worktree = FS.resolvePath('linked-worktree', testRoot)
  await Promise.all([FS.mkdir(systemTemp), FS.mkdir(worktree)])
  await FS.symlink(systemTemp, systemTempAlias)
  await FS.writeText(fakeGit, '#!/bin/zsh\nprint -r -- "$TAO_TEST_COMMON_GIT_DIR"\n')
  await FS.writeText(fakeGetconf, '#!/bin/zsh\nprint -r -- "$TAO_TEST_DARWIN_TEMP_DIR"\n')
  await Promise.all([makeExecutable(fakeGetconf), makeExecutable(fakeGit)])
  if (withPrimaryProfile) {
    const primaryNode = FS.resolvePath('bin/node', primaryProfile)
    await FS.writeText(primaryNode, '#!/bin/zsh\nprint -r -- v24.test\n')
    await makeExecutable(primaryNode)
  }
  return {
    env: {
      PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_TEST_COMMON_GIT_DIR: FS.resolvePath('.git', primaryRoot),
      TAO_TEST_DARWIN_TEMP_DIR: systemTempAlias,
    },
    primaryProfile,
    systemTemp,
    worktree,
  }
}

async function makeExecutable(path: string): Promise<void> {
  const result = await CLI.run('chmod', { args: ['+x', path] })
  Expect(result.exitCode).toBe(0)
}

async function runProfileScript(
  script: string,
  fixture: ProfileFixture,
  profile: string,
): Promise<CLI.CommandResult> {
  return await CLI.run('zsh', {
    args: ['-c', `source "$1"\n${script}`, 'agent-profile-test', PROFILE_SCRIPT, fixture.worktree, profile],
    env: fixture.env,
  })
}
