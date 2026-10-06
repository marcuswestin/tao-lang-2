import { Describe, Expect, Test } from '@shared/test'
import type { ReplicationPullOptions, ReplicationPushOptions, RxReplicationWriteToMasterRow } from 'rxdb'
import {
  type FirebaseReplicationValidation,
  validateFirebaseReplication,
} from '../firebase-src/firebase-replication-validation'
import {
  type FirebaseRow,
  firebaseRuntimeRow,
  repairFirebaseAccount,
  validateFirebaseRow,
} from '../firebase-src/firebase-schema'

const entity = {
  collection: 'accounts',
  fields: {
    DisplayName: { kind: 'text' as const, defaultValue: '' },
    Bio: { kind: 'text' as const, optional: true, defaultValue: 'optional default' },
  },
}
const validation: FirebaseReplicationValidation = {
  pull(row) {
    validateFirebaseRow('Account', entity, repairFirebaseAccount(row, entity), 'alice', true)
    return row
  },
  async push(row) {
    const next = repairFirebaseAccount(row, entity)
    validateFirebaseRow('Account', entity, next, 'alice', true)
    return next
  },
}

Describe('Firebase production replication validation handlers', () => {
  Test('pulls retain legacy master state and propagate malformed rows from the retryable handler', async () => {
    const legacy = { Id: 'alice', DisplayName: null, _deleted: false }
    let incoming: FirebaseRow & { _deleted: boolean } = legacy
    const pull: ReplicationPullOptions<FirebaseRow, number> = {
      handler: async () => ({ checkpoint: 17, documents: [incoming] }),
    }
    const push: ReplicationPushOptions<FirebaseRow> = { handler: async () => [] }
    validateFirebaseReplication({ pull, push }, validation)
    const result = await pull.handler(undefined, 100)
    Expect(result.checkpoint).toBe(17)
    Expect(result.documents[0]).toBe(legacy)
    Expect(result.documents[0]!['DisplayName']).toBe(null)
    incoming = { Id: 'alice', DisplayName: 'valid', Extra: true, _deleted: false }
    await Expect(pull.handler(undefined, 100)).rejects.toThrow("unknown field 'Extra'")
    incoming = { Id: 'alice', DisplayName: 'corrected', _deleted: false }
    Expect((await pull.handler(undefined, 100)).documents[0]!['DisplayName']).toBe('corrected')
    Expect(pull.modifier).toBeUndefined()
  })

  Test('corrects proposed writes while preserving assumed state, metadata, and returned conflicts', async () => {
    const proposed = { Id: 'alice', DisplayName: null, _deleted: true, _attachments: {} }
    const assumed = { Id: 'alice', DisplayName: null, _deleted: false }
    const conflict = { Id: 'alice', DisplayName: 'other client', _deleted: false }
    let returned: FirebaseRow & { _deleted: boolean } = conflict
    let received: RxReplicationWriteToMasterRow<FirebaseRow>[] = []
    const pull: ReplicationPullOptions<FirebaseRow, number> = {
      handler: async () => ({ checkpoint: 0, documents: [] }),
    }
    const push: ReplicationPushOptions<FirebaseRow> = {
      handler: async rows => {
        received = rows
        return [returned]
      },
    }
    validateFirebaseReplication({ pull, push }, validation)
    const input = [{ newDocumentState: proposed, assumedMasterState: assumed }]
    Expect((await push.handler(input))[0]).toBe(conflict)
    Expect(received[0]!.newDocumentState).toEqual({ Id: 'alice', DisplayName: '', _deleted: true, _attachments: {} })
    Expect(received[0]!.assumedMasterState).toBe(assumed)
    Expect(proposed.DisplayName).toBe(null)
    Expect(assumed.DisplayName).toBe(null)
    returned = { Id: 'alice', DisplayName: 'valid', Surprise: true, _deleted: false }
    await Expect(push.handler(input)).rejects.toThrow("unknown field 'Surprise'")
    Expect(push.modifier).toBeUndefined()
  })

  Test('only wire rows accept known metadata and runtime rows fill optional omissions with null', () => {
    const wire = {
      Id: 'alice',
      DisplayName: 'name',
      _deleted: false,
      _attachments: {},
      _meta: { lwt: 1 },
      _rev: '1-revision',
    }
    Expect(firebaseRuntimeRow('Account', entity, wire, 'alice', true)).toEqual({
      Id: 'alice',
      DisplayName: 'name',
      Bio: null,
    })
    Expect(() => validateFirebaseRow('Account', entity, wire, 'alice')).toThrow("unknown field '_deleted'")
    Expect(firebaseRuntimeRow('Account', entity, { Id: 'alice', DisplayName: 'name', Bio: null }, 'alice')).toEqual({
      Id: 'alice',
      DisplayName: 'name',
      Bio: null,
    })
    Expect(() => firebaseRuntimeRow('Account', entity, { ...wire, Unknown: false }, 'alice', true)).toThrow(
      "unknown field 'Unknown'",
    )
    Expect(() =>
      firebaseRuntimeRow('Account', entity, { Id: 'alice', DisplayName: null, _deleted: true }, 'alice', true)
    ).toThrow('DisplayName expects text')
  })
})
