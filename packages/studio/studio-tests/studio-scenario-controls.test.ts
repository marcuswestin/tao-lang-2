import { Expect, Test } from '@shared/test'
import { StudioScenarioControls } from '../studio-src/client/StudioScenarioControls'
import type { StudioCellIdentity, StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'

Test('Studio scenario controls serialize exact group, entry, cell, environment, layers, and failure identity', () => {
  const manifest = scenarioManifest()
  const failure = runtimeFailure()
  const first = StudioScenarioControls.fromManifest({
    cell: manifest.cells[0]!,
    cellIdentity: cellIdentity(),
    failureReplay: failure,
    manifest,
    previewInstanceId: 'preview-8',
  })
  const secondManifest = {
    ...manifest,
    cells: [{ ...manifest.cells[0]!, cellId: 'cell-second', scenarioId: 'scenario-second' }],
    scenarios: [{
      ...manifest.scenarios[0]!,
      scenarioId: 'scenario-second',
      source: { ...manifest.scenarios[0]!.source, path: '/workspace/Other.tao' },
    }],
    sourceVersions: { '/workspace/Other.tao': 'source-other' },
  }
  const second = StudioScenarioControls.fromManifest({
    cell: secondManifest.cells[0]!,
    cellIdentity: { ...cellIdentity(), cellId: 'cell-second' },
    manifest: secondManifest,
    previewInstanceId: 'preview-9',
  })

  Expect(first.ok).toBe(true)
  Expect(second.ok).toBe(true)
  if (!first.ok || !second.ok) {
    throw new Error('Expected scenario models.')
  }
  Expect(first.value).toMatchObject({
    arguments: { Count: 2, Mode: 'compact', Title: 'Novel' },
    capturedLayers: ['fixture-home', 'state-expanded'],
    cell: { compileRevision: 7, id: 'cell-novel', manifestRevision: 'manifest-7', revision: 3 },
    entry: { id: 'scenario-novel', label: 'novel', subjectId: 'view-card' },
    group: { label: 'states', sourcePath: '/workspace/Scenarios.tao' },
    network: { latencyMs: 25, outcome: 'normal' },
    viewport: { height: 844, presetId: 'phone', width: 390 },
  })
  Expect(first.value.failureReplay).toBe(failure)
  Expect(first.value.group.id).not.toBe(second.value.group.id)
  Expect(JSON.parse(JSON.stringify(first.value))).toMatchObject({
    cell: { id: 'cell-novel', revision: 3 },
    entry: { id: 'scenario-novel' },
    version: 1,
  })
})

Test('Studio scenario draft validation rejects invalid typed values and environment before dispatch', () => {
  const model = scenarioModel()
  const valid = StudioScenarioControls.validateDraft(model, {
    arguments: { Count: 4, Mode: 'wide', Title: 'Draft' },
    network: { latencyMs: 0, outcome: 'offline' },
    viewport: { height: 900, width: 1440 },
  })
  const invalid = StudioScenarioControls.validateDraft(model, {
    arguments: { Count: 99, Extra: true, Mode: 'unknown' },
    network: { latencyMs: -1, outcome: 'normal' },
    viewport: { height: 0, width: Number.NaN },
  })

  Expect(valid).toMatchObject({ ok: true, value: { arguments: { Count: 4, Mode: 'wide', Title: 'Draft' } } })
  Expect(invalid.ok).toBe(false)
  if (invalid.ok) {
    throw new Error('Expected invalid draft.')
  }
  Expect(invalid.issues).toEqual([
    'Argument is not declared: Extra.',
    'Title is required.',
    'Count does not match number.',
    'Mode does not match choice.',
    'Viewport width and height must be positive finite numbers.',
    'Network settings must use a non-negative integer latency and a valid outcome.',
  ])
})

Test('Studio scenario intents preserve revisions in one canonical save, fixture capture, and failure replay', () => {
  const model = scenarioModel(runtimeFailure())
  const save = StudioScenarioControls.saveArgumentsAction(
    model,
    { Count: 5, Mode: 'compact', Title: 'Saved' },
    'save-1',
    'light',
  )
  const invalidSave = StudioScenarioControls.saveArgumentsAction(
    model,
    { Count: 'five', Mode: 'compact', Title: 'No dispatch' },
    'save-invalid',
  )
  const capture = StudioScenarioControls.fixtureCapture(model, 'CapturedNovel', 'capture-1')
  const replay = StudioScenarioControls.replay(model)

  Expect(save).toMatchObject({
    ok: true,
    value: {
      action: {
        appearance: 'light',
        arguments: { Count: 5, Mode: 'compact', Title: 'Saved' },
        kind: 'set-scenario-arguments',
        scenarioGroupName: 'states',
        scenarioName: 'novel',
      },
      checkpoint: { id: 'scenario-arguments:save-1', phase: 'single' },
      identity: {
        cellId: 'cell-novel',
        cellRevision: 3,
        path: 'Scenarios.tao',
        scenarioId: 'scenario-novel',
        sourceVersion: 'source-scenarios',
      },
      requestId: 'save-1',
      type: 'source-action',
    },
  })
  Expect(invalidSave.ok).toBe(false)
  Expect(capture).toMatchObject({
    ok: true,
    value: {
      fixtureName: 'CapturedNovel',
      request: {
        identity: { cellId: 'cell-novel', cellRevision: 3, previewInstanceId: 'preview-8' },
        requestId: 'capture-1',
        type: 'capture-fixture',
      },
    },
  })
  Expect(replay).toMatchObject({ ok: true, value: { capturedAt: 10, version: 1 } })
  Expect(StudioScenarioControls.fixtureCapture(model, 'not valid', 'capture-2')).toEqual({
    issues: ['Fixture name must be a Tao identifier.'],
    ok: false,
  })
})

function scenarioModel(failureReplay = undefined as ReturnType<typeof runtimeFailure> | undefined) {
  const manifest = scenarioManifest()
  const modeled = StudioScenarioControls.fromManifest({
    cell: manifest.cells[0]!,
    cellIdentity: cellIdentity(),
    ...(failureReplay === undefined ? {} : { failureReplay }),
    manifest,
    previewInstanceId: 'preview-8',
  })
  if (!modeled.ok) {
    throw new Error(modeled.issues.join(' '))
  }
  return modeled.value
}

function cellIdentity(): StudioCellIdentity {
  return {
    appName: 'Garden',
    cellId: 'cell-novel',
    cellRevision: 3,
    compileRevision: 7,
    manifestRevision: 'manifest-7',
    project: '/workspace',
  }
}

function scenarioManifest(): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: '/workspace/Scenarios.tao', range: { end: 80, start: 10 } }
  return {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' },
    cells: [{
      args: { Count: 2, Mode: 'compact', Title: 'Novel' },
      cellId: 'cell-novel',
      cellRevision: 3,
      environment: {
        network: { latencyMs: 25, outcome: 'normal' },
        scheme: {
          capability: 'reactive-browser' as const,
          requested: 'system' as const,
          resolved: 'light' as const,
          source: 'system' as const,
        },
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
      scenarioId: 'scenario-novel',
      stateLayers: ['fixture-home', 'state-expanded'],
    }],
    compileRevision: 7,
    fixtures: [{ fixtureId: 'fixture-home', label: 'Home', plan: {}, source }],
    generationDeclarations: [],
    manifestRevision: 'manifest-7',
    parametersBySubject: {
      'view-card': [
        { label: 'Title', parameterId: 'Title', required: true, type: { kind: 'text' } },
        { label: 'Count', parameterId: 'Count', required: true, type: { kind: 'number', maximum: 10, minimum: 0 } },
        { label: 'Mode', parameterId: 'Mode', required: true, type: { kind: 'choice', values: ['compact', 'wide'] } },
      ],
    },
    project: { appName: 'Garden', entryPath: '/workspace/Garden.tao', root: '/workspace' },
    scenarios: [{
      args: { Count: 2, Mode: 'compact', Title: 'Novel' },
      fixtureId: 'fixture-home',
      group: 'states',
      label: 'novel',
      prepare: [],
      scenarioId: 'scenario-novel',
      source,
      stateLayers: ['state-expanded'],
      subjectId: 'view-card',
    }],
    sourceVersions: { '/workspace/Scenarios.tao': 'source-scenarios' },
    states: [],
    subjects: [{ kind: 'view', source, subjectId: 'view-card', viewName: 'Card' }],
    version: 2,
  }
}

function runtimeFailure() {
  return {
    capturedAt: 10,
    domains: [{ domain: 'data', value: { rows: [] }, version: 1 }],
    failure: {
      boundaryId: 'view:Card',
      error: { message: 'Failed', name: 'Error' },
      frame: { boundary: 'item' as const, declaration: 'Card' },
      retryEligible: true,
      stopper: false,
      timestamp: 10,
    },
    version: 1 as const,
  }
}
