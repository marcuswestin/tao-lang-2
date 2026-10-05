import React from 'react'
import { ActionBoundaryContext, MountedActionBoundary } from './TR-action-boundary-model'
import { createElement } from './TR-create-element'
import { TaoErrorBoundary } from './TR-error-containment'
import { actionFailurePublicMessage } from './TR-errors'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import { reactiveValue } from './TR-reactive-values'
import { readContext } from './TR-read-net'
import type { TaoProps } from './TR-TaoProps'

export { ActionBoundaryContext, MountedActionBoundary, type TaoActionFailureSink } from './TR-action-boundary-model'

/** Mount ownership and recovery stay outside the children replaced by a latched failure. */
export function MountedAppActionBoundary(props: {
  app: RuntimeAppDefinition
  __tao?: TaoProps
  children?: React.ReactNode
}): React.JSX.Element {
  const boundary = React.useMemo(() => new MountedActionBoundary(), [props.app])
  // Ownership exists before descendant layout/init actions, and is revoked at host disposal.
  React.useInsertionEffect(() => boundary.mount(), [boundary])
  React.useSyncExternalStore(boundary.subscribe, boundary.snapshot, boundary.snapshot)
  const appProps = { ...props.__tao, app: props.app }
  const handler = props.app.readNet?.error
  return createElement(
    ActionBoundaryContext.Provider,
    { value: boundary },
    createElement(TaoErrorBoundary, {
      app: props.app,
      boundaryId: `app:${props.app.declaration.canonicalIdentity?.canonical ?? props.app.definition.name}`,
      frame: { boundary: 'app', declaration: props.app.definition.name },
      stateKey: props.app.snapshot(),
      actionFailure: boundary.failure,
      actionBoundary: boundary,
      onActionRecovery: () => boundary.recover(),
      renderActionFailure: handler
        ? failure =>
          handler(
            { __tao: appProps },
            reactiveValue(Object.freeze({
              ...readContext('error'),
              Message: actionFailurePublicMessage(failure),
            })),
          )
        : undefined,
    }, props.children),
  )
}
