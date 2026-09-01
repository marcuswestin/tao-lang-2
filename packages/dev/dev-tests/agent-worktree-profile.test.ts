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

  Test("rejects a temporary directory that allows files but denies Bun's nested writes", async () => {
    const testRoot = await mkTestDir('tao-agent-shallow-temp-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const fallback = FS.resolvePath('fallback-temp', testRoot)
      await FS.mkdir(fallback)
      // A directory whose only denial is the rename Bun publishes each package with: the
      // previous single-file probe accepted it and the install then failed part-way through.
      const result = await runProfileScript(
        ['function mv() { return 1 }', 'tao_bun_temp_dir "$3"'].join('\n'),
        fixture,
        fallback,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(`${await FS.realPath(fallback)}/`)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test("prefers the worktree's own scratch under an agent sandbox", async () => {
    const testRoot = await mkTestDir('tao-agent-sandbox-temp-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const fallback = FS.resolvePath('fallback-temp', testRoot)
      await FS.mkdir(fallback)
      fixture.env['SANDBOX_RUNTIME'] = '1'
      const result = await runProfileScript('tao_bun_temp_dir "$3"', fixture, fallback)

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim()).toBe(`${await FS.realPath(fallback)}/`)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('reclaims abandoned bootstrap scratch without leaving its root', async () => {
    const testRoot = await mkTestDir('tao-agent-scratch-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const scratch = FS.resolvePath('.artifacts/tmp', fixture.worktree)
      await FS.writeText(FS.resolvePath('bun/partial/package.json', scratch), '{}')
      await FS.writeText(FS.resolvePath('.hidden-partial', scratch), 'partial')
      const result = await runProfileScript(
        'tao_prune_bootstrap_scratch "$2/.artifacts/tmp" --report',
        fixture,
        scratch,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Reclaimed')
      Expect(await FS.exists(scratch)).toBe(true)
      Expect(await FS.exists(FS.resolvePath('bun', scratch))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.hidden-partial', scratch))).toBe(false)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('refuses to prune anything outside a repository .artifacts root', async () => {
    const testRoot = await mkTestDir('tao-agent-scratch-guard-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const tracked = FS.resolvePath('packages/dev', fixture.worktree)
      await FS.writeText(FS.resolvePath('keep.ts', tracked), 'keep')
      const result = await runProfileScript(
        'tao_prune_bootstrap_scratch "$2/packages/dev"',
        fixture,
        tracked,
      )

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Refusing to prune bootstrap scratch outside')
      Expect(await FS.exists(FS.resolvePath('keep.ts', tracked))).toBe(true)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('warns on a detached HEAD and stays quiet on a named branch', async () => {
    const testRoot = await mkTestDir('tao-agent-head-')
    try {
      const repository = FS.resolvePath('detached-repo', testRoot)
      await FS.writeText(FS.resolvePath('file.txt', repository), 'one')
      await git(repository, ['init', '--quiet', '--initial-branch', 'main'])
      await git(repository, ['add', 'file.txt'])
      await git(repository, ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'one'])

      const warn = async () =>
        await CLI.run('zsh', {
          args: ['-c', `source "$1"\ntao_warn_on_detached_head "$2"`, 'head-test', PROFILE_SCRIPT, repository],
        })

      const onBranch = await warn()
      Expect(onBranch.exitCode).toBe(0)
      Expect(onBranch.stderr).toBe('')

      await git(repository, ['checkout', '--quiet', '--detach', 'HEAD'])
      const detached = await warn()

      Expect(detached.exitCode).toBe(0)
      Expect(detached.stderr).toContain('detached HEAD')
      Expect(detached.stderr).toContain('git switch -c feat/<name>')
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

  Test('retries a resumable temporary-directory denial and reclaims its scratch', async () => {
    const testRoot = await mkTestDir('tao-agent-install-retry-')
    try {
      const outcome = await runAgentInstall(testRoot, [
        'unable to write files to tempdir: PermissionDenied',
        '',
      ])

      Expect(outcome.result.exitCode).toBe(0)
      Expect(outcome.attempts).toBe(2)
      Expect(await FS.exists(FS.resolvePath('.artifacts/tmp/bun/partial', testRoot))).toBe(false)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('stops after a bounded number of resumable attempts', async () => {
    const testRoot = await mkTestDir('tao-agent-install-bounded-')
    try {
      const outcome = await runAgentInstall(
        testRoot,
        Array.from({ length: 6 }, () => 'unable to write files to tempdir: PermissionDenied'),
      )

      Expect(outcome.result.exitCode).toBe(1)
      Expect(outcome.attempts).toBe(3)
      Expect(outcome.result.stderr).toContain("Denied operation: writing Bun's install scratch.")
      Expect(outcome.result.stderr).toContain('just clean-scratch')
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('names the denied path and an unsandboxed recovery for a denied destination', async () => {
    const testRoot = await mkTestDir('tao-agent-install-denied-')
    try {
      const outcome = await runAgentInstall(testRoot, [
        'PermissionDenied: copy file android/.idea/migrations.xml',
        '',
      ])

      // Retrying a denied destination repeats identically, so it must not consume attempts.
      Expect(outcome.attempts).toBe(1)
      Expect(outcome.result.exitCode).toBe(1)
      Expect(outcome.result.stderr).toContain(
        'Denied operation: copy file android/.idea/migrations.xml',
      )
      Expect(outcome.result.stderr).toContain(`Bun temporary directory: ${testRoot}/.artifacts/tmp/`)
      Expect(outcome.result.stderr).toContain('just claude-unsandboxed')
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('refuses to start the developer CLI without the pinned profile', async () => {
    // Asserting that the source mentions the activation call passes against a commented-out one.
    // `./dev` resolves its own directory, so proving the behaviour needs a copy in a root that
    // genuinely has no profile to link.
    const testRoot = await mkTestDir('tao-dev-no-profile-')
    try {
      const fixture = await createProfileFixture(testRoot, false)
      const devPath = FS.resolvePath('dev', fixture.worktree)
      await FS.writeText(devPath, await FS.readText(Repo.resolvePath('dev')))
      await FS.writeText(
        FS.resolvePath('packages/dev/dev-src/cli/agent-worktree-profile.zsh', fixture.worktree),
        await FS.readText(PROFILE_SCRIPT),
      )
      await makeExecutable(devPath)
      const result = await CLI.run(devPath, { args: ['--help'], env: fixture.env })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('pinned devenv profile is unavailable')
      Expect(result.stderr).toContain('direnv allow && direnv exec . ./agent setup')
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('installs dependencies from repository-local Bun storage and repairs an incomplete graph', async () => {
    const commands = await justCommands('deps')

    Expect(commands).toContain(`${Repo.getRoot()}/.artifacts/tmp/bun`)
    Expect(commands).toContain(`${Repo.getRoot()}/.artifacts/cache/bun`)
    Expect(commands).toContain('bun install --frozen-lockfile')
    Expect(commands).toContain('--force')
    Expect(await justCommands('_dependency-health')).toContain(
      'require("expo/metro-config"); require("jest-expo/jest-preset")',
    )
  })

  Test('bootstraps dependencies before full verification runs its graph', async () => {
    const commands = await justCommands('full-verify')

    // The graph generates the parser inside `./dev gates`, so the ordering visible to a dry run is
    // the install first and the one gates invocation that names `_parser-gen` after it.
    const install = commands.indexOf('bun install --frozen-lockfile')
    const graph = commands.indexOf('./dev gates')
    Expect(install).toBeGreaterThanOrEqual(0)
    Expect(graph).toBeGreaterThan(install)
    Expect(commands.slice(graph)).toContain('_parser-gen')
  })

  Test('runs every unquarantined Studio lane in the one graph and reports the browser quarantine', async () => {
    const commands = await justCommands('full-verify')

    Expect(commands).toContain(
      '_full-verify-smoke-launch _full-verify-real-app _full-verify-native _full-verify-canary',
    )
    Expect(commands).toContain('--lane full-verify')
    Expect(commands).not.toContain('--jobs 1')
    Expect(commands).toContain(
      '"_full-verify-simulated=temporarily quarantined; '
        + 'run just _full-verify-simulated while debugging the browser journey"',
    )
    Expect(commands).not.toContain('manual-check')
    // Each lane owns a worker index so StudioSmoke.resources() keeps their ports and roots apart.
    Expect(await justCommands('_full-verify-smoke-launch')).toContain(
      '--worker 0 packages/dev/studio-smoke/studio-launch.test.ts',
    )
    Expect(await justCommands('_full-verify-real-app')).toContain(
      '--worker 1 packages/dev/studio-smoke/studio-real-app.test.ts',
    )
    Expect(await justCommands('_full-verify-simulated')).toContain(
      '--worker 2 packages/dev/studio-smoke/studio-simulated-user.test.ts',
    )
    Expect(await justCommands('_full-verify-native')).toContain('--native --run-id full-verify-native --worker 3')
    Expect(await justCommands('_full-verify-canary')).toContain('./dev studio-canary')
    Expect(await justCommands('studio-manual-checks')).toContain('./dev studio-manual-checks')
  })

  Test('exposes scratch reclamation as its own recipe and as part of cleaning', async () => {
    Expect(await justRecipeNames()).toContain('clean-scratch')
    Expect(await justCommands('clean-scratch')).toContain('tao_prune_bootstrap_scratch')
    Expect(await justCommands('clean')).toContain('tao_prune_bootstrap_scratch')
  })

  Test('never runs dprint with the incremental cache that would live in a home directory', async () => {
    for (const lane of ['fix', 'fmt', '_dprint-check']) {
      const dprintCommands = (await justCommands(lane)).split('\n')
        .filter(line => line.trimStart().startsWith('dprint '))
      Expect(dprintCommands.every(command => command.includes('--incremental=false'))).toBe(true)
    }
    // And the checking gate, which `check` runs, uses the same flag.
    Expect(await justCommands('_dprint-check')).toContain('dprint check --incremental=false')
  })

  Test('formats the Justfile in the same lane that checks its formatting', async () => {
    // `verify` skips `_dprint-check`, which is also where `just --fmt --check` lives. If `fix`
    // does not format the Justfile, `verify` can pass a tree that `check` then rejects.
    Expect(await justCommands('fix')).toContain('just --fmt')
    Expect(await justCommands('_dprint-check')).toContain('just --fmt --check')
    Expect(await justCommands('check')).toContain('_dprint-check')
  })
})

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await CLI.run('git', { args: [...args], cwd })
  Expect(result.exitCode).toBe(0)
}

/** justCommands returns the commands a recipe would run, so tests assert behavior, not layout. */
async function justCommands(name: string): Promise<string> {
  const result = await CLI.run('just', { args: ['--dry-run', name], cwd: Repo.getRoot() })
  Expect(result.exitCode).toBe(0)
  return `${result.stdout}${result.stderr}`
}

async function justRecipeNames(): Promise<string[]> {
  const result = await CLI.run('just', { args: ['--summary'], cwd: Repo.getRoot() })
  Expect(result.exitCode).toBe(0)
  return result.stdout.trim().split(/\s+/)
}

type AgentInstallOutcome = {
  attempts: number
  result: CLI.CommandResult
}

/**
 * Runs `./agent`'s dependency installation against a scripted Bun whose failures are supplied
 * per attempt, so retry bounds, scratch reclamation, and diagnostics are observed rather than
 * matched against the script's text.
 */
async function runAgentInstall(testRoot: string, attemptOutputs: readonly string[]): Promise<AgentInstallOutcome> {
  const fakeBin = FS.resolvePath('bin', testRoot)
  const attemptLog = FS.resolvePath('attempts.log', testRoot)
  const scratch = FS.resolvePath('.artifacts/tmp', testRoot)
  await FS.writeText(FS.resolvePath('.artifacts/tmp/bun/partial/package.json', testRoot), '{}')
  const outputsDir = FS.resolvePath('outputs', testRoot)
  for (const [index, output] of attemptOutputs.entries()) {
    await FS.writeText(FS.resolvePath(`${index + 1}.txt`, outputsDir), output)
  }
  await FS.writeText(
    FS.resolvePath('bun', fakeBin),
    [
      '#!/bin/zsh',
      'print -r -- attempt >> "$TAO_TEST_ATTEMPT_LOG"',
      'attempt=$(wc -l < "$TAO_TEST_ATTEMPT_LOG" | tr -d " ")',
      'output_file="$TAO_TEST_OUTPUTS/$attempt.txt"',
      '[[ -f "$output_file" ]] || exit 0',
      'output="$(<"$output_file")"',
      '[[ -z "$output" ]] && exit 0',
      'print -r -- "$output" >&2',
      'exit 1',
      '',
    ].join('\n'),
  )
  await makeExecutable(FS.resolvePath('bun', fakeBin))

  const script = [
    `SCRIPT_DIR=${JSON.stringify(testRoot)}`,
    `AGENT_TEMP_DIR=${JSON.stringify(scratch)}`,
    'BUN_TEMP_DIR="$AGENT_TEMP_DIR/"',
    'INSTALL_STAMP="$SCRIPT_DIR/install.stamp"',
    'typeset -a BUN_INSTALL_ARGS',
    'BUN_INSTALL_ARGS=(install)',
    'INSTALL_ATTEMPTS=3',
    `source ${JSON.stringify(PROFILE_SCRIPT)}`,
    agentFunctionSource(await FS.readText(Repo.resolvePath('agent'))),
    'install_dev_deps',
  ].join('\n')

  const result = await CLI.run('zsh', {
    args: ['-c', script],
    cwd: testRoot,
    env: {
      PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      TAO_TEST_ATTEMPT_LOG: attemptLog,
      TAO_TEST_OUTPUTS: outputsDir,
    },
  })
  const log = await FS.exists(attemptLog) ? await FS.readText(attemptLog) : ''
  return { attempts: log.split('\n').filter(Boolean).length, result }
}

/** Extracts `./agent`'s installation functions so the test exercises the shipped implementation. */
function agentFunctionSource(source: string): string {
  const start = source.indexOf('function report_install_failure()')
  const end = source.indexOf('function install_dev_deps_if_needed()')
  Expect(start).toBeGreaterThan(0)
  Expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

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
      // Cleared so temp-directory selection is deterministic: the suite itself may be running
      // inside an agent host's sandbox, which changes which directory the script prefers.
      CLAUDE_CODE_TMPDIR: '',
      CODEX_SANDBOX: '',
      PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
      SANDBOX_RUNTIME: '',
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
