import { Deferred, Expect, Test } from '@shared/test'
import { StudioCanvasPersistence } from '../studio-src/client/app/StudioCanvasPersistence'
import type { StudioCanvasViewportSaveRequest } from '../studio-src/StudioProtocol'

Test('canvas persistence coalesces motion and makes page-hide saves newer than in-flight writes', async () => {
  const requests: { request: StudioCanvasViewportSaveRequest; keepalive: boolean }[] = []
  const first = Deferred<void>()
  const persistence = new StudioCanvasPersistence({
    clientId: 'window',
    onError: error => {
      throw error
    },
    save: async (request, keepalive) => {
      requests.push({ request, keepalive })
      if (request.sequence === 1) {
        await first.promise
      }
    },
  })
  persistence.changed({ x: 1, y: 2, z: 1 })
  persistence.changed({ x: 30, y: 40, z: 2 })
  const normal = persistence.flush()
  try {
    Expect(requests.length).toBe(1)
    Expect(requests[0]?.request.viewport).toEqual({ x: 30, y: 40, z: 2 })
    // A pagehide must re-send even if the only latest snapshot is already in flight.
    await persistence.flush(true)
    Expect(requests[1]).toEqual({
      request: { clientId: 'window', sequence: 2, viewport: { x: 30, y: 40, z: 2 } },
      keepalive: true,
    })
    persistence.changed({ x: 70, y: 80, z: 3 })
    persistence.dispose()
    Expect(requests[2]).toEqual({
      request: { clientId: 'window', sequence: 3, viewport: { x: 70, y: 80, z: 3 } },
      keepalive: true,
    })
    persistence.changed({ x: 90, y: 90, z: 4 })
    Expect(requests.length).toBe(3)
  } finally {
    first.resolve()
    await normal
    persistence.dispose()
  }
})

Test('canvas persistence retains failed latest saves for retry and never restores an older snapshot', async () => {
  const requests: StudioCanvasViewportSaveRequest[] = []
  const first = Deferred<void>()
  const failures: unknown[] = []
  const persistence = new StudioCanvasPersistence({
    clientId: 'window',
    onError: error => failures.push(error),
    save: async request => {
      requests.push(request)
      if (request.sequence === 1) {
        await first.promise
      }
      if (request.sequence === 3) {
        return Promise.reject('temporarily unavailable')
      }
    },
  })
  persistence.changed({ x: 1, y: 1, z: 1 })
  const old = persistence.flush()
  persistence.changed({ x: 2, y: 2, z: 2 })
  await persistence.flush()
  first.reject('old failure')
  await old
  await persistence.flush()
  Expect(requests.length).toBe(2)
  persistence.changed({ x: 3, y: 3, z: 3 })
  await persistence.flush()
  await persistence.flush()
  Expect(requests[3]?.viewport).toEqual({ x: 3, y: 3, z: 3 })
  Expect(failures).toEqual(['old failure', 'temporarily unavailable'])
  await persistence.flush(true)
  Expect(requests.length).toBe(4)
  persistence.dispose()
  Expect(requests.length).toBe(4)
})
