import { Describe, Expect, settle, Test, until } from '@shared/test'
import { referenceTest } from './fixtures/reference-test'

Describe('Reference explicit retry', () => {
  for (const laterFailure of ['permanent', 'transient'] as const) {
    Test(`retries only the oldest failed submission while preserving a later ${laterFailure} failure`, async () => {
      const test = await referenceTest()
      try {
        const alice = await test.signIn('retry-alice', true)
        const bob = await test.signIn('retry-bob', true)
        await test.serverWrite(alice, [{
          kind: 'create',
          entity: 'Note',
          id: 'retry-note',
          fields: { Owner: alice.accountId, Body: 'original' },
        }])
        const connection = test.connect(alice)
        const baseline = await connection.load() as string
        const submit = (body: string) => {
          const changed = JSON.parse(baseline) as { rows: { Note: Array<{ Body: string }> } }
          changed.rows.Note[0]!.Body = body
          return connection.submit!(JSON.stringify(changed), [{ entity: 'Note', id: 'retry-note', fields: ['Body'] }], {
            previousSnapshot: baseline,
          })
        }
        await test.transferNote('retry-note', bob.accountId)
        await Expect(submit('oldest authored content')).rejects.toThrow('did not authorize')
        if (laterFailure === 'transient') {
          test.online = false
          Expect(await submit('later authored content')).toEqual({ status: 'queued' })
          Expect(await submit('still queued content')).toEqual({ status: 'queued' })
        } else {
          await Expect(submit('later authored content')).rejects.toThrow('did not authorize')
        }
        const before = connection.writes!.status('Note', 'retry-note')
        Expect(before.failed).toBe(2)
        Expect(before.queued).toBe(laterFailure === 'transient' ? 1 : 0)
        const attempts: string[] = []
        const observations: typeof before[] = []
        connection.writes!.subscribe(() => observations.push(connection.writes!.status('Note', 'retry-note')))
        test.beforePost = async transaction => {
          attempts.push(transaction.operationId)
        }
        await test.transferNote('retry-note', alice.accountId)
        test.online = true

        connection.writes!.retry('Note', 'retry-note')

        await until(() =>
          !connection.writes!.status('Note', 'retry-note').records.some(row => row.id === before.records[0]!.id)
        )
        // After acknowledgement, selecting the next upload uses only queued microtasks. Drain
        // those before asserting that explicit retry did not start a different submission.
        await settle()
        Expect(attempts).toEqual([before.records[0]!.id])
        Expect(observations[0]).toEqual({
          failed: 1,
          queued: before.queued + 1,
          records: [{ id: before.records[0]!.id, recovery: before.records[0]!.recovery }, ...before.records.slice(1)],
        })
        Expect(connection.writes!.status('Note', 'retry-note')).toEqual({
          failed: 1,
          queued: before.queued,
          records: before.records.slice(1),
        })
        Expect((await test.serverRows(alice)).rows.find(row => row.id === 'retry-note')?.fields['Body'])
          .toBe('oldest authored content')
        if (laterFailure === 'transient') {
          connection.writes!.retry('Note', 'retry-note')
          await until(() => connection.writes!.status('Note', 'retry-note').failed === 0)
          await until(() => connection.writes!.status('Note', 'retry-note').records.length === 1)
          await settle()
          Expect(attempts).toEqual(before.records.slice(0, 2).map(row => row.id))
          Expect(connection.writes!.status('Note', 'retry-note').records).toEqual(before.records.slice(2))

          connection.writes!.retry('Note', 'retry-note')
          await settle()
          Expect(attempts).toEqual(before.records.slice(0, 2).map(row => row.id))
          Expect(connection.writes!.status('Note', 'retry-note').records).toEqual(before.records.slice(2))
        }
      } finally {
        await test.stop()
      }
    })
  }
})
