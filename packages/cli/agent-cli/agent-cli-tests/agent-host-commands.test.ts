import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { AgentConfigFreshness } from '../agent-cli-src/agent-config/AgentConfigFreshness'
import {
  agentHostCommands,
  generateClaudeHostSettings,
  renderClaudeHostSettings,
} from '../agent-cli-src/agent-config/AgentHostCommands'
import { CodexConfigGenerator } from '../agent-cli-src/agent-config/CodexConfigGenerator'
import { hostCommandKind } from '../agent-cli-src/agent-config/HostCommandPolicy'
import { HOST_COMMAND_TARGETS, hostCommandTarget } from '../agent-cli-src/agent-config/HostCommandTargets'

const expected = [
  'notify-developer',
  'stop',
  'setup',
  'land',
  'finalize',
  'merge-main',
  'merge-recover',
  'landed',
  'capabilities',
  'open-pr',
  'merge-pr',
  'fix-agent-config',
  'verify-full',
  'test-host',
  'qa-capture',
  'studio-smoke',
  'studio-proof-real-app',
  'admission-experiment',
  'native-module-check',
  'reclaim --execute',
  'resources',
  'prepare-release studio',
  'prepare-release ide-extension',
  'ide-extension-acceptance',
  'app-dev',
  'dev-loop',
  'test-watch',
  'standalone-cli-acceptance',
  'studio',
  'studio-native',
  'studio-ps',
  'studio-stop',
  'studio-canary',
  'studio-manual-checks',
  'docker-desktop start',
  'watchman start',
  'watchman status',
  'watchman stop',
  'local-instantdb start',
  'local-instantdb stop',
  'companion-host-build',
  'setup-ios',
  'setup-visionos',
  'setup-watchos',
  'studio-companion-install',
  'clerk-review',
  'standalone-cli-vm-setup',
  'standalone-cli-clean-machine',
  'contributor-linux-test',
  'simulators list',
  'simulators boot',
  'simulators run',
  'simulators app-container',
  'simulators install',
  'simulators launch',
  'simulators open-url',
  'simulators uninstall',
  'simulators open',
  'devices list',
  'devices apps',
  'devices launch',
  'xcode version',
  'xcode setup-status',
  'xcode sdks',
  'xcode build-project',
  'xcode build-workspace',
  'xcode export-archive',
  'pods install',
  'pods spec',
  'android devices',
  'android state',
  'android emulators',
  'android boot',
  'android ensure',
  'android recover',
  'remote fetch',
  'remote refs',
  'remote heads',
  'remote exists',
  'processes list',
  'processes started',
  'processes group',
  'start-branch',
  'take-branch',
  'storage sync',
  'storage qa',
  'storage push',
]

