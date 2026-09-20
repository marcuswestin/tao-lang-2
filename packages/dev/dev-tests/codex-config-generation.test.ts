import { FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { parseProfiles, readProfiles } from '../dev-src/agent-config/AgentProfiles'
import { CodexConfigGenerator } from '../dev-src/agent-config/CodexConfigGenerator'
import { DELEGATION_SKILL_PATH, tierModels } from '../dev-src/delegation/DelegationProfiles'

const canonicalRules = `{
  // Canonical rules with the comments and trailing commas JSONC allows.
  "permission": {
    "bash": {
      "ps -o pid=,command= -p *": "allow",
      "ps -axo pid=,ppid=,lstart=,command=": "allow",
      "kill -TERM *": "allow",
      "git merge *": "allow",
      "just studio-smoke *": "allow",
      "git status *": "allow",
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
        "allowUnixSockets": ["/nix/var/nix/daemon-socket/socket", "~/.local/state/watchman/test-state/sock"],
        "allowedDomains": ["registry.npmjs.org", "*.npmjs.org", "exp.host", "cache.nixos.org"],
      },
      "excludedCommands": [
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
      '~/.local/state/watchman/test-state/sock',
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
    )
    const parsed = Platform.parseToml(rendered) as Record<string, any>
    const profile = parsed['permissions']['tao-workspace']

    Expect(parsed['default_permissions']).toBe('tao-workspace')
    Expect(profile['extends']).toBe(':workspace')
    Expect(profile['filesystem']['~/code/tao-lang']).toBe('read')
    Expect(profile['filesystem']['~/.ssh/**']).toBe('deny')
    Expect(profile['network']['allow_local_binding']).toBe(true)
    Expect(profile['network']['unix_sockets']['/nix/var/nix/daemon-socket/socket']).toBe('allow')
    Expect(profile['network']['unix_sockets'][FS.resolvePath('.local/state/watchman/test-state/sock', FS.homeDir())])
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

  Test('renders only fixed host command shapes as project-local command rules', () => {
    const rendered = CodexConfigGenerator.renderRules(CodexConfigGenerator.parsePermissions(canonicalRules))

    Expect(rendered).toContain('pattern=["ps","-axo","pid=,ppid=,lstart=,command="]')
    Expect(rendered).not.toContain('pattern=["ps","-o","pid=,command=","-p"]')
    Expect(rendered).not.toContain('pattern=["kill","-TERM"]')
    Expect(rendered).not.toContain('pattern=["git","merge"]')
    Expect(rendered).not.toContain('pattern=["just","studio-smoke"]')
    Expect(rendered).not.toContain('git status')
    Expect(rendered).toContain('pattern=["bun","install"], decision="forbidden"')
    Expect(rendered).toContain('Use ./agent setup')
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
    // A credential deny inside a granted tree still has to win, so denies are rendered last.
    Expect(filesystem['~/.ssh/**']).toBe('deny')
  })

  Test("denies dotenv files without denying this repository's own .envrc", () => {
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(canonicalRules),
      parseProfiles(canonicalProfiles),
    )
    const workspaceRoots =
      (Platform.parseToml(rendered) as any)['permissions']['tao-workspace']['filesystem'][':workspace_roots']

    Expect(Object.keys(workspaceRoots).toSorted()).toEqual(['**/.env', '**/.env.*'])
    Expect(rendered).not.toContain('**/.env*"')
  })

  Test('writes the profile and continues when a sandbox denies the output', async () => {
    const root = await mkTestDir('tao-codex-config-')
    try {
      await FS.writeText(FS.resolvePath('.rulesync/permissions.jsonc', root), canonicalRules)
      await FS.writeText(FS.resolvePath('.rulesync/profiles.jsonc', root), canonicalProfiles)
      await CodexConfigGenerator.generate({ root })

      const written = await FS.readText(FS.resolvePath('.codex/config.toml', root))
      Expect(written).toContain('default_permissions = "tao-workspace"')
      Expect(await FS.readText(FS.resolvePath('.codex/rules/tao.rules', root)))
        .toContain('pattern=["ps","-axo","pid=,ppid=,lstart=,command="]')

      const skipped: string[] = []
      await CodexConfigGenerator.generate({
        onSkip: message => skipped.push(message),
        root,
        writeText: async path => {
          throw Object.assign(new Error('blocked'), { code: 'EPERM', path })
        },
      })

      Expect(skipped).toEqual([
        `Skipped codexcli permissions: ${FS.resolvePath('.codex/config.toml', root)} is not writable.`,
        `Skipped codexcli permissions: ${FS.resolvePath('.codex/rules/tao.rules', root)} is not writable.`,
      ])
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

  Test('keeps the committed Codex profile identical to a fresh render', async () => {
    const root = Repo.getRoot()
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
      await readProfiles(root),
      await FS.readText(FS.resolvePath(DELEGATION_SKILL_PATH, root)),
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
    Expect(rules).not.toContain('studio-smoke')
    Expect(rules).toContain('pattern=["bun","install"], decision="forbidden"')
    Expect(rules).not.toContain('native-module-check')
  })
})
