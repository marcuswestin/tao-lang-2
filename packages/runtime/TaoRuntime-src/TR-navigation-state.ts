import type { TaoDialogue, TaoNavigationArguments, TaoPresentable } from './TR-navigation'
import type { Evaluable } from './TR-navigation-presentables'
import type { TaoDialogueOccurrence } from './TR-TaoProps'

export type PresentableEntry = {
  arguments: TaoNavigationArguments
  instanceId: number
  presentable: TaoPresentable
}

export type DialogueOccurrenceState = TaoDialogueOccurrence & {
  resolve(value: Evaluable): void
  settled: boolean
}

export type OverlayEntry = Omit<PresentableEntry, 'presentable'> & {
  dialogue?: DialogueOccurrenceState
  presentable: TaoPresentable | TaoDialogue
}

export type Subscription = {
  snapshot(): number
  subscribe(listener: () => void): () => void
}
