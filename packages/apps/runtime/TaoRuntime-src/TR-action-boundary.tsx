import React from 'react'
import { createElement } from './TR-create-element'
import { TaoErrorBoundary } from './TR-error-containment'
import { actionFailurePublicMessage, type TaoActionFailureReport } from './TR-errors'
import { runtimeRevisionStore } from './TR-listeners'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import { reactiveValue } from './TR-reactive-values'
import { readContext } from './TR-read-net'
import type { TaoProps } from './TR-TaoProps'

export type TaoActionFailureSink = (failure: TaoActionFailureReport) => boolean

/** One host occurrence owns its failure latch; app definitions may be mounted more than once. */
export class MountedActionBoundary {
  private readonly changes = runtimeRevisionStore()
  private generation = 0
  private mountGeneration = 0
  private active = false
  failure: TaoActionFailureReport | undefined
  readonly subscribe = this.changes.subscribe
  readonly snapshot = this.changes.snapshot

  mount(): () => void {
    const mount = ++this.mountGeneration
    this.generation += 1
    this.active = true
    return () => {
      if (this.mountGeneration === mount) {
        this.active = false
        this.generation += 1
      }
    }
  }

  capture(): TaoActionFailureSink | undefined {
    if (!this.active) {
      return undefined
    }
    const generation = this.generation
    return failure => {
      if (!this.active || this.generation !== generation) {
        return false
      }
      if (!this.failure) {
        this.failure = failure
        this.changes.changed()
      }
      return true
    }
  }

  recover(): void {
    this.generation += 1
    this.failure = undefined
    this.changes.changed()
  }
}

export const ActionBoundaryContext = React.createContext<MountedActionBoundary | undefined>(undefined)

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
