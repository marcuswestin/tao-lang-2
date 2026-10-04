import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { generate } from 'rulesync'
import { AgentConfigGenerator } from '../agent-cli-src/agent-config/AgentConfigGenerator'

const conflict = '<<<<<<< HEAD\n{"old":true}\n=======\n{"other":true}\n>>>>>>> main\n'

Describe('generated settings merge recovery', () => {
  for (const invalidSource of ['none', 'syntax', 'schema']) {
    Test(
      invalidSource !== 'none'
        ? `preserves conflicted output when canonical sources have invalid ${invalidSource}`
        : 'regenerates conflicted settings from canonical permissions and hooks',
      async () => {
        const root = await mkTestDir('tao-config-conflict-test-')
        const settings = FS.resolvePath('.claude/settings.json', root)
        try {
          await FS.writeText(settings, conflict)
          await FS.writeJson(FS.resolvePath('.rulesync/rulesync.jsonc', root), {
            targets: ['claudecode'],
            features: ['permissions', 'hooks'],
          })
          await FS.writeText(
            FS.resolvePath('.rulesync/permissions.jsonc', root),
            invalidSource === 'syntax'
              ? '<<<<<<< unresolved source'
              : JSON.stringify({
                permission: { bash: { 'echo canonical': invalidSource === 'schema' ? 'invalid-action' : 'allow' } },
                agentHostCommands: ['setup-visionos'],
              }),
          )
          await FS.writeJson(FS.resolvePath('.rulesync/hooks.jsonc', root), {
            hooks: {
              sessionStart: [{ type: 'command', command: 'echo canonical-hook' }],
            },
          })
          const run = () =>
            AgentConfigGenerator.generate({
              root,
              generate: async options => {
                if (options.targets?.[0] === 'claudecode') {
                  return await generate({ ...options, silent: true })
                }
                return undefined
              },
              generateCodexConfig: async () => {},
              generateClaudeProfiles: async () => {},
            })
          if (invalidSource !== 'none') {
            await Expect(run()).rejects.toThrow()
            Expect(await FS.readText(settings)).toBe(conflict)
          } else {
            await run()
            const content = await FS.readText(settings)
            const parsed = JSON.parse(content) as { permissions: { allow: string[] }; hooks: unknown }
            Expect(parsed.permissions.allow).toContain('Bash(echo canonical)')
            Expect(parsed.permissions.allow).toContain('Bash(./agent unsandboxed setup-visionos)')
            Expect(JSON.stringify(parsed.hooks)).toContain('echo canonical-hook')
            Expect(content).not.toContain('"old"')
            Expect(content).not.toContain('"other"')
          }
        } finally {
          await FS.remove(root)
        }
      },
    )
  }
})
