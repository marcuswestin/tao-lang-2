import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import { createElement, type ReactElement, useEffect, useState } from 'react'
import { MemoryProvider } from '../../stdlib/@tao/data/providers/memory/Memory'

/**
 * Proves the fix for a Studio preview cell that goes silently empty: `runtime.ts`'s generated
 * `receiveRuntime` must not replace the applied cell object for a runtime update whose identity
 * (compileRevision, cellRevision, manifestRevision) repeats what is already applied, because a new
 * cell object rebuilds the provider overlay (`TR.Studio.Environment.Host`, keyed on `[cell]`) and
 * clears its committed data and handles without the `TR.Studio.ErrorBoundary` remount that alone
 * would justify it — see the `sameRuntimeIdentity` comment in `runtime.ts`.
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
 * Mirrors `receiveRuntime`'s functional setState. `dedupe` toggles the fix under test: `true`
 * reproduces `runtime.ts` as it now stands, `false` reproduces it as it stood before this fix, so
 * the same harness can prove the regression test fails without the fix and passes with it.
 */
function StudioCellHost(
  props: { children: ReactElement; dedupe: boolean; next: Record<string, unknown> },
): ReactElement {
  // Wrapped in `{ cell }` to match `runtime.ts`'s own applied-runtime shape (`{ cell, manifest,
  // publication }`), which is what `sameRuntimeIdentity` actually compares (`previous?.cell?.identity`).
  const [applied, setApplied] = useState<{ cell: Record<string, unknown> }>({ cell: props.next })
  useEffect(() => {
    const next = { cell: props.next }
    setApplied(previous => (props.dedupe && sameRuntimeIdentity(previous, next)) ? previous : next)
  }, [props.next, props.dedupe])
  return createElement(TR.Studio.Environment.Host, { cell: applied.cell as never, children: props.children })
}

Describe('Studio preview runtime identity dedupe', () => {
  async function runRedeliveryScenario(dedupe: boolean): Promise<{ available: boolean; rowCount: number }> {
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
      createElement(StudioCellHost, { children: createElement(ProviderBinding), dedupe, next })

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

  Test('keeps the applied cell object, and its data, across a re-delivered equal-identity runtime', async () => {
    const result = await runRedeliveryScenario(true)
    Expect(result.rowCount).toBe(1)
    Expect(result.available).toBe(true)
  })

  // Proves the test above is not vacuous: with the fix's dedupe disabled — the pre-fix behavior,
  // where every accepted update replaces the applied cell object — the re-delivery above wipes the
  // row and invalidates its handle, matching the reported "mounts empty" / stale-handle failure.
  Test('without the dedupe, a re-delivered equal-identity runtime wipes data (regression baseline)', async () => {
    const result = await runRedeliveryScenario(false)
    Expect(result.rowCount).toBe(0)
    Expect(result.available).toBe(false)
  })

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
