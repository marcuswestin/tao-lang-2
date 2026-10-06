import type { AppiumApplicationState, AppiumSession } from '@appium-driver'
import { Errors, Time } from '@shared'

const BACKGROUND_WAIT_MS = 10_000
const FOREGROUND_WAIT_MS = 5_000

export type AppiumBackgroundResumeEvidence = Readonly<{
  appId: string
  backgroundObservedAtMs: number
  backgroundState: 2 | 3
  backgroundWaitCompletedAtMs: number
  foregroundAfterResumeAtMs: number
  foregroundBeforeAtMs: number
  foregroundState: 4
  sessionId: string
}>

/** AppiumBackgroundResumeProof proves one owned session backgrounds and reactivates the same app. */
export async function proveAppiumBackgroundResume(options: {
  appId: string
  session: Pick<AppiumSession, 'activateApplication' | 'executeScript' | 'id' | 'queryApplicationState'>
  now?: typeof Time.nowMs
  sleep?: typeof Time.sleep
}): Promise<AppiumBackgroundResumeEvidence> {
  const { appId, session } = options
  if (appId.trim().length === 0 || session.id.trim().length === 0) {
    return Errors.throwUserInput('Native background/resume proof requires an app ID and an owned Appium session.')
  }
  const queryApplicationState = session.queryApplicationState?.bind(session)
  if (queryApplicationState === undefined) {
    return Errors.throwHostEnvironment('The Appium session cannot observe the owned app state.')
  }

  const now = options.now ?? Time.nowMs
  const sleep = options.sleep ?? Time.sleep
  const foregroundBeforeAtMs = now()
  const foregroundState = await queryApplicationState(appId)
  requireState(foregroundState, 'The owned app must be foregrounded before the lifecycle proof.')

  // Negative seconds leave the app in the background for explicit state sampling and host-side waiting.
  await session.executeScript('mobile: backgroundApp', [{ seconds: -1 }])
  // budget-ok: Home-screen animation can finish after Appium acknowledges the command.
  const backgroundState = await Time.pollUntil(async () => {
    const state = await queryApplicationState(appId)
    if (state === 0 || state === 1) {
      requireBackground(state, 'The Appium background command did not leave the app running in background.')
    }
    return state === 2 || state === 3 ? state : undefined
  }, { intervalMs: 100, now, sleep, timeoutMs: FOREGROUND_WAIT_MS })
  requireBackground(backgroundState, 'The Appium background command did not leave the app running in background.')
  const backgroundObservedAtMs = now()

  await sleep(BACKGROUND_WAIT_MS)
  const backgroundAfterWait = await queryApplicationState(appId)
  requireBackground(backgroundAfterWait, 'The app stopped running in background before it could be resumed.')
  const backgroundWaitCompletedAtMs = now()
  if (
    !Number.isFinite(backgroundWaitCompletedAtMs)
    || backgroundWaitCompletedAtMs - backgroundObservedAtMs < BACKGROUND_WAIT_MS
  ) {
    return Errors.throwHostEnvironment('The native background interval was shorter than the required real-time wait.')
  }

  await session.activateApplication(appId)
  // budget-ok: one bounded Appium foreground transition on the already-owned session; a miss fails closed.
  const resumedState = await Time.pollUntil(async () => {
    const state = await queryApplicationState(appId)
    return state === 4 ? state : undefined
  }, { intervalMs: 100, now, sleep, timeoutMs: FOREGROUND_WAIT_MS })
  requireState(resumedState, 'The owned app did not return to foreground after activation.')
  const foregroundAfterResumeAtMs = now()
  if (
    !Number.isFinite(foregroundBeforeAtMs)
    || !Number.isFinite(backgroundObservedAtMs)
    || !Number.isFinite(foregroundAfterResumeAtMs)
    || foregroundBeforeAtMs > backgroundObservedAtMs
    || backgroundObservedAtMs > backgroundWaitCompletedAtMs
    || backgroundWaitCompletedAtMs > foregroundAfterResumeAtMs
  ) {
    return Errors.throwHostEnvironment('The native lifecycle timestamps were invalid or regressed.')
  }

  return {
    appId,
    backgroundObservedAtMs,
    backgroundState,
    backgroundWaitCompletedAtMs,
    foregroundAfterResumeAtMs,
    foregroundBeforeAtMs,
    foregroundState,
    sessionId: session.id,
  }
}

function requireBackground(state: AppiumApplicationState | undefined, message: string): asserts state is 2 | 3 {
  if (state !== 2 && state !== 3) {
    return Errors.throwHostEnvironment(message)
  }
}

function requireState(
  state: AppiumApplicationState | undefined,
  message: string,
): asserts state is 4 {
  if (state !== 4) {
    return Errors.throwHostEnvironment(message)
  }
}
