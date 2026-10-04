import { Describe, Expect, Test } from '@shared/test'
import {
  BrowserNavigationHistory,
  type BrowserNavigationHistoryDriver,
  type BrowserNavigationPosition,
} from '../TaoRuntime-src/TR-navigation-browser-history'

class FakeHistoryDriver implements BrowserNavigationHistoryDriver {
  readonly goes: number[] = []
  readonly pushes: number[] = []
  readonly replacements: number[] = []
  private currentEpoch: string | undefined
  private listener: ((position: BrowserNavigationPosition | undefined) => void) | undefined

  go(delta: number): void {
    this.goes.push(delta)
  }

  push(position: BrowserNavigationPosition): void {
    this.currentEpoch = position.epoch
    this.pushes.push(position.sequence)
  }

  replace(position: BrowserNavigationPosition): void {
    this.currentEpoch = position.epoch
    this.replacements.push(position.sequence)
  }

  subscribe(listener: (position: BrowserNavigationPosition | undefined) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) {
        this.listener = undefined
      }
    }
  }

  pop(sequence: number | undefined, epoch = this.currentEpoch): void {
    this.listener?.(
      sequence === undefined || epoch === undefined ? undefined : { epoch, sequence },
    )
  }

  get epoch(): string | undefined {
    return this.currentEpoch
  }
}

const owner = {}

