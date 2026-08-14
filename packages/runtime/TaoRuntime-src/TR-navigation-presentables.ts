import type React from 'react'
import type {
  TaoDialogueDefinition,
  TaoNavigationArguments,
  TaoPresentableDefinition,
} from './TR-navigation'
import type { TaoProps } from './TR-TaoProps'

export type Evaluable = {
  evaluate(): { jsValue: unknown }
}

/** RuntimePresentable is an evaluable UI descriptor used by aliases and configured navs. */
export class RuntimePresentable {
  readonly kind = 'ui'

  constructor(readonly definition: TaoPresentableDefinition) {}

  get name(): string {
    return this.definition.name
  }

  evaluate(): this {
    return this
  }

  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode {
    return this.definition.render(arguments_, taoProps)
  }
}

/** RuntimeDialogue is a declaration descriptor; each ask creates separate mutable occurrence state. */
export class RuntimeDialogue {
  readonly kind = 'dialogue'

  constructor(readonly definition: TaoDialogueDefinition) {}

  get name(): string {
    return this.definition.name
  }

  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode {
    return this.definition.render(arguments_, taoProps)
  }
}

/** RuntimeNavigationResult supplies the same evaluable shape as TR.Value without a runtime cycle. */
export class RuntimeNavigationResult {
  constructor(readonly jsValue: unknown) {}

  evaluate(): this {
    return this
  }
}
