import TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { TestWorld } from '../TaoRuntime-src/TR-test-world'

const empty = JSON.stringify({ rows: { Note: [] } })
const withNote = JSON.stringify({ rows: { Note: [{ Id: '1', Title: 'A' }] } })

Describe('test world provider stand-in', () => {
  Test('a snapshot save failure remains observable by wait for sync', async () => {
    TestWorld.begin()
    try {
      const connection = TestWorld.connection()
      await connection.save(empty)
      TestWorld.failAfter('create', 'Note', 'rejected')
      await Expect(Promise.resolve().then(() => connection.save(withNote))).rejects.toThrow('rejected')
      await Expect(TestWorld.waitForSync()).rejects.toThrow('Sync failed: rejected')
    } finally {
      TestWorld.end()
    }
  })

  Test('an unrelated operation does not consume the next matching failure', async () => {
    TestWorld.begin()
    try {
      const connection = TestWorld.connection(true)
      await connection.save(empty)
      TestWorld.failAfter('delete', 'Note', 'delete rejected')
      await connection.save(withNote)
      Expect(connection.writes?.status('Note', '1').failed).toBe(0)
      await connection.save(empty)
      Expect(connection.writes?.status('Note', '1').failed).toBe(1)
    } finally {
      TestWorld.end()
    }
  })

  Test('a named failure rejects the whole granular submission and one retry clears it', async () => {
    TestWorld.begin()
    try {
      const connection = TestWorld.connection(true)
      await connection.save(JSON.stringify({ rows: { Note: [], Task: [] } }))
      TestWorld.failAfter('create', 'Note', 'whole submission rejected')
      await connection.save(JSON.stringify({
        rows: {
          Note: [{ Id: '1', Title: 'A' }],
          Task: [{ Id: '2', Title: 'B' }],
        },
      }))
      Expect(connection.writes?.status('Note', '1').failed).toBe(1)
      Expect(connection.writes?.status('Task', '2').failed).toBe(1)
      connection.writes?.retry('Note', '1')
      Expect(connection.writes?.status('Note', '1').failed).toBe(0)
      Expect(connection.writes?.status('Task', '2').failed).toBe(0)
    } finally {
      TestWorld.end()
    }
  })

  Test('an offline granular write queues until reconnect before an armed fault fires', async () => {
    TestWorld.begin()
    try {
      const connection = TestWorld.connection(true)
      await connection.save(empty)
      TestWorld.failAfter('create', 'Note', 'rejected on reconnect')
      TestWorld.network('offline')
      await connection.save(withNote)
      Expect(connection.writes?.status('Note', '1')).toMatchObject({ failed: 0, queued: 1 })
      TestWorld.network('online')
      Expect(connection.writes?.status('Note', '1')).toMatchObject({ failed: 1, queued: 0 })
      await Expect(TestWorld.waitForSync()).rejects.toThrow('rejected on reconnect')
    } finally {
      TestWorld.end()
    }
  })

  Test('offline snapshot saves preserve every armed fault until an online matching write', async () => {
    TestWorld.begin()
    try {
      const connection = TestWorld.connection()
      await connection.save(empty)
      TestWorld.failAfter('create', 'Note', 'first rejection')
      TestWorld.failAfter('update', 'Note', 'second rejection')
      TestWorld.network('offline')
      await Expect(Promise.resolve().then(() => connection.save(withNote))).rejects.toThrow('Network is offline')
      TestWorld.network('online')
      await Expect(Promise.resolve().then(() => connection.save(withNote))).rejects.toThrow('first rejection')
      await connection.save(withNote)
      await Expect(
        Promise.resolve().then(() =>
          connection.save(
            JSON.stringify({ rows: { Note: [{ Id: '1', Title: 'B' }] } }),
          )
        ),
      ).rejects.toThrow('second rejection')
    } finally {
      TestWorld.end()
    }
  })

  Test('a configured provider patch and switch rebind the test capability', async () => {
    TR.Data.beginTest()
    try {
      const schema = TR.Data.Schema({
        name: 'TestWorldRebind',
        entities: {
          Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } },
        },
      })
      const granular = TR.Data.Declaration('Granular', {
        testWriteRecovery: true,
        connect: () => Errors.throwUnexpected('Real provider must not connect in a behavior test.'),
      })
      const first = TR.Data.Configure(granular, { StorageKey: 'first' })
      TR.Data.BindConfigured(schema, first)
      await TR.Data.Settle(schema)
      TestWorld.failAfter('create', 'Note', 'first failed')
      TR.Data.Create(schema, 'Note', { Title: TR.Value('First') })
      await TR.Data.Settle(schema)
      Expect(TR.Data.Read(schema.query({ entity: 'Note', filters: [] })[0], 'CanRetryWrites')).toBe(true)

      TR.Data.BindConfigured(schema, TR.Data.Patch(first, { Revision: 2 }))
      await TR.Data.Settle(schema)
      Expect(TR.Data.Read(schema.query({ entity: 'Note', filters: [] })[0], 'CanRetryWrites')).toBe(true)

      TR.Data.BindConfigured(schema, TR.Data.Patch(first, { StorageKey: 'second' }))
      await TR.Data.Settle(schema)
      Expect(schema.query({ entity: 'Note', filters: [] })).toHaveLength(0)
      TestWorld.failAfter('create', 'Note', 'second failed')
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Second') })
      await TR.Data.Settle(schema)
      Expect(TR.Data.Read(schema.query({ entity: 'Note', filters: [] })[0], 'CanRetryWrites')).toBe(true)

      const snapshot = TR.Data.Declaration('Snapshot', {
        connect: () => Errors.throwUnexpected('Real provider must not connect in a behavior test.'),
      })
      TR.Data.BindConfigured(schema, TR.Data.Configure(snapshot, { StorageKey: 'third' }))
      await TR.Data.Settle(schema)
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Third') })
      await TR.Data.Settle(schema)
      Expect(TR.Data.Read(schema.query({ entity: 'Note', filters: [] })[0], 'CanRetryWrites')).toBe(false)
    } finally {
      TR.Data.endTest()
    }
  })

  Test('a production snapshot save failure keeps an existing handle readable', async () => {
    const schema = TR.Data.Schema({
      name: 'ProductionSnapshot',
      entities: {
        Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } },
      },
    }, {
      load: () => undefined,
      save: () => Errors.throwHostEnvironment('save rejected'),
    })
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Readable') })
    await TR.Data.Settle(schema)
    Expect(TR.Data.EntityAvailability(schema.query({ entity: 'Note', filters: [] })[0])).toEqual({
      status: 'available',
    })
  })
})
