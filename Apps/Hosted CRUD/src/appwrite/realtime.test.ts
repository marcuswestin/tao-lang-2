import { describe, expect, test } from 'bun:test'
import { AppwriteNotesError } from './model'
import { type RowEvent, watchOwnedRows } from './realtime'

const event = (ownerId: string): RowEvent => ({ payload: { ownerId } })

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(1)
  }
  expect(predicate()).toBe(true)
}

describe('Appwrite owned-row realtime', () => {
  test('concurrent close callers await the same pending subscription cleanup', async () => {
    let releaseConnection: (connection: { disconnect(): Promise<void> }) => void = () => {}
    const pendingConnection = new Promise<{ disconnect(): Promise<void> }>(resolve => {
      releaseConnection = resolve
    })
    let disconnects = 0
    const watcher = watchOwnedRows('alice', () => {}, async () => pendingConnection, 60_000)
    const first = watcher.stop()
    const second = watcher.stop()
    let completed = false
    void second.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(first).toBe(second)
    releaseConnection({
      disconnect: async () => {
        disconnects++
      },
    })
    await Promise.all([first, second])
    expect(completed).toBe(true)
    expect(disconnects).toBe(1)
  })

  test('reconciles owned create, update, and delete and stops on account close', async () => {
    const remote = new Map<string, { ownerId: string; text: string }>()
    let local = new Map<string, string>()
    let onEvent: (event: RowEvent) => void = () => {}
    let onOpen: () => void = () => {}
    let disconnects = 0
    const watcher = watchOwnedRows('alice', () => {
      local = new Map(
        [...remote]
          .filter(([, note]) => note.ownerId === 'alice')
          .map(([id, note]) => [id, note.text]),
      )
    }, async (eventCallback, openCallback) => {
      onEvent = eventCallback
      onOpen = openCallback
      return {
        disconnect: async () => {
          disconnects++
        },
      }
    }, 60_000)
    await Promise.resolve()
    await Promise.resolve()

    remote.set('note-1', { ownerId: 'alice', text: 'new' })
    onEvent(event('alice'))
    await waitFor(() => local.get('note-1') === 'new')
    expect(local.get('note-1')).toBe('new')

    remote.set('note-1', { ownerId: 'alice', text: 'edited' })
    onEvent(event('alice'))
    await waitFor(() => local.get('note-1') === 'edited')
    expect(local.get('note-1')).toBe('edited')

    remote.delete('note-1')
    onEvent(event('alice'))
    await waitFor(() => !local.has('note-1'))
    expect(local.has('note-1')).toBe(false)

    remote.set('foreign', { ownerId: 'bob', text: 'private' })
    onEvent(event('bob'))
    await Promise.resolve()
    await Promise.resolve()
    expect(local.has('foreign')).toBe(false)

    onOpen()
    await Promise.resolve()
    await Promise.resolve()
    expect(local.has('foreign')).toBe(false)

    await watcher.stop()
    expect(disconnects).toBe(1)
    remote.set('note-2', { ownerId: 'alice', text: 'after close' })
    onEvent(event('alice'))
    await Promise.resolve()
    expect(local.has('note-2')).toBe(false)
  })

  test('keeps polling and retries a failed subscription after an offline interval', async () => {
    let attempts = 0
    let refreshes = 0
    let disconnects = 0
    const watcher = watchOwnedRows('alice', () => {
      refreshes++
    }, async () => {
      attempts++
      if (attempts === 1) {
        throw new AppwriteNotesError('offline')
      }
      return {
        disconnect: async () => {
          disconnects++
        },
      }
    }, 5)
    try {
      const deadline = Date.now() + 500
      while (attempts < 2 && Date.now() < deadline) {
        await Bun.sleep(5)
      }
      expect(attempts).toBe(2)
      expect(refreshes).toBeGreaterThan(0)
    } finally {
      await watcher.stop()
    }
    expect(disconnects).toBe(1)
  })

  test('coalesces events arriving during a list refresh and closes a late subscription', async () => {
    let finishRefresh: () => void = () => {}
    const pendingRefresh = new Promise<void>(resolve => {
      finishRefresh = resolve
    })
    let calls = 0
    let onEvent: (event: RowEvent) => void = () => {}
    let releaseConnection: (connection: { disconnect(): Promise<void> }) => void = () => {}
    const pendingConnection = new Promise<{ disconnect(): Promise<void> }>(resolve => {
      releaseConnection = resolve
    })
    let disconnects = 0
    const watcher = watchOwnedRows('alice', async () => {
      calls++
      if (calls === 1) {
        await pendingRefresh
      }
    }, async callback => {
      onEvent = callback
      return pendingConnection
    }, 60_000)

    releaseConnection({
      disconnect: async () => {
        disconnects++
      },
    })
    await waitFor(() => calls === 1)
    onEvent(event('alice'))
    onEvent(event('alice'))
    finishRefresh()
    await waitFor(() => calls === 2)
    await watcher.stop()
    expect(disconnects).toBe(1)

    let lateDisconnects = 0
    let releaseLate: (connection: { disconnect(): Promise<void> }) => void = () => {}
    const lateConnection = new Promise<{ disconnect(): Promise<void> }>(resolve => {
      releaseLate = resolve
    })
    const lateWatcher = watchOwnedRows('alice', () => {}, async () => lateConnection, 60_000)
    const stopping = lateWatcher.stop()
    releaseLate({
      disconnect: async () => {
        lateDisconnects++
      },
    })
    await stopping
    expect(lateDisconnects).toBe(1)
  })
})
