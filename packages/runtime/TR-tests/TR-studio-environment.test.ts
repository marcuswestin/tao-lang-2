import TR from '@runtime/TR'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import type { TaoDataConnection, TaoDataProvider, TaoDataProviderContext, TaoFillOps } from '../TaoRuntime-src/TR-data'
import {
  capturedFixture,
  studioEnvironmentVersion,
  studioStateSeedVersion,
  TaoStudioDeclaredFillError,
  type TaoStudioEnvironment,
  TaoStudioOfflineError,
} from '../TaoRuntime-src/TR-studio-environment'

const scenarioScheme = {
  requested: 'dark',
  source: 'scenario',
} as const

const consoleInfoSlot = testOverrideSlot<typeof console.info>({
  read: () => console.info,
  write: value => {
    console.info = value
  },
})

function environment(overrides: Partial<TaoStudioEnvironment['network']> = {}): TaoStudioEnvironment {
  return {
    network: { mode: 'online', ...overrides },
    scheme: scenarioScheme,
    version: studioEnvironmentVersion,
  }
}

function context(storageKey: string, configuration: Record<string, unknown> = {}): TaoDataProviderContext {
  return Object.freeze({
    configuration: Object.freeze(configuration),
    schema: { entities: {}, name: storageKey },
    storageKey,
  })
}