Describe('browser navigation history', () => {
  Test('dispatches Back and replays a consecutive three-entry Forward chain', () => {
    const driver = new FakeHistoryDriver()
    const replayed: number[] = []
    let backs = 0
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      backs += 1
      history.reducerBackCompleted()
      return true
    })
    history.attach(driver)
    for (let number = 1; number <= 3; number += 1) {
      history.record({
        arguments: {},
        instanceId: number,
        kind: 'content',
        owner,
        presentable: number,
        replay: () => replayed.push(number),
      })
    }

    driver.pop(0)
    Expect(backs).toBe(3)
    driver.pop(3)
    Expect(replayed).toEqual([1, 2, 3])
    Expect(driver.pushes).toEqual([1, 2, 3])
  })

  Test('Forward replays the auxiliary occurrence the reducer actually removed', () => {
    const driver = new FakeHistoryDriver()
    const auxiliary = {}
    const root = {}
    const replayed: string[] = []
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      history.reducerBackCompleted({ owner: auxiliary })
      return true
    })
    history.attach(driver)
    history.record({
      arguments: {},
      instanceId: 1,
      kind: 'content',
      owner: auxiliary,
      presentable: 'auxiliary',
      replay: () => replayed.push('auxiliary'),
    })
    history.record({
      arguments: {},
      instanceId: 2,
      kind: 'content',
      owner: root,
      presentable: 'root',
      replay: () => replayed.push('root'),
    })

    driver.pop(1)
    driver.pop(2)

    Expect(replayed).toEqual(['auxiliary'])
  })

  Test('owner fallback preserves third-party overlay-before-content Back order', () => {
    const driver = new FakeHistoryDriver()
    const thirdPartyMount = {}
    const replayed: string[] = []
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      history.reducerBackCompleted({ owner: thirdPartyMount })
      return true
    })
    history.attach(driver)
    history.record({
      arguments: {},
      instanceId: 1,
      kind: 'overlay',
      owner: thirdPartyMount,
      presentable: 'overlay',
      replay: () => replayed.push('overlay'),
    })
    history.record({
      arguments: {},
      instanceId: 2,
      kind: 'content',
      owner: thirdPartyMount,
      presentable: 'content',
      replay: () => replayed.push('content'),
    })

    driver.pop(1)
    driver.pop(2)

    Expect(replayed).toEqual(['overlay'])
  })

  Test('owner fallback preserves third-party selection-item Back order', () => {
    const driver = new FakeHistoryDriver()
    const thirdPartySelection = {}
    const replayed: string[] = []
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      history.reducerBackCompleted({ context: 'home', owner: thirdPartySelection })
      return true
    })
    history.attach(driver)
    history.record({
      arguments: {},
      context: 'home',
      instanceId: 1,
      kind: 'content',
      owner: thirdPartySelection,
      presentable: 'home detail',
      replay: () => replayed.push('home detail'),
    })
    history.record({
      arguments: {},
      context: 'settings',
      instanceId: 2,
      kind: 'content',
      owner: thirdPartySelection,
      presentable: 'settings detail',
      replay: () => replayed.push('settings detail'),
    })

    driver.pop(1)
    driver.pop(2)

    Expect(replayed).toEqual(['home detail'])
  })

  Test('a new navigation after Back truncates the redo chain', () => {
    const driver = new FakeHistoryDriver()
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      history.reducerBackCompleted()
      return true
    })
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'content', owner, presentable: 1, replay: () => {} })
    history.record({ arguments: {}, instanceId: 2, kind: 'content', owner, presentable: 2, replay: () => {} })
    driver.pop(1)

    let replayed = false
    history.record({
      arguments: {},
      instanceId: 3,
      kind: 'content',
      owner,
      presentable: 3,
      replay: () => {
        replayed = true
      },
    })
    driver.pop(3)

    Expect(replayed).toBe(false)
    Expect(driver.replacements.at(-1)).toBe(2)
  })

  Test('Back dismisses an ask but Forward never replays it', () => {
    const driver = new FakeHistoryDriver()
    let backs = 0
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      backs += 1
      history.reducerBackCompleted()
      return true
    })
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'ask', owner, presentable: 1 })

    driver.pop(0)
    driver.pop(1)

    Expect(backs).toBe(1)
    Expect(driver.replacements.at(-1)).toBe(0)
  })

  Test('root exhaustion and non-Tao history entries are not intercepted', () => {
    const driver = new FakeHistoryDriver()
    let backs = 0
    const history = new BrowserNavigationHistory(() => {
      backs += 1
      return false
    })
    history.attach(driver)
    driver.pop(undefined)

    Expect(backs).toBe(0)
    Expect(driver.replacements).toEqual([0])
  })

  Test('continues browser Back past stale Tao entries when the reducer is exhausted', () => {
    const driver = new FakeHistoryDriver()
    let backs = 0
    const history = new BrowserNavigationHistory(() => {
      backs += 1
      return false
    })
    history.attach(driver)
    history.record({
      arguments: {},
      instanceId: 1,
      kind: 'content',
      owner,
      presentable: 1,
      replay: () => {},
    })

    driver.pop(0)

    Expect(backs).toBe(1)
    Expect(driver.goes).toEqual([-1])
    Expect(driver.replacements).toEqual([0, 0])
  })

  Test('queues consecutive self-caused Back traversals in order', () => {
    const driver = new FakeHistoryDriver()
    const history = new BrowserNavigationHistory(() => false)
    history.attach(driver)
    for (let number = 1; number <= 3; number += 1) {
      history.record({
        arguments: {},
        instanceId: number,
        kind: 'content',
        owner,
        presentable: number,
        replay: () => {},
      })
    }

    history.reducerBackCompleted()
    history.reducerBackCompleted()
    driver.pop(2)
    driver.pop(1)

    Expect(driver.goes).toEqual([-1, -1])
    Expect(driver.replacements).toEqual([0])
  })

  Test('an exact in-app removal does not consume a newer live occurrence', () => {
    const driver = new FakeHistoryDriver()
    let replayedNewer = false
    const history = new BrowserNavigationHistory(() => false)
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'ask', owner, presentable: 'ask' })
    history.record({
      arguments: {},
      instanceId: 2,
      kind: 'content',
      owner,
      presentable: 'newer',
      replay: () => {
        replayedNewer = true
      },
    })

    history.reducerBackCompleted({ instanceId: 1, owner })
    driver.pop(1)
    driver.pop(2)

    Expect(replayedNewer).toBe(false)
    Expect(driver.replacements.at(-1)).toBe(1)
  })

  Test('defers a new mutation until an in-app Back traversal settles', () => {
    const driver = new FakeHistoryDriver()
    const history = new BrowserNavigationHistory(() => false)
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'content', owner, presentable: 1, replay: () => {} })

    history.reducerBackCompleted()
    history.record({ arguments: {}, instanceId: 2, kind: 'content', owner, presentable: 2, replay: () => {} })
    Expect(driver.pushes).toEqual([1])
    driver.pop(0)

    Expect(driver.pushes).toEqual([1, 1])
  })

  Test('coalesces synchronous dismiss, present, dismiss while one traversal is in flight', () => {
    const driver = new FakeHistoryDriver()
    const history = new BrowserNavigationHistory(() => false)
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'content', owner, presentable: 1, replay: () => {} })

    history.reducerBackCompleted()
    history.record({ arguments: {}, instanceId: 2, kind: 'content', owner, presentable: 2, replay: () => {} })
    history.reducerBackCompleted()

    Expect(driver.goes).toEqual([-1])
    driver.pop(0)
    history.record({ arguments: {}, instanceId: 3, kind: 'content', owner, presentable: 3, replay: () => {} })
    Expect(driver.pushes).toEqual([1, 1])
  })

  Test('rehydrates browser Back depth when a host detaches and reattaches', () => {
    const firstDriver = new FakeHistoryDriver()
    let history: BrowserNavigationHistory
    let backs = 0
    history = new BrowserNavigationHistory(() => {
      backs += 1
      history.reducerBackCompleted()
      return true
    })
    const detach = history.attach(firstDriver)
    history.record({ arguments: {}, instanceId: 1, kind: 'content', owner, presentable: 1, replay: () => {} })
    history.record({ arguments: {}, instanceId: 2, kind: 'content', owner, presentable: 2, replay: () => {} })
    detach()

    const secondDriver = new FakeHistoryDriver()
    history.attach(secondDriver)
    Expect(secondDriver.replacements).toEqual([0])
    Expect(secondDriver.pushes).toEqual([1, 2])

    secondDriver.pop(1)
    Expect(backs).toBe(1)
  })

  Test('does not latch when platform root Back has no earlier browser entry', () => {
    const driver = new FakeHistoryDriver()
    let backs = 0
    const history = new BrowserNavigationHistory(() => {
      backs += 1
      return false
    })
    history.attach(driver)
    history.record({ arguments: {}, instanceId: 1, kind: 'content', owner, presentable: 1, replay: () => {} })
    driver.pop(0)

    history.record({ arguments: {}, instanceId: 2, kind: 'content', owner, presentable: 2, replay: () => {} })
    driver.pop(0)

    Expect(backs).toBe(2)
    Expect(driver.goes).toEqual([-1, -1])
  })

  Test('treats colliding pre-reload sequence numbers as inert by epoch', () => {
    const driver = new FakeHistoryDriver()
    const replayed: number[] = []
    let history: BrowserNavigationHistory
    history = new BrowserNavigationHistory(() => {
      history.reducerBackCompleted()
      return true
    })
    history.attach(driver)
    history.record({
      arguments: {},
      instanceId: 1,
      kind: 'content',
      owner,
      presentable: 1,
      replay: () => replayed.push(1),
    })
    history.record({
      arguments: {},
      instanceId: 2,
      kind: 'content',
      owner,
      presentable: 2,
      replay: () => replayed.push(2),
    })
    driver.pop(0)
    driver.pop(1, 'pre-reload-epoch')

    Expect(replayed).toEqual([])
  })
})
