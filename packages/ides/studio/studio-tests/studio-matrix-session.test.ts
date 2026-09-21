import { Describe, Expect, Test } from '@shared/test'
import { StudioMatrixConflictError, StudioMatrixSession } from '../studio-src/StudioMatrixSession'
import type {
  StudioCellInstanceIdentity,
  StudioPreviewManifestV2,
} from '../studio-src/StudioPreviewManifest'
import type { StudioRuntimeCaptureArtifact } from '../studio-src/StudioProtocol'
import { systemLightScheme } from './test-studio-fixtures'

Describe('Studio matrix session', () => {
  Test('registers concurrent cell instances without one cell invalidating another', () => {
    const session = new StudioMatrixSession(fixture())
    const phone = instance(session, 'phone', 'phone-instance')
    const desktop = instance(session, 'desktop', 'desktop-instance')

    session.registerInstance(phone)
    session.registerInstance(desktop)

    Expect(session.assertCurrentInstance(phone).cell.cellId).toBe('phone')
    Expect(session.assertCurrentInstance(desktop).cell.cellId).toBe('desktop')
    Expect(session.instance('phone-instance').identity).toEqual(session.cell('phone').identity)
  })

  Test('keeps several live instances of one cell until that cell is reconfigured', () => {
    const session = new StudioMatrixSession(fixture())
    const browser = instance(session, 'phone', 'browser-instance')
    const device = instance(session, 'phone', 'device-instance')
    session.registerInstance(browser)
    session.registerInstance(device)

    Expect(session.assertCurrentInstance(browser).cell.cellId).toBe('phone')
    Expect(session.assertCurrentInstance(device).cell.cellId).toBe('phone')
    Expect(session.instance('browser-instance').identity).toEqual(session.instance('device-instance').identity)

    session.unregisterInstance('device-instance')
    Expect(() => session.instance('device-instance')).toThrow('no longer current')
    Expect(session.assertCurrentInstance(browser).cell.cellId).toBe('phone')

    session.registerInstance(device)
    session.reconfigure({ ...session.cell('phone').identity, args: { title: 'Changed' } })
    Expect(() => session.instance('browser-instance')).toThrow('no longer current')
    Expect(() => session.instance('device-instance')).toThrow('no longer current')
  })

  Test('reconfigures one cell, resolves state layers, and rejects only its stale instance', () => {
    const session = new StudioMatrixSession(fixture())
    const phone = instance(session, 'phone', 'phone-instance')
    const desktop = instance(session, 'desktop', 'desktop-instance')
    session.registerInstance(phone)
    session.registerInstance(desktop)

    const next = session.reconfigure({
      ...session.cell('phone').identity,
      args: { title: 'Changed' },
      environment: {
        network: { error: { message: 'Injected failure', status: 503 }, latencyMs: 300, outcome: 'error' },
        scheme: {
          capability: 'reactive-browser' as const,
          requested: 'dark' as const,
          resolved: 'dark' as const,
          source: 'scenario' as const,
        },
        viewport: { height: 600, width: 600 },
      },
      stateLayers: ['loading'],
    })

    Expect(next.identity.cellRevision).toBe(1)
    Expect(next.resolvedState.orderedStateIds).toEqual(['base', 'loading'])
    Expect(next.cell.args).toEqual({ title: 'Changed' })
    Expect(() => session.assertCurrentInstance(phone)).toThrow('stale configuration revision')
    Expect(() => session.instance('phone-instance')).toThrow('no longer current')
    Expect(session.assertCurrentInstance(desktop).cell.cellId).toBe('desktop')
  })

  Test('rejects stale manifest, compile, and cell revisions with explicit conflict codes', () => {
    const session = new StudioMatrixSession(fixture())
    const current = session.cell('phone').identity
    const failures = [
      { ...current, manifestRevision: 'old' },
      { ...current, compileRevision: 6 },
      { ...current, cellRevision: 9 },
    ]
    const codes = failures.map(identity => {
      try {
        session.reconfigure(identity)
        return 'none'
      } catch (error) {
        return error instanceof StudioMatrixConflictError ? error.code : 'unexpected'
      }
    })

    Expect(codes).toEqual(['stale-manifest', 'stale-compile', 'stale-cell'])
  })

  Test('carries an explicit-domain runtime capture into one remounted cell and rejects unknown domains', () => {
    const session = new StudioMatrixSession(fixture())
    const replay: StudioRuntimeCaptureArtifact = {
      capturedAt: 1_788_100_000_000,
      domains: [
        { domain: 'data', value: { snapshots: { demo: '{"rows":{}}' } }, version: 1 },
        { domain: 'scene', value: { selected: 'Story1' }, version: 1 },
      ],
      failure: {
        boundaryId: 'screen:Card',
        error: { message: 'Failed', name: 'Error' },
        frame: { boundary: 'screen' as const, declaration: 'Card' },
        retryEligible: true,
        stopper: false,
        timestamp: 1_788_100_000_000,
      },
      version: 1 as const,
    }

    const replaying = session.reconfigure({ ...session.cell('phone').identity, replay })
    Expect(replaying.replay).toEqual(replay)
    Expect(session.cell('desktop').replay).toBe(undefined)

    Expect(() =>
      session.reconfigure({
        ...session.cell('desktop').identity,
        replay: { ...replay, domains: [{ domain: 'credentials', value: {}, version: 1 }] },
      })
    ).toThrow('capture domain is not supported: credentials')

    const cleared = session.reconfigure({ ...replaying.identity, args: { title: 'Fresh' } })
    Expect(cleared.replay).toBe(undefined)
  })

  Test('rebases compatible explicit overrides and invalidates live instances for remount', () => {
    const session = new StudioMatrixSession(fixture())
    const phoneInstance = instance(session, 'phone', 'phone-instance')
    session.registerInstance(phoneInstance)
    session.reconfigure({
      ...session.cell('phone').identity,
      args: { title: 'Preserved' },
      environment: {
        network: { latencyMs: 250, outcome: 'normal' },
        scheme: {
          capability: 'reactive-browser' as const,
          requested: 'dark' as const,
          resolved: 'dark' as const,
          source: 'scenario' as const,
        },
        viewport: { height: 600, width: 600 },
      },
      stateLayers: ['loading'],
    })
    session.registerInstance({ ...session.cell('phone').identity, previewInstanceId: 'phone-instance' })
    const nextManifest = fixture({ compileRevision: 8, manifestRevision: 'manifest-8' })
    const rebased = session.rebase(nextManifest)

    Expect(rebased.cell('phone').cell).toMatchObject({
      args: { title: 'Preserved' },
      cellRevision: 1,
      stateLayers: ['loading'],
    })
    Expect(rebased.cell('phone').cell.environment.viewport).toEqual({ height: 600, width: 600 })
    Expect(rebased.cell('phone').identity).toMatchObject({ compileRevision: 8, manifestRevision: 'manifest-8' })
    Expect(rebased.publishedManifest().cells.find(cell => cell.cellId === 'phone')).toMatchObject({
      args: { title: 'Preserved' },
      cellRevision: 1,
      stateLayers: ['loading'],
    })
    Expect(() => rebased.instance('phone-instance')).toThrow('no longer current')
    Expect(() => rebased.assertCurrentInstance(phoneInstance)).toThrow('stale manifest revision')
  })

  Test('rebasing drops removed and incompatible overrides while retaining compatible dimensions', () => {
    const session = new StudioMatrixSession(fixture())
    session.reconfigure({
      ...session.cell('phone').identity,
      args: { title: 'No longer valid' },
      environment: {
        network: { latencyMs: 250, outcome: 'normal' },
        scheme: {
          capability: 'reactive-browser' as const,
          requested: 'dark' as const,
          resolved: 'dark' as const,
          source: 'scenario' as const,
        },
        viewport: { height: 600, width: 600 },
      },
      stateLayers: ['loading'],
    })
    session.reconfigure({
      ...session.cell('desktop').identity,
      args: { title: 'Removed cell' },
    })
    const base = fixture({ compileRevision: 8, manifestRevision: 'manifest-8' })
    const manifest: StudioPreviewManifestV2 = {
      ...base,
      cells: base.cells.filter(cell => cell.cellId === 'phone').map(cell => ({
        ...cell,
        args: { count: 1 },
        stateLayers: ['base'],
      })),
      parametersBySubject: {
        card: [{ label: 'Count', parameterId: 'count', required: true, type: { kind: 'number' } }],
      },
      scenarios: base.scenarios.map(scenario => ({ ...scenario, args: { count: 1 } })),
      states: base.states.filter(state => state.stateId === 'base'),
    }
    const rebased = session.rebase(manifest)

    Expect(rebased.cell('phone').cell.args).toEqual({ count: 1 })
    Expect(rebased.cell('phone').cell.environment.viewport).toEqual({ height: 600, width: 600 })
    Expect(rebased.cell('phone').cell.stateLayers).toEqual(['base'])
    Expect(rebased.cell('phone').identity.cellRevision).toBe(1)
    Expect(() => rebased.cell('desktop')).toThrow('does not exist')
  })
})

