import { Errors, FS, Platform, Repo } from '@shared'
import * as CLI from '@shared/CLI'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { parseProfiles, readProfiles } from '../agent-cli-src/agent-config/AgentProfiles'
import { CodexConfigGenerator } from '../agent-cli-src/agent-config/CodexConfigGenerator'
import { DELEGATION_SKILL_PATH, tierModels } from '../agent-cli-src/delegation/DelegationProfiles'

const canonicalRules = `{
  // Canonical rules with the comments and trailing commas JSONC allows.
  "agentHostCommands": ["land", "xcrun simctl list devices"],
  "permission": {
    "bash": {
      "ps -o pid=,command= -p *": "allow",
      "ps -axo pid=,ppid=,lstart=,command=": "allow",
      "kill -TERM *": "allow",
      "git merge *": "allow",
      "just studio-smoke *": "allow",
      "git status *": "allow",
      "./agent *": "allow",
      "just *": "allow",
      "bun install *": "deny",
    },
    "read": {
      "~/code/tao-lang/**": "allow",
      "**/.env": "deny",
      "**/.env.*": "deny",
      "~/.ssh/**": "deny",
    },
  },
  "claudecode": {
    "sandbox": {
      "filesystem": {
        "allowWrite": ["~/.bun", "~/.cache"],
      },
      "network": {
        "allowLocalBinding": true,
        "allowUnixSockets": ["/nix/var/nix/daemon-socket/socket", "~/.local/state/watchman"],
        "allowedDomains": ["registry.npmjs.org", "*.npmjs.org", "exp.host", "cache.nixos.org"],
      },
      "excludedCommands": [
        "./agent land",
        "./agent land *",
        "ps -o pid=,command= -p *",
        "ps -axo pid=,ppid=,lstart=,command=",
        "kill -TERM *",
        "git merge *",
        "just studio-smoke *",
      ],
    },
  },
}
`

const canonicalProfiles = `{
  "profiles": {
    "native": {
      "description": "Test native.",
      "ask": ["xcrun simctl *"],
      "allowWrite": ["~/Library/Developer/CoreSimulator"],
    },
    "local-services": {
      "description": "Test services.",
      "allow": ["docker ps *"],
      "excludedCommands": ["docker *"],
      "unixSockets": ["/var/run/docker.sock", "~/.docker/run/docker.sock"],
    },
    "release": {
      "description": "Test release.",
      "extends": "native",
      "ask": ["codesign *"],
      "allowWrite": ["~/Library/Developer/Xcode/Archives"],
    },
    "device-lab": {
      "description": "Test a profile the renderer does not know by name.",
      "extends": "local-services",
      "allowWrite": ["~/Library/Developer/TaoDeviceLab"],
      "unixSockets": ["~/Library/Developer/TaoDeviceLab/control.sock"],
    },
    "unsandboxed": {
      "description": "Test unrestricted host access.",
      "extends": "device-lab",
      "allowWrite": ["~/must-not-be-rendered"],
      "unixSockets": ["/must-not-be-rendered.sock"],
      "sandbox": false,
    },
  },
}
`

