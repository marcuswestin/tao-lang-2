/** sleep waits for the specified number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** nowMs returns a monotonic millisecond reading, for measuring how long work took. */
export function nowMs(): number {
  return performance.now()
}
