type StudioBackgroundValidationSchedulerOptions = {
  cancelTimer: (handle: unknown) => void
  idleDelayMs?: number
  maxDelayMs?: number
  onRelease: (revision: number) => void
  setTimer: (callback: () => void, delayMs: number) => unknown
}

export function createStudioBackgroundValidationScheduler({
  cancelTimer,
  idleDelayMs = 1_000,
  maxDelayMs = 10_000,
  onRelease,
  setTimer,
}: StudioBackgroundValidationSchedulerOptions) {
  let pendingRevision: number | undefined
  let pendingAttempt: object | undefined
  let paintedRevision: number | undefined
  let idleTimer: unknown
  let maximumTimer: unknown
  let hasIdleTimer = false
  let hasMaximumTimer = false
  let closed = false

  function cancelIdleTimer() {
    if (!hasIdleTimer) {
      return
    }
    const timer = idleTimer
    idleTimer = undefined
    hasIdleTimer = false
    cancelTimer(timer)
  }

  function cancelMaximumTimer() {
    if (!hasMaximumTimer) {
      return
    }
    const timer = maximumTimer
    maximumTimer = undefined
    hasMaximumTimer = false
    cancelTimer(timer)
  }

  function clearPending() {
    pendingAttempt = undefined
    paintedRevision = undefined
    cancelIdleTimer()
    cancelMaximumTimer()
    pendingRevision = undefined
  }

  function releaseAttempt(attempt: object) {
    if (closed || pendingAttempt !== attempt || pendingRevision === undefined) {
      return
    }
    const revision = pendingRevision
    clearPending()
    onRelease(revision)
  }

  function release() {
    if (closed || pendingAttempt === undefined) {
      return
    }
    releaseAttempt(pendingAttempt)
  }

  function request(revision: number) {
    if (closed || !Number.isSafeInteger(revision) || revision < 1) {
      return
    }
    if (pendingAttempt !== undefined && pendingRevision === revision) {
      return
    }
    cancelIdleTimer()
    paintedRevision = undefined
    pendingRevision = revision
    if (pendingAttempt !== undefined) {
      return
    }
    const attempt = {}
    pendingAttempt = attempt
    hasMaximumTimer = true
    maximumTimer = setTimer(() => {
      if (pendingAttempt !== attempt) {
        return
      }
      maximumTimer = undefined
      hasMaximumTimer = false
      releaseAttempt(attempt)
    }, maxDelayMs)
  }

  function painted(revision: number, accepted = true) {
    const attempt = pendingAttempt
    if (closed || attempt === undefined || pendingRevision !== revision) {
      return
    }
    if (!accepted) {
      releaseAttempt(attempt)
      return
    }
    if (paintedRevision === revision) {
      return
    }
    cancelIdleTimer()
    paintedRevision = revision
    hasIdleTimer = true
    idleTimer = setTimer(() => {
      if (pendingAttempt !== attempt || pendingRevision !== revision) {
        return
      }
      idleTimer = undefined
      hasIdleTimer = false
      releaseAttempt(attempt)
    }, idleDelayMs)
  }

  function complete() {
    if (closed) {
      return
    }
    clearPending()
  }

  function close() {
    if (closed) {
      return
    }
    closed = true
    clearPending()
  }

  return { request, painted, release, complete, close }
}
