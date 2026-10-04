import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { studioReplayConfiguration } from '../studio-src/client/matrix/StudioRuntimeCapture'
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

  Test('preserves reactive and pinned native Scheme captures without accepting invalid native pins', () => {
    for (
      const scheme of [
        { capability: 'reactive-native', requested: 'system', resolved: 'dark', source: 'system' },
        { capability: 'pinned-native', requested: 'dark', resolved: 'dark', source: 'scenario' },
      ] as const
    ) {
      const manifest = fixture()
      const environment = manifest.cells[0]!.environment
      environment.scheme = scheme
      Expect(StudioPreviewManifest.define(manifest).cells[0]!.environment.scheme).toEqual(scheme)
      const currentEnvironment = { ...environment, scheme: systemLightScheme() }
      const replay = studioReplayConfiguration({
        capturedAt: 1,
        domains: [{ domain: 'scheme', value: scheme, version: 1 }],
        version: 1,
      }, currentEnvironment)
      Expect(replay.environment.scheme).toEqual(scheme)
    }
    const invalid = fixture()
    invalid.cells[0]!.environment.scheme = {
      capability: 'pinned-native',
      requested: 'dark',
      resolved: 'light',
      source: 'scenario',
    }
    Expect(() => StudioPreviewManifest.define(invalid)).toThrow('valid request, resolution, source')
    const currentEnvironment = { ...invalid.cells[0]!.environment, scheme: systemLightScheme() }
    Expect(
      studioReplayConfiguration({
        capturedAt: 1,
        domains: [{ domain: 'scheme', value: invalid.cells[0]!.environment.scheme, version: 1 }],
        version: 1,
      }, currentEnvironment).environment.scheme,
    ).toEqual(systemLightScheme())
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

  Test('accepts a fixtureless scenario and preserves its ordered journey prefix', () => {
    const base = fixture()
    const [first, second] = base.scenarios
    const { fixtureId: _firstFixture, ...fixturelessFirst } = first!
    const { fixtureId: _secondFixture, ...fixturelessSecond } = second!
    const input: StudioPreviewManifestV2 = {
      ...base,
      fixtures: [],
      scenarios: [{
        ...fixturelessFirst,
        steps: [
          { kind: 'pressDown', selector: 'tag', target: 'revertSave' },
          { kind: 'advance', milliseconds: 1.5 },
          { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
          { kind: 'hover', selector: 'tag', target: 'revertSave' },
          { kind: 'focus', tag: 'revertSave' },
          { kind: 'press', selector: 'text', target: 'Save' },
          { kind: 'enter', selector: 'placeholder', target: 'Name', value: '' },
          { kind: 'submit', selector: 'label', target: 'Profile' },
          {
            index: 1,
            kind: 'select',
            steps: [{ kind: 'press', selector: 'tag', target: 'open' }],
            tag: 'row',
          },
        ],
      }, fixturelessSecond],
    }

    const defined = StudioPreviewManifest.define(input)

    Expect(defined.scenarios[0]?.fixtureId).toBeUndefined()
    Expect(defined.scenarios[0]?.steps?.map(step => step.kind)).toEqual([
      'pressDown',
      'advance',
      'pressUp',
      'hover',
      'focus',
      'press',
      'enter',
      'submit',
      'select',
    ])
  })

  Test('rejects malformed journey variants, selectors, values, fields, and nested steps as user input', () => {
    const malformed: readonly (readonly [unknown, string])[] = [
      [{ not: 'an array' }, 'steps must be an array'],
      [[null], 'object with a supported kind'],
      [[{ kind: 'tap', selector: 'tag', target: 'save' }], 'Unsupported Studio journey step kind: tap'],
      [[{ kind: 'advance', milliseconds: -0.5 }], 'non-negative number'],
      [[{ kind: 'advance', milliseconds: Number.POSITIVE_INFINITY }], 'non-negative number'],
      [[{ kind: 'focus', tag: '' }], 'focus tag must not be empty'],
      [[{ kind: 'press', selector: 'role', target: 'save' }], 'press selector is invalid'],
      [[{ kind: 'enter', selector: 'tag', target: 'name', value: 42 }], 'enter value must be text'],
      [[{ extra: true, kind: 'submit', selector: 'tag', target: 'form' }], 'unsupported field: extra'],
      [[{ index: 0, kind: 'select', steps: [], tag: 'row' }], 'positive whole number'],
      [[{ index: 1, kind: 'select', steps: {}, tag: 'row' }], 'steps must be an array'],
      [[
        { index: 1, kind: 'select', steps: [{ kind: 'tap', selector: 'tag', target: 'save' }], tag: 'row' },
      ], 'Unsupported Studio journey step kind: tap'],
    ]

    for (const [steps, message] of malformed) {
      const manifest = fixture()
      ;(manifest.scenarios[0] as unknown as { steps: unknown }).steps = steps

      let failure: unknown
      try {
        StudioPreviewManifest.define(manifest)
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(Errors.UserInputError)
      Expect((failure as Error).message).toContain(message)
    }
  })

  Test('preserves entity parameter identity and requires an object argument', () => {
    const base = fixture()
    const manifest: StudioPreviewManifestV2 = {
      ...base,
      cells: base.cells.map((cell, index) =>
        index === 0 ? { ...cell, args: { ...cell.args, owner: { id: 'account-1' } } } : cell
      ),
      parametersBySubject: {
        ...base.parametersBySubject,
        card: [
          ...base.parametersBySubject['card']!,
          { label: 'Owner', parameterId: 'owner', required: true, type: { entity: 'Account', kind: 'json' } },
        ],
      },
      scenarios: base.scenarios.map((scenario, index) =>
        index === 0
          ? { ...scenario, args: { ...scenario.args, owner: { handle: 'Lead', kind: 'fixture-reference' } } }
          : scenario
      ),
    }

    const defined = StudioPreviewManifest.define(manifest)

    Expect(defined.parametersBySubject['card']?.[1]?.type).toEqual({ entity: 'Account', kind: 'json' })

    const invalid = {
      ...manifest,
      cells: manifest.cells.map((cell, index) =>
        index === 0 ? { ...cell, args: { ...cell.args, owner: 'account-1' } } : cell
      ),
    }
    Expect(() => StudioPreviewManifest.define(invalid)).toThrow('does not match entity Account')
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
