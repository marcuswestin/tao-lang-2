/**
 * Deterministic effect sessions shared by the shipped runtime and host controls. It lives in the
 * runtime package because that package ships the implementation tree; @shared re-exports this
 * host-neutral surface instead of carrying a second copy.
 */

const MAX_ADVANCE_MS = 86_400_000
const MAX_RUN_ID_LENGTH = 128
const MAX_SEED = 0xffff_ffff
const MAX_EPOCH_MS = 8_640_000_000_000_000
const RANDOM_DIVISOR = 0x1_0000_0000

export type Clock = Readonly<{
  begin: (epochMs: number) => void
  now: () => number
  advance: (advanceMs: number) => void
  end: () => void
}>

export type SessionConfig = Readonly<{
  runId: string
  seed: number
  epochMs: number
}>

export type SessionSnapshot = Readonly<{
  runId: string
  seed: number
  epochMs: number
  /** Wall-clock time from the supplied clock. */
  wallMs: number
  /** Controlled elapsed time, which begins at zero regardless of epochMs. */
  monotonicMs: number
  /** Present after an explicit control command records its advance. */
  lastControlAdvanceMs?: number
}>

export type Session = Readonly<{
  config: SessionConfig
  snapshot: () => SessionSnapshot
  advance: (runId: string, advanceMs: number) => SessionSnapshot
  /** Records control receipt before clock subscribers observe the advance. */
  advanceControl: (runId: string, advanceMs: number) => SessionSnapshot
  chooseRandom: (runId: string, upperExclusive: number) => number
  dispose: () => void
}>

/** Invalid effect-control values use the platform's dependency-free range error. */
export const InputError = RangeError

/**
 * Creates a deterministic session against an injected clock. The caller may own several sessions
 * in one process as long as their clocks are distinct; platform adapters decide realm exclusivity.
 */
export function createSession(config: SessionConfig, clock: Clock): Session {
  const sessionConfig = Object.freeze({ ...config })
  validateConfig(sessionConfig)
  clock.begin(sessionConfig.epochMs)
  let randomState = sessionConfig.seed
  let lastControlAdvanceMs: number | undefined
  let disposed = false

  const verifyActiveRun = (runId: string): void => {
    if (runId !== sessionConfig.runId) {
      failInput(`Effect control run '${runId}' does not match active run '${sessionConfig.runId}'.`)
    }
  }

  const snapshot = (): SessionSnapshot => {
    verifyNotDisposed(disposed)
    const wallMs = clock.now()
    return {
      runId: sessionConfig.runId,
      seed: sessionConfig.seed,
      epochMs: sessionConfig.epochMs,
      wallMs,
      monotonicMs: wallMs - sessionConfig.epochMs,
      ...(lastControlAdvanceMs === undefined ? {} : { lastControlAdvanceMs }),
    }
  }

  const moveClock = (runId: string, advanceMs: number, control: boolean): SessionSnapshot => {
    verifyNotDisposed(disposed)
    verifyActiveRun(runId)
    validateAdvance(advanceMs)
    if (control) {
      lastControlAdvanceMs = advanceMs
    }
    clock.advance(advanceMs)
    return snapshot()
  }

  const chooseRandom = (runId: string, upperExclusive: number): number => {
    verifyNotDisposed(disposed)
    verifyActiveRun(runId)
    validateUpperExclusive(upperExclusive)
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
    return Math.floor((randomState / RANDOM_DIVISOR) * upperExclusive)
  }

  return Object.freeze({
    config: sessionConfig,
    snapshot,
    advance: (runId, advanceMs) => moveClock(runId, advanceMs, false),
    advanceControl: (runId, advanceMs) => moveClock(runId, advanceMs, true),
    chooseRandom,
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      clock.end()
    },
  })
}

export function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.length > MAX_RUN_ID_LENGTH) {
    failInput(`Effect runId '${runId}' must use 1-${MAX_RUN_ID_LENGTH} letters, digits, '.', '_', or '-'.`)
  }
}

export function validateAdvance(advanceMs: number): void {
  if (!Number.isSafeInteger(advanceMs) || advanceMs < 0 || advanceMs > MAX_ADVANCE_MS) {
    failInput(`Effect advanceMs must be an integer from 0 to ${MAX_ADVANCE_MS}, received '${advanceMs}'.`)
  }
}

function validateConfig(config: SessionConfig): void {
  validateRunId(config.runId)
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > MAX_SEED) {
    failInput(`Effect seed must be an unsigned 32-bit integer, received '${config.seed}'.`)
  }
  if (!Number.isSafeInteger(config.epochMs) || config.epochMs < 0 || config.epochMs > MAX_EPOCH_MS) {
    failInput(`Effect epochMs must be a valid Unix-millisecond instant, received '${config.epochMs}'.`)
  }
}

function validateUpperExclusive(upperExclusive: number): void {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive < 1 || upperExclusive > RANDOM_DIVISOR) {
    failInput(`Effect upperExclusive must be an integer from 1 to ${RANDOM_DIVISOR}, received '${upperExclusive}'.`)
  }
}

function verifyNotDisposed(disposed: boolean): void {
  if (disposed) {
    failInput('The effect session has already been disposed.')
  }
}

function failInput(message: string): never {
  throw new InputError(message)
}
