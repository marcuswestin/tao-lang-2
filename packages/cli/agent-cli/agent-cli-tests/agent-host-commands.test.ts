import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AgentConfigFreshness } from '../agent-cli-src/agent-config/AgentConfigFreshness'
import { agentHostCommands, renderClaudeHostSettings } from '../agent-cli-src/agent-config/AgentHostCommands'
import { CodexConfigGenerator } from '../agent-cli-src/agent-config/CodexConfigGenerator'

const expected = ['land', 'finalize', 'landed', 'capabilities']

Describe('agent host command permissions', () => {
  Test('one canonical list generates exact Codex and Claude host rules', async () => {
    const source = CodexConfigGenerator.parsePermissions(
      await FS.readText(Repo.resolvePath('.rulesync/permissions.jsonc')),
    )
    Expect(agentHostCommands(source)).toEqual(expected)
    const rules = CodexConfigGenerator.renderRules(source)
    const settings = JSON.parse(await FS.readText(Repo.resolvePath('.claude/settings.json'))) as {
      permissions: { allow: string[] }
      sandbox: { excludedCommands: string[] }
    }
    for (const command of expected) {
      const shape = `./agent unsandboxed ${command}`
      Expect(rules).toContain(`pattern=["./agent","unsandboxed","${command}"], decision="allow"`)
      Expect(settings.permissions.allow).toContain(`Bash(${shape})`)
      Expect(settings.permissions.allow).toContain(`Bash(${shape} *)`)
      Expect(settings.sandbox.excludedCommands).toContain(shape)
      Expect(settings.sandbox.excludedCommands).toContain(`${shape} *`)
    }
    Expect(rules).not.toContain('pattern=["./agent","unsandboxed"],')
    Expect(rules).not.toContain('pattern=["./agent","unsandboxed","board"]')
    Expect(settings.sandbox.excludedCommands).not.toContain('./agent unsandboxed board')
    Expect(settings.sandbox.excludedCommands).not.toContain('./agent unsandboxed *')
    Expect(
      (await AgentConfigFreshness.staleIssues(Repo.getRoot())).some(issue =>
        issue.startsWith('.claude/settings.json ')
      ),
    ).toBe(false)
  })

  Test('rejects unknown and duplicate host command names', () => {
    Expect(() => agentHostCommands({ agentHostCommands: ['not-a-command'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 'land'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 42] })).toThrow()
  })

  Test('removes stale Claude host rules when the canonical list changes', () => {
    const initial = JSON.stringify({
      permissions: { allow: ['Bash(./agent *)', 'Bash(./agent unsandboxed board)'] },
      sandbox: { excludedCommands: ['./agent unsandboxed board'] },
    })
    const rendered = JSON.parse(renderClaudeHostSettings(initial, ['land'])) as {
      permissions: { allow: string[] }
      sandbox: { excludedCommands: string[] }
    }
    Expect(rendered.permissions.allow).toEqual([
      'Bash(./agent *)',
      'Bash(./agent unsandboxed land)',
      'Bash(./agent unsandboxed land *)',
    ])
    Expect(rendered.sandbox.excludedCommands).toEqual([
      './agent unsandboxed land',
      './agent unsandboxed land *',
    ])
  })
})
