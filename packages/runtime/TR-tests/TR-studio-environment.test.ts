import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoDataProvider, TaoFillOps } from '../TaoRuntime-src/TR-data'
import {
  capturedFixture,
  studioEnvironmentVersion,
  studioStateSeedVersion,
  TaoStudioDeclaredFillError,
  type TaoStudioEnvironment,
  TaoStudioOfflineError,
} from '../TaoRuntime-src/TR-studio-environment'

const inertScheme = {
  capability: 'inert',
  reason: 'Reactive Scheme and Appearance are not implemented.',
  requested: 'dark',
} as const

function environment(overrides: Partial<TaoStudioEnvironment['network']> = {}): TaoStudioEnvironment {
  return {
    network: { mode: 'online', ...overrides },
    scheme: inertScheme,
    version: studioEnvironmentVersion,
  }
}

Describe('Studio isolated provider environment', () => {
  Test('resolves focused-view arguments as self-evaluating Tao values', () => {
    const workspace = { Name: 'Novel' }
    const argument = TR.Studio.Environment.Argument(
      { handle: 'Novel', kind: 'fixture-reference' },
      { Novel: workspace },
    )

    Expect(argument.evaluate()).toBe(argument)
    Expect(argument.jsValue).toBe(workspace)
    Expect(TR.Member(argument.evaluate(), ['Name']).evaluate().jsValue).toBe('Novel')
  })

  Test('converts captured provider rows into a dependency-ordered fixture plan', async () => {
    const snapshot = JSON.stringify({
      formatVersion: 1,
      nextId: 3,
      rows: {
        Author: [{ Id: 'Author-1', Name: 'Ada' }],
        Story: [{ Author: 'Author-1', Id: 'Story-2', Title: 'Analytical Engine' }],
      },
      schemaVersion: 1,
    })
    const provider = TR.Studio.Environment.Provider(TR.DataProvider.Memory(), {
      environment: environment(),
      seed: { snapshots: { Capture: snapshot }, version: studioStateSeedVersion },
    })
    const schema = TR.Data.Schema({
      entities: {
        Author: { collection: 'Authors', fields: { Name: { kind: 'text' } } },
        Story: {
          collection: 'Stories',
          fields: {
            Author: { kind: 'relation', relation: 'Author' },
            Title: { kind: 'text' },
          },
        },
      },
      name: 'Capture',
    }, provider)
    await schema.settle()

    Expect(capturedFixture([provider], [schema])).toEqual({
      accounts: [],
      creates: [
        { entity: 'Author', fields: { Name: 'Ada' }, name: 'Author1' },
        {
          entity: 'Story',
          fields: {
            Author: { handle: 'Author1', kind: 'fixture-reference' },
            Title: 'Analytical Engine',
          },
          name: 'Story1',
        },
      ],
    })
  })

  Test('loads seeded snapshots, captures writes exactly, and never reaches durable persistence', async () => {
    let durableLoads = 0
    let durablePersists = 0
    const durable: TaoDataProvider = {
      load: () => {
        durableLoads += 1
        return 'durable'
      },
      persist: () => {
        durablePersists += 1
      },
    }
    const provider = TR.Studio.Environment.Provider(durable, {
      environment: environment(),
      seed: {
        snapshots: { Notes: '{"rows":["seed"]}' },
        version: studioStateSeedVersion,
      },
    })

    Expect(await provider.load('Notes')).toBe('{"rows":["seed"]}')
    Expect(await provider.load('Other')).toBeUndefined()
    await provider.persist('Notes', '{"rows":["edited"]}')
    await provider.persist('Accounts', '{"rows":["ro"]}')

    Expect(provider.capture()).toEqual({
      snapshots: {
        Accounts: '{"rows":["ro"]}',
        Notes: '{"rows":["edited"]}',
      },
      version: studioStateSeedVersion,
    })
    Expect(durableLoads).toBe(0)
    Expect(durablePersists).toBe(0)
  })

  Test('keeps cells isolated even when they wrap the same configured provider and storage key', async () => {
    const durable = TR.DataProvider.Memory()
    const first = TR.Studio.Environment.Provider(durable, { environment: environment() })
    const second = TR.Studio.Environment.Provider(durable, { environment: environment() })

    await first.persist('Shared', 'first')
    await second.persist('Shared', 'second')

    Expect(await first.load('Shared')).toBe('first')
    Expect(await second.load('Shared')).toBe('second')
    Expect(await durable.load('Shared')).toBeUndefined()
  })

  Test('preserves configuration and fill cache behavior while sharing the cell snapshot overlay', async () => {
    const configurations: Readonly<Record<string, unknown>>[] = []
    const fills: string[] = []
    const configuredProvider = (label: string): TaoDataProvider => ({
      fill: async request => {
        fills.push(`${label}:${request.descriptor.entity}`)
      },
      fillCacheMs: 250,
      load: () => 'durable',
      persist: () => {},
      withConfiguration(config) {
        configurations.push(config)
        return configuredProvider(String(config['label']))
      },
    })
    const provider = TR.Studio.Environment.Provider(configuredProvider('base'), {
      environment: environment(),
    })
    await provider.persist('Notes', 'cell')
    const configured = provider.withConfiguration!({ label: 'configured' })

    await configured.fill!(fillRequest('Story'), collectingOps())

    Expect(configurations).toEqual([{ label: 'configured' }])
    Expect(fills).toEqual(['configured:Story'])
    Expect(configured.fillCacheMs).toBe(250)
    Expect(await configured.load('Notes')).toBe('cell')
  })

  Test('delegates the exact fill descriptor and upsert operations', async () => {
    const upserts: Array<{ entity: string; rows: readonly Record<string, unknown>[] }> = []
    const base: TaoDataProvider = {
      fill: async (request, ops) => {
        Expect(request.descriptor).toEqual({ entity: 'Story', limit: 3, where: { Feed: 'front' } })
        ops.upsert('Story', [{ Id: 1 }])
      },
      load: () => undefined,
      persist: () => {},
    }
    const provider = TR.Studio.Environment.Provider(base, { environment: environment() })

    await provider.fill!({
      descriptor: { entity: 'Story', limit: 3, where: { Feed: 'front' } },
    }, {
      upsert: (entity, rows) => upserts.push({ entity, rows }),
    })

    Expect(upserts).toEqual([{ entity: 'Story', rows: [{ Id: 1 }] }])
  })

  Test('delays delegated fills on the Tao clock', async () => {
    const fills: string[] = []
    const provider = TR.Studio.Environment.Provider(fillProvider(entity => fills.push(entity)), {
      environment: environment({ latencyMs: 25 }),
    })
    TR.Clock.beginTest(1_000)
    try {
      const pending = provider.fill!(fillRequest('Story'), collectingOps())
      TR.Clock.advance(24)
      await Promise.resolve()
      Expect(fills).toEqual([])

      TR.Clock.advance(1)
      await pending
      Expect(fills).toEqual(['Story'])
    } finally {
      TR.Clock.endTest()
    }
  })

  Test('models offline and declared failures at the fill boundary without calling the adapter', async () => {
    let calls = 0
    const base = fillProvider(() => {
      calls += 1
    })
    const offline = TR.Studio.Environment.Provider(base, {
      environment: environment({ mode: 'offline' }),
    })
    await Expect(offline.fill!(fillRequest('Story'), collectingOps())).rejects.toBeInstanceOf(TaoStudioOfflineError)

    const failing = TR.Studio.Environment.Provider(base, {
      environment: environment({
        failures: [{ entity: 'Story', message: 'Declared outage', occurrence: 2 }],
      }),
    })
    await failing.fill!(fillRequest('Story'), collectingOps())
    await Expect(failing.fill!(fillRequest('Story'), collectingOps())).rejects.toBeInstanceOf(
      TaoStudioDeclaredFillError,
    )
    await failing.fill!(fillRequest('Story'), collectingOps())

    Expect(calls).toBe(2)
  })

  Test('keeps declared failure occurrence counters isolated by cell', async () => {
    const base = fillProvider(() => {})
    const options = {
      environment: environment({ failures: [{ message: 'First fill fails', occurrence: 1 }] }),
    }
    const first = TR.Studio.Environment.Provider(base, options)
    const second = TR.Studio.Environment.Provider(base, options)

    await Expect(first.fill!(fillRequest('Story'), collectingOps())).rejects.toThrow('First fill fails')
    await Expect(second.fill!(fillRequest('Story'), collectingOps())).rejects.toThrow('First fill fails')
    await first.fill!(fillRequest('Story'), collectingOps())
    await second.fill!(fillRequest('Story'), collectingOps())
  })

  Test('keeps Scheme explicitly inert and returns the same immutable configuration', () => {
    Expect(TR.Studio.Environment.Scheme(inertScheme)).toBe(inertScheme)
    Expect(() =>
      TR.Studio.Environment.Scheme({
        capability: 'inert',
        reason: '',
        requested: 'system',
      })
    ).toThrow('explicitly inert with a visible reason')
  })
})

function fillProvider(fill: (entity: string) => void): TaoDataProvider {
  return {
    fill: async request => fill(request.descriptor.entity),
    load: () => undefined,
    persist: () => {},
  }
}

function fillRequest(entity: string) {
  return { descriptor: { entity, where: {} } }
}

function collectingOps(): TaoFillOps {
  return { upsert: () => {} }
}
