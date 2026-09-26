import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  type AgentDocument,
  DELEGATION_SKILL_PATH,
  delegationIssues,
  parseAgentFrontmatter,
  readDelegationIssues,
  SUBAGENTS_DIRECTORY,
  tierModels,
} from '../agent-cli-src/delegation/DelegationProfiles'

const skillSource = [
  '| Tier | Claude Code `model` | Codex CLI `model` | Cursor `model` |',
  '| --- | --- | --- | --- |',
  '| fast | `haiku` | `gpt-6-luna` | `composer-2.5` |',
  '| standard | `opus` | `gpt-6-sol` | `claude-opus-5-5` |',
  '| deep | `opus` | `gpt-6-sol` | `claude-opus-5-5` |',
].join('\n')

const readOnlyEverywhere = {
  claudecode: { model: 'haiku', permissionMode: 'plan', tools: 'Bash, Read, Skill' },
  codexcli: { sandbox_mode: 'read-only' },
  cursor: { model: 'composer-2.5', readonly: 'true' },
}

function profile(overrides: Partial<AgentDocument> = {}): AgentDocument {
  return {
    description: 'Use proactively for sweeps.',
    name: 'scout',
    path: 'agents/subagents/scout.md',
    sections: readOnlyEverywhere,
    ...overrides,
  }
}

function issuesFor(document: AgentDocument): string[] {
  return delegationIssues({ profiles: [document], skills: [], skillSource })
}

