import { CLI, FS, Repo, Text } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, mkTestDir, Test } from '@shared/test'
import type { GenerateOptions } from 'rulesync'
import { AgentConfigGenerator } from '../agent-cli-src/agent-config/AgentConfigGenerator'

Describe('agent config generation', () => {
  Test('the session-start hook reaches the worktree script from a repository subdirectory', async () => {
    const root = await mkGitTestDir('tao-agent-hook-subdirectory-')
    await initGitTestRepository(root)
    const marker = FS.resolvePath('hook-ran', root)
    const script = FS.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-session-start.zsh', root)
    await FS.writeText(script, '#!/bin/zsh\n: > "$TAO_TEST_HOOK_MARKER"\n')
    await FS.chmod(script, 0o755)
    const nested = FS.resolvePath('packages/cli/agent-cli', root)
    await FS.mkdir(nested)
    const hooks = JSON.parse(
      Text.stripJsonc(await FS.readText(Repo.resolvePath('.rulesync/hooks.jsonc'))),
    ) as { hooks: { sessionStart: Array<{ command: string }> } }

    const result = await CLI.run('zsh', {
      args: ['-c', hooks.hooks.sessionStart[0]!.command],
      cwd: nested,
      env: { TAO_TEST_HOOK_MARKER: marker },
    })

    Expect(result.exitCode).toBe(0)
    Expect(await FS.exists(marker)).toBe(true)
  })

  Test('continues when a managed worktree blocks one adapter directory', async () => {
    const root = await mkTestDir('tao-agent-config-')
    try {
      const calls: GenerateOptions[] = []
      const skipped: string[] = []
      const codexRoots: string[] = []
      await AgentConfigGenerator.generate({
        generate: async options => {
          calls.push(options)
          if (options.targets?.[0] === 'codexcli') {
            throw Object.assign(new Error('blocked'), {
              code: 'EPERM',
              path: FS.resolvePath('.codex/agents', root),
            })
          }
        },
        generateClaudeProfiles: async () => {},
        generateCodexConfig: async options => {
          codexRoots.push(options.root)
        },
        onSkip: message => skipped.push(message),
        root,
      })

      Expect(calls.map(call => call.targets)).toEqual([['codexcli'], ['claudecode'], ['cursor']])
      Expect(codexRoots).toEqual([root])
      // Both CLI harnesses take `hooks`, so the session-start bootstrap in .rulesync/hooks.jsonc
      // reaches .claude/settings.json and .codex/hooks.json; Codex CLI's permissions stay
      // hand-rendered, and Cursor takes the profiles alone because its own permission and worktree
      // files are hand-maintained in a shape rulesync cannot express.
      Expect(calls.map(call => call.features)).toEqual([
        ['subagents', 'hooks'],
        ['subagents', 'permissions', 'hooks'],
        ['subagents'],
      ])
      Expect(skipped).toEqual([
        `Skipped codexcli agent config: ${FS.resolvePath('.codex/agents', root)} is not writable.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('continues when a sandbox denies the generated Claude Code settings', async () => {
    const root = await mkTestDir('tao-agent-config-settings-')
    try {
      const skipped: string[] = []
      await AgentConfigGenerator.generate({
        generate: async options => {
          if (options.targets?.[0] === 'claudecode') {
            throw Object.assign(new Error('blocked'), {
              code: 'EPERM',
              path: FS.resolvePath('.claude/settings.json', root),
            })
          }
        },
        generateClaudeProfiles: async () => {},
        generateCodexConfig: async () => {},
        onSkip: message => skipped.push(message),
        root,
      })

      Expect(skipped).toEqual([
        `Skipped claudecode agent config: ${FS.resolvePath('.claude/settings.json', root)} is not writable.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not hide generation errors outside the adapter output', async () => {
    const root = await mkTestDir('tao-agent-config-error-')
    try {
      const failure = Object.assign(new Error('source unreadable'), {
        code: 'EPERM',
        path: FS.resolvePath('.rulesync/subagents', root),
      })
      let thrown: unknown
      try {
        await AgentConfigGenerator.generate({
          generate: async () => {
            throw failure
          },
          root,
        })
      } catch (error) {
        thrown = error
      }

      Expect(thrown).toBe(failure)
    } finally {
      await FS.remove(root)
    }
  })

  Test('session-start hides successful setup warnings and reports setup failures', async () => {
    const root = await mkTestDir('tao-agent-session-start-')
    try {
      const scriptPath = 'packages/cli/agent-cli/agent-cli-src/cli/agent-session-start.zsh'
      const script = FS.resolvePath(scriptPath, root)
      await FS.writeText(script, await FS.readText(Repo.resolvePath(scriptPath)))
      await FS.chmod(script, 0o755)
      const agent = FS.resolvePath('agent', root)
      await FS.writeText(agent, '#!/bin/zsh\necho "detached HEAD warning" >&2\nexit 0\n')
      await FS.chmod(agent, 0o755)

      const success = await CLI.run(script, { cwd: root })
      Expect(success.exitCode).toBe(0)
      Expect(success.stdout).toBe('')
      Expect(success.stderr).toBe('')

      await FS.writeText(agent, '#!/bin/zsh\necho "setup failed"\necho "recovery detail" >&2\nexit 7\n')
      const failure = await CLI.run(script, { cwd: root })
      Expect(failure.exitCode).toBe(7)
      Expect(failure.stderr).toContain('setup failed')
      Expect(failure.stderr).toContain('recovery detail')
    } finally {
      await FS.remove(root)
    }
  })

  Test('session-start passes the model-routing notice to the agent and survives a failed audit', async () => {
    const root = await mkTestDir('tao-agent-session-notice-')
    try {
      const scriptPath = 'packages/cli/agent-cli/agent-cli-src/cli/agent-session-start.zsh'
      const script = FS.resolvePath(scriptPath, root)
      await FS.writeText(script, await FS.readText(Repo.resolvePath(scriptPath)))
      await FS.chmod(script, 0o755)
      const agent = FS.resolvePath('agent', root)
      await FS.writeText(agent, '#!/bin/zsh\necho "setup chatter"\nexit 0\n')
      await FS.chmod(agent, 0o755)
      // Stands in for the profile's bun: it names the script it was asked to run, then fails.
      const bun = FS.resolvePath('.devenv/profile/bin/bun', root)
      await FS.writeText(bun, '#!/bin/zsh\necho "notice from ${2:t}"\nexit 3\n')
      await FS.chmod(bun, 0o755)

      const result = await CLI.run(script, { cwd: root, env: { CLAUDE_ENV_FILE: '' } })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toBe('notice from agent-model-audit.ts\n')
      Expect(result.stderr).toBe('')
    } finally {
      await FS.remove(root)
    }
  })
})
