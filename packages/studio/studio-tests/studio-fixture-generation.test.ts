import { type GenerationDeclaration, ScriptedGenerationProvider } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import type { StudioPreviewManifestV1 } from '../studio-src/StudioPreviewManifest'

Describe('Studio fixture generation', () => {
  Test('reports injected provider availability without browser-side model access', async () => {
    const generation = new StudioFixtureGeneration(
      new ScriptedGenerationProvider([], {
        reason: 'Foundation Models is disabled.',
        status: 'unavailable',
      }),
    )

    Expect(await generation.availability()).toEqual({
      reason: 'Foundation Models is disabled.',
      status: 'unavailable',
    })
  })

  Test('generates fixture rows, excludes secrets, and preserves explicit relation topology', async () => {
    const provider = new ScriptedGenerationProvider([
      { kind: 'answer', partials: [{ Title: 'Road' }], value: { Title: 'Roadmap' } },
      { kind: 'answer', value: { Title: 'Introduction' } },
    ])
    const generation = new StudioFixtureGeneration(provider)
    const result = await generation.generate(manifest(), { scenarioId: 'Workspace.focused' })

    Expect(result).toEqual({
      fixture: {
        accounts: [],
        creates: [
          { entity: 'Workspace', fields: { Title: 'Roadmap' }, name: 'Main' },
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
    Expect(provider.calls[1]?.schema.properties).not.toHaveProperty('Workspace')
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

function manifest(): StudioPreviewManifestV1 {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 100, start: 0 } }
  return {
    capabilities: { captureDomains: ['data'], scheme: 'inert' },
    cells: [{
      args: {},
      cellId: 'Workspace.focused#cell',
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' },
        scheme: { requested: 'light', status: 'inert' },
        viewport: { height: 844, width: 390 },
      },
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
    version: 1,
  }
}

const generationDeclarations: readonly GenerationDeclaration[] = [
  {
    collection: 'Workspaces',
    fields: [
      { name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } },
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
