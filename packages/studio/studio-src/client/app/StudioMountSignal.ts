/** The mount signal: a cancelled product-host mount stops between awaits and unwinds as an AbortError. */
export const StudioMountSignal = {
  isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  },

  throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      const error = new Error('Tao Studio product host mount was cancelled.')
      error.name = 'AbortError'
      throw error
    }
  },
} as const