function instance(session: StudioMatrixSession, cellId: string, previewInstanceId: string): StudioCellInstanceIdentity {
  return { ...session.cell(cellId).identity, previewInstanceId }
}

function fixture(revisions: { compileRevision: number; manifestRevision: string } = {
  compileRevision: 7,
  manifestRevision: 'manifest-7',
}): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 20, start: 0 } }
  const environment = {
    network: { latencyMs: 0, outcome: 'normal' as const },
    scheme: systemLightScheme(),
    viewport: { height: 844, width: 390 },
  }
  return {
    capabilities: { captureDomains: ['data', 'scene'], scheme: 'reactive-browser' },
    cells: [
      {
        args: { title: 'Hello' },
        cellId: 'phone',
        cellRevision: 0,
        environment,
        scenarioId: 'default',
        stateLayers: ['base'],
      },
      {
        args: { title: 'Hello' },
        cellId: 'desktop',
        cellRevision: 0,
        environment,
        scenarioId: 'default',
        stateLayers: [],
      },
    ],
    compileRevision: revisions.compileRevision,
    fixtures: [{ fixtureId: 'fixture:base', label: 'Base', plan: {}, source }],
    generationDeclarations: [],
    manifestRevision: revisions.manifestRevision,
    parametersBySubject: {
      card: [{ label: 'Title', parameterId: 'title', required: true, type: { kind: 'text' } }],
    },
    project: { appName: 'Demo', entryPath: '/project/App.tao', root: '/project' },
    scenarios: [{
      args: { title: 'Hello' },
      fixtureId: 'fixture:base',
      group: 'Cards',
      label: 'Default',
      prepare: [],
      scenarioId: 'default',
      source,
      stateLayers: ['base'],
      subjectId: 'card',
    }],
    sourceVersions: { '/project/App.tao': 'text-v1:app' },
    states: [
      {
        label: 'Base',
        layers: [],
        revision: 'base-1',
        snapshot: { domains: { data: { codecVersion: 1, value: { user: 'Ada' } } }, version: 1 },
        source,
        stateId: 'base',
      },
      {
        label: 'Loading',
        layers: ['base'],
        revision: 'loading-1',
        snapshot: { domains: { scene: { codecVersion: 1, value: { loading: true } } }, version: 1 },
        source,
        stateId: 'loading',
      },
    ],
    subjects: [{ kind: 'view', source, subjectId: 'card', viewName: 'Card' }],
    version: 2,
  }
}
