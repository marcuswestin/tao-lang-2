import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AgentConfigFreshness } from '../agent-cli-src/agent-config/AgentConfigFreshness'
import { agentHostCommands, renderClaudeHostSettings } from '../agent-cli-src/agent-config/AgentHostCommands'
import { CodexConfigGenerator } from '../agent-cli-src/agent-config/CodexConfigGenerator'
import { hostCommandKind } from '../agent-cli-src/agent-config/HostCommandPolicy'

const expected = [
  'land',
  'finalize',
  'landed',
  'capabilities',
  'open-pr',
  'fix-agent-config',
  'test-host',
  'studio-smoke',
  'studio-proof-real-app',
  'admission-experiment',
  './tao dev',
  'xcrun simctl list devices',
  'xcrun simctl boot',
  'xcrun simctl get_app_container',
  'xcrun simctl install',
  'xcrun simctl openurl',
  'xcrun simctl uninstall',
  'xcrun devicectl list devices',
  'xcrun devicectl device info apps',
  'xcrun devicectl device process launch',
  'xcodebuild -version',
  'xcodebuild -checkFirstLaunchStatus',
  'xcodebuild -showsdks',
  'xcodebuild -project',
  'xcodebuild -workspace',
  'xcodebuild -exportArchive',
  'pod install',
  'pod ipc spec',
  'open -a Simulator',
  'adb devices',
  'adb get-state',
  'emulator -list-avds',
  'emulator -avd',
  'git fetch origin',
  'git ls-remote origin',
  'git ls-remote --heads origin',
  'git ls-remote --exit-code origin',
  'ps -axo pid=,ppid=,lstart=,command=',
  'ps -o lstart= -p',
]

Describe('agent host command permissions', () => {
  Test('one canonical list generates exact Codex and Claude host rules', async () => {
    const source = CodexConfigGenerator.parsePermissions(
      await FS.readText(Repo.resolvePath('.rulesync/permissions.jsonc')),
    )
    const prefixes = agentHostCommands(source)
    Expect(prefixes).toEqual(expected.map(command => command.split(' ')))
    const rules = CodexConfigGenerator.renderRules(source)
    const settings = JSON.parse(await FS.readText(Repo.resolvePath('.claude/settings.json'))) as {
      permissions: { allow: string[] }
      sandbox: { excludedCommands: string[] }
    }
    Expect(rules.split('\n').filter(line => line.startsWith('prefix_rule('))).toEqual(
      prefixes.map(prefix =>
        `prefix_rule(pattern=${
          JSON.stringify(['./agent', 'unsandboxed', ...prefix])
        }, decision="allow", justification="Repository-approved host command.")`
      ),
    )
    const shapes = expected.flatMap(command => [
      `./agent unsandboxed ${command}`,
      `./agent unsandboxed ${command} *`,
    ])
    Expect(settings.sandbox.excludedCommands).toEqual(shapes)
    Expect(settings.permissions.allow.filter(rule => rule.startsWith('Bash(./agent unsandboxed')))
      .toEqual(shapes.map(shape => `Bash(${shape})`))
    Expect(settings.permissions.allow).not.toContain('Bash(./agent land)')
    Expect(
      (await AgentConfigFreshness.staleIssues(Repo.getRoot())).some(issue =>
        issue.startsWith('.claude/settings.json ')
      ),
    ).toBe(false)
  })

  Test('accepts only whole listed prefixes and rejects malformed entries', () => {
    const prefixes = [['land'], ['xcrun', 'simctl', 'list', 'devices']]
    Expect(hostCommandKind(['land', '--dry-run'], prefixes)).toBe('agent')
    Expect(hostCommandKind(['xcrun', 'simctl', 'list', 'devices', 'booted'], prefixes)).toBe('external')
    Expect(hostCommandKind(['land-unlock'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['xcrun', 'simctl', 'erase', 'all'], prefixes)).toBeUndefined()
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 'land'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 42] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['xcrun  simctl'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['xcrun *'] })).toThrow()
  })

  Test('removes stale Claude host rules when the canonical list changes', () => {
    const initial = JSON.stringify({
      permissions: { allow: ['Bash(./agent *)', 'Bash(./agent unsandboxed board)'] },
      sandbox: { excludedCommands: ['./agent unsandboxed board'] },
    })
    const rendered = JSON.parse(renderClaudeHostSettings(initial, [['land']])) as {
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