Describe('agent host command permissions', () => {
  Test('one canonical list gates runtime dispatch behind per-operation Codex and Claude host rules', async () => {
    const source = CodexConfigGenerator.parsePermissions(
      await FS.readText(Repo.resolvePath('.rulesync/permissions.jsonc')),
    )
    const prefixes = agentHostCommands(source)
    Expect(prefixes).toEqual(expected.map(command => command.split(' ')))
    Expect(hostCommandKind(['verify-full', '--no-cache'], prefixes)).toBe('agent')
    Expect(hostCommandKind(['verify-full-sandbox'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['verify-repo'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['prepare-release', 'studio', '--version', '0.0.1'], prefixes)).toBe('named')
    Expect(hostCommandKind(['prepare-release', 'ide-extension'], prefixes)).toBe('named')
    Expect(hostCommandKind(['prepare-release', 'other'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['prepare-release'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['reclaim', '--execute'], prefixes)).toBe('named')
    Expect(hostCommandKind(['reclaim', '--report-json'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['notify-developer', '--message', 'question'], prefixes)).toBe('named')
    Expect(hostCommandKind(['stop'], prefixes)).toBe('named')
    Expect(Object.keys(HOST_COMMAND_TARGETS)).toEqual([
      'notify-developer',
      'stop',
      'merge-recover',
      ...expected.slice(expected.indexOf('reclaim --execute')),
    ])
    const rules = CodexConfigGenerator.renderRules(source)
    const settings = JSON.parse(await FS.readText(Repo.resolvePath('.claude/settings.json'))) as {
      permissions: { allow: string[] }
      sandbox: { excludedCommands: string[] }
    }
    const operations = [...new Set(prefixes.map(prefix => prefix[0]))]
    Expect(rules.split('\n').filter(line => line.startsWith('prefix_rule('))).toEqual(
      operations.map(operation =>
        `prefix_rule(pattern=${
          JSON.stringify(['./agent', 'unsandboxed', operation])
        }, decision="allow", justification="Repository host wrapper validates subcommands and arguments.")`
      ),
    )
    const shapes = operations.flatMap(operation => [
      `./agent unsandboxed ${operation}`,
      `./agent unsandboxed ${operation} *`,
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
    const prefixes = [['land'], ['simulators', 'list']]
    Expect(hostCommandKind(['land', '--dry-run'], prefixes)).toBe('agent')
    Expect(hostCommandKind(['simulators', 'list', 'booted'], prefixes)).toBe('named')
    Expect(hostCommandKind(['land-unlock'], prefixes)).toBeUndefined()
    Expect(hostCommandKind(['simulators', 'erase', 'all'], prefixes)).toBeUndefined()
    Expect(hostCommandTarget(['simulators', 'list'])).toEqual({
      command: 'xcrun',
      fixedArgs: ['simctl', 'list', 'devices'],
    })
    Expect(hostCommandTarget(['simulators', 'launch'])).toEqual({
      command: 'xcrun',
      fixedArgs: ['simctl', 'launch'],
    })
    Expect(hostCommandTarget(['start-branch'])).toEqual({ command: './dev', fixedArgs: ['start-branch'] })
    Expect(hostCommandTarget(['take-branch'])).toEqual({ command: './dev', fixedArgs: ['take-branch'] })
    Expect(hostCommandTarget(['setup-ios'])).toEqual({ command: './dev', fixedArgs: ['setup-ios'] })
    Expect(hostCommandTarget(['setup-visionos'])).toEqual({ command: './dev', fixedArgs: ['setup-visionos'] })
    Expect(hostCommandTarget(['setup-watchos'])).toEqual({ command: './dev', fixedArgs: ['setup-watchos'] })
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 'land'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['land', 42] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['xcrun simctl list devices'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['./tao run'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['xcrun  simctl'] })).toThrow()
    Expect(() => agentHostCommands({ agentHostCommands: ['xcrun *'] })).toThrow()
  })

  Test('runs CocoaPods under a UTF-8 locale, which it needs to read podspecs', () => {
    // An agent's host shell carries no LANG, and `pod install` then fails normalizing an
    // ASCII-8BIT string before it reads a single pod.
    for (const operation of [['pods', 'install'], ['pods', 'spec']]) {
      Expect(hostCommandTarget(operation)?.env).toEqual({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
    }
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

  Test('drops a Claude setting the source no longer has, which rulesync would merge back', () => {
    const initial = JSON.stringify({
      $schema: 'schema',
      env: { KEPT: '1', REMOVED: '1' },
      hooks: { SessionStart: [] },
      permissions: { allow: [] },
      removed: true,
      sandbox: { excludedCommands: [], network: { allowedDomains: ['a'], allowLocalBinding: true } },
    })
    const rendered = JSON.parse(renderClaudeHostSettings(initial, [], {
      env: { KEPT: '1' },
      sandbox: { excludedCommands: [], network: { allowedDomains: ['a'] } },
    })) as unknown

    Expect(rendered).toEqual({
      $schema: 'schema',
      env: { KEPT: '1' },
      hooks: { SessionStart: [] },
      permissions: { allow: [] },
      sandbox: { excludedCommands: [], network: { allowedDomains: ['a'] } },
    })
  })

  Test('replaces inherited permission lists while keeping other source settings', () => {
    const initial = JSON.stringify({
      permissions: {
        additionalDirectories: ['../x'],
        allow: ['Read', 'Bash(stale)'],
        ask: ['Bash(stale ask)'],
        defaultMode: 'plan',
        deny: ['Read(.env)', 'Bash(stale deny)'],
      },
      sandbox: { excludedCommands: [] },
    })
    const rendered = JSON.parse(renderClaudeHostSettings(initial, [], {
      permissions: { additionalDirectories: ['../x'] },
      sandbox: { excludedCommands: [] },
    }, { allow: ['Read'], deny: ['Read(.env)'] })) as unknown

    Expect(rendered).toEqual({
      permissions: { additionalDirectories: ['../x'], allow: ['Read'], deny: ['Read(.env)'] },
      sandbox: { excludedCommands: [] },
    })
  })

  Test('a pristine Rulesync render removes a tool absent from the permission source', async () => {
    const root = await mkTestDir('tao-permission-removal-')
    try {
      await FS.writeText(
        FS.resolvePath('.rulesync/rulesync.jsonc', root),
        await FS.readText(Repo.resolvePath('.rulesync/rulesync.jsonc')),
      )
      await FS.writeText(
        FS.resolvePath('.rulesync/permissions.jsonc', root),
        JSON.stringify({
          agentHostCommands: ['land'],
          claudecode: { permissions: { additionalDirectories: ['../x'] } },
          permission: { bash: { 'echo allow': 'allow', 'echo ask': 'ask', 'echo deny': 'deny' } },
        }),
      )
      await FS.writeText(
        FS.resolvePath('.claude/settings.json', root),
        JSON.stringify({
          permissions: {
            additionalDirectories: ['../x'],
            allow: ['Bash(echo allow)', 'Bash(stale allow)'],
            ask: ['Bash(echo ask)', 'Bash(stale ask)'],
            deny: ['Bash(echo deny)', 'Bash(stale deny)'],
          },
        }),
      )

      await generateClaudeHostSettings(root)

      const settings = JSON.parse(await FS.readText(FS.resolvePath('.claude/settings.json', root))) as {
        permissions: { additionalDirectories: string[]; allow: string[]; ask: string[]; deny: string[] }
      }
      Expect(settings.permissions).toEqual({
        additionalDirectories: ['../x'],
        allow: ['Bash(echo allow)', 'Bash(./agent unsandboxed land)', 'Bash(./agent unsandboxed land *)'],
        ask: ['Bash(echo ask)'],
        deny: ['Bash(echo deny)'],
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('still writes the host rules when the source has no sandbox block or allow list', () => {
    const rendered = JSON.parse(
      renderClaudeHostSettings(JSON.stringify({ permissions: {}, sandbox: { enabled: true } }), [['land']], {}),
    ) as { permissions: { allow: string[] }; sandbox: unknown }

    Expect(rendered.permissions.allow).toEqual([
      'Bash(./agent unsandboxed land)',
      'Bash(./agent unsandboxed land *)',
    ])
    Expect(rendered.sandbox).toEqual({
      excludedCommands: ['./agent unsandboxed land', './agent unsandboxed land *'],
    })
  })
})
