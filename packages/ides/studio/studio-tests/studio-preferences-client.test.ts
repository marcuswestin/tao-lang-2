import { Expect, Test, testOverrideSlot, until } from '@shared/test'
import { StudioPreferences } from '../studio-src/client/StudioPreferences'

const fetchSlot = testOverrideSlot({
  read: () => globalThis.fetch,
  write: value => {
    Reflect.set(globalThis, 'fetch', value)
  },
})
const windowSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  equals: (left, right) => left?.value === right?.value,
  read: () => Object.getOwnPropertyDescriptor(globalThis, 'window'),
  write: value => {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', value)
    }
  },
})

Test('Studio flushes the latest preference on pagehide with an ordered keepalive request', async () => {
  const requests: Array<
    { body: { sequence: number; values: Record<string, string>; writerId: string }; init: RequestInit; url: string }
  > = []
  let pagehide: (() => void) | undefined
  let releaseFirst: ((response: Response) => void) | undefined
  const restoreWindow = windowSlot.install({
    configurable: true,
    value: {
      addEventListener: (name: string, listener: () => void) => {
        if (name === 'pagehide') {
          pagehide = listener
        }
      },
      localStorage: { getItem: () => null, removeItem: () => {} },
    },
  })
  const restoreFetch = fetchSlot.install(Object.assign(async (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    if (init?.method !== 'POST') {
      return Response.json({ values: {} })
    }
    requests.push({
      body: JSON.parse(String(init.body)) as { sequence: number; values: Record<string, string>; writerId: string },
      init,
      url: String(input),
    })
    if (requests.length === 1) {
      return await new Promise<Response>(resolve => {
        releaseFirst = resolve
      })
    }
    return Response.json({ values: requests.at(-1)!.body.values })
  }, { preconnect: fetch.preconnect }))
  try {
    await StudioPreferences.load()
    StudioPreferences.storage.setItem('tao-studio:drawer-tab:v1', 'Problems')
    await until(() => requests.length === 1)
    StudioPreferences.storage.setItem('tao-studio:drawer-tab:v1', 'Debug')
    pagehide?.()
    Expect(requests.length).toBe(2)
    Expect(requests.map(request => request.url)).toEqual(['/api/studio/preferences', '/api/studio/preferences'])
    Expect(requests.every(request => request.init.keepalive === true)).toBe(true)
    Expect(requests[1]!.body.values).toEqual({ 'tao-studio:drawer-tab:v1': 'Debug' })
    Expect(requests[1]!.body.writerId).toBe(requests[0]!.body.writerId)
    Expect(requests[1]!.body.sequence).toBeGreaterThan(requests[0]!.body.sequence)
    releaseFirst?.(Response.json({ values: requests[0]!.body.values }))
    await until(() => requests.length === 3)
  } finally {
    releaseFirst?.(Response.json({ values: {} }))
    restoreFetch()
    restoreWindow()
  }
})
