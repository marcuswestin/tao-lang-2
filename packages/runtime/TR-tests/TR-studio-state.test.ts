import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import {
  studioStateArtifactVersion,
  TaoStudioStateCodecRegistry,
  TaoStudioStateConflictError,
  type TaoStudioStateDomainCodec,
  type TaoStudioStateLayer,
} from '../TaoRuntime-src/TR-studio-state'

Describe('Studio versioned state domains', () => {
  Test('composes data snapshots in layer order and preserves canonical domain state', () => {
    const registry = TR.Studio.State.Registry()
    const composed = registry.compose([
      dataLayer('Base', { Notes: 'notes-v1' }),
      dataLayer('Accounts', { Accounts: 'accounts-v1' }),
      dataLayer('Same notes', { Notes: 'notes-v1' }),
    ])

    Expect(composed).toEqual({
      domains: [{
        domain: 'data',
        state: {
          snapshots: { Accounts: 'accounts-v1', Notes: 'notes-v1' },
          version: 1,
        },
        version: 1,
      }],
      version: studioStateArtifactVersion,
    })
  })

  Test('reports the exact domain and layers for conflicting provider snapshots', () => {
    const registry = TR.Studio.State.Registry()

    try {
      registry.compose([
        dataLayer('Empty state', { Notes: 'empty' }),
        dataLayer('Populated state', { Notes: 'populated' }),
      ])
      throw new Error('Expected a state composition conflict.')
    } catch (error) {
      Expect(error).toBeInstanceOf(TaoStudioStateConflictError)
      Expect(error).toMatchObject({
        domain: 'data',
        incomingLayer: 'Populated state',
        previousLayers: ['Empty state'],
      })
      Expect(String(error)).toContain("storage key 'Notes' has different snapshots")
    }
  })

  Test('rejects unsupported domains, versions, duplicate domains, and invalid data payloads', () => {
    const registry = TR.Studio.State.Registry()
    Expect(() => registry.validate(artifact('navigation', 1, {}))).toThrow(
      "Unsupported Tao Studio state domain 'navigation'",
    )
    Expect(() => registry.validate(artifact('data', 2, { snapshots: {}, version: 1 }))).toThrow(
      "Unsupported Tao Studio state domain 'data' version '2'",
    )
    Expect(() =>
      registry.validate({
        domains: [
          { domain: 'data', state: { snapshots: {}, version: 1 }, version: 1 },
          { domain: 'data', state: { snapshots: {}, version: 1 }, version: 1 },
        ],
        version: 1,
      })
    ).toThrow("repeats domain 'data'")
    Expect(() => registry.validate(artifact('data', 1, { snapshots: { Notes: 42 }, version: 1 }))).toThrow(
      'string snapshots',
    )
  })

  Test('runs custom domain composition in source order and preserves first domain appearance order', () => {
    const registry = new TaoStudioStateCodecRegistry()
    registry.register(numberCodec('counter'))
    registry.register(numberCodec('secondary'))
    const result = registry.compose([
      layer('First', [payload('counter', 2)]),
      layer('Second', [payload('secondary', 10), payload('counter', 3)]),
      layer('Third', [payload('counter', 5)]),
    ])

    Expect(result.domains).toEqual([
      { domain: 'counter', state: 10, version: 1 },
      { domain: 'secondary', state: 10, version: 1 },
    ])
  })

  Test('rejects duplicate codec registration and unsupported artifact versions', () => {
    const registry = new TaoStudioStateCodecRegistry()
    registry.register(numberCodec('counter'))
    Expect(() => registry.register(numberCodec('counter'))).toThrow("domain 'counter' is already registered")
    Expect(() => registry.validate({ domains: [], version: 2 as 1 })).toThrow(
      "Unsupported Tao Studio state artifact version '2'",
    )
  })
})

function dataLayer(name: string, snapshots: Readonly<Record<string, string>>): TaoStudioStateLayer {
  return layer(name, [{
    domain: 'data',
    state: { snapshots, version: 1 },
    version: 1,
  }])
}

function artifact(domain: string, version: number, state: Record<string, unknown>) {
  return {
    domains: [{ domain, state, version }],
    version: studioStateArtifactVersion,
  } as Parameters<TaoStudioStateCodecRegistry['validate']>[0]
}

function layer(name: string, domains: TaoStudioStateLayer['artifact']['domains']): TaoStudioStateLayer {
  return { artifact: { domains, version: studioStateArtifactVersion }, name }
}

function payload(domain: string, state: number) {
  return { domain, state, version: 1 } as const
}

function numberCodec(domain: string): TaoStudioStateDomainCodec<number> {
  return {
    compose: (current, incoming) => current + incoming,
    decode(state) {
      if (typeof state !== 'number') {
        throw new Error('Expected a number.')
      }
      return state
    },
    domain,
    encode: value => value,
    version: 1,
  }
}
