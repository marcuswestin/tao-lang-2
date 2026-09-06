import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import type { GenerateOptions } from 'rulesync'
import { AgentConfigGenerator } from '../dev-src/agent-config/AgentConfigGenerator'

Describe('agent config generation', () => {
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

      Expect(calls.map(call => call.targets)).toEqual([['codexcli'], ['claudecode']])
      Expect(codexRoots).toEqual([root])
      // Both harnesses take `hooks`, so the session-start bootstrap in .rulesync/hooks.jsonc reaches
      // .claude/settings.json and .codex/hooks.json; Codex CLI's permissions stay hand-rendered.
      Expect(calls.map(call => call.features)).toEqual([
        ['subagents', 'hooks'],
        ['subagents', 'permissions', 'hooks'],
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
})
