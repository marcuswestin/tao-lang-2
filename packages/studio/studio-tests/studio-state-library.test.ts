import { Describe, Expect, Test } from '@shared/test'
import {
  type StudioStateEntry,
  StudioStateLibrary,
  StudioStateResolutionError,
} from '../studio-src/StudioStateLibrary'

Describe('Studio state library', () => {
  Test('resolves ordered Tao-authored layers and diagnoses deterministic domain overrides', () => {
    const library = new StudioStateLibrary([
      state('base', [], { data: domain(1, { user: 'Ada' }) }),
      state('loading', ['base'], { scene: domain(1, { loading: true }) }),
      state('override', [], { data: domain(1, { user: 'Grace' }) }),
    ], ['data', 'scene'])

    const resolved = library.resolve(['loading', 'override'])

    Expect(resolved.orderedStateIds).toEqual(['base', 'loading', 'override'])
    Expect(resolved.snapshot).toEqual({
      domains: {
        data: domain(1, { user: 'Grace' }),
        scene: domain(1, { loading: true }),
      },
      version: 1,
    })
    Expect(resolved.diagnostics).toContainEqual({
      code: 'state-domain-overridden',
      domain: 'data',
      message: 'Studio state override overrides data from base.',
      severity: 'warning',
      stateIds: ['base', 'override'],
    })
  })

  Test('reports composition cycles and incompatible codec conflicts', () => {
    const cyclic = new StudioStateLibrary([
      state('a', ['b'], {}),
      state('b', ['a'], {}),
    ], [])
    try {
      cyclic.resolve(['a'])
      throw new Error('Expected a cycle diagnostic.')
    } catch (error) {
      Expect(error).toBeInstanceOf(StudioStateResolutionError)
      Expect((error as StudioStateResolutionError).diagnostics[0]?.code).toBe('state-cycle')
    }

    const conflicting = new StudioStateLibrary([
      state('old', [], { data: domain(1, {}) }),
      state('new', [], { data: domain(2, {}) }),
    ], ['data'])
    Expect(() => conflicting.resolve(['old', 'new'])).toThrow('incompatible data codecs')
  })

  Test('rejects unsupported runtime domains and non-JSON capture data', () => {
    Expect(() =>
      new StudioStateLibrary([
        state('unsupported', [], { navigation: domain(1, {}) }),
      ], ['data'])
    ).toThrow('domain is not supported')

    Expect(() =>
      new StudioStateLibrary([
        state('bad-json', [], { data: domain(1, { value: Number.NaN }) }),
      ], ['data'])
    ).toThrow('unsupported runtime data')
  })
})

function state(
  stateId: string,
  layers: readonly string[],
  domains: StudioStateEntry['snapshot']['domains'],
): StudioStateEntry {
  return {
    label: stateId,
    layers,
    revision: `${stateId}-revision`,
    snapshot: { domains, version: 1 },
    source: { kind: 'tao', path: '/project/Scenarios.tao', range: { end: 10, start: 0 } },
    stateId,
  }
}

function domain(codecVersion: number, value: Record<string, unknown>) {
  return { codecVersion, value } as StudioStateEntry['snapshot']['domains'][string]
}
