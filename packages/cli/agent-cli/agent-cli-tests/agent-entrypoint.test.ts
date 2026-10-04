import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

/**
 * Exercises `agent-dev.ts` itself rather than a unit underneath it, because the behavior under test
 * — what Commander does with an option it sees before any subcommand is chosen — only exists once
 * the whole program is assembled. Run through `bun run` rather than the built `./agent` wrapper: the
 * wrapper's own build and devenv bootstrap would make this the slowest test in the package for a
 * question that has nothing to do with either.
 */

const ENTRYPOINT = Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/agent-dev.ts')

async function runEntrypoint(args: readonly string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const result = await CLI.run('bun', { args: ['run', ENTRYPOINT, ...args], cwd: Repo.getRoot(), stdio: 'pipe' })
  return { exitCode: result.exitCode ?? -1, stderr: result.stderr, stdout: result.stdout }
}

Describe('agent entrypoint', () => {
  Test('unsandboxed forwards the command, quoted arguments, and flags unchanged', async () => {
    const root = await mkTestDir('tao-agent-unsandboxed-')
    try {
      const agent = FS.resolvePath('agent', root)
      const helper = FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/agent-worktree-profile.zsh', root)
      const dependencyScript = FS.resolvePath('packages/cli/dev-cli/dev-cli-src/cli/ensure-dependencies.zsh', root)
      const build = FS.resolvePath('.artifacts/build/agent-dev/agent-dev.js', root)
      const stamp = FS.resolvePath('.artifacts/build/agent-dev/agent-dev.stamp', root)
      const bin = FS.resolvePath('bin', root)
      const marker = FS.resolvePath('argv.txt', root)
      await FS.copyFile(Repo.resolvePath('agent'), agent)
      await FS.writeText(
        FS.resolvePath('.rulesync/permissions.jsonc', root),
        '{ "agentHostCommands": ["test", "app-dev", "simulators list"] }',
      )
      await FS.writeText(
        helper,
        'tao_activate_devenv_profile() { return 0; }\ntao_bun_temp_dir() { echo "$1"; }\ntao_warn_on_detached_head() { :; }\n',
      )
      await FS.writeText(dependencyScript, '#!/bin/sh\nexit 0\n')
      await FS.writeText(build, '')
      await FS.writeText(stamp, '')
      await FS.mkdir(bin)
      const fakeBun = FS.resolvePath('bun', bin)
      const fakePs = FS.resolvePath('ps', bin)
      const fakeXcrun = FS.resolvePath('xcrun', bin)
      const fakeTao = FS.resolvePath('tao', root)
      await FS.writeText(
        fakeBun,
        '#!/usr/bin/env zsh\nif [[ "$1" == */agent-host-command-check.ts ]]; then shift; exec "$TAO_REAL_BUN" "$TAO_REAL_CHECKER" "$@"; fi\nif [[ "$1" == */agent-host-dispatch.ts ]]; then shift; exec "$TAO_REAL_BUN" "$TAO_REAL_DISPATCHER" "$@"; fi\nprintf "%s\\n" "$@" > "$TAO_TEST_ARGS"\n',
      )
      await FS.chmod(fakeBun, 0o755)
      await FS.writeText(fakePs, '#!/bin/sh\nexit 0\n')
      await FS.chmod(fakePs, 0o755)
      await FS.writeText(fakeXcrun, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_TEST_ARGS"\n')
      await FS.chmod(fakeXcrun, 0o755)
      await FS.writeText(fakeTao, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_TEST_ARGS"\n')
      await FS.chmod(fakeTao, 0o755)
      const env = {
        PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
        TAO_TEST_ARGS: marker,
        TAO_REAL_BUN: Platform.runtimeProcess.execPath,
        TAO_REAL_CHECKER: Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-command-check.ts'),
        TAO_REAL_DISPATCHER: Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts'),
        CODEX_SANDBOX: '',
      }
      const run = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'test', 'two words', 'a "quoted" value', '--json', 'literal $HOME'],
        cwd: root,
        env,
      })
      Expect(run.exitCode).toBe(0)
      Expect((await FS.readText(marker)).split('\n').filter(Boolean)).toEqual([
        build,
        'test',
        'two words',
        'a "quoted" value',
        '--json',
        'literal $HOME',
      ])

      await FS.remove(marker)
      const native = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'simulators', 'list', 'booted'],
        cwd: root,
        env,
      })
      Expect(native.exitCode).toBe(0)
      Expect((await FS.readText(marker)).split('\n').filter(Boolean))
        .toEqual(['simctl', 'list', 'devices', 'booted'])

      await FS.remove(marker)
      const dev = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'app-dev', 'Apps/HNReader', '--app', 'HNReaderStub'],
        cwd: root,
        env,
      })
      Expect(dev.exitCode).toBe(0)
      Expect((await FS.readText(marker)).split('\n').filter(Boolean))
        .toEqual(['run', 'Apps/HNReader', '--app', 'HNReaderStub'])

      await FS.remove(marker)
      const unlisted = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'simulators', 'erase', 'all'],
        cwd: root,
        env,
      })
      Expect(unlisted.exitCode).toBe(2)
      Expect(unlisted.stderr).toContain('agentHostCommands in .rulesync/permissions.jsonc')
      Expect(await FS.exists(marker)).toBe(false)

      const raw = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'xcrun', 'simctl', 'list', 'devices'],
        cwd: root,
        env,
      })
      Expect(raw.exitCode).toBe(2)
      Expect(await FS.exists(marker)).toBe(false)

      const missing = await CLI.run('zsh', { args: [agent, 'unsandboxed'], cwd: root })
      Expect(missing.exitCode).toBe(2)
      Expect(missing.stderr).toContain('Usage: ./agent unsandboxed <command> [args...]')

      await FS.remove(marker)
      const inheritedMarker = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'test'],
        cwd: root,
        env: { ...env, CODEX_SANDBOX: 'seatbelt' },
      })
      Expect(inheritedMarker.exitCode).toBe(0)
      Expect((await FS.readText(marker)).split('\n').filter(Boolean)).toEqual([build, 'test'])

      await FS.remove(marker)
      await FS.writeText(fakePs, '#!/bin/sh\nexit 1\n')
      const deniedProcessTable = await CLI.run('zsh', {
        args: [agent, 'unsandboxed', 'test'],
        cwd: root,
        env: { ...env, CODEX_SANDBOX: 'seatbelt' },
      })
      Expect(deniedProcessTable.exitCode).toBe(1)
      Expect(deniedProcessTable.stderr).toContain('the host command was not started')
      Expect(await FS.exists(marker)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('hints that a front-door flag belongs after the command, not before it', async () => {
    const result = await runEntrypoint(['--verbose', 'board'])

    Expect(result.exitCode).toBe(1)
    Expect(result.stderr).toContain("unknown option '--verbose'")
    Expect(result.stderr).toContain('go after the command, not before it')
    Expect(result.stderr).toContain('./agent <command> --verbose')
  })

  Test('leaves an unrelated unknown option without the front-door hint', async () => {
    const result = await runEntrypoint(['--not-a-real-flag', 'board'])

    Expect(result.exitCode).toBe(1)
    Expect(result.stderr).toContain("unknown option '--not-a-real-flag'")
    // Still hinted: any option before the command is unknown to the top-level parser, front-door
    // flag or not, so the hint is the right answer for this one too rather than a special case.
    Expect(result.stderr).toContain('go after the command, not before it')
  })

  Test('requires the named host entry point for release preparation', async () => {
    const result = await runEntrypoint(['prepare-release', 'studio'])

    Expect(result.exitCode).toBe(1)
    Expect(result.stderr).toContain('too many arguments')
  })
})