Describe('Codex config generation', () => {
  Test('reads canonical rules that JSON alone would reject', () => {
    const permissions = CodexConfigGenerator.parsePermissions(canonicalRules)

    Expect(permissions.permission?.read?.['**/.env']).toBe('deny')
    Expect(permissions.claudecode?.sandbox?.network?.allowedDomains).toEqual([
      'registry.npmjs.org',
      '*.npmjs.org',
      'exp.host',
      'cache.nixos.org',
    ])
    Expect(permissions.claudecode?.sandbox?.network?.allowUnixSockets).toEqual([
      '/nix/var/nix/daemon-socket/socket',
      '~/.local/state/watchman',
    ])
  })

  Test('collapses Claude Code apex and wildcard domains into Codex apex syntax', () => {
    Expect(CodexConfigGenerator.codexDomains([
      'registry.npmjs.org',
      '*.npmjs.org',
      'github.com',
      '*.github.com',
      'exp.host',
      'cache.nixos.org',
    ])).toEqual(['**.github.com', '**.npmjs.org', 'cache.nixos.org', 'exp.host'])
  })

  Test('renders a profile that narrows the workspace rather than opening it', () => {
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(canonicalRules),
      parseProfiles(canonicalProfiles),
      '',
      '/clones/elsewhere/tao/.git',
    )
    const parsed = Platform.parseToml(rendered) as Record<string, any>
    const profile = parsed['permissions']['tao-workspace']

    Expect(parsed['default_permissions']).toBe('tao-workspace')
    Expect(profile['extends']).toBe(':workspace')
    Expect(profile['filesystem']['/clones/elsewhere/tao/.git']).toBe('write')
    Expect(profile['filesystem']['~/code/tao-lang']).toBe('read')
    Expect(profile['filesystem']['~/.ssh/**']).toBeUndefined()
    Expect(parsed['permissions']['tao-review']['filesystem']['~/.ssh/**']).toBe('deny')
    Expect(profile['network']['allow_local_binding']).toBe(true)
    Expect(profile['network']['unix_sockets']['/nix/var/nix/daemon-socket/socket']).toBe('allow')
    // Codex matches a socket rule as a directory prefix, so Watchman's state directory covers the
    // `<login>-state/sock` it names after whoever is running it.
    Expect(profile['network']['unix_sockets'][FS.resolvePath('.local/state/watchman', FS.homeDir())])
      .toBe('allow')
    Expect(profile['network']['unix_sockets']['/var/run/docker.sock']).toBeUndefined()
    Expect(profile['network']['domains']['*']).toBeUndefined()
    Expect(parsed['permissions']['tao-review']['extends']).toBe(':read-only')
    Expect(parsed['permissions']['tao-native']['filesystem']['~/Library/Developer/CoreSimulator']).toBe('write')
    Expect(parsed['permissions']['tao-local-services']['network']['unix_sockets']['/var/run/docker.sock'])
      .toBe('allow')
    Expect(
      parsed['permissions']['tao-local-services']['network']['unix_sockets'][
        FS.resolvePath('.docker/run/docker.sock', FS.homeDir())
      ],
    ).toBe('allow')
    Expect(parsed['permissions']['tao-release']['extends']).toBe('tao-native')
    Expect(parsed['permissions']['tao-release']['filesystem']['~/Library/Developer/Xcode/Archives']).toBe('write')
    Expect(parsed['permissions']['tao-device-lab']['extends']).toBe('tao-local-services')
    Expect(parsed['permissions']['tao-device-lab']['description'])
      .toBe('Test a profile the renderer does not know by name.')
    Expect(parsed['permissions']['tao-device-lab']['filesystem']['~/Library/Developer/TaoDeviceLab']).toBe('write')
    Expect(
      parsed['permissions']['tao-device-lab']['network']['unix_sockets'][
        FS.resolvePath('Library/Developer/TaoDeviceLab/control.sock', FS.homeDir())
      ],
    ).toBe('allow')
    Expect(parsed['permissions']['tao-unsandboxed']).toEqual({
      description: 'Test unrestricted host access.',
      extends: ':danger-full-access',
    })
  })

  Test('renders only wrapper host prefixes from the canonical list', () => {
    const rendered = CodexConfigGenerator.renderRules(CodexConfigGenerator.parsePermissions(canonicalRules))

    Expect(rendered.split('\n').filter(line => line.startsWith('prefix_rule('))).toEqual([
      'prefix_rule(pattern=["./agent","unsandboxed","land"], decision="allow", justification="Repository-approved host command.")',
      'prefix_rule(pattern=["./agent","unsandboxed","xcrun","simctl","list","devices"], decision="allow", justification="Repository-approved host command.")',
    ])
  })

  Test('grants host access to each local release preparation target without admitting other targets', async () => {
    const source = await FS.readText(Repo.resolvePath('.rulesync/permissions.jsonc'))
    const rendered = CodexConfigGenerator.renderRules(CodexConfigGenerator.parsePermissions(source))

    Expect(rendered).toContain('pattern=["./agent","unsandboxed","prepare-release","studio"], decision="allow"')
    Expect(rendered).toContain('pattern=["./agent","unsandboxed","prepare-release","ide-extension"], decision="allow"')
    Expect(rendered).not.toContain('pattern=["./agent","unsandboxed","prepare-release"], decision="allow"')
  })

  Test('grants both harnesses the same caches outside the worktree', () => {
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(canonicalRules),
      parseProfiles(canonicalProfiles),
    )
    const filesystem = (Platform.parseToml(rendered) as any)['permissions']['tao-workspace']['filesystem']

    // The pinned toolchain and the machine-wide lane registry both write under the user's cache
    // root. A harness that is not granted them prompts, or silently loses shared state the other
    // harness is keeping.
    Expect(filesystem['~/.bun']).toBe('write')
    Expect(filesystem['~/.cache']).toBe('write')
    // The default profile must have no denied reads or Codex cannot run its exact host rules.
    Expect(filesystem['~/.ssh/**']).toBeUndefined()
  })

  Test('keeps denied reads out of the host-capable default but in the review profile', () => {
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(canonicalRules),
      parseProfiles(canonicalProfiles),
    )
    const profiles = (Platform.parseToml(rendered) as any)['permissions']
    const workspace = profiles['tao-workspace']['filesystem']
    const review = profiles['tao-review']['filesystem']

    Expect(Object.values(workspace)).not.toContain('deny')
    Expect(workspace[':workspace_roots']).toBeUndefined()
    Expect(Object.keys(review[':workspace_roots']).toSorted()).toEqual(['**/.env', '**/.env.*'])
    Expect(rendered).not.toContain('**/.env*"')
  })

  Test('skips unchanged outputs but reports a stale protected output as a blocking host write', async () => {
    const root = await mkTestDir('tao-codex-config-')
    try {
      await FS.writeText(FS.resolvePath('.rulesync/permissions.jsonc', root), canonicalRules)
      await FS.writeText(FS.resolvePath('.rulesync/profiles.jsonc', root), canonicalProfiles)
      await CodexConfigGenerator.generate({ root })

      const written = await FS.readText(FS.resolvePath('.codex/config.toml', root))
      Expect(written).toContain('default_permissions = "tao-workspace"')
      Expect(await FS.readText(FS.resolvePath('.codex/rules/tao.rules', root)))
        .toContain('pattern=["./agent","unsandboxed","land"]')

      const skipped: string[] = []
      await CodexConfigGenerator.generate({
        onSkip: message => skipped.push(message),
        root,
        writeText: async path => {
          throw Object.assign(new Errors.HostEnvironmentError('blocked'), { code: 'EPERM', path })
        },
      })
      Expect(skipped).toEqual([])

      await FS.writeText(
        FS.resolvePath('.rulesync/permissions.jsonc', root),
        canonicalRules.replace(
          '"agentHostCommands": ["land", "xcrun simctl list devices"]',
          '"agentHostCommands": ["land", "xcrun simctl boot"]',
        ),
      )
      await Expect(CodexConfigGenerator.generate({
        onSkip: message => skipped.push(message),
        root,
        writeText: async path => {
          throw Object.assign(new Errors.HostEnvironmentError('blocked'), { code: 'EPERM', path })
        },
      })).rejects.toThrow('Codex permissions are stale')

      Expect(skipped).toHaveLength(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps the committed Claude Code settings in step with the canonical rules', async () => {
    // The generator skips this write when a sandbox denies it, so an agent can edit the canonical
    // rules, watch `./agent setup` succeed, and commit rules that never reached the settings file.
    // Nothing else notices; this does.
    const root = Repo.getRoot()
    const rules = CodexConfigGenerator.parsePermissions(
      await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root)),
    )
    const settings = await FS.readJson<{
      permissions?: { allow?: string[]; ask?: string[]; deny?: string[] }
      sandbox?: { network?: { allowUnixSockets?: string[]; allowedDomains?: string[] } }
    }>(FS.resolvePath('.claude/settings.json', root))

    for (const [pattern, action] of Object.entries(rules.permission?.read ?? {})) {
      const rendered = `Read(${pattern})`
      const list = action === 'deny' ? settings.permissions?.deny : settings.permissions?.allow
      Expect(list ?? []).toContain(rendered)
    }
    for (const [pattern, action] of Object.entries(rules.permission?.bash ?? {})) {
      if (action === 'deny') {
        Expect(settings.permissions?.deny ?? []).toContain(`Bash(${pattern})`)
      }
    }
    Expect(settings.sandbox?.network?.allowedDomains ?? [])
      .toEqual(rules.claudecode?.sandbox?.network?.allowedDomains ?? [])
  })

  Test('takes the delegation defaults from the standard tier of the routing table', async () => {
    const root = Repo.getRoot()
    const skill = await FS.readText(FS.resolvePath(DELEGATION_SKILL_PATH, root))
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
      await readProfiles(root),
      skill,
    )

    const standard = tierModels(skill, 'codex').get('standard')
    Expect(standard).toBeDefined()
    Expect(rendered).toContain('[agents]')
    Expect(rendered).toContain(`default_subagent_model = "${standard}"`)
    Expect(rendered).toContain('max_concurrent_threads_per_session = 5')
  })

  Test('leaves the delegation defaults out when the routing table is unreadable', async () => {
    const root = Repo.getRoot()
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
      await readProfiles(root),
      '',
    )

    Expect(rendered).not.toContain('[agents]')
  })

  Test('keeps the tracked Codex profile identical to a fresh render', async () => {
    const root = Repo.getRoot()
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
      await readProfiles(root),
      await FS.readText(FS.resolvePath(DELEGATION_SKILL_PATH, root)),
      await CodexConfigGenerator.gitDirectory(root),
    )

    Expect(await FS.readText(FS.resolvePath('.codex/config.toml', root))).toBe(rendered)
    const rules = await FS.readText(FS.resolvePath('.codex/rules/tao.rules', root))
    Expect(rules).toBe(
      CodexConfigGenerator.renderRules(
        CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
      ),
    )
    Expect(rules).not.toContain('pattern=["git","merge"]')
    Expect(rules).not.toContain('pattern=["kill"')
    Expect(rules).not.toContain('pattern=["/bin/kill"')
    Expect(rules).not.toContain('pattern=["just","land"], decision="allow"')
    Expect(rules).not.toContain('pattern=["./dev","land"], decision="allow"')
    Expect(rules).not.toContain('pattern=["just","merge-with-main"], decision="allow"')
    Expect(rules).not.toContain('pattern=["./dev","merge-with-main"], decision="allow"')
    Expect(rules).not.toContain('pattern=["just","my-land"], decision="allow"')
    Expect(rules).not.toContain('pattern=["./agent","land"]')
  })

  Test('tracks the startup profile and limits machine paths to its required sockets', async () => {
    // A new managed worktree must load this before either setup or a session hook can run.
    const root = Repo.getRoot()
    const tracked = await CLI.run('git', { args: ['ls-files', '.claude', '.codex', '.cursor', '.rulesync'], cwd: root })
    const login = Platform.runtimeProcess.env['USER'] ?? FS.basename(FS.homeDir())
    const offending: string[] = []
    for (const path of tracked.stdout.split('\n').filter(Boolean)) {
      if (path === '.codex/config.toml') {
        continue
      }
      const file = FS.resolvePath(path, root)
      if (!(await FS.isFile(file))) {
        continue
      }
      const text = await FS.readText(file)
      if (text.includes(FS.homeDir()) || text.includes(`${login}-state`)) {
        offending.push(path)
      }
    }

    Expect(tracked.exitCode).toBe(0)
    Expect(offending).toEqual([])
    Expect(tracked.stdout.split('\n')).toContain('.codex/config.toml')
    const configText = await FS.readText(FS.resolvePath('.codex/config.toml', root))
    const config = Platform.parseToml(configText) as any
    Expect(config.default_permissions).toBe('tao-workspace')
    Expect(config.permissions['tao-workspace'].extends).toBe(':workspace')
    Expect(config.permissions['tao-workspace'].filesystem['~/code/tao-lang-2/.git']).toBe('write')
    const machinePaths = configText.split('\n').filter(line => line.includes(FS.homeDir()))
    Expect(machinePaths).toEqual([
      `"${FS.resolvePath('.local/state/watchman', FS.homeDir())}" = "allow"`,
      `"${FS.resolvePath('.docker/run/docker.sock', FS.homeDir())}" = "allow"`,
    ])
  })
})
