import TR from '@runtime/TR'
import { createTaoJourneyReplayGate, replayTaoJourney, type TaoJourneyStep } from '@runtime/TR-studio-journey'
import { Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import { createElement, type ReactElement, useEffect, useRef, useState } from 'react'
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
})
