import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type AgentDocument,
  DELEGATION_SKILL_PATH,
  delegationIssues,
  parseAgentFrontmatter,
  readDelegationIssues,
  SUBAGENTS_DIRECTORY,
  tierModels,
} from '../dev-src/delegation/DelegationProfiles'

const skillSource = [
  '| Tier | Claude Code `model` | Codex CLI `model` | Relative token cost |',
  '| --- | --- | --- | --- |',
  '| fast | `haiku` | `gpt-5.6-luna` | 1 |',
  '| deep | `opus` | `gpt-5.6-sol` | 5 |',
].join('\n')

function profile(overrides: Partial<AgentDocument> = {}): AgentDocument {
  return {
    description: 'Use proactively for sweeps.',
    name: 'scout',
    path: 'agents/subagents/scout.md',
    sections: { claudecode: { model: 'haiku', permissionMode: 'plan' }, codexcli: { sandbox_mode: 'read-only' } },
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

    Expect(document.name).toEqual('scout')
    Expect(document.sections['claudecode']).toMatchObject({ model: 'sonnet', permissionMode: 'plan' })
    Expect(document.sections['codexcli']?.['sandbox_mode']).toEqual('read-only')
    Expect(document.description?.startsWith('Read-only Tao repository explorer.')).toEqual(true)
    Expect(document.description?.includes('Use proactively')).toEqual(true)
  })

  Test('reads one model per tier out of the skill that owns the routing table', async () => {
    const source = await FS.readText(FS.resolvePath(DELEGATION_SKILL_PATH, Repo.getRoot()))

    Expect([...tierModels(source, 'claude').keys()]).toEqual(['fast', 'standard', 'deep', 'frontier'])
    Expect(tierModels(source, 'claude').get('deep')).toEqual('opus')
    Expect(tierModels(source, 'codex').get('fast')).toEqual('gpt-5.6-luna')
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
    Expect(await readDelegationIssues(await FS.mkTmpDir('delegation-empty'))).toEqual([])
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
    Expect(
      issuesFor(
        profile({ sections: { claudecode: { permissionMode: 'plan' }, codexcli: { sandbox_mode: 'read-only' } } }),
      ),
    )
      .toEqual(['agents/subagents/scout.md must name a Claude Code model, so a caller inherits nothing by accident.'])
  })

  Test('rejects a model no tier in the routing table offers', () => {
    Expect(issuesFor(profile({
      sections: { claudecode: { model: 'sonnet', permissionMode: 'plan' }, codexcli: { sandbox_mode: 'read-only' } },
    }))).toEqual([`agents/subagents/scout.md names model 'sonnet', which no tier in ${DELEGATION_SKILL_PATH} offers.`])
  })

  Test('rejects a profile that is read-only under one harness and writable under the other', () => {
    Expect(
      issuesFor(profile({ sections: { claudecode: { model: 'haiku' }, codexcli: { sandbox_mode: 'read-only' } } })),
    )
      .toEqual([
        'agents/subagents/scout.md is read-only under Codex but writable under the other; '
        + 'pair `sandbox_mode: read-only` with `permissionMode: plan`.',
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
