import { Platform } from '@shared'

/** Keep repeated terminal signals from interrupting an in-progress owned teardown. */
export function installDevLoopStopSignals(
  stop: (exitCode: number) => Promise<unknown>,
  onFailure: (error: unknown) => void,
  onSignal = Platform.onProcessSignal,
): () => void {
  let stopping: Promise<unknown> | undefined
  const releases = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal, index) =>
    onSignal(signal, () => {
      if (stopping !== undefined) {
        return
      }
      // Schedule before calling stop: a reentrant signal must see the same cleanup promise.
      stopping = Promise.resolve().then(() => stop([130, 143, 129][index]!))
      void stopping.catch(onFailure)
    })
  )
  return () => releases.forEach(release => release())
}
