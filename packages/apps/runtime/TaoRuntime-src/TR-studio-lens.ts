import React from 'react'
import { createElement } from './TR-create-element'
import type { TaoStudioIdentity } from './TR-TaoProps'

/** Studio Lens records provenance and timing, never state or provider values. */
export type TaoStudioLensCause =
  | Readonly<{ kind: 'data'; entity: string; providerWaitMs?: number; schema: string }>
  | Readonly<{ kind: 'state' }>

export type TaoStudioLensRenderSample = Readonly<{
  actualDurationMs: number
  causes: readonly TaoStudioLensCause[]
  identity: TaoStudioIdentity
  instanceId: string
  phase: 'mount' | 'update'
  resolvedStyle?: Readonly<Record<string, string>>
  timestamp: number
}>

export type TaoStudioLensScope = Readonly<{
  mark(cause: TaoStudioLensCause): void
  pending(): readonly TaoStudioLensCause[]
}>

const PublishContext = React.createContext<((sample: TaoStudioLensRenderSample) => void) | undefined>(undefined)
const ScopeContext = React.createContext<TaoStudioLensScope | undefined>(undefined)
const maximumPendingCauses = 8

/** The preview owns the sink; a normal app pays no profiling or transport cost. */
export function StudioLensHost(props: {
  children?: React.ReactNode
  publish: (sample: TaoStudioLensRenderSample) => void
}): React.ReactElement {
  return createElement(PublishContext.Provider, { value: props.publish }, props.children)
}

/** One Studio-only render occurrence, including repeated instances of the same source span. */
export function StudioLensRender(props: {
  children?: React.ReactNode
  identity: TaoStudioIdentity
}): React.ReactElement {
  const publish = React.useContext(PublishContext)
  const parentScope = React.useContext(ScopeContext)
  const instanceId = React.useId()
  const pending = React.useRef<TaoStudioLensCause[]>([])
  const scope = React.useMemo<TaoStudioLensScope>(() => ({
    mark(cause) {
      if (pending.current.length === maximumPendingCauses) {
        pending.current.shift()
      }
      pending.current.push(cause)
    },
    pending() {
      return [...(parentScope?.pending() ?? []), ...pending.current].slice(-maximumPendingCauses)
    },
  }), [parentScope])
  const onRender = React.useCallback<React.ProfilerOnRenderCallback>((_id, phase, actualDuration) => {
    if (publish === undefined || !Number.isFinite(actualDuration) || actualDuration < 0) {
      pending.current.length = 0
      return
    }
    const causes = scope.pending()
    pending.current.length = 0
    publish({
      actualDurationMs: actualDuration,
      causes,
      identity: props.identity,
      instanceId,
      phase: phase === 'mount' ? 'mount' : 'update',
      timestamp: Date.now(),
    })
  }, [instanceId, props.identity, publish, scope])
  if (publish === undefined) {
    return createElement(React.Fragment, null, props.children)
  }
  return createElement(
    ScopeContext.Provider,
    { value: scope },
    createElement(React.Profiler, { id: instanceId, onRender }, props.children),
  )
}

/** Hooks that own a Tao read use the nearest rendered occurrence as its causal scope. */
export function useStudioLensScope(): TaoStudioLensScope | undefined {
  return React.useContext(ScopeContext)
}
