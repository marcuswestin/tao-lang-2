import type TR from '@runtime/TR'
import { Assert, Errors, Time } from '@shared/core'

/**
 * HttpProvider serves query-driven remote reads over an in-memory snapshot store. The provider is
 * deliberately a thin, honest machine — descriptor matching, staleness, and error surfacing —
 * while every API-specific truth (which query shape maps to which request, how JSON becomes rows)
 * lives in the app's configured Adapter. A live query matching no declared shape fails loudly; it
 * never silently non-fetches.
 */
export function HttpProvider(): TR.DataProvider {
  return {
    connect: context => {
      // The snapshot store is connection-scoped: a rebind with a different adapter starts clean
      // instead of reloading rows the previous configuration fetched, and Tao checks that bind
      // this fill-capable provider stay isolated from one another.
      const snapshots = new Map<string, string>()
      const adapter = context.configuration['Adapter'] as TR.HttpAdapter | undefined
      const cacheForNs = context.configuration['CacheFor'] as number | undefined
      return {
        fill: (request, ops) => runAdapterFill(adapter, request, ops),
        fillCacheMs: (cacheForNs ?? 0) / Time.NANOSECONDS_PER_MILLISECOND,
        load: () => snapshots.get(context.storageKey),
        referenceToken: reference => reference.id,
        reset: () => {
          snapshots.delete(context.storageKey)
        },
        resolveReference: reference => reference.token,
        save: snapshot => {
          snapshots.set(context.storageKey, snapshot)
        },
      }
    },
    fills: true,
  }
}

async function runAdapterFill(
  adapter: TR.HttpAdapter | undefined,
  request: TR.DataFillRequest,
  ops: TR.DataFillOps,
): Promise<void> {
  Assert.input(adapter, "An Http datasource requires an 'Adapter' declaring its supported query shapes.")
  const { descriptor } = request
  const shapes = adapter[descriptor.entity]
  const shape = shapes?.find(candidate => shapeMatches(candidate.matches, descriptor))
  // Guarded rather than asserted: every fill runs through here, and this sentence walks the
  // adapter's declared shapes to build itself, which `Assert.input` would do on the passing path too.
  if (!shape) {
    Errors.throwUserInput(
      `The Http adapter declares no query shape matching ${describeDescriptor(descriptor)}. `
        + (shapes?.length
          ? `Declared shapes for '${descriptor.entity}': ${shapes.map(s => describeMatch(s.matches)).join('; ')}.`
          : `It declares no shapes for '${descriptor.entity}' at all.`),
    )
  }
  await shape.fill(descriptor, {
    upsert: rows => ops.upsert(descriptor.entity, rows),
    upsertInto: (entity, rows) => ops.upsert(entity, rows),
  })
}

function shapeMatches(match: TR.HttpMatch, descriptor: TR.QueryDescriptor): boolean {
  const expected = [match.where ?? []].flat().slice().sort()
  const actual = Object.keys(descriptor.where).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) {
    return false
  }
  if (match.orderBy !== undefined && match.orderBy !== descriptor.orderBy) {
    return false
  }
  return match.orderDirection === undefined || match.orderDirection === descriptor.orderDirection
}

function describeDescriptor(descriptor: TR.QueryDescriptor): string {
  const where = Object.keys(descriptor.where)
  const parts = [
    where.length ? `where ${where.join(', ')}` : 'no filters',
    descriptor.orderBy ? `order by ${descriptor.orderBy} ${descriptor.orderDirection}` : 'no ordering',
  ]
  return `'${descriptor.entity}' (${parts.join(', ')})`
}

function describeMatch(match: TR.HttpMatch): string {
  const where = [match.where ?? []].flat()
  return [
    where.length ? `where ${where.join(', ')}` : 'no filters',
    match.orderBy ? `order by ${match.orderBy}` : 'no ordering',
  ].join(', ')
}
