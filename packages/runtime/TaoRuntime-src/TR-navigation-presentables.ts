import type React from 'react'
import type {
  TaoNavigationArguments,
  TaoPresentableDefinition,
} from './TR-navigation'
import type { TaoProps } from './TR-TaoProps'

export type Evaluable = {
  evaluate(): { jsValue: unknown }
}

/** RuntimePresentable is the evaluable view descriptor used by every presentation and ask site. */
export class RuntimePresentable {
  readonly kind = 'view'

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

/** RuntimeNavigationResult supplies the same evaluable shape as TR.Value without a runtime cycle. */
export class RuntimeNavigationResult {
  constructor(readonly jsValue: unknown) {}

  evaluate(): this {
    return this
  }
}
