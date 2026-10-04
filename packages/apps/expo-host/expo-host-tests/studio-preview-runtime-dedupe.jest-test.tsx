import TR from '@runtime/TR'
import { createTaoJourneyReplayGate, replayTaoJourney, type TaoJourneyStep } from '@runtime/TR-studio-journey'
import { StudioLensHost, StudioLensRender } from '@runtime/TR-studio-lens'
import { Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import { createElement, memo, type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Text } from 'react-native'
import { MemoryProvider } from '../../stdlib/@tao/data/providers/memory/Memory'

/**
 * Proves the fix for a Studio preview cell that goes silently empty: `runtime.ts`'s generated
 * `receiveRuntime` must not replace the applied cell object for a runtime update whose identity
 * (compileRevision, cellRevision, manifestRevision) repeats what is already applied, because a new
 * cell object rebuilds the provider overlay (`TR.Studio.Environment.Host`, keyed on `[cell]`) and
 * clears its committed data and handles. The generated root now also gives the resolved cell
 * contract a separate lifetime, preserving compatible publications and remounting fixture owners
 * together when the contract changes. ErrorBoundary.resetKey only clears a caught failure.
 *
 * `runtime.ts`'s generated preview root is text this package writes, not an importable module —
 * importing `@expo-host` here fails at `@compiler/workspace`, which this Jest config does not
 * resolve — so `sameRuntimeIdentity` below is a literal copy of the generated function, not an
 * import of it. `runtime.test.ts` (`generates a stable preview root with a caller-supplied
 * revision`) pins the two together with a `toContain` assertion on the exact source line, so an
 * edit to the shipped comparison without a matching edit here fails that Bun suite instead of
 * silently drifting.
 */
function sameRuntimeIdentity(previous: any, next: any) {
  const previousIdentity = previous?.cell?.identity
  const nextIdentity = next?.cell?.identity
  return previousIdentity !== undefined
    && nextIdentity !== undefined
    && previousIdentity.compileRevision === nextIdentity.compileRevision
    && previousIdentity.cellRevision === nextIdentity.cellRevision
    && previousIdentity.manifestRevision === nextIdentity.manifestRevision
}

type RuntimeIdentity = { cellRevision: number; compileRevision: number; manifestRevision: string }

function cellPayload(identity: RuntimeIdentity): Record<string, unknown> {
  return {
    environment: {
      network: { mode: 'online' },
      scheme: { requested: 'light', source: 'scenario' },
      version: 1,
    },
    fixture: { accounts: [], creates: [] },
    identity,
    scenario: { arguments: {}, kind: 'app', prepare: [], subjectId: 'App' },
  }
}

/**
 * Mirrors `receiveRuntime`'s functional setState; the generated-source check in runtime.test.ts
 * pins this fixture to the shipped comparison until the generated root can be mounted directly.
 */
function StudioCellHost(
  props: { children: ReactElement; next: Record<string, unknown> },
): ReactElement {
  // Wrapped in `{ cell }` to match `runtime.ts`'s own applied-runtime shape (`{ cell, manifest,
  // publication }`), which is what `sameRuntimeIdentity` actually compares (`previous?.cell?.identity`).
  const [applied, setApplied] = useState<{ cell: Record<string, unknown> }>({ cell: props.next })
  useEffect(() => {
    const next = { cell: props.next }
    setApplied(previous => sameRuntimeIdentity(previous, next) ? previous : next)
  }, [props.next])
  return createElement(TR.Studio.Environment.Host, { cell: applied.cell as never, children: props.children })
}

Describe('Studio preview runtime identity dedupe', () => {
  // REMOVAL CANDIDATE: mirrored publication lifetime exercises real providers but cannot prove the generated root executes this wiring.
  Test('retains interactive cells and reseeds changed contracts or publication journey replays', async () => {
    const declaration = TR.Data.Declaration('StudioPublicationMemory', MemoryProvider())
    const schema = TR.Data.Schema({
      name: 'StudioPublicationData',
      entities: { Entry: { collection: 'Entries', fields: { Name: { kind: 'text' }, Count: { kind: 'number' } } } },
    })
    let selected: unknown
    let changeCount: ((value: number) => void) | undefined
    let count = 0
    let replay: Promise<void> | undefined
    function FixtureSubject({ journeyRevision }: { journeyRevision: string }): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, {}))
      const fixture = TR.Studio.Environment.useFixture(schema)
      const scenario = TR.Studio.Environment.useScenario()
      const gate = useRef(createTaoJourneyReplayGate())
      const [value, setValue] = useState(0)
      count = value
      changeCount = setValue
      if (fixture.ready) {
        selected = fixture.handles['Example']
      }
      useEffect(() => {
        const steps = scenario?.steps
        if (!fixture.ready || !steps?.length || !gate.current.beginReplay(journeyRevision)) {
          return
        }
        // The real journey interpreter executes a non-idempotent press against the seeded row.
        // PreviewBridge uses this gate with the same publication/cell revision tuple.
        replay = replayTaoJourney(steps, {
          advance: () => {},
          dispatch: () => {
            TR.Data.Update(TR.Value(selected), { Count: TR.Value(Number(TR.Data.Read(selected, 'Count')) + 1) })
            setValue(previous => previous + 1)
          },
          find: () => 'increment',
          select: () => 'increment',
          settle: () => {},
        }).then(() => gate.current.completeReplay(journeyRevision))
      }, [fixture.ready, journeyRevision, scenario])
      return null
    }
    function CellContent({ cellContract, journeyRevision }: {
      cellContract: string
      journeyRevision: string
    }): ReactElement {
      // Mirrors StudioPreviewCellContent's lifetime, pinned in runtime.test.ts.
      const [TaoStudioCell] = useState(() => JSON.parse(cellContract))
      return createElement(TR.Studio.Environment.Host, {
        cell: TaoStudioCell as never,
        children: createElement(FixtureSubject, { journeyRevision }),
      })
    }
    function PublicationHost({ cell, cellRevision, compileRevision }: {
      cell: Record<string, unknown>
      cellRevision: number
      compileRevision: number
    }): ReactElement {
      const cellContract = JSON.stringify(cell)
      const scenario = cell['scenario'] as { steps?: readonly TaoJourneyStep[] }
      const replayPublication = scenario.steps?.length
        ? [compileRevision, `compile:${compileRevision}`, 'preview']
        : undefined
      const cellKey = JSON.stringify(['example', cellRevision, cellContract, replayPublication])
      const journeyRevision = [compileRevision, cellRevision, `compile:${compileRevision}`, 'preview'].join(':')
      return createElement(CellContent, { cellContract, journeyRevision, key: cellKey })
    }
    const payload = (title: string, cellRevision = 0): Record<string, unknown> => ({
      ...cellPayload({ cellRevision, compileRevision: 1, manifestRevision: 'compile:1' }),
      fixture: { accounts: [], creates: [{ entity: 'Entry', fields: { Name: title, Count: 0 }, name: 'Example' }] },
    })
    // studioCellRuntime strips publication identity before handing the contract to this host.
    const host = (
      title: string,
      cellRevision = 0,
      compileRevision = 1,
      steps: readonly TaoJourneyStep[] = [],
    ): ReactElement => {
      const { identity: _, ...cell } = payload(title, cellRevision)
      cell['scenario'] = { ...(cell['scenario'] as object), steps }
      return createElement(PublicationHost, { cell, cellRevision, compileRevision })
    }
    const screen = render(host('Before'))
    try {
      await act(async () => await TR.Data.Settle(schema))
      const original = selected
      Expect(TR.Data.Read(selected, 'Name')).toBe('Before')
      act(() => changeCount?.(7))
      screen.rerender(host('Before', 0, 2))
      await act(async () => await TR.Data.Settle(schema))
      Expect(count).toBe(7)
      Expect(selected).toBe(original)
      Expect(TR.Data.Read(selected, 'Name')).toBe('Before')
      screen.rerender(host('After'))
      await act(async () => await TR.Data.Settle(schema))
      Expect(count).toBe(0)
      Expect(selected).not.toBe(original)
      Expect(TR.Data.Read(selected, 'Name')).toBe('After')
      const beforeReset = selected
      act(() => changeCount?.(9))
      screen.rerender(host('After', 1))
      await act(async () => await TR.Data.Settle(schema))
      Expect(count).toBe(0)
      Expect(selected).not.toBe(beforeReset)
      Expect(TR.Data.Read(selected, 'Name')).toBe('After')
      const steps: readonly TaoJourneyStep[] = [{ kind: 'press', selector: 'tag', target: 'increment' }]
      screen.rerender(host('Replay', 0, 3, steps))
      await act(async () => await replay)
      Expect(count).toBe(1)
      Expect(TR.Data.Read(selected, 'Count')).toBe(1)
      const firstReplay = selected
      screen.rerender(host('Replay', 0, 4, steps))
      await act(async () => await replay)
      Expect(count).toBe(1)
      Expect(TR.Data.Read(selected, 'Count')).toBe(1)
      Expect(selected).not.toBe(firstReplay)
      const secondReplay = selected
      screen.rerender(host('Replay', 0, 4, steps))
      await act(async () => await replay)
      Expect(selected).toBe(secondReplay)
      Expect(count).toBe(1)
      screen.rerender(host('Replay', 1, 4, steps))
      await act(async () => await replay)
      Expect(selected).not.toBe(secondReplay)
      Expect(TR.Data.Read(selected, 'Count')).toBe(1)
      Expect(count).toBe(1)
    } finally {
      screen.unmount()
    }
  })

  // A hot-reloaded datasource module re-runs its declarations, so the app root binds the same store to
  // a new declaration and provider, whose cell overlay starts empty. The cell seeds it again, and a
  // focused view, which takes its arguments once per mount, is remounted by the fixture's revision.
  Test('reseeds the fixture when a store is rebound to a new datasource declaration', async () => {
    const schema = TR.Data.Schema({
      name: 'StudioReboundData',
      entities: { Entry: { collection: 'Entries', fields: { Name: { kind: 'text' } } } },
    })
    let seed: ReturnType<typeof TR.Studio.Environment.useFixture> | undefined
    function FocusedView({ entry }: { entry: unknown }): ReactElement {
      const [mounted] = useState(entry)
      return createElement(Text, null, String(TR.Data.Read(mounted, 'Name')))
    }
    function FixtureSubject(
      { declaration }: { declaration: ReturnType<typeof TR.Data.Declaration> },
    ): ReactElement | null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, {}))
      seed = TR.Studio.Environment.useFixture(schema)
      return seed.ready ? createElement(FocusedView, { entry: seed.handles['Example'], key: seed.revision }) : null
    }
    const cell = {
      ...cellPayload({ cellRevision: 0, compileRevision: 1, manifestRevision: 'compile:1' }),
      fixture: { accounts: [], creates: [{ entity: 'Entry', fields: { Name: 'Seeded' }, name: 'Example' }] },
    }
    const host = (declaration: ReturnType<typeof TR.Data.Declaration>): ReactElement =>
      createElement(TR.Studio.Environment.Host, {
        cell: cell as never,
        children: createElement(FixtureSubject, { declaration }),
      })
    const rows = () => schema.query({ entity: 'Entry', filters: [] })
    const first = TR.Data.Declaration('StudioReboundMemory', MemoryProvider())
    const screen = render(host(first))
    try {
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      const original = seed?.handles['Example']
      const revision = seed?.revision

      screen.rerender(host(first))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.handles['Example']).toBe(original)
      Expect(seed?.revision).toBe(revision)

      screen.rerender(host(TR.Data.Declaration('StudioReboundMemory', MemoryProvider())))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.ready).toBe(true)
      Expect(seed?.handles['Example']).not.toBe(original)
      Expect(seed?.revision).not.toBe(revision)
      Expect(screen.getByText('Seeded')).toBeTruthy()
    } finally {
      screen.unmount()
    }
  })

  Test('keeps one unique fixture row and its edited handle across an app child remount', async () => {
    const schema = TR.Data.Schema({
      name: 'StudioFixtureLifetime',
      entities: {
        Story: {
          collection: 'Stories',
          fields: {
            HnId: { kind: 'number', unique: true },
            Name: { kind: 'text' },
          },
        },
      },
    })
    const cell = {
      ...cellPayload({ cellRevision: 0, compileRevision: 1, manifestRevision: 'compile:1' }),
      fixture: { accounts: [], creates: [{ entity: 'Story', fields: { HnId: 42, Name: 'Seeded' }, name: 'Story' }] },
    }
    const first = TR.Data.Declaration('StudioFixtureLifetimeMemory', MemoryProvider())
    let seed: ReturnType<typeof TR.Studio.Environment.useFixture> | undefined
    function App({ declaration, storageKey }: {
      declaration: ReturnType<typeof TR.Data.Declaration>
      storageKey: string
    }): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, { StorageKey: storageKey }))
      seed = TR.Studio.Environment.useFixture(schema)
      return null
    }
    const host = (
      hostKey: string,
      childKey: string,
      declaration: ReturnType<typeof TR.Data.Declaration>,
      storageKey = 'fixture-a',
    ) =>
      createElement(TR.Studio.Environment.Host, {
        key: hostKey,
        cell: cell as never,
        children: createElement(App, { declaration, key: childKey, storageKey }),
      })
    const rows = () => schema.query({ entity: 'Story', filters: [] })
    const screen = render(host('cell', 'app-1', first))
    try {
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      const handle = seed?.handles['Story']
      const revision = seed?.revision
      TR.Data.Update(TR.Value(handle), { Name: TR.Value('Edited') })
      screen.rerender(host('cell', 'app-2', first))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.handles['Story']).toBe(handle)
      Expect(seed?.revision).toBe(revision)
      Expect(TR.Data.Read(seed?.handles['Story'], 'Name')).toBe('Edited')

      screen.rerender(host('cell', 'app-storage-b', first, 'fixture-b'))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.handles['Story']).not.toBe(handle)
      Expect(seed?.revision).not.toBe(revision)
      Expect(TR.Data.Read(seed?.handles['Story'], 'Name')).toBe('Seeded')

      const rebound = TR.Data.Declaration('StudioFixtureLifetimeMemory', MemoryProvider())
      const storageHandle = seed?.handles['Story']
      screen.rerender(host('cell', 'app-3', rebound, 'fixture-b'))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.handles['Story']).not.toBe(storageHandle)
      Expect(seed?.revision).not.toBe(revision)
      Expect(TR.Data.Read(seed?.handles['Story'], 'Name')).toBe('Seeded')

      const reboundHandle = seed?.handles['Story']
      screen.rerender(host('fresh-cell', 'app-4', rebound, 'fixture-b'))
      await act(async () => await TR.Data.Settle(schema))
      Expect(rows()).toHaveLength(1)
      Expect(seed?.handles['Story']).not.toBe(reboundHandle)
      Expect(TR.Data.Read(seed?.handles['Story'], 'Name')).toBe('Seeded')
    } finally {
      screen.unmount()
    }
  })

  Test('starts a new fixture application for a new declaration with the same canonical identity', async () => {
    const schema = TR.Data.Schema({ name: 'StudioCanonicalRebind', entities: {} })
    const identity = TR.Navigation.Identity([
      'tao.declaration',
      1,
      'studio-fixture-test',
      'app',
      'Data.tao',
      'datasource',
      'SharedMemory',
    ])
    const cell = cellPayload({ cellRevision: 0, compileRevision: 1, manifestRevision: 'compile:1' })
    let seed: ReturnType<typeof TR.Studio.Environment.useFixture> | undefined
    function App({ declaration }: { declaration: ReturnType<typeof TR.Data.Declaration> }): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, {}))
      seed = TR.Studio.Environment.useFixture(schema)
      return null
    }
    const host = (declaration: ReturnType<typeof TR.Data.Declaration>) =>
      createElement(TR.Studio.Environment.Host, {
        cell: cell as never,
        children: createElement(App, { declaration }),
      })
    const first = TR.Data.Declaration('SharedMemory', MemoryProvider(), identity)
    const screen = render(host(first))
    try {
      await act(async () => await TR.Data.Settle(schema))
      const revision = seed?.revision
      const generation = schema.bindingGeneration()
      screen.rerender(host(TR.Data.Declaration('SharedMemory', MemoryProvider(), identity)))
      await act(async () => await TR.Data.Settle(schema))
      Expect(schema.bindingGeneration()).toBeGreaterThan(generation)
      Expect(seed?.ready).toBe(true)
      Expect(seed?.revision).not.toBe(revision)
    } finally {
      screen.unmount()
    }
  })

  Test('keeps one fixture application when auth preparation binds its own connection', async () => {
    const schema = TR.Data.Schema({
      name: 'StudioAuthPreparationData',
      entities: { Story: { collection: 'Stories', fields: { HnId: { kind: 'number' } } } },
    })
    const declaration = TR.Data.Declaration('StudioAuthPreparationMemory', MemoryProvider())
    const cell = {
      ...cellPayload({ cellRevision: 0, compileRevision: 1, manifestRevision: 'compile:1' }),
      fixture: {
        accounts: [{ name: 'Tester', fields: {} }],
        creates: [{ account: 'Tester', entity: 'Story', fields: { HnId: 42 }, name: 'Story' }],
      },
    }
    let preparations = 0
    let creates = 0
    const auth = {
      prepareFixture: async () => {
        preparations += 1
        schema.bindConfigured(TR.Data.Configure(declaration, { StorageKey: 'auth-fixture' }))
        return {}
      },
      fixtureCreate: (store: typeof schema, entity: string, fields: Record<string, unknown>) => {
        creates += 1
        return store.create(entity, fields)
      },
      finishFixture: () => {},
    }
    let seed: ReturnType<typeof TR.Studio.Environment.useFixture> | undefined
    const Binding = memo(function Binding(): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, { StorageKey: 'app' }))
      return null
    })
    function Fixture(): null {
      seed = TR.Studio.Environment.useFixture(schema, auth as never)
      return null
    }
    const host = (childKey: string) =>
      createElement(TR.Studio.Environment.Host, {
        cell: cell as never,
        children: [createElement(Binding, { key: 'binding' }), createElement(Fixture, { key: childKey })],
      })
    const screen = render(host('first'))
    try {
      await act(async () => await TR.Data.Settle(schema))
      const handle = seed?.handles['Story']
      const revision = seed?.revision
      screen.rerender(host('second'))
      await act(async () => await TR.Data.Settle(schema))
      Expect(preparations).toBe(1)
      Expect(creates).toBe(1)
      Expect(seed?.handles['Story']).toBe(handle)
      Expect(seed?.revision).toBe(revision)
    } finally {
      screen.unmount()
    }
  })

  Test('shares pending auth fixture work across a child remount and retires it on datasource rebind', async () => {
    const schema = TR.Data.Schema({
      name: 'StudioPendingFixtureLifetime',
      entities: { Story: { collection: 'Stories', fields: { HnId: { kind: 'number', unique: true } } } },
    })
    const cell = {
      ...cellPayload({ cellRevision: 0, compileRevision: 1, manifestRevision: 'compile:1' }),
      fixture: {
        accounts: [{ name: 'Tester', fields: {} }],
        creates: [{ account: 'Tester', entity: 'Story', fields: { HnId: 42 }, name: 'Story' }],
      },
    }
    const pending: Array<() => void> = []
    let preparations = 0
    let creates = 0
    const auth = {
      prepareFixture: async () => {
        preparations += 1
        await new Promise<void>(resolve => {
          pending.push(resolve)
        })
        return {}
      },
      fixtureCreate: (store: typeof schema, entity: string, fields: Record<string, unknown>) => {
        creates += 1
        return store.create(entity, fields)
      },
      finishFixture: () => {},
    }
    let seed: ReturnType<typeof TR.Studio.Environment.useFixture> | undefined
    function App({ declaration, storageKey }: {
      declaration: ReturnType<typeof TR.Data.Declaration>
      storageKey: string
    }): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, { StorageKey: storageKey }))
      seed = TR.Studio.Environment.useFixture(schema, auth as never)
      return null
    }
    const host = (key: string, declaration: ReturnType<typeof TR.Data.Declaration>, storageKey = 'pending-a') =>
      createElement(TR.Studio.Environment.Host, {
        cell: cell as never,
        children: createElement(App, { declaration, key, storageKey }),
      })
    const first = TR.Data.Declaration('StudioPendingFixtureMemory', MemoryProvider())
    const screen = render(host('app-1', first))
    try {
      await act(async () => {
        await Promise.resolve()
      })
      Expect(preparations).toBe(1)
      Expect(seed?.ready).toBe(false)
      screen.rerender(host('app-2', first))
      await act(async () => {
        await Promise.resolve()
      })
      Expect(preparations).toBe(1)
      Expect(creates).toBe(0)

      screen.rerender(host('app-3', first, 'pending-b'))
      await act(async () => {
        await Promise.resolve()
      })
      Expect(preparations).toBe(1)
      pending[0]?.()
      await act(async () => {
        await Promise.resolve()
      })
      Expect(preparations).toBe(2)
      Expect(creates).toBe(0)
      pending[1]?.()
      await act(async () => await TR.Data.Settle(schema))
      Expect(creates).toBe(1)
      Expect(schema.query({ entity: 'Story', filters: [] })).toHaveLength(1)
      Expect(seed?.ready).toBe(true)
      Expect(TR.Data.Read(seed?.handles['Story'], 'HnId')).toBe(42)
    } finally {
      for (const resolve of pending) {
        resolve()
      }
      screen.unmount()
    }
  })

  async function runRedeliveryScenario(): Promise<{ available: boolean; rowCount: number }> {
    const declaration = TR.Data.Declaration('StudioDedupeMemory', MemoryProvider())
    const schema = TR.Data.Schema({
      name: 'StudioDedupeData',
      entities: { Entry: { collection: 'Entries', fields: { Name: { kind: 'text' } } } },
    })
    function ProviderBinding(): null {
      TR.Data.UseConfigured(schema, TR.Data.Configure(declaration, {}))
      return null
    }
    const identity: RuntimeIdentity = { cellRevision: 1, compileRevision: 3, manifestRevision: 'compile:3' }
    const host = (next: Record<string, unknown>): ReactElement =>
      createElement(StudioCellHost, { children: createElement(ProviderBinding), next })

    const screen = render(host(cellPayload(identity)))
    await act(async () => {
      await TR.Data.Settle(schema)
    })
    act(() => {
      TR.Data.Create(schema, 'Entry', { Name: TR.Value('Kept') })
    })
    const row = schema.query({ entity: 'Entry', filters: [] })[0]

    // A second delivery: a freshly parsed object (as every postMessage payload is), carrying the
    // exact same identity tuple already applied.
    screen.rerender(host(cellPayload({ ...identity })))
    await act(async () => {
      await TR.Data.Settle(schema)
    })

    return {
      available: TR.Data.EntityAvailability(row)?.status === 'available',
      rowCount: schema.query({ entity: 'Entry', filters: [] }).length,
    }
  }

  // REMOVAL CANDIDATE: copied identity fixture retains the real provider invalidation regression until generated-root execution is available.
  Test('keeps the applied cell object, and its data, across a re-delivered equal-identity runtime', async () => {
    const result = await runRedeliveryScenario()
    Expect(result.rowCount).toBe(1)
    Expect(result.available).toBe(true)
  })

  // REMOVAL CANDIDATE: field variants exercise a copied comparator pinned by source strings; generated-host execution would provide stronger proof.
  Test('does not treat a changed cellRevision, compileRevision, or manifestRevision as the same identity', () => {
    const base: RuntimeIdentity = { cellRevision: 1, compileRevision: 3, manifestRevision: 'compile:3' }
    const baseNext = { cell: cellPayload(base) }

    Expect(sameRuntimeIdentity({ cell: cellPayload(base) }, baseNext)).toBe(true)
    Expect(sameRuntimeIdentity({ cell: cellPayload({ ...base, cellRevision: 2 }) }, baseNext)).toBe(false)
    Expect(sameRuntimeIdentity({ cell: cellPayload({ ...base, compileRevision: 4 }) }, baseNext)).toBe(false)
    Expect(sameRuntimeIdentity({ cell: cellPayload({ ...base, manifestRevision: 'compile:4' }) }, baseNext))
      .toBe(false)
    // The very first applied runtime has no previous cell to compare against, so it is never a no-op.
    Expect(sameRuntimeIdentity(undefined, baseNext)).toBe(false)
  })

  // Each compile hands the preview root a new config. The root holds one app element for its mounted
  // lifetime, as StudioPreviewCellContent does, so the views below it do not render again, while the
  // Lens wrappers, which read the config's publisher, still report a sample for the new revision.
  Test('a new config re-renders the Lens wrappers but not the app held as one element', () => {
    let viewRenders = 0
    const published: string[] = []
    const identity = { end: 10, kind: 'render', sourcePath: 'Feed.tao', start: 0 } as const
    function View(): ReactElement {
      viewRenders += 1
      return createElement(Text, null, 'Feed')
    }
    function App(): ReactElement {
      return createElement(StudioLensRender, { identity }, createElement(View))
    }
    function PreviewRoot({ revision }: { revision: string }): ReactElement {
      const [app] = useState(() => createElement(App))
      const publish = useCallback(() => published.push(revision), [revision])
      return createElement(StudioLensHost, { publish }, app)
    }
    const screen = render(createElement(PreviewRoot, { revision: 'compile:1' }))
    try {
      screen.rerender(createElement(PreviewRoot, { revision: 'compile:2' }))
      Expect(viewRenders).toBe(1)
      Expect(published).toEqual(['compile:1', 'compile:2'])
    } finally {
      screen.unmount()
    }
  })
})
