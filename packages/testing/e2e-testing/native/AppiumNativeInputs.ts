import { AppiumNoSuchElementError } from '@appium-driver'
import { HostControlError, type HostObservation, type HostSession, type HostTarget } from '@host-control'
import { Time } from '@shared'
import type { HostJourneySelection } from '../journey/HostJourney'

/** Input operations keep the authored selector and exact observed value at the host boundary. */
export async function enterNativeInput(
  session: HostSession,
  selector: string,
  target: string,
  value: string,
  selections: readonly HostJourneySelection[],
): Promise<void> {
  const selected = inputTarget(selector, target, selections)
  const observation = await Time.pollUntil(async () => {
    const found = await observeInput(session, selected)
    return found?.visible === true ? found : undefined
  }, { intervalMs: 100, timeoutMs: 10_000 })
  if (observation === undefined) {
    throw new HostControlError('assertion', `Tao journey could not enter ${selector} '${target}': input was not ready.`)
  }
  await session.perform({
    expectedRevision: session.descriptor().revision,
    kind: 'type',
    lease: session.descriptor().lease,
    observation,
    text: value,
  })
}

export async function assertNativeInputValue(
  session: HostSession,
  selector: string,
  target: string,
  value: string,
  selections: readonly HostJourneySelection[],
  sourcePath: string,
): Promise<void> {
  const selected = inputTarget(selector, target, selections)
  let latest: HostObservation | undefined
  const observation = await Time.pollUntil(async () => {
    latest = await observeInput(session, selected)
    return latest?.visible === true && latest.text === value ? latest : undefined
  }, { intervalMs: 100, timeoutMs: 10_000 })
  if (observation === undefined) {
    throw new HostControlError(
      'assertion',
      `Tao journey assertion at ${sourcePath}: expected input value '${value}'.`,
      {
        actual: latest?.text,
        expected: value,
      },
    )
  }
}

async function observeInput(session: HostSession, target: HostTarget): Promise<HostObservation | undefined> {
  try {
    return await session.observe({ expectedRevision: session.descriptor().revision, target })
  } catch (error) {
    if (
      error instanceof AppiumNoSuchElementError
      || (error instanceof HostControlError && error.code === 'assertion'
        && error.details?.['reason'] === 'element-not-found')
    ) {
      return undefined
    }
    throw error
  }
}

function inputTarget(selector: string, value: string, selections: readonly HostJourneySelection[]): HostTarget {
  if (selector !== 'tag' && selector !== 'label') {
    throw new HostControlError(
      'unsupported',
      `The native input journey requires a tag or label selector, received '${selector}'.`,
    )
  }
  // Tao tags belong to the input's layout wrapper. The editable descendant owns text entry
  // and its value; a wrapper observation can be visible while carrying no editable value.
  let target: HostTarget = selector === 'tag'
    ? { kind: 'scoped', scope: { kind: 'tag', value }, target: { kind: 'accessibility', role: 'textbox', name: '' } }
    : { kind: 'accessibility', role: 'textbox', name: value }
  for (const selection of selections.toReversed()) {
    target = { kind: 'scoped', scope: { kind: 'tag', occurrence: selection.index, value: selection.tag }, target }
  }
  return target
}
