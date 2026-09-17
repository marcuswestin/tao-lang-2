import React from 'react'
import { captureArguments, TaoErrorBoundary } from './TR-error-containment'
import type {
  TaoNavigationArguments,
  TaoPresentableDefinition,
} from './TR-navigation'
import type { RuntimeHostReadChannel } from './TR-navigation-host-slots'
import type { TaoProps } from './TR-TaoProps'
import { TaoPropsControls } from './TR-TaoProps'

export type { Evaluable } from './TR-action-values'

/** RuntimePresentable is the evaluable view descriptor used by every presentation and ask site. */
export class RuntimePresentable {
  readonly kind = 'view'

  constructor(
    readonly definition: TaoPresentableDefinition,
    readonly boundArguments?: TaoNavigationArguments,
  ) {}

  get name(): string {
    return this.definition.name
  }

  evaluate(): this {
    return this
  }

  /** bind returns a descriptor with live arguments without registering a second view identity. */
  bind(arguments_: TaoNavigationArguments): RuntimePresentable {
    return new RuntimePresentable(this.definition, arguments_)
  }

  render(
    arguments_: TaoNavigationArguments,
    taoProps?: TaoProps,
    host?: RuntimeHostReadChannel,
  ): React.ReactNode {
    const effectiveArguments = this.boundArguments
      ? { ...this.boundArguments, ...arguments_ }
      : arguments_
    let capturedArguments: ReturnType<typeof captureArguments> | undefined
    const diagnosticsArguments = () =>
      capturedArguments ??= captureArguments(Object.fromEntries(
        Object.entries(effectiveArguments).map(([name, value]) => [
          name,
          value.evaluate().jsValue,
        ]),
      ))
    const identity = this.definition.identity?.canonical ?? this.definition.name
    return React.createElement(
      TaoErrorBoundary,
      {
        app: TaoPropsControls.appInChain(taoProps),
        boundaryId: `screen:${identity}`,
        frame: () => ({
          arguments: diagnosticsArguments(),
          boundary: 'screen' as const,
          declaration: this.definition.name,
          ...(this.definition.source ? { source: this.definition.source } : {}),
        }),
        stateKey: () => JSON.stringify([taoProps?.navigation?.snapshot(), diagnosticsArguments()]),
      },
      React.createElement(PresentableContent, {
        arguments_: effectiveArguments,
        definition: this.definition,
        host,
        taoProps,
      }),
    )
  }
}

function PresentableContent(props: {
  arguments_: TaoNavigationArguments
  definition: TaoPresentableDefinition
  host?: RuntimeHostReadChannel
  taoProps?: TaoProps
}): React.ReactNode {
  return props.definition.render(props.arguments_, props.taoProps, props.host)
}

/** RuntimeNavigationResult supplies the same evaluable shape as TR.Value without a runtime cycle. */
export class RuntimeNavigationResult {
  constructor(readonly jsValue: unknown) {}

  evaluate(): this {
    return this
  }
}
