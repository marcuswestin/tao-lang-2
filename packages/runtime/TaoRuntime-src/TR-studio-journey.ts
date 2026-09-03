import { RuntimeAssert } from './TR-assert'

export type TaoJourneySelector = 'label' | 'placeholder' | 'tag' | 'text'

export type TaoJourneyStep =
  | Readonly<{ kind: 'advance'; milliseconds: number }>
  | Readonly<{ kind: 'focus'; tag: string }>
  | Readonly<{
    kind: 'hover' | 'pressDown' | 'pressUp'
    selector: TaoJourneySelector
    target: string
  }>

export type TaoJourneyEvent = 'focus' | 'hover' | 'pressDown' | 'pressUp'

export type TaoJourneyAdapter<Target> = Readonly<{
  advance(milliseconds: number): void | Promise<void>
  dispatch(target: Target, event: TaoJourneyEvent): void | Promise<void>
  find(selector: TaoJourneySelector, target: string): Target
  settle(): void | Promise<void>
}>

export type TaoJourneyReplayGate = Readonly<{
  shouldReplay(revision: string): boolean
}>

/** createTaoJourneyReplayGate admits a journey once per mounted cell revision. */
export function createTaoJourneyReplayGate(): TaoJourneyReplayGate {
  let replayedRevision: string | undefined
  return {
    shouldReplay(revision) {
      if (replayedRevision === revision) {
        return false
      }
      replayedRevision = revision
      return true
    },
  }
}

/** replayTaoJourney drives the same ordered step IR in Studio and the Tao test harness. */
export async function replayTaoJourney<Target>(
  steps: readonly TaoJourneyStep[],
  adapter: TaoJourneyAdapter<Target>,
): Promise<void> {
  for (const step of steps) {
    await replayTaoJourneyStep(step, adapter)
    await adapter.settle()
  }
}

/** replayTaoJourneyStep applies one already-validated test-shaped operation through a host adapter. */
export async function replayTaoJourneyStep<Target>(
  step: TaoJourneyStep,
  adapter: TaoJourneyAdapter<Target>,
): Promise<void> {
  if (step.kind === 'advance') {
    RuntimeAssert.input(
      Number.isSafeInteger(step.milliseconds) && step.milliseconds >= 0,
      'A Tao journey can only advance by a non-negative whole number of milliseconds.',
      { milliseconds: step.milliseconds },
    )
    await adapter.advance(step.milliseconds)
    return
  }
  if (step.kind === 'focus') {
    await adapter.dispatch(adapter.find('tag', step.tag), 'focus')
    return
  }
  await adapter.dispatch(adapter.find(step.selector, step.target), step.kind)
}
