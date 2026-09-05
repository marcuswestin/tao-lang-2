import { Describe, Expect, Test } from '@shared/test'
import {
  StudioPreviewManifest,
  type StudioPreviewManifestV2,
} from '../studio-src/StudioPreviewManifest'
import { systemLightScheme } from './test-studio-fixtures'

Describe('Studio preview manifest', () => {
  Test('defines typed view and app scenarios with explicit isolated cells', () => {
    const manifest = fixture()
    const defined = StudioPreviewManifest.define(manifest)

    Expect(defined.subjects.map(subject => subject.kind)).toEqual(['view', 'app'])
    Expect(defined.version).toBe(2)
    Expect(defined.scenarios.map(scenario => scenario.group)).toEqual(['Cards', 'Application'])
    Expect(defined.cells.map(cell => cell.cellId)).toEqual(['card-phone', 'app-desktop'])
    Expect(defined.cells[0]?.environment).toEqual({
      network: { latencyMs: 120, outcome: 'normal' },
      scheme: systemLightScheme(),
      viewport: { height: 844, presetId: 'phone', width: 390 },
    })
    Expect(StudioPreviewManifest.cellIdentity(defined, defined.cells[0]!)).toEqual({
      appName: 'Demo',
      cellId: 'card-phone',
      cellRevision: 0,
      compileRevision: 7,
      manifestRevision: 'manifest-7',
      project: '/project',
    })
  })

  Test('rejects invalid typed args, non-Tao scenario authority, and invalid Scheme resolutions', () => {
    const invalidArgs = fixture()
    invalidArgs.cells[0]!.args = { title: 42 }
    Expect(() => StudioPreviewManifest.define(invalidArgs)).toThrow('does not match text')

    const sidecar = fixture()
    ;(sidecar.scenarios[0]!.source as { kind: string }).kind = 'artifact'
    Expect(() => StudioPreviewManifest.define(sidecar)).toThrow('must be Tao source')

    const invalidScheme = fixture()
    invalidScheme.cells[0]!.environment.scheme = {
      capability: 'fixed-light-native',
      requested: 'dark',
      resolved: 'dark',
      source: 'native-fixed',
    }
    Expect(() => StudioPreviewManifest.define(invalidScheme)).toThrow('valid request, resolution, source')

    const missingGroup = fixture()
    ;(missingGroup.scenarios[0] as { group: string }).group = ''
    Expect(() => StudioPreviewManifest.define(missingGroup)).toThrow('scenario group')
  })

  Test('rejects unknown state layers and invalid deterministic network simulation', () => {
    const missingState = fixture()
    missingState.cells[0]!.stateLayers = ['missing']
    Expect(() => StudioPreviewManifest.define(missingState)).toThrow('state does not exist')

    const missingError = fixture()
    missingError.cells[0]!.environment.network = { latencyMs: 0, outcome: 'error' }
    Expect(() => StudioPreviewManifest.define(missingError)).toThrow('requires an explicit error')

    const legacy = fixture()
    ;(legacy as { version: number }).version = 1
    Expect(() => StudioPreviewManifest.define(legacy)).toThrow('Unsupported Studio preview manifest version: 1')
  })
})

function fixture(): StudioPreviewManifestV2 & { cells: Array<StudioPreviewManifestV2['cells'][number]> } {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 20, start: 0 } }
  return {
    capabilities: { captureDomains: ['data', 'scene'], scheme: 'reactive-browser' },
    cells: [
      {
        args: { title: 'Hello' },
        cellId: 'card-phone',
        cellRevision: 0,
        environment: {
          network: { latencyMs: 120, outcome: 'normal' },
          scheme: systemLightScheme(),
          viewport: { height: 844, presetId: 'phone', width: 390 },
        },
        scenarioId: 'card-default',
        stateLayers: ['logged-in'],
      },
      {
        args: {},
        cellId: 'app-desktop',
        cellRevision: 2,
        environment: {
          network: { latencyMs: 0, outcome: 'offline' },
          scheme: {
            capability: 'reactive-browser' as const,
            requested: 'dark' as const,
            resolved: 'dark' as const,
            source: 'scenario' as const,
          },
          viewport: { height: 800, presetId: 'desktop', width: 1280 },
        },
        scenarioId: 'app-default',
        stateLayers: [],
      },
    ],
    compileRevision: 7,
    fixtures: [{ fixtureId: 'fixture:base', label: 'Base', plan: {}, source }],
    generationDeclarations: [],
    manifestRevision: 'manifest-7',
    parametersBySubject: {
      card: [{ label: 'Title', parameterId: 'title', required: true, type: { kind: 'text' } }],
      demo: [],
    },
    project: { appName: 'Demo', entryPath: '/project/App.tao', root: '/project' },
    scenarios: [
      {
        args: { title: 'Hello' },
        fixtureId: 'fixture:base',
        group: 'Cards',
        label: 'Default Card',
        prepare: [],
        scenarioId: 'card-default',
        source,
        stateLayers: ['logged-in'],
        subjectId: 'card',
      },
      {
        args: {},
        fixtureId: 'fixture:base',
        group: 'Application',
        label: 'Default App',
        prepare: [],
        scenarioId: 'app-default',
        source,
        stateLayers: [],
        subjectId: 'demo',
      },
    ],
    sourceVersions: { '/project/App.tao': 'text-v1:app', '/project/Scenarios.tao': 'text-v1:scenarios' },
    states: [{
      label: 'Logged In',
      layers: [],
      revision: 'state-1',
      snapshot: { domains: { data: { codecVersion: 1, value: { user: 'Ada' } } }, version: 1 },
      source,
      stateId: 'logged-in',
    }],
    subjects: [
      { kind: 'view', source, subjectId: 'card', viewName: 'Card' },
      { appName: 'Demo', kind: 'app', source, subjectId: 'demo' },
    ],
    version: 2,
  }
}
