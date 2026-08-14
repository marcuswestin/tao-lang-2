import type React from 'react'
import type {
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import { type Evaluable, RuntimePresentable } from './TR-navigation-presentables'
import { RuntimeNavigationValue } from './TR-navigation-value'
import type { TaoProps } from './TR-TaoProps'

export function isNavigation(value: TaoPresentable | TaoNavigationValue): value is TaoNavigationValue {
  return value instanceof RuntimeNavigationValue
}

export function isPresentable(value: unknown): value is TaoPresentable | TaoNavigationValue {
  return value instanceof RuntimePresentable || value instanceof RuntimeNavigationValue
}

export function patchedPresentable<ValueT extends TaoPresentable | TaoNavigationValue>(
  patch: unknown,
  fallback: ValueT,
  navigationName: string,
  property: string,
): ValueT {
  if (patch === undefined) {
    return fallback
  }
  if (!isPresentable(patch)) {
    throw new Error(`Navigation ${navigationName} patch '${property}' expects ui or nav.`)
  }
  return patch as ValueT
}

export function patchedSelectionKey(
  value: unknown,
  navigationName: string,
): string {
  if (isPresentable(value) || !isEvaluable(value)) {
    throw new Error(`SelectionNav ${navigationName} patch 'Initial' expects an @key.`)
  }
  const key = String(value.evaluate().jsValue)
  if (!key.startsWith('@')) {
    throw new Error(`SelectionNav ${navigationName} patch 'Initial' expects an @key.`)
  }
  return key.slice(1)
}

export function patchedEvaluable(
  patch: unknown,
  fallback: Evaluable,
  navigationName: string,
  property: string,
): Evaluable {
  if (patch === undefined) {
    return fallback
  }
  if (isPresentable(patch) || !isEvaluable(patch)) {
    throw new Error(`Navigation ${navigationName} patch '${property}' expects a scalar value.`)
  }
  return patch
}

function isEvaluable(value: unknown): value is Evaluable {
  return typeof value === 'object' && value !== null && 'evaluate' in value
    && typeof value.evaluate === 'function'
}

export function assertPatchKeys(
  patch: TaoNavigationPatch,
  allowed: readonly string[],
  navigationName: string,
): void {
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) {
      throw new Error(`Navigation ${navigationName} has no configurable property '${key}'.`)
    }
  }
}

export function renderPresentable(
  value: TaoPresentable | TaoNavigationValue,
  arguments_: TaoNavigationArguments,
  taoProps?: TaoProps,
): React.ReactNode {
  return isNavigation(value)
    ? value.render(taoProps)
    : value.render(arguments_, taoProps)
}
