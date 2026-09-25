import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const PROFILE_SCRIPT = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh')
const DEPENDENCY_SCRIPT = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh')

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
          'print -r -- "$ANDROID_HOME"',
          'print -r -- "$ANDROID_SDK_ROOT"',
          'print -r -- "$ANDROID_USER_HOME"',
        ].join('\n'),
        fixture,
        profile,
      )

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout.trim().split('\n')).toEqual([
        FS.resolvePath('bin/node', profile),
        'v24.test',
        FS.resolvePath('libexec/android-sdk', profile),
        FS.resolvePath('libexec/android-sdk', profile),
        FS.resolvePath('.android', fixture.worktree),
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
      const tracked = FS.resolvePath('packages/cli/dev-cli', fixture.worktree)
      await FS.writeText(FS.resolvePath('keep.ts', tracked), 'keep')
      const result = await runProfileScript(
        'tao_prune_bootstrap_scratch "$2/packages/cli/dev-cli"',
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
      Expect(detached.stderr).toContain('./agent start-branch feat/<name>')
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('leaves Bun to choose its install backend in every checkout', async () => {
    const testRoot = await mkTestDir('tao-agent-install-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const profile = FS.resolvePath('profile', testRoot)
      // Naming a backend here breaks the sandboxed install: `--backend=copyfile` writes every
      // packaged file through its own path, and npm packages ship `.idea/` files a sandbox
      // protects. Bun's default cloning writes whole directories and is not caught by that.
      const expected = ['install', '--cwd', fixture.worktree]

      const linkedResult = await runProfileScript(
        'tao_bun_install_args "$2"\nprint -rl -- "${reply[@]}"',
        fixture,
        profile,
      )

      Expect(linkedResult.exitCode).toBe(0)
      Expect(linkedResult.stdout.trim().split('\n')).toEqual(expected)

      fixture.env['TAO_TEST_GIT_DIR'] = fixture.gitDirAlias
      const primaryResult = await runProfileScript(
        'tao_bun_install_args "$2"\nprint -rl -- "${reply[@]}"',
        fixture,
        profile,
      )

      Expect(primaryResult.exitCode).toBe(0)
      Expect(primaryResult.stdout.trim().split('\n')).toEqual(expected)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('keeps every flag after --refresh-lockfile rather than dropping it on the floor', async () => {
    const run = async (...args: string[]) =>
      await CLI.run('zsh', {
        args: [
          '-c',
          'source "$1"\ntao_agent_command_args "${@:2}"\nprint -rl -- "${reply[@]}"',
          'args-test',
          PROFILE_SCRIPT,
          ...args,
        ],
      })

    const refreshed = await run('setup', '--refresh-lockfile', '--json')
    Expect(refreshed.exitCode).toBe(0)
    Expect(refreshed.stdout.trim().split('\n')).toEqual(['setup', '--json'])

    const refreshedBare = await run('setup', '--refresh-lockfile')
    Expect(refreshedBare.exitCode).toBe(0)
    Expect(refreshedBare.stdout.trim().split('\n')).toEqual(['setup'])

    const untouched = await run('board', '--verbose')
    Expect(untouched.exitCode).toBe(0)
    Expect(untouched.stdout.trim().split('\n')).toEqual(['board', '--verbose'])
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
      Expect(outcome.result.stderr).toContain('./agent setup')
      Expect(outcome.result.stderr).toContain('just session-unsandboxed')
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
        FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh', fixture.worktree),
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

  Test('hands a successful ./dev install to ./agent without a second Bun install', async () => {
    const testRoot = await mkTestDir('tao-dev-agent-install-stamp-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      await copyBootstrapScripts(fixture.worktree)
      await writeBootstrapBun(FS.resolvePath('bin/bun', testRoot))

      const dev = await CLI.run(FS.resolvePath('dev', fixture.worktree), {
        args: ['--help'],
        env: { ...fixture.env, TAO_TEST_COMMAND_LOG: commandLog },
      })
      Expect(dev.exitCode).toBe(0)
      Expect(await FS.exists(FS.resolvePath('.artifacts/build/agent-dev/dev-deps.stamp', fixture.worktree))).toBe(true)

      const agent = await CLI.run(FS.resolvePath('agent', fixture.worktree), {
        args: ['help'],
        env: { ...fixture.env, TAO_TEST_COMMAND_LOG: commandLog },
      })
      Expect(agent.exitCode).toBe(0)

      const commands = (await FS.readText(commandLog)).trim().split('\n')
      Expect(commands.filter(command => command.startsWith('install '))).toEqual([
        `install --cwd ${fixture.worktree} --frozen-lockfile`,
      ])
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('rebuilds the agent when an imported CLI-kit source changes', async () => {
    const testRoot = await mkTestDir('tao-agent-cli-kit-freshness-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      const buildRoot = FS.resolvePath('.artifacts/build/agent-dev', fixture.worktree)
      const outputText = FS.resolvePath('packages/cli/cli-kit/cli-kit-src/OutputText.ts', fixture.worktree)
      await copyBootstrapScripts(fixture.worktree)
      await writeBootstrapBun(FS.resolvePath('bin/bun', testRoot))
      await Promise.all([
        FS.mkdir(FS.resolvePath('node_modules', fixture.worktree)),
        FS.writeText(FS.resolvePath('package.json', fixture.worktree), '{}'),
        FS.writeText(FS.resolvePath('bun.lock', fixture.worktree), ''),
        FS.writeText(FS.resolvePath('packages/cli/agent-cli/package.json', fixture.worktree), '{}'),
        FS.writeText(FS.resolvePath('packages/cli/cli-kit/package.json', fixture.worktree), '{}'),
        FS.writeText(FS.resolvePath('packages/cli/dev-cli/package.json', fixture.worktree), '{}'),
        FS.writeText(FS.resolvePath('packages/shared/package.json', fixture.worktree), '{}'),
        FS.writeText(outputText, 'export const OutputText = {}\n'),
        FS.writeText(FS.resolvePath('agent-dev.js', buildRoot), ''),
        FS.writeText(FS.resolvePath('dev-deps.stamp', buildRoot), ''),
        FS.writeText(FS.resolvePath('agent-dev.stamp', buildRoot), ''),
      ])
      const stamp = FS.resolvePath('agent-dev.stamp', buildRoot)
      await FS.setModifiedTimeMs(stamp, Date.now() + 10_000)

      const unchanged = await CLI.run(FS.resolvePath('agent', fixture.worktree), {
        args: ['help'],
        env: { ...fixture.env, TAO_TEST_COMMAND_LOG: commandLog },
      })
      Expect(unchanged.exitCode).toBe(0)
      Expect((await FS.readText(commandLog)).split('\n').some(command => command.startsWith('build '))).toBe(false)

      await FS.writeText(outputText, 'export const OutputText = { changed: true }\n')
      await FS.setModifiedTimeMs(outputText, Date.now() + 20_000)
      const changed = await CLI.run(FS.resolvePath('agent', fixture.worktree), {
        args: ['help'],
        env: { ...fixture.env, TAO_TEST_COMMAND_LOG: commandLog },
      })

      Expect(changed.exitCode).toBe(0)
      Expect((await FS.readText(commandLog)).split('\n').some(command => command.startsWith('build '))).toBe(true)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('does not publish the shared install stamp after ./dev installation fails', async () => {
    const testRoot = await mkTestDir('tao-dev-agent-install-stamp-failure-')
    try {
      const fixture = await createProfileFixture(testRoot, true)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      await copyBootstrapScripts(fixture.worktree)
      await writeBootstrapBun(FS.resolvePath('bin/bun', testRoot))

      const dev = await CLI.run(FS.resolvePath('dev', fixture.worktree), {
        args: ['--help'],
        env: { ...fixture.env, TAO_TEST_BUN_INSTALL_FAILURE: '1', TAO_TEST_COMMAND_LOG: commandLog },
      })

      Expect(dev.exitCode).not.toBe(0)
      Expect(await FS.exists(FS.resolvePath('.artifacts/build/agent-dev/dev-deps.stamp', fixture.worktree))).toBe(false)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('exposes one public setup command backed by one private installer', async () => {
    const commands = await justCommands('_setup')
    const names = await justRecipeNames()

    Expect(commands).toContain('packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh')
    Expect(commands).toContain('--health')
    Expect(commands).not.toContain('bun install')
    Expect(names).not.toContain('deps')
    Expect(names).not.toContain('setup')
    for (const entrypoint of ['agent', 'dev']) {
      Expect(await FS.readText(Repo.resolvePath(entrypoint))).toContain('ensure-dependencies.zsh')
    }
    const help = await CLI.run(Repo.resolvePath('agent'), { args: ['help'], cwd: Repo.getRoot() })
    Expect(help.exitCode).toBe(0)
    Expect(help.stdout).toContain('setup')
    Expect(help.stdout).toContain('Install dependencies and generate agent adapters')
  })

  Test('adopts a healthy tree restored by another entry point without a second install', async () => {
    const testRoot = await mkTestDir('tao-dependency-adopt-')
    try {
      const fakeBin = FS.resolvePath('bin', testRoot)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      await FS.mkdir(FS.resolvePath('node_modules', testRoot))
      await FS.writeText(
        FS.resolvePath('bun', fakeBin),
        [
          '#!/bin/zsh',
          'print -r -- "$*" >> "$TAO_TEST_COMMAND_LOG"',
          '[[ "$1" == run ]]',
          '',
        ].join('\n'),
      )
      await makeExecutable(FS.resolvePath('bun', fakeBin))

      const script = [
        `TAO_DEPENDENCY_ROOT=${JSON.stringify(testRoot)}`,
        'TAO_DEPENDENCY_DEV="$TAO_DEPENDENCY_ROOT/packages/cli/dev-cli"',
        'TAO_DEPENDENCY_AGENT_CLI="$TAO_DEPENDENCY_ROOT/packages/cli/agent-cli"',
        'TAO_DEPENDENCY_TEMP_ROOT="$TAO_DEPENDENCY_ROOT/.artifacts/tmp"',
        'TAO_DEPENDENCY_TEMP="$TAO_DEPENDENCY_TEMP_ROOT/"',
        'TAO_DEPENDENCY_STAMP="$TAO_DEPENDENCY_ROOT/install.stamp"',
        'TAO_DEPENDENCY_HEALTH="$TAO_DEPENDENCY_ROOT/packages/testing/verification/verification-src/DependencyHealth.ts"',
        'TAO_DEPENDENCY_MODE=""',
        'TAO_DEPENDENCY_ATTEMPTS=3',
        'typeset -a TAO_DEPENDENCY_INSTALL_ARGS',
        'TAO_DEPENDENCY_INSTALL_ARGS=(install --cwd "$TAO_DEPENDENCY_ROOT" --frozen-lockfile)',
        `source ${JSON.stringify(PROFILE_SCRIPT)}`,
        dependencyFunctionSource(await FS.readText(DEPENDENCY_SCRIPT)),
        'tao_ensure_dependencies_locked',
      ].join('\n')
      const result = await CLI.run('zsh', {
        args: ['-c', script],
        cwd: testRoot,
        env: {
          PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
          TAO_TEST_COMMAND_LOG: commandLog,
        },
      })

      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(commandLog)).trim()).toBe(
        `run ${FS.resolvePath('packages/testing/verification/verification-src/DependencyHealth.ts', testRoot)}`,
      )
      Expect(await FS.exists(FS.resolvePath('install.stamp', testRoot))).toBe(true)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('repairs a damaged dependency graph before the agent CLI build can consume it', async () => {
    const testRoot = await mkTestDir('tao-agent-health-repair-')
    try {
      const fakeBin = FS.resolvePath('bin', testRoot)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      const repaired = FS.resolvePath('repaired', testRoot)
      await FS.writeText(
        FS.resolvePath('bun', fakeBin),
        [
          '#!/bin/zsh',
          'print -r -- "$*" >> "$TAO_TEST_COMMAND_LOG"',
          'if [[ "$1" == run ]]; then',
          '  [[ -f "$TAO_TEST_REPAIRED" ]] && exit 0',
          '  print -r -- "dependency health: missing package output" >&2',
          '  exit 1',
          'fi',
          'if [[ " $* " == *" --force "* ]]; then',
          '  : > "$TAO_TEST_REPAIRED"',
          '  exit 0',
          'fi',
          // The first install completes but leaves the probe unhealthy, so replacement is justified.
          'exit 0',
          '',
        ].join('\n'),
      )
      await makeExecutable(FS.resolvePath('bun', fakeBin))

      const script = [
        `TAO_DEPENDENCY_ROOT=${JSON.stringify(testRoot)}`,
        'TAO_DEPENDENCY_TEMP_ROOT="$TAO_DEPENDENCY_ROOT/.artifacts/tmp"',
        'TAO_DEPENDENCY_TEMP="$TAO_DEPENDENCY_TEMP_ROOT/"',
        'TAO_DEPENDENCY_STAMP="$TAO_DEPENDENCY_ROOT/install.stamp"',
        'TAO_DEPENDENCY_HEALTH="$TAO_DEPENDENCY_ROOT/packages/testing/verification/verification-src/DependencyHealth.ts"',
        'TAO_DEPENDENCY_ATTEMPTS=3',
        'typeset -a TAO_DEPENDENCY_INSTALL_ARGS',
        'TAO_DEPENDENCY_INSTALL_ARGS=(install --cwd "$TAO_DEPENDENCY_ROOT" --frozen-lockfile)',
        `source ${JSON.stringify(PROFILE_SCRIPT)}`,
        dependencyFunctionSource(await FS.readText(DEPENDENCY_SCRIPT)),
        'tao_repair_dependencies',
      ].join('\n')
      const result = await CLI.run('zsh', {
        args: ['-c', script],
        cwd: testRoot,
        env: {
          PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
          TAO_TEST_COMMAND_LOG: commandLog,
          TAO_TEST_REPAIRED: repaired,
        },
      })

      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(commandLog)).trim().split('\n')).toEqual([
        `install --cwd ${testRoot} --frozen-lockfile`,
        'run ' + FS.resolvePath('packages/testing/verification/verification-src/DependencyHealth.ts', testRoot),
        `install --cwd ${testRoot} --frozen-lockfile --force`,
        'run ' + FS.resolvePath('packages/testing/verification/verification-src/DependencyHealth.ts', testRoot),
      ])
      Expect(await FS.exists(FS.resolvePath('install.stamp', testRoot))).toBe(true)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('repairs without relinking healthy packages when a plain install is enough', async () => {
    // `--force` relinks every package, including the few shipping `.idea/` or `.gitmodules` that an
    // agent sandbox protects and no setting exempts. A forced repair therefore fails there on
    // packages that were healthy, and fails partway, leaving a worse tree than the unhealthy one it
    // was called to fix — a recovery path that could only ever damage what it repaired.
    const testRoot = await mkTestDir('tao-agent-health-plain-')
    try {
      const fakeBin = FS.resolvePath('bin', testRoot)
      const commandLog = FS.resolvePath('commands.log', testRoot)
      const repaired = FS.resolvePath('repaired', testRoot)
      await FS.writeText(
        FS.resolvePath('bun', fakeBin),
        [
          '#!/bin/zsh',
          'print -r -- "$*" >> "$TAO_TEST_COMMAND_LOG"',
          'if [[ "$1" == run ]]; then',
          '  [[ -f "$TAO_TEST_REPAIRED" ]] && exit 0',
          '  print -r -- "dependency health: missing package output" >&2',
          '  exit 1',
          'fi',
          // The realistic case: what was missing installs, and nothing healthy is touched.
          ': > "$TAO_TEST_REPAIRED"',
          'exit 0',
          '',
        ].join('\n'),
      )
      await makeExecutable(FS.resolvePath('bun', fakeBin))

      const script = [
        `TAO_DEPENDENCY_ROOT=${JSON.stringify(testRoot)}`,
        'TAO_DEPENDENCY_TEMP_ROOT="$TAO_DEPENDENCY_ROOT/.artifacts/tmp"',
        'TAO_DEPENDENCY_TEMP="$TAO_DEPENDENCY_TEMP_ROOT/"',
        'TAO_DEPENDENCY_STAMP="$TAO_DEPENDENCY_ROOT/install.stamp"',
        'TAO_DEPENDENCY_HEALTH="$TAO_DEPENDENCY_ROOT/packages/testing/verification/verification-src/DependencyHealth.ts"',
        'TAO_DEPENDENCY_ATTEMPTS=3',
        'typeset -a TAO_DEPENDENCY_INSTALL_ARGS',
        'TAO_DEPENDENCY_INSTALL_ARGS=(install --cwd "$TAO_DEPENDENCY_ROOT" --frozen-lockfile)',
        `source ${JSON.stringify(PROFILE_SCRIPT)}`,
        dependencyFunctionSource(await FS.readText(DEPENDENCY_SCRIPT)),
        'tao_repair_dependencies',
      ].join('\n')
      const result = await CLI.run('zsh', {
        args: ['-c', script],
        cwd: testRoot,
        env: {
          PATH: `${fakeBin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
          TAO_TEST_COMMAND_LOG: commandLog,
          TAO_TEST_REPAIRED: repaired,
        },
      })

      Expect(result.exitCode).toBe(0)
      const commands = (await FS.readText(commandLog)).trim().split('\n')
      Expect(commands).toContain(`install --cwd ${testRoot} --frozen-lockfile`)
      // The whole point: nothing escalated, so no healthy package was relinked.
      Expect(commands.some(command => command.includes('--force'))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('install.stamp', testRoot))).toBe(true)
    } finally {
      await FS.remove(testRoot)
    }
  })

  Test('bootstraps dependencies before full verification runs its graph', async () => {
    const commands = await justCommands('verify-full')

    // The graph generates the parser inside `./dev gates`, so the ordering visible to a dry run is
    // the install first and the one gates invocation that names `_parser-gen` after it.
    const install = commands.indexOf('ensure-dependencies.zsh')
    const graph = commands.indexOf('./dev gates')
    Expect(install).toBeGreaterThanOrEqual(0)
    Expect(graph).toBeGreaterThan(install)
    Expect(commands.slice(graph)).toContain('_parser-gen')
  })

  Test('bootstraps dependencies before either verify scope runs its graph', async () => {
    for (const scope of ['verify', 'verify-changed']) {
      const commands = await justCommands(scope)

      const install = commands.indexOf('ensure-dependencies.zsh')
      const graph = commands.indexOf('./dev gates')
      Expect(install).toBeGreaterThanOrEqual(0)
      Expect(graph).toBeGreaterThan(install)
      Expect(commands.slice(graph)).toContain('_parser-gen')
    }
  })

  Test('verify runs the complete pass, and a narrower scope is its own command', async () => {
    // Verifying everything is what the word means, so it is what the bare command does. The
    // narrowing a developer asks for while iterating is a name that completes under `just v<TAB>`,
    // never a flag a merge gate could inherit by forgetting it.
    const complete = await justCommands('verify')
    const changed = await justCommands('verify-changed')
    Expect(complete).toContain(' _test ')
    Expect(changed).toContain(' _test-changed ')
    Expect(changed).not.toContain(' _test ')
    Expect(complete).toContain('--lane verify ')
    Expect(changed).toContain('--lane verify-changed ')

    // Each lane records the tree it proved green under its own name and stands on a record from any
    // lane whose gates contain its own.
    Expect(complete).toContain('--green-tree verify verify-full-sandbox verify-full')
    Expect(changed).toContain('--green-tree verify-changed verify verify-full-sandbox verify-full')
    Expect(await justCommands('verify-full')).toContain('--green-tree verify-full ')
    Expect(await justCommands('verify-full-sandbox')).toContain('--green-tree verify-full-sandbox verify-full')

    // `--no-cache` is the one flag every scope takes, because it chooses whether recorded evidence
    // is trusted at all rather than which gates run. It is named for the cache of verdicts it
    // declines to read; it deletes nothing, which is what `clean` is for.
    Expect(complete).not.toContain('--no-cache')
    for (const scope of ['verify', 'verify-changed', 'verify-full', 'verify-full-sandbox', 'check']) {
      Expect(await justCommands(scope, '--no-cache')).toContain('--no-cache')
    }

    // `--complete` stays accepted as the explicit spelling of what bare `verify` already does.
    Expect(await justCommands('verify', '--complete')).toContain('--lane verify ')
  })

  Test('names every verification scope rather than hiding one behind a flag', async () => {
    const names = await justRecipeNames()
    for (const scope of ['verify', 'verify-changed', 'verify-full', 'verify-full-sandbox', 'test-all']) {
      Expect(names).toContain(scope)
    }
    Expect(names).not.toContain('full-verify')
    Expect(names).not.toContain('full-verify-sandbox')

    // Only the sandbox scope skips the host lanes, and only the host scopes bootstrap dependencies.
    const sandbox = await justCommands('verify-full-sandbox')
    Expect(sandbox).toContain('--skip-unsandboxed')
    Expect(await justCommands('verify-full')).not.toContain('--skip-unsandboxed')
    Expect(sandbox).not.toContain('ensure-dependencies.zsh')
  })

  Test('check runs no test suite and takes the same --no-cache flag the gate lanes take', async () => {
    const commands = await justCommands('check')
    Expect(commands).toContain('--green-tree check')
    Expect(commands).not.toContain('--no-cache')
    Expect(commands).not.toContain(' _test ')
    Expect(commands).not.toContain(' _test-changed ')
    Expect(await justCommands('check', '--no-cache')).toContain('--no-cache')
  })

  Test('test defaults to the changed scope and resolves one target by existence', async () => {
    // The default is the cheap scope, and `test-all` is the escape hatch the description names,
    // because a changed-scope run can be green while a suite the change broke elsewhere never ran.
    const body = await justCommands('test')
    Expect(body).toContain('./dev test-changed')
    Expect((await justCommands('test-all')).split('\n')).toContain('./dev test')

    // Path or pattern is decided by whether the argument exists, never by how it is spelled, and the
    // recipe prints the reading it chose so a wrong guess shows up in the first line of output.
    Expect(body).toContain('./dev test-file')
    Expect(body).toContain('Running tests in')
    Expect(body).toContain('Filtering the changed suites to tests matching')
    Expect(body).toContain('[ -e ')
  })

  Test('a test-name pattern narrows the default scope instead of replacing it', async () => {
    // `just test "<name>"` means the suites this branch's diff reaches, filtered to that name. A
    // pattern that reached `./dev test` instead would silently widen the fast default to every suite.
    Expect(await justCommands('test')).toContain('./dev test-changed --name')

    // The complete scope keeps its own meaning and composes with the same filter, so the two
    // questions — which suites, which tests inside them — stay answerable independently.
    Expect((await justCommands('test-all')).split('\n')).toContain('./dev test')
    Expect((await justCommands('test-all', 'one package only')).split('\n')).toContain("./dev test 'one package only'")
  })

  Test('the exhaustive pass composes the recipes it is made of rather than restating their gates', async () => {
    const commands = await justCommands('verify-repo')

    // Clean first, then a verification that trusts no recorded evidence, then the checks a person
    // performs. Composing the three means widening `verify-full` widens this too.
    Expect(commands).toContain('./dev clean')
    Expect(commands).toContain('--lane verify-full ')
    Expect(commands).toContain('--no-cache')
    Expect(commands).toContain('./dev studio-manual-checks')
    Expect(commands.indexOf('./dev clean')).toBeLessThan(commands.indexOf('--lane verify-full '))
    Expect(commands.indexOf('--lane verify-full ')).toBeLessThan(commands.indexOf('./dev studio-manual-checks'))
    // It runs `verify-full`'s gate list because it runs `verify-full`, not because it holds a copy.
    Expect(await justRecipeNames()).toContain('verify-repo')
  })

  Test('the ledger reports are one command over both implementations', async () => {
    const commands = await justCommands('report-test-stats', '5')
    const names = await justRecipeNames()

    // Two names to remember for one question — which tests to distrust — is one name now. The
    // underlying commands are unchanged, and one limit bounds both lists.
    Expect(commands).toContain('./dev test-flakes --limit "5"')
    Expect(commands).toContain('./dev test-slowest --limit "5"')
    Expect(names).not.toContain('test-flakes')
    Expect(names).not.toContain('test-slowest')
    // The test family shares one prefix, so it completes together under `just test<TAB>`.
    Expect(names).toContain('test-studio')
    Expect(names).not.toContain('studio-test')
  })

  Test('retry is the short spelling of test-retry and runs the same command', async () => {
    // Both names stay: `test-retry` keeps the family completing together, `retry` is the one the
    // hand reaches for after a red run.
    Expect(await justRecipeNames()).toContain('retry')
    Expect(await justCommands('retry')).toContain('./dev test-retry')
    Expect(await justCommands('test-retry')).toContain('./dev test-retry')
  })

  Test('the merge flags read in the widening order the scopes are named in', async () => {
    // `--skip-verify-full` names the lane it skips, in the word order `verify-full` already uses.
    Expect(await justCommands('merge-with-main', '--skip-verify-full')).toContain('--skip-verify-full')
    Expect(await justCommands('merge-with-main', '--skip-verify')).toContain('--skip-verify')
    Expect(await justCommands('merge-with-main')).not.toContain('--skip-')
  })

  Test('GitHub setup standardizes HTTPS, the credential helper, and this origin', async () => {
    const commands = await justCommands('github-setup')

    Expect(commands).toContain('url.https://github.com/.insteadOf')
    Expect(commands).toContain('gh auth login --hostname github.com --git-protocol https --web')
    Expect(commands).toContain('gh auth setup-git --hostname github.com')
    Expect(commands).toContain('git remote set-url origin https://github.com/marcuswestin/tao-lang-2.git')
    Expect(commands).toContain('git ls-remote --exit-code origin refs/heads/main')
  })

  Test('the human landing recipe exposes the read-only dry run', async () => {
    const command = await justCommands('merge-with-main', '--dry-run')
    Expect(command).toContain('./dev merge-with-main')
    Expect(command).toContain('--dry-run')
  })

  Test('runs every stable browser and native lane while reporting the simulated journey quarantine', async () => {
    const commands = await justCommands('verify-full')

    // The lanes are named for the public recipes that run the same files by hand; the graph runs
    // the smokes through the catalog's command, which is where their worker indices come from.
    Expect(commands).toContain(
      'ship-bundle-proof studio-smoke studio-proof-real-app studio-smoke-simulated-user keyboard-navigation-smoke studio-dialog-browser studio-agent-browser studio-network-simulation studio-smoke-native studio-canary',
    )
    Expect(commands).toContain('--lane verify-full')
    Expect(commands).not.toContain('--jobs 1')
    Expect(commands).toContain(
      'ship-bundle-proof studio-smoke studio-proof-real-app studio-smoke-simulated-user keyboard-navigation-smoke studio-dialog-browser studio-agent-browser studio-network-simulation studio-smoke-native studio-canary',
    )
    Expect(commands).not.toContain('_tao-check=')
    Expect(commands).not.toContain('_dprint-check=')
    Expect(commands).not.toContain('manual-check')
    Expect(await justRecipeNames()).not.toContain('_verify-full-smoke-launch')
    Expect(await justCommands('ship-bundle-proof')).toContain(
      'bun run packages/apps/expo-host/expo-host-src/testing/verify-release-bundle.ts',
    )
    Expect(await justCommands('studio-canary')).toContain('./dev studio-canary')
    Expect(await justCommands('studio-manual-checks')).toContain('./dev studio-manual-checks')
  })

  Test('exposes scratch reclamation as its own recipe and as part of cleaning', async () => {
    Expect(await justRecipeNames()).toContain('clean-scratch')
    Expect(await justCommands('clean-scratch')).toContain('tao_prune_bootstrap_scratch')
    Expect(await justCommands('clean')).toContain('tao_prune_bootstrap_scratch')
    Expect(await justCommands('clean-all')).toContain('tao_prune_bootstrap_scratch')
  })

  Test('cleans through the step-reporting command rather than silent recipe shell', async () => {
    // Reporting each removal and what it cost is more shell than a recipe should carry, so the
    // recipes name a scope and `./dev clean` owns the steps — the same removals, in the same order.
    Expect((await justCommands('clean')).split('\n').filter(line => line.startsWith('./dev')))
      .toEqual(['./dev clean'])
    Expect((await justCommands('clean-all')).split('\n').filter(line => line.startsWith('./dev')))
      .toEqual(['./dev clean --all'])
    for (const recipe of ['clean', 'clean-all']) {
      Expect(await justCommands(recipe)).not.toContain('rm -rf .artifacts')
      Expect(await justCommands(recipe)).not.toContain('find .')
    }
  })

  Test('never runs dprint with the incremental cache that would live in a home directory', async () => {
    for (const lane of ['fix', 'fmt', '_fix-dprint', '_dprint-check']) {
      const dprintCommands = (await justCommands(lane)).split('\n')
        .filter(line => line.trimStart().startsWith('dprint '))
      Expect(dprintCommands.every(command => command.includes('--incremental=false'))).toBe(true)
    }
    // And the checking gate, which `check` runs, uses the same flag.
    Expect(await justCommands('_dprint-check')).toContain('dprint check --incremental=false')
  })

  Test('checks generated root-package files without letting fix lanes rewrite them', async () => {
    for (const lane of ['fix', 'fmt', '_fix-dprint']) {
      const commands = await justCommands(lane)
      Expect(commands).toContain(
        'dprint fmt --incremental=false --excludes "@/" "**/@/**"',
      )
      Expect(commands).toContain(
        'dprint check --incremental=false --allow-no-files "@/**/*" "**/@/**/*"',
      )
    }
  })

  Test('formats the Justfile in the same lane that checks its formatting', async () => {
    // `verify` uses fixing gates instead of `_dprint-check`, which is also where
    // `just --fmt --check` lives. If `fix` does not format the Justfile, `verify` can pass a tree
    // that `check` then rejects.
    Expect(await justCommands('fix')).toContain('just --fmt')
    Expect(await justCommands('_dprint-check')).toContain('just --fmt --check')
    Expect(await justCommands('check')).toContain('_dprint-check')
  })

  Test('reports only work deliberately omitted from a lane as skipped', async () => {
    const verify = await justCommands('verify')
    const fullVerify = await justCommands('verify-full')
    const sandbox = await justCommands('verify-full-sandbox')

    Expect(verify).toContain('--skipped "studio-smoke=slow lane; run ./agent studio-smoke or ./agent verify-full"')
    for (const commands of [verify, fullVerify, sandbox]) {
      Expect(commands).not.toContain('_tao-check=')
      Expect(commands).not.toContain('_dprint-check=')
    }
    // Nothing is deliberately omitted from the full lanes: the simulated-user journey is a gate
    // again, and the sandbox lane names what it cannot run through `--skip-unsandboxed` instead.
    Expect(fullVerify).not.toContain('--skipped')
    Expect(sandbox).toContain('--skip-unsandboxed')
    Expect(sandbox).not.toContain('--skipped')
  })
})

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await CLI.run('git', { args: [...args], cwd })
  Expect(result.exitCode).toBe(0)
}

/** justCommands returns the commands a recipe would run, so tests assert behavior, not layout. */
async function justCommands(name: string, ...args: string[]): Promise<string> {
  const result = await CLI.run('just', { args: ['--dry-run', name, ...args], cwd: Repo.getRoot() })
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
    `TAO_DEPENDENCY_ROOT=${JSON.stringify(testRoot)}`,
    `TAO_DEPENDENCY_TEMP_ROOT=${JSON.stringify(scratch)}`,
    'TAO_DEPENDENCY_TEMP="$TAO_DEPENDENCY_TEMP_ROOT/"',
    'TAO_DEPENDENCY_STAMP="$TAO_DEPENDENCY_ROOT/install.stamp"',
    'typeset -a TAO_DEPENDENCY_INSTALL_ARGS',
    'TAO_DEPENDENCY_INSTALL_ARGS=(install)',
    'TAO_DEPENDENCY_ATTEMPTS=3',
    `source ${JSON.stringify(PROFILE_SCRIPT)}`,
    dependencyFunctionSource(await FS.readText(DEPENDENCY_SCRIPT)),
    'tao_run_bun_install',
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

/** Extracts the dependency functions without running the script's real repository bootstrap. */
function dependencyFunctionSource(source: string): string {
  const start = source.indexOf('function tao_dependency_state()')
  const end = source.lastIndexOf('tao_run_with_lock "$TAO_DEPENDENCY_LOCK"')
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
    await FS.mkdir(FS.resolvePath('libexec/android-sdk', primaryProfile))
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

async function copyBootstrapScripts(worktree: string): Promise<void> {
  await Promise.all([
    FS.writeText(FS.resolvePath('agent', worktree), await FS.readText(Repo.resolvePath('agent'))),
    FS.writeText(FS.resolvePath('dev', worktree), await FS.readText(Repo.resolvePath('dev'))),
    FS.writeText(
      FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh', worktree),
      await FS.readText(PROFILE_SCRIPT),
    ),
    FS.writeText(
      FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh', worktree),
      await FS.readText(DEPENDENCY_SCRIPT),
    ),
  ])
  await Promise.all([
    makeExecutable(FS.resolvePath('agent', worktree)),
    makeExecutable(FS.resolvePath('dev', worktree)),
  ])
}

async function writeBootstrapBun(path: string): Promise<void> {
  await FS.writeText(
    path,
    [
      '#!/bin/zsh',
      'print -r -- "$*" >> "$TAO_TEST_COMMAND_LOG"',
      'if [[ "$1" == install ]]; then',
      '  [[ "${TAO_TEST_BUN_INSTALL_FAILURE:-}" == 1 ]] && exit 1',
      '  mkdir -p "$3/node_modules" "$3/packages/cli/dev-cli/node_modules"',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  )
  await makeExecutable(path)
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
