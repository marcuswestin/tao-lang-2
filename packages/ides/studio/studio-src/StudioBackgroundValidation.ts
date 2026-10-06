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
    cancelIdleTimer()
    cancelMaximumTimer()
    pendingRevision = undefined
  }

  function release() {
    if (closed || pendingRevision === undefined) {
      return
    }
    const revision = pendingRevision
    clearPending()
    onRelease(revision)
  }

  function request(revision: number) {
    if (closed) {
      return
    }
    pendingRevision = revision
    cancelIdleTimer()
    if (hasMaximumTimer) {
      return
    }
    hasMaximumTimer = true
    maximumTimer = setTimer(() => {
      maximumTimer = undefined
      hasMaximumTimer = false
      release()
    }, maxDelayMs)
  }

  function painted(revision: number, accepted = true) {
    if (closed || pendingRevision !== revision) {
      return
    }
    if (!accepted) {
      release()
      return
    }
    cancelIdleTimer()
    hasIdleTimer = true
    idleTimer = setTimer(() => {
      idleTimer = undefined
      hasIdleTimer = false
      if (pendingRevision === revision) {
        release()
      }
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
