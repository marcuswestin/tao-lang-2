import { Assert } from '@shared/core'
import type { ReplicationPullOptions, ReplicationPushOptions } from 'rxdb'
import type { FirebaseRow } from './firebase-schema'

export type FirebaseReplicationValidation = Readonly<{
  pull<Row extends FirebaseRow>(row: Row): Row
  push<Row extends FirebaseRow>(row: Row): Promise<Row>
}>

/** Validate in RxDB's retryable handlers, preserving the received and assumed remote states. */
export function validateFirebaseReplication<Row extends FirebaseRow, Checkpoint>(
  state: { pull?: ReplicationPullOptions<Row, Checkpoint>; push?: ReplicationPushOptions<Row> },
  validation: FirebaseReplicationValidation,
): void {
  const pull = state.pull
  const push = state.push
  Assert.defined(pull, 'Firebase replication has a pull handler')
  Assert.defined(push, 'Firebase replication has a push handler')
  const read = pull.handler
  pull.handler = async (checkpoint, batchSize) => {
    // Modifier failures escape RxDB's downstream queue; handler failures report and retry.
    const result = await read(checkpoint, batchSize)
    return { ...result, documents: result.documents.map(row => validation.pull(row)) }
  }
  const write = push.handler
  push.handler = async writes => {
    // A push modifier also transforms assumedMasterState, breaking legacy conflict comparison.
    const valid = await Promise.all(writes.map(row =>
      validation.push(row.newDocumentState).then(newDocumentState => ({
        ...row,
        newDocumentState,
      }))
    ))
    return (await write(valid)).map(row => validation.pull(row))
  }
}
