import type { TaoNavigationArguments, TaoPresentable } from './TR-navigation'
import type { Evaluable } from './TR-navigation-presentables'
import type { TaoResponseOccurrence } from './TR-TaoProps'

export type PresentableEntry = {
  arguments: TaoNavigationArguments
  instanceId: number
  presentable: TaoPresentable
}

export type ResponseOccurrenceState = TaoResponseOccurrence & {
  resolve(value: Evaluable): void
  settled: boolean
}

export type OverlayEntry = PresentableEntry & {
  response?: ResponseOccurrenceState
  /** A sheet is presented by the platform's modal host rather than as another overlay layer. */
  sheet?: boolean
}

export type Subscription = {
  snapshot(): number
  subscribe(listener: () => void): () => void
}
