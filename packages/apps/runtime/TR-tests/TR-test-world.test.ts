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
})
