import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { CodexConfigGenerator } from '../dev-src/agent-config/CodexConfigGenerator'

const canonicalRules = `{
  // Canonical rules with the comments and trailing commas JSONC allows.
  "permission": {
    "read": {
      "~/code/tao-lang/**": "allow",
      "**/.env": "deny",
      "**/.env.*": "deny",
      "~/.ssh/**": "deny",
    },
  },
  "claudecode": {
    "sandbox": {
      "network": {
        "allowLocalBinding": true,
        "allowedDomains": ["registry.npmjs.org", "*.npmjs.org", "exp.host", "cache.nixos.org"],
      },
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
    const rendered = CodexConfigGenerator.render(CodexConfigGenerator.parsePermissions(canonicalRules))
    const parsed = Bun.TOML.parse(rendered) as Record<string, any>
    const profile = parsed['permissions']['tao-workspace']

    Expect(parsed['default_permissions']).toBe('tao-workspace')
    Expect(profile['extends']).toBe(':workspace')
    Expect(profile['filesystem']['~/code/tao-lang']).toBe('read')
    Expect(profile['filesystem']['~/.ssh/**']).toBe('deny')
    Expect(profile['network']['allow_local_binding']).toBe(true)
    Expect(profile['network']['unix_sockets']['/var/run/docker.sock']).toBe('allow')
    Expect(profile['network']['domains']['*']).toBeUndefined()
  })

  Test("denies dotenv files without denying this repository's own .envrc", () => {
    const rendered = CodexConfigGenerator.render(CodexConfigGenerator.parsePermissions(canonicalRules))
    const workspaceRoots =
      (Bun.TOML.parse(rendered) as any)['permissions']['tao-workspace']['filesystem'][':workspace_roots']

    Expect(Object.keys(workspaceRoots).toSorted()).toEqual(['**/.env', '**/.env.*'])
    Expect(rendered).not.toContain('**/.env*"')
  })

  Test('writes the profile and continues when a sandbox denies the output', async () => {
    const root = await mkTestDir('tao-codex-config-')
    try {
      await FS.writeText(FS.resolvePath('.rulesync/permissions.jsonc', root), canonicalRules)
      await CodexConfigGenerator.generate({ root })

      const written = await FS.readText(FS.resolvePath('.codex/config.toml', root))
      Expect(written).toContain('default_permissions = "tao-workspace"')

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
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps the committed Codex profile identical to a fresh render', async () => {
    const root = Repo.getRoot()
    const rendered = CodexConfigGenerator.render(
      CodexConfigGenerator.parsePermissions(await FS.readText(FS.resolvePath('.rulesync/permissions.jsonc', root))),
    )

    Expect(await FS.readText(FS.resolvePath('.codex/config.toml', root))).toBe(rendered)
  })
})
