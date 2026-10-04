export type RowEvent = {
  payload: { ownerId?: unknown } | null
}

type LiveConnection = { disconnect(): Promise<void> }

export function watchOwnedRows(
  userId: string,
  refresh: () => Promise<unknown> | void,
  connect: (
    onEvent: (event: RowEvent) => void,
    onOpen: () => void,
  ) => Promise<LiveConnection>,
  pollIntervalMs = 30_000,
  reportError: (error: unknown) => void = () => {},
): { stop(): Promise<void> } {
  let closed = false
  let stopPromise: Promise<void> | undefined
  let live: LiveConnection | undefined
  let connectedAt = 0
  let connecting: Promise<void> | undefined
  let renewing: Promise<void> | undefined
  let refreshing = false
  let refreshRequested = false
  let reportedFailure = false

  function refreshSafely(): void {
    if (closed) {
      return
    }
    if (refreshing) {
      refreshRequested = true
      return
    }
    refreshing = true
    void Promise.resolve()
      .then(() => closed ? undefined : refresh())
      .catch(() => undefined)
      .finally(() => {
        refreshing = false
        if (refreshRequested) {
          refreshRequested = false
          refreshSafely()
        }
      })
  }

  function onEvent(event: RowEvent): void {
    // The table-row channel covers creates, updates, and deletes. A deleted-row
    // payload may omit ownerId, so refresh the owner-filtered list in that case.
    if (closed || (event.payload?.ownerId !== undefined && event.payload.ownerId !== userId)) {
      return
    }
    refreshSafely()
  }

  function ensureConnected(): void {
    if (closed || live || connecting || renewing) {
      return
    }
    connecting = connect(onEvent, refreshSafely)
      .then(async connection => {
        if (closed) {
          await connection.disconnect()
        } else {
          live = connection
          connectedAt = Date.now()
          reportedFailure = false
          refreshSafely()
        }
      })
      .catch(error => {
        if (!closed && !reportedFailure) {
          reportError(error)
          reportedFailure = true
        }
      })
      .finally(() => {
        connecting = undefined
      })
  }

  const timer = setInterval(() => {
    refreshSafely()
    // Appwrite JWTs expire. Recreate the socket with a fresh token before expiry.
    if (live && Date.now() - connectedAt >= 45 * 60_000 && !renewing) {
      const previous = live
      live = undefined
      renewing = previous.disconnect().catch(() => undefined).finally(() => {
        renewing = undefined
        ensureConnected()
      })
    } else {
      ensureConnected()
    }
  }, pollIntervalMs)
  ensureConnected()

  return {
    stop() {
      return stopPromise ??= (async () => {
        closed = true
        clearInterval(timer)
        await connecting
        await renewing
        await live?.disconnect()
        live = undefined
      })()
    },
  }
}
