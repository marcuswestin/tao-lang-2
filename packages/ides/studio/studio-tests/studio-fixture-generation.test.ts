import { type GenerationDeclaration, ScriptedGenerationProvider } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { cellEnvironment } from './test-studio-fixtures'

Describe('Studio fixture generation', () => {
  Test('declines generation clearly for a valid fixtureless scenario', async () => {
    const base = manifest()
    const provider = new ScriptedGenerationProvider([{ kind: 'answer', value: { Title: 'Unused' } }])
    const result = await new StudioFixtureGeneration(provider).generate({
      ...base,
      fixtures: [],
      scenarios: [{ ...base.scenarios[0]!, fixtureId: undefined }],
    }, { scenarioId: 'Workspace.focused' })

    Expect(result).toEqual({
      code: 'validation_failed',
      error: 'The Studio scenario has no fixture to generate.',
      status: 'failed',
    })
    Expect(provider.calls).toHaveLength(0)
  })

  Test('generates fixture rows, excludes secrets, and preserves explicit relation topology', async () => {
    const provider = new ScriptedGenerationProvider([
      {
        kind: 'answer',
        partials: [{ Title: 'Road' }],
        value: { Title: 'Roadmap' },
      },
      { kind: 'answer', value: { Title: 'Introduction' } },
    ])
    const generation = new StudioFixtureGeneration(provider)
    const result = await generation.generate(manifest(), { scenarioId: 'Workspace.focused' })

    Expect(result).toEqual({
      fixture: {
        accounts: [],
        creates: [
          {
            entity: 'Workspace',
            fields: { CreatedAt: { kind: 'now' }, Title: 'Roadmap' },
            name: 'Main',
          },
          {
            entity: 'Document',
            fields: { Title: 'Introduction', Workspace: { handle: 'Main', kind: 'fixture-reference' } },
            name: 'Intro',
          },
        ],
      },
      status: 'ready',
    })
    Expect(provider.calls).toHaveLength(2)
    Expect(provider.calls[0]?.schema.properties).not.toHaveProperty('PrivateNotes')
    Expect(provider.calls[0]?.schema.properties).not.toHaveProperty('CreatedAt')
    Expect(provider.calls[1]?.schema.properties).not.toHaveProperty('Workspace')
  })

  Test('returns a declared failure rather than dropping for-account or through fixture topology', async () => {
    const base = manifest()
    for (
      const [clause, create] of [
        [
          'for-account',
          { account: 'Owner', entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' },
        ],
        [
          'through',
          {
            entity: 'Workspace',
            fields: { Title: 'Old' },
            name: 'Main',
            through: { action: 'CreateWorkspace', arguments: [] },
          },
        ],
      ] as const
    ) {
      const provider = new ScriptedGenerationProvider([{ kind: 'answer', value: { Title: 'Unused' } }])
      const result = await new StudioFixtureGeneration(provider).generate({
        ...base,
        fixtures: [{
          ...base.fixtures[0]!,
          plan: { accounts: [], creates: [create] },
        }],
      }, { scenarioId: 'Workspace.focused' })

      Expect(result).toMatchObject({ code: 'validation_failed', status: 'failed' })
      Expect((result as { error: string }).error).toContain(clause === 'for-account' ? 'for-account' : 'through')
      Expect(provider.calls).toHaveLength(0)
    }
  })

  Test('fails honestly when a required time has neither a fixture now value nor a now default', async () => {
    const base = manifest()
    const declarations = base.generationDeclarations.map(declaration =>
      declaration.kind !== 'entity' || declaration.name !== 'Workspace'
        ? declaration
        : {
          ...declaration,
          fields: declaration.fields.map(field =>
            field.name === 'CreatedAt'
              ? { ...field, defaultValue: undefined }
              : field
          ),
        }
    )
    const provider = new ScriptedGenerationProvider([{ kind: 'answer', value: { Title: 'Unused' } }])
    const result = await new StudioFixtureGeneration(provider).generate({
      ...base,
      generationDeclarations: declarations,
    }, { scenarioId: 'Workspace.focused' })

    Expect(result).toEqual({
      code: 'validation_failed',
      error: 'The required time Workspace.CreatedAt needs a fixture now value or a now default.',
      status: 'failed',
    })
    Expect(provider.calls).toHaveLength(0)
  })

  Test('returns a declared provider failure without retrying', async () => {
    const provider = new ScriptedGenerationProvider([
      { kind: 'failure', message: 'The scripted model declined.' },
    ])
    const generation = new StudioFixtureGeneration(provider)
    const result = await generation.generate({
      ...manifest(),
      fixtures: [{
        ...manifest().fixtures[0]!,
        plan: { accounts: [], creates: [{ entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' }] },
      }],
    }, { scenarioId: 'Workspace.focused' })

    Expect(result).toMatchObject({
      code: 'scripted_failure',
      error: 'The scripted model declined.',
      status: 'failed',
    })
    Expect(provider.calls).toHaveLength(1)
  })

  Test('rejects a generated row when its required relation cannot be reconstructed', async () => {
    const provider = new ScriptedGenerationProvider([
      { kind: 'answer', value: { Title: 'Roadmap' } },
      { kind: 'answer', value: { Title: 'Introduction' } },
    ])
    const base = manifest()
    const generation = new StudioFixtureGeneration(provider)
    const result = await generation.generate({
      ...base,
      fixtures: [{
        ...base.fixtures[0]!,
        plan: {
          accounts: [],
          creates: [
            { entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' },
            { entity: 'Document', fields: { Title: 'Old' }, name: 'Intro' },
          ],
        },
      }],
    }, { scenarioId: 'Workspace.focused' })

    Expect(result).toEqual({
      code: 'validation_failed',
      error: 'The scene fixture does not provide the required relation Document.Workspace.',
      status: 'failed',
    })
    Expect(provider.calls).toHaveLength(0)
  })
})

function manifest(): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 100, start: 0 } }
  return {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' },
    cells: [{
      args: {},
      cellId: 'Workspace.focused#cell',
      cellRevision: 0,
      environment: cellEnvironment(),
      scenarioId: 'Workspace.focused',
      stateLayers: [],
    }],
    compileRevision: 1,
    fixtures: [{
      fixtureId: 'fixture:WorkspaceState',
      label: 'WorkspaceState',
      plan: {
        accounts: [],
        creates: [
          { entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' },
          {
            entity: 'Document',
            fields: { Title: 'Old', Workspace: { handle: 'Main', kind: 'fixture-reference' } },
            name: 'Intro',
          },
        ],
      },
      source,
    }],
    generationDeclarations,
    manifestRevision: 'compile:1',
    parametersBySubject: { 'view:Workspace': [] },
    project: { appName: 'WordFlower', entryPath: '/project/WordFlower.tao', root: '/project' },
    scenarios: [{
      args: {},
      fixtureId: 'fixture:WorkspaceState',
      group: 'Workspace',
      label: 'Workspace.focused',
      prepare: [],
      scenarioId: 'Workspace.focused',
      source,
      stateLayers: [],
      subjectId: 'view:Workspace',
    }],
    sourceVersions: { '/project/Scenarios.tao': 'text-v1:scenarios' },
    states: [],
    subjects: [{ kind: 'view', source, subjectId: 'view:Workspace', viewName: 'Workspace' }],
    version: 2,
  }
}

const generationDeclarations: readonly GenerationDeclaration[] = [
  {
    collection: 'Workspaces',
    fields: [
      { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
      {
        defaultValue: { kind: 'now' },
        name: 'CreatedAt',
        optional: false,
        secret: false,
        type: { kind: 'scalar', scalar: 'time' },
      },
      { name: 'PrivateNotes', optional: true, secret: true, type: { kind: 'scalar', scalar: 'text' } },
    ],
    kind: 'entity',
    name: 'Workspace',
  },
  {
    collection: 'Documents',
    fields: [
      { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
      {
        name: 'Workspace',
        optional: false,
        secret: false,
        type: { entity: 'Workspace', inverse: false, kind: 'relation' },
      },
    ],
    kind: 'entity',
    name: 'Document',
  },
]