Describe('delegation profiles', () => {
  Test('reads the harness blocks and the folded description of a real profile', async () => {
    const path = `${SUBAGENTS_DIRECTORY}/scout.md`
    const document = parseAgentFrontmatter(path, await FS.readText(FS.resolvePath(path, Repo.getRoot())))

    // Which model a real profile pins is the routing table's to change; its shape is what is read here.
    Expect(document.name).toEqual('scout')
    Expect(document.sections['claudecode']?.['model']).toBeDefined()
    Expect(document.sections['claudecode']?.['permissionMode']).toEqual('plan')
    Expect(document.sections['codexcli']?.['sandbox_mode']).toEqual('read-only')
    Expect(document.sections['cursor']?.['model']).toBeDefined()
    Expect(document.sections['cursor']?.['readonly']).toEqual('true')
    Expect(document.description?.startsWith('Read-only Tao repository explorer.')).toEqual(true)
    Expect(document.description?.includes('Use proactively')).toEqual(true)
  })

  Test('reads one model per tier out of the skill that owns the routing table', async () => {
    const source = await FS.readText(FS.resolvePath(DELEGATION_SKILL_PATH, Repo.getRoot()))

    for (const column of ['claude', 'codex', 'cursor'] as const) {
      Expect([...tierModels(source, column).keys()]).toEqual(['fast', 'standard', 'deep', 'frontier'])
    }
  })

  Test('reads each harness column of a routing table, skipping its header and separator', () => {
    Expect([...tierModels(skillSource, 'claude')]).toEqual([['fast', 'haiku'], ['standard', 'opus'], ['deep', 'opus']])
    Expect([...tierModels(skillSource, 'codex')]).toEqual([
      ['fast', 'gpt-6-luna'],
      ['standard', 'gpt-6-sol'],
      ['deep', 'gpt-6-sol'],
    ])
    Expect([...tierModels(skillSource, 'cursor')]).toEqual([
      ['fast', 'composer-2.5'],
      ['standard', 'claude-opus-5-5'],
      ['deep', 'claude-opus-5-5'],
    ])
  })

  Test('accepts the profiles this repository ships', async () => {
    Expect(await readDelegationIssues(Repo.getRoot())).toEqual([])
  })

  Test('faults a checkout whose profiles it cannot read, rather than passing on an empty set', () => {
    Expect(delegationIssues({ profiles: [], skills: [], skillSource })).toEqual([
      `${SUBAGENTS_DIRECTORY} holds no profile; the routing table would have nothing to govern.`,
    ])
  })

  Test('leaves a tree that is not this repository alone', async () => {
    Expect(await readDelegationIssues(await mkTestDir('delegation-empty'))).toEqual([])
  })

  Test('rejects a name that does not match the file', () => {
    Expect(issuesFor(profile({ name: 'explorer' }))).toEqual([
      "agents/subagents/scout.md declares name 'explorer'; it must match the file name 'scout'.",
    ])
  })

  Test('rejects a description that says what a profile is but never when to reach for it', () => {
    Expect(issuesFor(profile({ description: 'A read-only repository explorer.' }))).toEqual([
      'agents/subagents/scout.md description must say when to reach for the profile, not only what it is.',
    ])
  })

  Test('rejects a profile that names no model, because the caller would inherit one', () => {
    Expect(issuesFor(profile({
      sections: { ...readOnlyEverywhere, claudecode: { permissionMode: 'plan', tools: 'Bash, Read, Skill' } },
    }))).toEqual(['agents/subagents/scout.md must name a Claude Code model, so a caller inherits nothing by accident.'])
  })

  Test('rejects a model no tier in the routing table offers', () => {
    Expect(issuesFor(profile({
      sections: {
        ...readOnlyEverywhere,
        claudecode: { model: 'unknown-model', permissionMode: 'plan', tools: 'Bash, Read, Skill' },
      },
    }))).toEqual([
      `agents/subagents/scout.md names Claude Code model 'unknown-model', which no tier in ${DELEGATION_SKILL_PATH} offers.`,
    ])
  })

  Test('reads a Cursor model through its effort parameters, which are not part of the tier', () => {
    Expect(issuesFor(profile({
      sections: {
        ...readOnlyEverywhere,
        claudecode: { model: 'opus', permissionMode: 'plan', tools: 'Bash, Read, Skill' },
        cursor: { model: 'claude-opus-5-5[effort=high,context=300k]', readonly: 'true' },
      },
    }))).toEqual([])
  })

  Test('keeps the Claude subagent default on the standard tier, the opus alias unpinned, and pins unforced', () => {
    const env = { CLAUDE_CODE_SUBAGENT_MODEL: 'opus' }
    const issuesWith = (claudeEnv: Record<string, unknown>) =>
      delegationIssues({ claudeEnv, profiles: [profile()], skills: [], skillSource })

    Expect(issuesWith(env)).toEqual([])
    Expect(issuesWith({ ...env, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })).toEqual([
      '.rulesync/permissions.jsonc must not force the Claude subagent default over explicit models.',
    ])
    Expect(issuesWith({ ...env, ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5' })).toEqual([
      '.rulesync/permissions.jsonc must not pin the opus alias with ANTHROPIC_DEFAULT_OPUS_MODEL; '
      + 'unpinned, it follows each install to the newest Opus.',
    ])
  })

  Test('rejects a profile that names no tools, because it would inherit every tool schema', () => {
    Expect(issuesFor(profile({
      sections: { ...readOnlyEverywhere, claudecode: { model: 'haiku', permissionMode: 'plan' } },
    }))).toEqual([
      'agents/subagents/scout.md must name the Claude Code tools it needs; a profile that names none '
      + 'loads every tool schema into every request it makes.',
    ])
  })

  Test('rejects an empty tool list, which would leave the profile nothing to work with', () => {
    Expect(issuesFor(profile({
      sections: { ...readOnlyEverywhere, claudecode: { model: 'haiku', permissionMode: 'plan', tools: ' , ' } },
    }))).toEqual([
      'agents/subagents/scout.md declares an empty Claude Code tool list; it would have nothing to work with.',
    ])
  })

  Test('rejects a read-only profile whose tool list can still write', () => {
    Expect(issuesFor(profile({
      sections: {
        ...readOnlyEverywhere,
        claudecode: { model: 'haiku', permissionMode: 'plan', tools: 'Bash, Read, Edit, Write' },
      },
    }))).toEqual(['agents/subagents/scout.md is read-only but lists Edit and Write; drop them from its tool list.'])
  })

  Test('leaves a writable profile free to list the tools that write', () => {
    Expect(issuesFor(profile({
      sections: {
        claudecode: { effort: 'high', model: 'haiku', tools: 'Bash, Read, Edit, Write' },
        codexcli: { sandbox_mode: 'workspace-write' },
        cursor: { model: 'composer-2.5', readonly: 'false' },
      },
    }))).toEqual([])
  })

  Test('rejects a profile that is read-only under some harnesses and writable under the rest', () => {
    Expect(issuesFor(profile({
      sections: { ...readOnlyEverywhere, cursor: { model: 'composer-2.5', readonly: 'false' } },
    }))).toEqual([
      'agents/subagents/scout.md is read-only under Claude Code and Codex but writable under the rest; '
      + 'pair `sandbox_mode: read-only` with `permissionMode: plan` and `readonly: true`.',
    ])
  })

  Test('rejects a skill whose name does not match its directory', () => {
    const skill: AgentDocument = {
      description: 'Use when something happens.',
      name: 'delegating',
      path: 'agents/skills/delegation/SKILL.md',
      sections: {},
    }

    Expect(delegationIssues({ profiles: [profile()], skills: [skill], skillSource })).toEqual([
      "agents/skills/delegation/SKILL.md declares name 'delegating'; it must match its directory 'delegation'.",
    ])
  })
})
