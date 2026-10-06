import { expect, test } from '@playwright/test'
import { Errors } from '@shared'
import { proveAppiumBackgroundResume } from './AppiumBackgroundResumeProof'

test.describe('Appium background and resume proof', () => {
  test('waits for background animation before measuring the full background interval', async () => {
    const states: (0 | 1 | 2 | 3 | 4)[] = [4, 4, 4, 2, 3, 4]
    let elapsedMs = 0
    const evidence = await proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      now: () => elapsedMs,
      sleep: async milliseconds => {
        elapsedMs += milliseconds
      },
      session: {
        id: 'owned-session',
        activateApplication: async () => {},
        executeScript: async <T>() => undefined as T,
        queryApplicationState: async () => states.shift() ?? 4,
      },
    })
    expect(evidence.backgroundObservedAtMs).toBe(200)
    expect(evidence.backgroundWaitCompletedAtMs).toBe(10_200)
    expect(evidence.backgroundState).toBe(2)
  })

  test('records foreground, live background, and foreground on one session', async () => {
    const events: string[] = []
    const states: (0 | 1 | 2 | 3 | 4)[] = [4, 2, 3, 4]
    let elapsedMs = 10
    const evidence = await proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      now: () => elapsedMs,
      session: {
        activateApplication: async appId => {
          expect(appId).toBe('dev.tao.syntax2')
          events.push('activate')
        },
        executeScript: async <T>(script: string, args?: readonly unknown[]) => {
          events.push(`${script}:${JSON.stringify(args)}`)
          return undefined as T
        },
        id: 'owned-session',
        async queryApplicationState(appId) {
          expect(this.id).toBe('owned-session')
          expect(appId).toBe('dev.tao.syntax2')
          events.push('state')
          return states.shift() ?? 4
        },
      },
      sleep: async milliseconds => {
        events.push(`sleep:${milliseconds}`)
        elapsedMs += milliseconds
      },
    })

    expect(events).toEqual([
      'state',
      'mobile: backgroundApp:[{"seconds":-1}]',
      'state',
      'sleep:10000',
      'state',
      'activate',
      'state',
    ])
    expect(evidence).toEqual({
      appId: 'dev.tao.syntax2',
      backgroundObservedAtMs: 10,
      backgroundState: 2,
      backgroundWaitCompletedAtMs: 10_010,
      foregroundAfterResumeAtMs: 10_010,
      foregroundBeforeAtMs: 10,
      foregroundState: 4,
      sessionId: 'owned-session',
    })
  })

  test('fails closed if the app is not foregrounded at entry', async () => {
    const events: string[] = []
    await expect(proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      session: {
        activateApplication: async () => {
          events.push('activate')
        },
        executeScript: async <T>() => {
          events.push('background')
          return undefined as T
        },
        id: 'owned-session',
        queryApplicationState: async () => 3,
      },
      sleep: async () => {
        events.push('sleep')
      },
    })).rejects.toThrow('must be foregrounded')
    expect(events).toEqual([])
  })

  test('fails if backgrounding terminates or loses the app before the bounded wait', async () => {
    const states: (0 | 1 | 2 | 3 | 4)[] = [4, 1]
    const events: string[] = []
    await expect(proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      session: {
        activateApplication: async () => {
          events.push('activate')
        },
        executeScript: async <T>() => {
          events.push('background')
          return undefined as T
        },
        id: 'owned-session',
        queryApplicationState: async () => states.shift() ?? 1,
      },
      sleep: async () => {
        events.push('sleep')
      },
    })).rejects.toThrow('did not leave the app running in background')
    expect(events).toEqual(['background'])
  })

  test('fails if the app does not return to foreground after activation', async () => {
    let elapsedMs = 0
    let queries = 0
    await expect(proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      now: () => elapsedMs,
      session: {
        activateApplication: async () => {},
        executeScript: async <T>() => undefined as T,
        id: 'owned-session',
        queryApplicationState: async () => ++queries === 1 ? 4 : 3,
      },
      sleep: async milliseconds => {
        elapsedMs += milliseconds
      },
    })).rejects.toThrow('did not return to foreground')
  })

  test('fails closed when the Appium session cannot observe app state', async () => {
    await expect(proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      session: {
        activateApplication: async () => {},
        executeScript: async <T>() => undefined as T,
        id: 'owned-session',
      },
    })).rejects.toThrow('cannot observe the owned app state')
  })

  test('preserves transport failures as failed proof', async () => {
    const failure = Errors.abortError('state query unavailable')
    await expect(proveAppiumBackgroundResume({
      appId: 'dev.tao.syntax2',
      session: {
        activateApplication: async () => {},
        executeScript: async <T>() => undefined as T,
        id: 'owned-session',
        queryApplicationState: async () => {
          throw failure
        },
      },
    })).rejects.toBe(failure)
  })
})
