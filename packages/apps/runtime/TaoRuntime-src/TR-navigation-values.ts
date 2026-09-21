import type React from 'react'
import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import type {
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import type { RuntimeHostReadChannel } from './TR-navigation-host-slots'
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
  RuntimeAssert.input(isPresentable(patch), `Navigation ${navigationName} patch '${property}' expects ui or nav.`, {
    navigationName,
    property,
  })
  return patch as ValueT
}

export function patchedSelectionKey(
  value: unknown,
  navigationName: string,
): string {
  if (isPresentable(value) || !isEvaluable(value)) {
    throw new UserInputError(`SelectionNav ${navigationName} patch 'Initial' expects an @key.`, { navigationName })
  }
  const key = String(value.evaluate().jsValue)
  RuntimeAssert.input(key.startsWith('@'), `SelectionNav ${navigationName} patch 'Initial' expects an @key.`, {
    navigationName,
  })
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
    throw new UserInputError(`Navigation ${navigationName} patch '${property}' expects a scalar value.`, {
      navigationName,
      property,
    })
  }
  return patch
}

export function isEvaluable(value: unknown): value is Evaluable {
  return typeof value === 'object' && value !== null && 'evaluate' in value
    && typeof value.evaluate === 'function'
}

export function assertPatchKeys(
  patch: TaoNavigationPatch,
  allowed: readonly string[],
  navigationName: string,
): void {
  for (const key of Object.keys(patch)) {
    RuntimeAssert.input(
      allowed.includes(key),
      `Navigation ${navigationName} has no configurable property '${key}'.`,
      { navigationName, property: key },
    )
  }
}

export function renderPresentable(
  value: TaoPresentable | TaoNavigationValue,
  arguments_: TaoNavigationArguments,
  taoProps?: TaoProps,
  host?: RuntimeHostReadChannel,
): React.ReactNode {
  return isNavigation(value)
    ? value.render(taoProps, host)
    : value.render(arguments_, taoProps, host)
}
