import { RuntimeAssert } from './TR-assert'
import RuntimeSwitch from './TR-switch'

export type TaoJourneySelector = 'label' | 'placeholder' | 'tag' | 'text'

export type TaoJourneyStep =
  | Readonly<{ kind: 'advance'; milliseconds: number }>
  | Readonly<{ kind: 'focus'; tag: string }>
  | Readonly<{
    kind: 'hover' | 'press' | 'pressDown' | 'pressUp' | 'submit'
    selector: TaoJourneySelector
    target: string
  }>
  | Readonly<{ kind: 'enter'; selector: TaoJourneySelector; target: string; value: string }>
  | Readonly<{ kind: 'select'; tag: string; index: number; steps: readonly TaoJourneyStep[] }>

export type TaoJourneyEvent = 'enter' | 'focus' | 'hover' | 'press' | 'pressDown' | 'pressUp' | 'submit'

export type TaoJourneyEventAdapter<Target> = Readonly<{
  dispatch(target: Target, event: TaoJourneyEvent, value?: string): void | Promise<void>
  find(selector: TaoJourneySelector, target: string, scope?: Target): Target | Promise<Target>
}>

export type TaoJourneyAdapter<Target> =
  & TaoJourneyEventAdapter<Target>
  & Readonly<{
    advance(milliseconds: number): void | Promise<void>
    select(tag: string, index: number, scope?: Target): Target | Promise<Target>
    settle(): void | Promise<void>
  }>

/** A missing interaction target gets this long to appear before its journey step fails. */
export const taoJourneyTargetTimeoutMs = 1_000

const taoJourneyTargetPollIntervalMs = 16

/** waitForTaoJourneyTarget retries only absence; callers remain responsible for rejecting ambiguity immediately. */
export async function waitForTaoJourneyTarget<Target>(
  find: () => Target | undefined,
  timeoutMs = taoJourneyTargetTimeoutMs,
  signal?: AbortSignal,
): Promise<Target | undefined> {
  RuntimeAssert.input(
    Number.isFinite(timeoutMs) && timeoutMs >= 0,
    'A Tao journey target timeout must be a non-negative number of milliseconds.',
    { timeoutMs },
  )
  const deadline = Date.now() + timeoutMs
  while (true) {
    RuntimeAssert.input(signal?.aborted !== true, 'The Tao journey target wait was superseded before it finished.')
    const target = find()
    if (target !== undefined) {
      return target
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return undefined
    }
    await waitForJourneyPoll(Math.min(taoJourneyTargetPollIntervalMs, remaining), signal)
  }
}

/** waitForJourneyPoll clears its timer when a replacement replay aborts this acquisition. */
function waitForJourneyPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, milliseconds)
  })
}

export type TaoJourneyReplayGate = Readonly<{
  beginReplay(revision: string): boolean
  completeReplay(revision: string): void
  failReplay(revision: string): void
}>

/** createTaoJourneyReplayGate admits one attempt and records a revision only after successful replay. */
export function createTaoJourneyReplayGate(): TaoJourneyReplayGate {
  let activeRevision: string | undefined
  let replayedRevision: string | undefined
  return {
    beginReplay(revision) {
      if (activeRevision === revision || replayedRevision === revision) {
        return false
      }
      activeRevision = revision
      return true
    },
    completeReplay(revision) {
      if (activeRevision === revision) {
        replayedRevision = revision
        activeRevision = undefined
      }
    },
    failReplay(revision) {
      if (activeRevision === revision) {
        activeRevision = undefined
      }
    },
  }
}

/** replayTaoJourney drives the same ordered step IR in Studio and the Tao test harness. */
export async function replayTaoJourney<Target>(
  steps: readonly TaoJourneyStep[],
  adapter: TaoJourneyAdapter<Target>,
): Promise<void> {
  await replayTaoJourneySteps(steps, adapter)
}

async function replayTaoJourneySteps<Target>(
  steps: readonly TaoJourneyStep[],
  adapter: TaoJourneyAdapter<Target>,
  scope?: () => Target | Promise<Target>,
): Promise<void> {
  for (const step of steps) {
    await replayTaoJourneyStep(step, adapter, scope)
    await adapter.settle()
  }
}

/** replayTaoJourneyStep applies one already-validated test-shaped operation through a host adapter. */
async function replayTaoJourneyStep<Target>(
  step: TaoJourneyStep,
  adapter: TaoJourneyAdapter<Target>,
  scope?: () => Target | Promise<Target>,
): Promise<void> {
  /** Every step but `advance` and `select` is one event against one found target. */
  const event = async (eventStep: Exclude<TaoJourneyStep, { kind: 'advance' | 'select' }>): Promise<void> => {
    await replayTaoJourneyEventStep(eventStep, adapter, scope ? await scope() : undefined)
  }
  await RuntimeSwitch.kind<TaoJourneyStep, Promise<void>>(step, {
    advance: async advance => {
      RuntimeAssert.input(
        Number.isFinite(advance.milliseconds) && advance.milliseconds >= 0,
        'A Tao journey can only advance by a non-negative number of milliseconds.',
        { milliseconds: advance.milliseconds },
      )
      await adapter.advance(advance.milliseconds)
    },
    enter: event,
    focus: event,
    hover: event,
    press: event,
    pressDown: event,
    pressUp: event,
    select: async selection => {
      RuntimeAssert.input(
        Number.isSafeInteger(selection.index) && selection.index > 0,
        'A Tao journey can only select a positive whole-numbered row.',
        { index: selection.index, tag: selection.tag },
      )
      await replayTaoJourneySteps(
        selection.steps,
        adapter,
        async () => await adapter.select(selection.tag, selection.index, scope ? await scope() : undefined),
      )
    },
    submit: event,
  })
}

/** replayTaoJourneyEventStep applies one event-only step without exposing the clock adapter surface. */
export async function replayTaoJourneyEventStep<Target>(
  step: Exclude<TaoJourneyStep, { kind: 'advance' | 'select' }>,
  adapter: TaoJourneyEventAdapter<Target>,
  scope?: Target,
): Promise<void> {
  if (step.kind === 'focus') {
    await adapter.dispatch(await adapter.find('tag', step.tag, scope), 'focus')
    return
  }
  await adapter.dispatch(
    await adapter.find(step.selector, step.target, scope),
    step.kind,
    step.kind === 'enter' ? step.value : undefined,
  )
}
