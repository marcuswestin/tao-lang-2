import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const PROFILE_SCRIPT = Repo.resolvePath('packages/dev/dev-src/cli/agent-worktree-profile.zsh')

type ProfileFixture = {
  commonGitDir: string
  env: Platform.ProcessEnv
  gitDirAlias: string
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
      Expect(result.stdout.trim()).toBe(`${await FS.realPath(fixture.systemTemp)}/`)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('uses repository temporary files when preferred directories deny file creation', async () => {
    const testRoot = await mkTestDir('tao-agent-restricted-temp-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const fallback = FS.resolvePath('fallback-temp', testRoot)
      await FS.mkdir(fallback)
      const result = await runProfileScript(
        'function mktemp() { return 1 }\ntao_bun_temp_dir "$3"',
        fixture,
        fallback,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(`${await FS.realPath(fallback)}/`)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('uses copyfile installation only for linked worktrees', async () => {
    const testRoot = await mkTestDir('tao-agent-install-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const profile = FS.resolvePath('profile', testRoot)
      const linkedResult = await runProfileScript(
        'tao_bun_install_args "$2"\nprint -rl -- "${reply[@]}"',
        fixture,
        profile,
      )

      Expect(linkedResult.exitCode).toBe(0)
      Expect(linkedResult.stdout.trim().split('\n')).toEqual([
        'install',
        '--backend=copyfile',
        '--cwd',
        fixture.worktree,
      ])

      fixture.env['TAO_TEST_GIT_DIR'] = fixture.gitDirAlias
      const primaryResult = await runProfileScript(
        'tao_bun_install_args "$2"\nprint -rl -- "${reply[@]}"',
        fixture,
        profile,
      )

      Expect(primaryResult.exitCode).toBe(0)
      Expect(primaryResult.stdout.trim().split('\n')).toEqual([
        'install',
        '--cwd',
        fixture.worktree,
      ])
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('times out under contention and reacquires after the holder exits', async () => {
    const testRoot = await mkTestDir('tao-agent-lock-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const profile = FS.resolvePath('profile', testRoot)
      const result = await runProfileScript(
        [
          'lock_file="$2/bootstrap.lock"',
          'ready_file="$2/bootstrap.ready"',
          'function hold_lock() { print -r -- ready > "$ready_file"; sleep 0.2 }',
          'tao_run_with_lock "$lock_file" 2 hold_lock &',
          'holder_pid=$!',
          'for attempt in {1..100}; do [[ -f "$ready_file" ]] && break; sleep 0.01; done',
          '[[ -f "$ready_file" ]] || exit 8',
          'if tao_run_with_lock "$lock_file" 0.05 true; then exit 9; fi',
          'wait "$holder_pid"',
          'tao_run_with_lock "$lock_file" 0.1 print -r -- acquired',
        ].join('\n'),
        fixture,
        profile,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe('acquired')
      Expect(result.stderr).toContain('Timed out waiting for agent bootstrap lock:')
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('reuses checkout-specific installation arguments after a transient failure', async () => {
    const source = await FS.readText(Repo.resolvePath('agent'))

    Expect(source.split('bun "${BUN_INSTALL_ARGS[@]}"').length - 1).toBe(2)
    Expect(source).toContain('unable to write files to tempdir: PermissionDenied')
    Expect(source).not.toContain('bun install --backend=copyfile')
    Expect(source).not.toContain('command -v lockf')
    Expect(source).not.toContain('BUN_TMPDIR=')
  })

  Test('activates the pinned profile before the developer CLI starts', async () => {
    const source = await FS.readText(Repo.resolvePath('dev'))
    const activation = source.indexOf('tao_activate_devenv_profile')
    const launch = source.indexOf('exec bun run')

    Expect(source).toContain('source "$SCRIPT_DIR/packages/dev/dev-src/cli/agent-worktree-profile.zsh"')
    Expect(activation).toBeGreaterThan(0)
    Expect(launch).toBeGreaterThan(activation)
    Expect(source).toContain('direnv allow && direnv exec . ./agent setup')
  })

  Test('repairs incomplete dependency graphs from repository-local Bun storage', async () => {
    const source = await FS.readText(Repo.resolvePath('Justfile'))

    Expect(source).toContain('BUN_CACHE_DIR := justfile_directory() + "/.artifacts/cache/bun"')
    Expect(source).toContain('BUN_TMP_DIR := justfile_directory() + "/.artifacts/tmp/bun"')
    Expect(source).toContain('TMPDIR="{{ BUN_TMP_DIR }}" bun install --frozen-lockfile')
    Expect(source).toContain('bun install --frozen-lockfile --force --cache-dir="{{ BUN_CACHE_DIR }}"')
    Expect(source).toContain('require("expo/metro-config"); require("jest-expo/jest-preset")')
  })

  Test('keeps dprint caches out of developer home directories', async () => {
    const source = await FS.readText(Repo.resolvePath('Justfile'))
    const dprintCommands = source.split('\n').filter(line => line.trimStart().startsWith('dprint '))

    Expect(dprintCommands.length).toBeGreaterThan(0)
    Expect(dprintCommands.every(command => command.includes('--incremental=false'))).toBe(true)
  })
})

async function createProfileFixture(testRoot: string, withPrimaryProfile: boolean): Promise<ProfileFixture> {
  const fakeBin = FS.resolvePath('bin', testRoot)
  const fakeGit = FS.resolvePath('git', fakeBin)
  const fakeGetconf = FS.resolvePath('getconf', fakeBin)
  const primaryRoot = FS.resolvePath('primary', testRoot)
  const commonGitDir = FS.resolvePath('.git', primaryRoot)
  const linkedGitDir = FS.resolvePath('worktrees/fixture', commonGitDir)
  const gitDirAlias = FS.resolvePath('primary-git-alias', testRoot)
  const primaryProfile = FS.resolvePath('.devenv/profile', primaryRoot)
  const systemTemp = FS.resolvePath('system-temp', testRoot)
  const systemTempAlias = FS.resolvePath('system-temp-alias', testRoot)
  const worktree = FS.resolvePath('linked-worktree', testRoot)
  await Promise.all([FS.mkdir(linkedGitDir), FS.mkdir(systemTemp), FS.mkdir(worktree)])
  await Promise.all([
    FS.symlink(commonGitDir, gitDirAlias),
    FS.symlink(systemTemp, systemTempAlias),
  ])
  await FS.writeText(
    fakeGit,
    [
      '#!/bin/zsh',
      'if [[ " $* " == *" --absolute-git-dir "* ]]; then',
      '  print -r -- "$TAO_TEST_GIT_DIR"',
      'elif [[ " $* " == *" --git-common-dir "* ]]; then',
      '  print -r -- "$TAO_TEST_COMMON_GIT_DIR"',
      'else',
      '  exit 2',
      'fi',
      '',
    ].join('\n'),
  )
  await FS.writeText(fakeGetconf, '#!/bin/zsh\nprint -r -- "$TAO_TEST_DARWIN_TEMP_DIR"\n')
  await Promise.all([makeExecutable(fakeGetconf), makeExecutable(fakeGit)])
  if (withPrimaryProfile) {
    const primaryNode = FS.resolvePath('bin/node', primaryProfile)
    await FS.writeText(primaryNode, '#!/bin/zsh\nprint -r -- v24.test\n')
    await makeExecutable(primaryNode)
  }
  return {
    commonGitDir,
    env: {
      PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_TEST_COMMON_GIT_DIR: commonGitDir,
      TAO_TEST_DARWIN_TEMP_DIR: systemTempAlias,
      TAO_TEST_GIT_DIR: linkedGitDir,
    },
    gitDirAlias,
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
