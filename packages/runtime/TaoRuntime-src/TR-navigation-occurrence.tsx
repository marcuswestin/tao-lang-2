import React from 'react'
import { createElement } from './TR-create-element'
import { UserInputError } from './TR-errors'
import type {
  TaoConfiguredNavigation,
  TaoNavigationInput,
  TaoNavigationValue,
  TaoPresentable,
  TaoRuntimeApp,
} from './TR-navigation'
import { isConfiguredNavigation, mountConfiguredNavigation } from './TR-navigation-configuration'
import { isEvaluable, isNavigation, isPresentable, renderPresentable } from './TR-navigation-values'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { Views } from './TR-views'

/**
 * NavigationOccurrence renders a value a view named at a render site: a nav declaration, or a
 * view-, scene-, or nav-typed parameter. A view value renders as an ordinary occurrence, taking
 * this site's layout clause and tag. A nav value mounts once on the nearest enclosing navigation
 * occurrence and keeps that mount across covers and returns, so its history lives where it was
 * mounted; the enclosing occurrence routes Back, selection activation, and restoration to it.
 */
export function NavigationOccurrence(props: { name: string; value: unknown; __tao?: TaoProps }): React.ReactNode {
  const value = occurrenceValue(props.name, props.value)
  if (value.kind === 'view') {
    return renderPresentable(value.presentable, {}, props.__tao)
  }
  return createElement(HostedNavigationOccurrence, { taoProps: props.__tao, value: value.input })
}

function HostedNavigationOccurrence(props: { taoProps?: TaoProps; value: TaoNavigationInput }): React.ReactNode {
  const host = TaoPropsControls.navigationInChain(props.taoProps)
  const app = TaoPropsControls.appInChain(props.taoProps)
  const mount = hostedMount(host, app, props.value)
  const active = TaoPropsControls.ambientContext(props.taoProps).navigationHostActive !== false
  React.useSyncExternalStore(mount.subscribe, mount.snapshot, mount.snapshot)
  React.useLayoutEffect(() => host?.attachHostedNavigation(mount, active), [active, host, mount])
  // The wrapper is the occurrence the render site's clauses style; the navigator inside receives
  // only presentation context, exactly as a navigator mounted at an app root does.
  return Views.View({
    __tao: props.taoProps,
    children: mount.render({ ...TaoPropsControls.ambientContext(props.taoProps) }),
  })
}

/** orphanMounts keeps one mount per descriptor for a nav rendered outside any navigation occurrence. */
const orphanMounts = new WeakMap<TaoConfiguredNavigation, TaoNavigationValue>()

function hostedMount(
  host: TaoNavigationValue | undefined,
  app: TaoRuntimeApp | undefined,
  value: TaoNavigationInput,
): TaoNavigationValue {
  if (host) {
    return host.hostNavigation(value, () => {
      if (!isConfiguredNavigation(value)) {
        return value
      }
      return app ? app.hostNavigation(host, value) : mountConfiguredNavigation(value)
    })
  }
  if (!isConfiguredNavigation(value)) {
    return value
  }
  const existing = orphanMounts.get(value)
  if (existing) {
    return existing
  }
  const mount = mountConfiguredNavigation(value)
  orphanMounts.set(value, mount)
  return mount
}

type OccurrenceValue =
  | { kind: 'nav'; input: TaoNavigationInput }
  | { kind: 'view'; presentable: TaoPresentable }

/** occurrenceValue collapses the bound value a render site received to the view or nav it names. */
function occurrenceValue(name: string, value: unknown): OccurrenceValue {
  let current = value
  // A bound parameter is an alias over an alias at most a few levels deep; the bound is a guard
  // against a self-evaluating scalar, which never becomes a view.
  for (let depth = 0; depth < 8; depth += 1) {
    const carried: unknown = (current as { jsValue?: unknown } | undefined)?.jsValue
    const classified = classifyOccurrenceValue(current) ?? classifyOccurrenceValue(carried)
    if (classified) {
      return classified
    }
    if (!isEvaluable(current)) {
      break
    }
    current = current.evaluate()
  }
  throw new UserInputError(`Cannot render ${name}: its value is not a view or a nav.`, { name })
}

function classifyOccurrenceValue(value: unknown): OccurrenceValue | undefined {
  if (isConfiguredNavigation(value)) {
    return { kind: 'nav', input: value }
  }
  if (!isPresentable(value)) {
    return undefined
  }
  return isNavigation(value) ? { kind: 'nav', input: value } : { kind: 'view', presentable: value }
}
