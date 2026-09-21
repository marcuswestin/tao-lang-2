import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { inheritedWritePaths, parseProfiles, readProfiles } from '../agent-cli-src/agent-config/AgentProfiles'
import { ClaudeProfilesGenerator } from '../agent-cli-src/agent-config/ClaudeProfilesGenerator'

const profiles = parseProfiles(`{
  // Profiles with the comments and trailing commas JSONC allows.
  "profiles": {
    "native": {
      "description": "Test native.",
      "ask": ["xcrun simctl *", "adb *"],
      "allowWrite": ["~/Library/Developer/CoreSimulator"],
    },
    "release": {
      "description": "Test release.",
      "extends": "native",
      "ask": ["codesign *"],
      "allowWrite": ["~/Library/Developer/Xcode/Archives"],
    },
    "services": {
      "description": "Test services.",
      "allow": ["docker ps *"],
      "excludedCommands": ["docker *"],
    },
    "open": { "description": "No sandbox.", "sandbox": false },
  },
}
`)

Describe('Claude profile generation', () => {
  Test('renders prompted commands as both a prompt and a sandbox exclusion', () => {
    Expect(JSON.parse(ClaudeProfilesGenerator.render(profiles, 'native'))).toEqual({
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: { ask: ['Bash(adb *)', 'Bash(xcrun simctl *)'] },
      sandbox: {
        excludedCommands: ['adb *', 'xcrun simctl *'],
        filesystem: { allowWrite: ['~/Library/Developer/CoreSimulator'] },
      },
    })
  })

  Test("folds an extended profile's write paths in, but not its commands", () => {
    Expect(inheritedWritePaths(profiles, 'release')).toEqual([
      '~/Library/Developer/CoreSimulator',
      '~/Library/Developer/Xcode/Archives',
    ])
    Expect(JSON.parse(ClaudeProfilesGenerator.render(profiles, 'release'))).toMatchObject({
      permissions: { ask: ['Bash(codesign *)'] },
      sandbox: { excludedCommands: ['codesign *'] },
    })
  })

  Test('renders allowed commands and explicit exclusions, and a profile with no sandbox at all', () => {
    Expect(JSON.parse(ClaudeProfilesGenerator.render(profiles, 'services'))).toEqual({
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: { allow: ['Bash(docker ps *)'] },
      sandbox: { excludedCommands: ['docker *'] },
    })
    Expect(JSON.parse(ClaudeProfilesGenerator.render(profiles, 'open'))).toEqual({
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      sandbox: { enabled: false },
    })
  })

  Test('rejects a profile that extends one that does not exist', () => {
    Expect(() => parseProfiles('{ "profiles": { "a": { "description": "x", "extends": "b" } } }'))
      .toThrow("extends unknown profile 'b'")
  })

  Test('writes every profile and continues when a sandbox denies one', async () => {
    const root = await mkTestDir('tao-claude-profiles-')
    try {
      await FS.writeText(
        FS.resolvePath('.rulesync/profiles.jsonc', root),
        '{ "profiles": { "native": { "description": "n", "ask": ["adb *"] } } }',
      )
      await ClaudeProfilesGenerator.generate({ root })
      Expect(await FS.readJson(FS.resolvePath('.claude/settings.native.json', root))).toMatchObject({
        permissions: { ask: ['Bash(adb *)'] },
      })

      const skipped: string[] = []
      await ClaudeProfilesGenerator.generate({
        onSkip: message => skipped.push(message),
        root,
        writeText: async path => {
          throw Object.assign(new Error('blocked'), { code: 'EPERM', path })
        },
      })
      Expect(skipped).toEqual([
        `Skipped claudecode profile 'native': ${FS.resolvePath('.claude/settings.native.json', root)} is not writable.`,
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps every committed Claude profile identical to a fresh render', async () => {
    const root = Repo.getRoot()
    const committed = await readProfiles(root)
    for (const name of Object.keys(committed)) {
      Expect(await FS.readText(FS.resolvePath(ClaudeProfilesGenerator.settingsPath(name), root)))
        .toBe(ClaudeProfilesGenerator.render(committed, name))
    }
  })
})
