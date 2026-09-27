import { afterAll, beforeEach } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Nothing a device runs keeps a process alive, but journeys run on Node, where anything left open
// holds the Jest worker after its journeys pass. Provider SDKs do leave things open: InstantDB's
// client starts an interval and a BroadcastChannel that its shutdown never closes.

// React Native has no BroadcastChannel; Jest's environment inherits Node's.
delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel

// Every journey starts on a device nobody has used, so what a provider SDK stored in one journey,
// such as a signed-in InstantDB user, is gone before the next.
beforeEach(() => AsyncStorage.clear())

// Once a file's journeys finish the device is off: every timer they left pending is cancelled, and
// any scheduled later cannot hold the worker. A timer leaves the set when it fires or is cleared.
const pending = new Set<unknown>()
let finished = false

function track<Timer extends ReturnType<typeof setTimeout>>(timer: Timer): Timer {
  if (finished) {
    timer.unref()
  } else {
    pending.add(timer)
  }
  return timer
}

const platform = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
}
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  const timer = track(platform.setTimeout(
    (...fired: unknown[]) => {
      pending.delete(timer)
      callback(...fired)
    },
    delay,
    ...args,
  ))
  return timer
}) as typeof setTimeout
globalThis.setInterval =
  ((...args: Parameters<typeof setInterval>) => track(platform.setInterval(...args))) as typeof setInterval
globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
  pending.delete(timer)
  platform.clearTimeout(timer)
}) as typeof clearTimeout
globalThis.clearInterval = ((timer?: Parameters<typeof clearInterval>[0]) => {
  pending.delete(timer)
  platform.clearInterval(timer)
}) as typeof clearInterval

afterAll(() => {
  finished = true
  for (const timer of pending) {
    platform.clearTimeout(timer as Parameters<typeof clearTimeout>[0])
  }
  pending.clear()
})
