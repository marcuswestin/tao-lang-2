import type { TaoNavigationArguments, TaoNavigationValue, TaoPresentable } from './TR-navigation'
import type { RuntimeHostReadChannel } from './TR-navigation-host-slots'
import type { Evaluable } from './TR-navigation-presentables'
import type { TaoResponseOccurrence } from './TR-TaoProps'

export type PresentableEntry<
  PresentableT extends TaoPresentable | TaoNavigationValue = TaoPresentable | TaoNavigationValue,
> = {
  arguments: TaoNavigationArguments
  instanceId: number
  presentable: PresentableT
  host?: RuntimeHostReadChannel
}

export type ResponseOccurrenceState = TaoResponseOccurrence & {
  resolve(value: Evaluable): void
  settled: boolean
}

export type OverlayEntry = PresentableEntry<TaoPresentable> & {
  response?: ResponseOccurrenceState
  /** A sheet is presented by the platform's modal host rather than as another overlay layer. */
  sheet?: boolean
}

export type Subscription = {
  snapshot(): number
  subscribe(listener: () => void): () => void
}
