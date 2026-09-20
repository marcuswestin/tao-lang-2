type Snapshot = Readonly<{
  runId: string
  seed: number
  wallMs: number
  monotonicMs: number
  lastControlAdvanceMs?: number
}>

type HostTestControl = Readonly<{
  snapshot: () => Snapshot
  chooseRandom: (request: Readonly<{ runId: string; upperExclusive: number }>) => number
}>

type ClockworkGlobal = typeof globalThis & { __TAO_HOST_TEST_CONTROL__?: unknown }

const colors = ['brass', 'copper', 'steel', 'verdigris'] as const

export function ReadClockworkEnvironment(_tick: number): string {
  const snapshot = control()?.snapshot()
  return snapshot === undefined
    ? 'Host control unavailable'
    : `Host ready: run ${snapshot.runId} · seed ${snapshot.seed} · wall ${snapshot.wallMs} · monotonic ${snapshot.monotonicMs}`
}

export function ReadClockworkControlReceipt(_tick: number): string {
  const snapshot = control()?.snapshot()
  return snapshot?.lastControlAdvanceMs === undefined
    ? 'Control pending'
    : `Control received: advance ${snapshot.lastControlAdvanceMs}ms`
}

export function ClockworkChoice(): string {
  const host = control()
  if (host === undefined) {
    return 'unavailable'
  }
  const snapshot = host.snapshot()
  return colors[host.chooseRandom({ runId: snapshot.runId, upperExclusive: colors.length })] ?? 'unavailable'
}

function control(): HostTestControl | undefined {
  const candidate = (globalThis as ClockworkGlobal).__TAO_HOST_TEST_CONTROL__
  return isHostTestControl(candidate) ? candidate : undefined
}

function isHostTestControl(candidate: unknown): candidate is HostTestControl {
  return typeof candidate === 'object'
    && candidate !== null
    && typeof (candidate as { snapshot?: unknown }).snapshot === 'function'
    && typeof (candidate as { chooseRandom?: unknown }).chooseRandom === 'function'
}
