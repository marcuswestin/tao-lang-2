import type { HostRevision } from '@host-control'
import { HostControlError } from '@host-control'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import {
  createAppiumMac2HostController,
  type Mac2DesktopLease,
  type Mac2DesktopLeases,
} from '../appium-driver-src/AppiumMac2HostController'
import type {
  AppiumActionSequence,
  AppiumCapabilities,
  AppiumElement,
  AppiumLocator,
  AppiumSession,
} from '../appium-driver-src/AppiumWebDriver'

const revision: HostRevision = { build: 'build-1', source: 'source-1' }

Describe('Appium Mac2 host controller', () => {
  Test(
    'fences physical desktop input, performs real UI operations, and retains ownership after an ambiguous delete',
    async () => {
      const leases = new FakeDesktopLeases()
      const remote = new FakeRemoteSession()
      const capabilities: AppiumCapabilities[] = []
      const host = createAppiumMac2HostController({
        capabilities: { 'appium:automationName': 'Mac2', platformName: 'mac' },
        client: {
          createSession: async next => {
            capabilities.push(next)
            return remote
          },
        },
        desktopLeases: leases,
        resolveTarget: _target => ({ using: 'accessibility id', value: 'studio-window' }),
        target: { appId: 'dev.tao.studio' },
      })
      const session = await host.openSession({
        artifactRoot: '/artifacts',
        mode: 'acceptance',
        revision,
        target: 'studio',
      })
      await Expect(host.openSession({ artifactRoot: '/artifacts', mode: 'acceptance', revision, target: 'studio' }))
        .rejects.toBeInstanceOf(HostControlError)

      const observation = await session.observe({
        expectedRevision: revision,
        target: { kind: 'tag', value: 'studio-window' },
      })
      await session.perform({
        expectedRevision: revision,
        kind: 'click',
        lease: session.descriptor().lease,
        observation,
      })
      await session.perform({
        expectedRevision: revision,
        kind: 'key',
        key: 'Enter',
        lease: session.descriptor().lease,
      })
      await session.executeExternalUi({ args: [{ x: 3, y: 4 }], kind: 'executeScript', script: 'macos: click' })
      await session.perform({
        expectedRevision: revision,
        kind: 'relaunchApplication',
        lease: session.descriptor().lease,
      })
      Expect(remote.clicked).toBe(1)
      Expect(remote.actionCalls).toHaveLength(1)
      Expect(remote.scripts).toEqual([{ args: [{ x: 3, y: 4 }], script: 'macos: click' }])
      Expect(remote.terminated).toEqual(['dev.tao.studio'])
      Expect(remote.activated).toEqual(['dev.tao.studio'])
      await session.observe({
        expectedRevision: revision,
        target: {
          kind: 'scoped',
          scope: { kind: 'tag', value: 'studio-window' },
          target: { kind: 'tag', value: 'toolbar' },
        },
      })
      Expect(capabilities).toEqual([{ 'appium:automationName': 'mac2', platformName: 'mac' }])

      await Expect(
        session.perform({ expectedRevision: revision, kind: 'click', lease: session.descriptor().lease, observation }),
      ).rejects
        .toMatchObject({ code: 'staleObservation' })
      const scrollObservation = await session.observe({
        expectedRevision: revision,
        target: { kind: 'tag', value: 'studio-window' },
      })
      await session.perform({
        deltaX: 1,
        deltaY: 2,
        expectedRevision: revision,
        kind: 'scroll',
        lease: session.descriptor().lease,
        observation: scrollObservation,
      })
      const scrollSteps = remote.actionCalls[1]?.['actions']
      Expect((scrollSteps as readonly Record<string, unknown>[])[0]).toEqual({
        duration: 0,
        type: 'pointerMove',
        x: 22,
        y: 14,
      })

      remote.deleteFailures = 1
      await Expect(session.close(session.descriptor().lease)).rejects.toThrow('retaining the desktop-input lease')
      Expect(leases.lease.releaseCalls).toBe(0)
      await session.close(session.descriptor().lease)
      Expect(leases.lease.releaseCalls).toBe(1)
    },
  )

  Test('resolves each scoped target occurrence before descending to the nested target', async () => {
    const remote = new FakeRemoteSession()
    const group1 = new FakeElement(remote, 'group-1')
    const group2 = new FakeElement(remote, 'group-2')
    const group1Row = new FakeElement(remote, 'group-1-row-1')
    const group2Row1 = new FakeElement(remote, 'group-2-row-1')
    const group2Row2 = new FakeElement(remote, 'group-2-row-2')
    group1.children.set('row', [group1Row])
    group2.children.set('row', [group2Row1, group2Row2])
    group1Row.children.set('button', [
      new FakeElement(remote, 'wrong-group-button-1'),
      new FakeElement(remote, 'wrong-group-button-2'),
    ])
    group2Row1.children.set('button', [
      new FakeElement(remote, 'wrong-row-button-1'),
      new FakeElement(remote, 'wrong-row-button-2'),
    ])
    group2Row2.children.set('button', [
      new FakeElement(remote, 'right-button-1'),
      new FakeElement(remote, 'right-button-2'),
    ])
    remote.elementsByLocator.set('group', [group1, group2])
    const host = createAppiumMac2HostController({
      capabilities: { 'appium:automationName': 'Mac2', platformName: 'mac' },
      client: { createSession: async () => remote },
      desktopLeases: new FakeDesktopLeases(),
      resolveTarget: target => {
        if (target.kind !== 'tag') {
          throw new HostControlError('assertion', 'The nested occurrence fixture resolves tag targets only.')
        }
        return { using: 'accessibility id', value: target.value }
      },
      target: { appId: 'dev.tao.studio' },
    })
    const session = await host.openSession({
      artifactRoot: '/artifacts',
      mode: 'acceptance',
      revision,
      target: 'studio',
    })

    const observation = await session.observe({
      expectedRevision: revision,
      target: {
        kind: 'scoped',
        scope: { kind: 'tag', occurrence: 2, value: 'group' },
        target: {
          kind: 'scoped',
          scope: { kind: 'tag', occurrence: 2, value: 'row' },
          target: { kind: 'tag', occurrence: 2, value: 'button' },
        },
      },
    })

    Expect(observation.id).toBe('right-button-2')
    await session.close(session.descriptor().lease)
  })

  Test('closes only after operations already queued on the remote session finish', async () => {
    const remote = new FakeRemoteSession()
    const firstStarted = Deferred()
    const secondStarted = Deferred()
    const releaseFirst = Deferred()
    const releaseSecond = Deferred()
    let actionCount = 0
    remote.onActions = async () => {
      actionCount += 1
      if (actionCount === 1) {
        firstStarted.resolve()
        await releaseFirst.promise
      } else {
        secondStarted.resolve()
        await releaseSecond.promise
      }
    }
    const leases = new FakeDesktopLeases()
    const host = createAppiumMac2HostController({
      capabilities: { 'appium:automationName': 'Mac2', platformName: 'mac' },
      client: { createSession: async () => remote },
      desktopLeases: leases,
      resolveTarget: _target => ({ using: 'accessibility id', value: 'studio-window' }),
      target: { appId: 'dev.tao.studio' },
    })
    const session = await host.openSession({
      artifactRoot: '/artifacts',
      mode: 'acceptance',
      revision,
      target: 'studio',
    })
    const action = (key: string) =>
      session.perform({
        expectedRevision: revision,
        kind: 'key',
        key,
        lease: session.descriptor().lease,
      })

    const first = action('A')
    await firstStarted.promise
    const second = action('B')
    const closing = session.close(session.descriptor().lease)

    Expect(remote.deleteCalls).toBe(0)
    Expect(leases.lease.releaseCalls).toBe(0)
    releaseFirst.resolve()
    await secondStarted.promise
    Expect(remote.deleteCalls).toBe(0)
    Expect(leases.lease.releaseCalls).toBe(0)
    releaseSecond.resolve()

    await Promise.all([first, second, closing])
    Expect(remote.deleteCalls).toBe(1)
    Expect(leases.lease.releaseCalls).toBe(1)
  })
})

