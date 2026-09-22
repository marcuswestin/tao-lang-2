import { Expect, Test } from '@shared/test'
import { previewCompatibilitySignature } from '../studio-src/StudioPreviewCompatibility'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { systemLightScheme } from './test-studio-fixtures'

function manifest(): StudioPreviewManifestV2 {
  return {
    capabilities: { captureDomains: [], scheme: 'reactive-browser' },
    cells: [{
      args: { title: 'Before' },
      cellId: 'card',
      cellRevision: 0,
      environment: {
        network: { latencyMs: 0, outcome: 'normal' },
        scheme: systemLightScheme(),
        viewport: { height: 844, width: 390 },
      },
      scenarioId: 'card-scenario',
      stateLayers: [],
    }],
    compileRevision: 1,
    fixtures: [],
    generationDeclarations: [],
    manifestRevision: 'compile:1',
    parametersBySubject: { card: [{ label: 'Title', parameterId: 'title', required: true, type: { kind: 'text' } }] },
    project: { appName: 'Garden', entryPath: '/project/Garden.tao', root: '/project' },
    renders: [],
    scenarios: [{
      args: { title: 'Before' },
      group: 'cards',
      label: 'Card',
      prepare: [],
      scenarioId: 'card-scenario',
      source: { kind: 'tao', path: '/project/Garden.tao', range: { end: 50, start: 10 } },
      stateLayers: [],
      subjectId: 'card',
    }],
    sourceVersions: { '/project/Garden.tao': 'source-1' },
    states: [],
    subjects: [{
      kind: 'view',
      source: { kind: 'tao', path: '/project/Garden.tao', range: { end: 10, start: 0 } },
      subjectId: 'card',
      viewName: 'Card',
    }],
    version: 2,
  }
}

Test('Studio keeps browser state for ordinary compile revisions and source-location changes', () => {
  const first = manifest()
  const next = {
    ...first,
    compileRevision: 2,
    manifestRevision: 'compile:2',
    renders: [{ elementName: 'Text', renderId: 'render-2', source: first.subjects[0]!.source }],
    sourceVersions: { '/project/Garden.tao': 'source-2' },
    scenarios: [{ ...first.scenarios[0]!, label: 'Renamed card' }],
  }

  Expect(previewCompatibilitySignature(next)).toBe(previewCompatibilitySignature(first))
})

Test('Studio resets every browser preview when a scenario contract becomes incompatible', () => {
  const first = manifest()
  const changed = { ...first, scenarios: [{ ...first.scenarios[0]!, subjectId: 'different-view' }] }
  const differentArgs = { ...first, cells: [{ ...first.cells[0]!, args: { title: 'Changed' } }] }

  Expect(previewCompatibilitySignature(changed)).not.toBe(previewCompatibilitySignature(first))
  Expect(previewCompatibilitySignature(differentArgs)).not.toBe(previewCompatibilitySignature(first))
})
