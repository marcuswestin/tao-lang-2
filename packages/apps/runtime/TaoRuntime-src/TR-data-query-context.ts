import { RuntimeAssert } from './TR-assert'
import type { TaoDataConnection, TaoFillOps, TaoQueryDescriptor } from './TR-data'

/** Native adapters receive an authenticated query's connection and observed request, even for empty rows. */
export type TaoNativeQueryContext = Readonly<{
  connection: TaoDataConnection
  descriptor: TaoQueryDescriptor
  run(
    operation: (connection: TaoDataConnection, descriptor: TaoQueryDescriptor, ops: TaoFillOps) => Promise<void>,
  ): Promise<void>
}>

const queryContexts = new WeakMap<object, () => TaoNativeQueryContext>()

/** Query results carry private ownership, independent of row fields and list contents. */
export function registerQueryContext(rows: object, context: () => TaoNativeQueryContext): void {
  queryContexts.set(rows, context)
}

/** Revalidation occurs when an action uses the query, rather than trusting an earlier render. */
export function nativeQueryContext(rows: unknown): TaoNativeQueryContext {
  const context = rows !== null && typeof rows === 'object' ? queryContexts.get(rows) : undefined
  RuntimeAssert.input(context, 'This operation expects a live query result.')
  return context()
}