class FakeDesktopLeases implements Mac2DesktopLeases {
  readonly lease = new FakeDesktopLease()
  #held = false

  async acquire(): Promise<Mac2DesktopLease> {
    if (this.#held) {
      throw new HostControlError('busy', 'The physical desktop is already leased.')
    }
    this.#held = true
    return this.lease
  }
}

class FakeDesktopLease implements Mac2DesktopLease {
  readonly generation = 'desktop-lease-1'
  releaseCalls = 0
  async assertCurrent(generation: string): Promise<void> {
    if (generation !== this.generation) {
      throw new HostControlError('staleLease', 'Unexpected desktop lease generation.')
    }
  }
  async release(): Promise<void> {
    this.releaseCalls += 1
  }
}

class FakeRemoteSession implements AppiumSession {
  readonly activated: string[] = []
  readonly actionCalls: AppiumActionSequence[] = []
  clicked = 0
  deleteCalls = 0
  deleteFailures = 0
  readonly elementsByLocator = new Map<string, readonly AppiumElement[]>()
  readonly id = 'mac2-session-1'
  readonly scripts: Array<{ args: readonly unknown[]; script: string }> = []
  readonly terminated: string[] = []
  onActions: (() => Promise<void>) | undefined

  async actions(input: readonly AppiumActionSequence[]): Promise<void> {
    this.actionCalls.push(...input)
    await this.onActions?.()
  }
  async activateApplication(appId: string): Promise<void> {
    this.activated.push(appId)
  }
  async delete(): Promise<void> {
    this.deleteCalls += 1
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1
      throw new HostControlError('host', 'remote delete timed out')
    }
  }
  async executeScript<T>(script: string, args: readonly unknown[] = []): Promise<T> {
    this.scripts.push({ args, script })
    return undefined as T
  }
  async find(): Promise<AppiumElement> {
    return new FakeElement(this)
  }
  async findAll(locator: AppiumLocator): Promise<readonly AppiumElement[]> {
    return this.elementsByLocator.get(locator.value) ?? [new FakeElement(this)]
  }
  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array([1, 2])
  }
  async terminateApplication(appId: string): Promise<void> {
    this.terminated.push(appId)
  }
}

class FakeElement implements AppiumElement {
  readonly children = new Map<string, readonly AppiumElement[]>()
  constructor(readonly remote: FakeRemoteSession, readonly id = 'element-1') {}
  async click(): Promise<void> {
    this.remote.clicked += 1
  }
  async find(): Promise<AppiumElement> {
    return this
  }
  async findAll(locator: AppiumLocator): Promise<readonly AppiumElement[]> {
    return this.children.get(locator.value) ?? [this]
  }
  async getAttribute(): Promise<string> {
    return 'Studio window'
  }
  async getRect() {
    return { height: 20, width: 40, x: 2, y: 4 }
  }
  async getText(): Promise<string> {
    return 'Studio'
  }
  async observe() {
    return {
      accessibilityLabel: 'Studio window',
      rect: { height: 20, width: 40, x: 2, y: 4 },
      text: 'Studio',
      visible: true,
    }
  }
  async sendKeys(): Promise<void> {}
  async visible(): Promise<boolean> {
    return true
  }
}
