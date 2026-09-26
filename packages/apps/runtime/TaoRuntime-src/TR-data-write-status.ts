import type { TaoChangeSet, TaoSyncRowId } from './TR-data-sync'

/** TaoSyncWriteFailure is the locally durable transport result for one still-pending change-set. */
export type TaoSyncWriteFailure = Readonly<{
  changeSetId: string
  message: string
}>

/** TaoSyncWriteRecord identifies one unresolved submission and its latest transport failure, if any. */
type TaoSyncWriteRecord = Readonly<{
  id: string
  message?: string
  recovery?: readonly Readonly<{
    entity: string
    id: string
    operation: 'create' | 'update' | 'delete'
    fields?: Readonly<Record<string, unknown>>
  }>[]
}>

/** TaoSyncEntityWriteStatus summarizes every unresolved submission affecting one entity row. */
export type TaoSyncEntityWriteStatus = Readonly<{
  failed: number
  queued: number
  records: readonly TaoSyncWriteRecord[]
}>

/** statusForSyncEntity projects unresolved change-sets onto one stable wire row identity. */
export function statusForSyncEntity(
  pending: readonly TaoChangeSet[],
  failures: readonly TaoSyncWriteFailure[],
  entity: string,
  row: TaoSyncRowId,
): TaoSyncEntityWriteStatus {
  const failed = new Set(failures.map(failure => failure.changeSetId))
  const messages = new Map(failures.map(failure => [failure.changeSetId, failure.message]))
  const records: TaoSyncWriteRecord[] = []
  let queued = 0
  let failedCount = 0
  for (const changeSet of pending) {
    if (
      !changeSet.ops.some(operation =>
        operation.entity === entity && operation.row.id === row.id && operation.row.origin === row.origin
      )
    ) {
      continue
    }
    if (failed.has(changeSet.id)) {
      failedCount += 1
      records.push({ id: changeSet.id, message: messages.get(changeSet.id) })
    } else {
      queued += 1
      records.push({ id: changeSet.id })
    }
  }
  return { failed: failedCount, queued, records }
}