function memoryProvider(): TaoDataProvider & { loads(): number; saves(): number } {
  const snapshots = new Map<string, string>()
  let loads = 0
  let saves = 0
  return {
    connect: ({ storageKey }) => ({
      load: () => {
        loads += 1
        return snapshots.get(storageKey)
      },
      save: snapshot => {
        saves += 1
        snapshots.set(storageKey, snapshot)
      },
    }),
    loads: () => loads,
    saves: () => saves,
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

  Test('binds omitted action parameters to isolated bounded stand-ins with evaluated arguments', () => {
    const firstHandles = {}
    const secondHandles = {}
    const first = TR.Studio.Environment.Argument(
      { kind: 'action-stand-in', parameter: 'Revert' },
      firstHandles,
    )
    const second = TR.Studio.Environment.Argument(
      { kind: 'action-stand-in', parameter: 'Revert' },
      secondHandles,
    )
    const calls: unknown[][] = []
    const restoreConsoleInfo = consoleInfoSlot.install((...arguments_) => calls.push(arguments_))
    try {
      const firstAction = first.jsValue as { invoke(...arguments_: unknown[]): void }
      const secondAction = second.jsValue as { invoke(...arguments_: unknown[]): void }
      for (let index = 0; index < 102; index += 1) {
        firstAction.invoke(TR.Value(index), TR.Value(`draft-${index}`))
      }
      secondAction.invoke(TR.Value('other cell'))

      const firstLog = TR.Studio.Environment.actionLog(firstHandles)
      Expect(firstLog).toHaveLength(100)
      Expect(firstLog[0]).toEqual({ arguments: [2, 'draft-2'], parameter: 'Revert' })
      Expect(firstLog[99]).toEqual({ arguments: [101, 'draft-101'], parameter: 'Revert' })
      Expect(TR.Studio.Environment.actionLog(secondHandles)).toEqual([
        { arguments: ['other cell'], parameter: 'Revert' },
      ])
      Expect(calls.at(-1)).toEqual(["Tao Studio action stand-in 'Revert' invoked.", 'other cell'])
    } finally {
      restoreConsoleInfo()
    }
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
    const provider = TR.Studio.Environment.Provider(memoryProvider(), {
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
    }, provider.connect(context('Capture')))
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
    const durable = memoryProvider()
    const provider = TR.Studio.Environment.Provider(durable, {
      environment: environment(),
      seed: {
        snapshots: { Notes: '{"rows":["seed"]}' },
        version: studioStateSeedVersion,
      },
    })

    Expect(await provider.connect(context('Notes')).load()).toBe('{"rows":["seed"]}')
    Expect(await provider.connect(context('Other')).load()).toBeUndefined()
    await provider.connect(context('Notes')).save('{"rows":["edited"]}')
    await provider.connect(context('Accounts')).save('{"rows":["ro"]}')

    Expect(provider.capture()).toEqual({
      snapshots: {
        Accounts: '{"rows":["ro"]}',
        Notes: '{"rows":["edited"]}',
      },
      version: studioStateSeedVersion,
    })
    Expect(durable.loads()).toBe(0)
    Expect(durable.saves()).toBe(0)
  })

  Test('keeps cells isolated even when they wrap the same configured provider and storage key', async () => {
    const durable = memoryProvider()
    const first = TR.Studio.Environment.Provider(durable, { environment: environment() })
    const second = TR.Studio.Environment.Provider(durable, { environment: environment() })

    await first.connect(context('Shared')).save('first')
    await second.connect(context('Shared')).save('second')

    Expect(await first.connect(context('Shared')).load()).toBe('first')
    Expect(await second.connect(context('Shared')).load()).toBe('second')
    Expect(await durable.connect(context('Shared')).load()).toBeUndefined()
  })

  Test('preserves configuration and fill cache behavior while sharing the cell snapshot overlay', async () => {
    const configurations: Readonly<Record<string, unknown>>[] = []
    const fills: string[] = []
    const base: TaoDataProvider = {
      connect: ({ configuration }) => {
        configurations.push(configuration)
        return {
          fill: async request => {
            fills.push(`${String(configuration['label'])}:${request.descriptor.entity}`)
          },
          fillCacheMs: 250,
          load: () => 'durable',
          save: () => {},
        }
      },
      fills: true,
    }
    const provider = TR.Studio.Environment.Provider(base, {
      environment: environment(),
    })
    await provider.connect(context('Notes')).save('cell')
    const configured = provider.connect(context('Notes', { label: 'configured' }))

    await configured.fill!(fillRequest('Story'), collectingOps())

    Expect(configurations).toEqual([{}, { label: 'configured' }])
    Expect(fills).toEqual(['configured:Story'])
    Expect(configured.fillCacheMs).toBe(250)
    Expect(await configured.load()).toBe('cell')
  })

  Test('delegates the exact fill descriptor and upsert operations', async () => {
    const upserts: Array<{ entity: string; rows: readonly Record<string, unknown>[] }> = []
    const base: TaoDataProvider = {
      connect: () => ({
        fill: async (request, ops) => {
          Expect(request.descriptor).toEqual({ entity: 'Story', limit: 3, where: { Feed: 'front' } })
          ops.upsert('Story', [{ Id: 1 }])
        },
        load: () => undefined,
        save: () => {},
      }),
      fills: true,
    }
    const provider = TR.Studio.Environment.Provider(base, { environment: environment() })

    await provider.connect(context('Stories')).fill!({
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
    const connection = provider.connect(context('Stories'))
    TR.Clock.beginTest(1_000)
    try {
      const pending = connection.fill!(fillRequest('Story'), collectingOps())
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
    }).connect(context('Stories'))
    await Expect(offline.fill!(fillRequest('Story'), collectingOps())).rejects.toBeInstanceOf(TaoStudioOfflineError)

    const failing = TR.Studio.Environment.Provider(base, {
      environment: environment({
        failures: [{ entity: 'Story', message: 'Declared outage', occurrence: 2 }],
      }),
    }).connect(context('Stories'))
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
    const first = TR.Studio.Environment.Provider(base, options).connect(context('Stories'))
    const second = TR.Studio.Environment.Provider(base, options).connect(context('Stories'))

    await Expect(first.fill!(fillRequest('Story'), collectingOps())).rejects.toThrow('First fill fails')
    await Expect(second.fill!(fillRequest('Story'), collectingOps())).rejects.toThrow('First fill fails')
    await first.fill!(fillRequest('Story'), collectingOps())
    await second.fill!(fillRequest('Story'), collectingOps())
  })

  Test('resolves a scenario Scheme the same way on a canvas and on a device', () => {
    Expect(TR.Studio.Environment.Scheme(
      scenarioScheme,
      { platform: 'web', system: 'light' },
    )).toEqual({
      capability: 'reactive-browser',
      requested: 'dark',
      resolved: 'dark',
      source: 'scenario',
    })
    // A device runs the scenario, and appearance is part of it — unlike the viewport, nothing about
    // a phone prevents it. The two surfaces differ only in what the capability is called.
    Expect(TR.Studio.Environment.Scheme(
      scenarioScheme,
      { platform: 'native', system: 'dark' },
    )).toEqual({
      capability: 'pinned-native',
      requested: 'dark',
      resolved: 'dark',
      source: 'scenario',
    })
    Expect(() =>
      TR.Studio.Environment.Scheme({
        requested: 'system',
        source: 'scenario',
      }, { platform: 'web', system: 'light' })
    ).toThrow('valid requested appearance and request source')
  })

  Test('mounts a replayed Scheme from its captured resolution before live environment precedence', () => {
    Expect(TR.Studio.Environment.Scheme({
      replay: {
        capability: 'reactive-browser',
        requested: 'system',
        resolved: 'dark',
        source: 'system',
      },
      requested: 'light',
      source: 'scenario',
    }, { platform: 'web', system: 'light' })).toEqual({
      capability: 'reactive-browser',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    })
  })
})

function fillProvider(fill: (entity: string) => void): TaoDataProvider {
  return {
    connect: (): TaoDataConnection => ({
      fill: async request => fill(request.descriptor.entity),
      load: () => undefined,
      save: () => {},
    }),
    fills: true,
  }
}

function fillRequest(entity: string) {
  return { descriptor: { entity, where: {} } }
}

function collectingOps(): TaoFillOps {
  return { upsert: () => {} }
}
