import { injectionArgumentName } from './injections'
import {
  resolveActionInvocation,
  resolveActionTarget,
  resolveItemPropertyBindings,
  resolveNavigationInvocation,
  resolveRenderInvocation,
} from './invocations'
import { layoutEntryValues, layoutTermValue } from './layouts'
import { Packages } from './Packages'
import { referencedNames } from './references'
import { Type } from './Type'

export { Packages, Type }

/** ASTUtils groups shared semantic helpers for Tao AST consumers. */
export const ASTUtils = {
  injectionArgumentName,
  layoutEntryValues,
  layoutTermValue,
  referencedNames,
  resolveActionInvocation,
  resolveActionTarget,
  resolveItemPropertyBindings,
  resolveNavigationInvocation,
  resolveRenderInvocation,
} as const

export namespace ASTUtils {
  export type ActionInvocationPair = import('./invocations').ActionInvocationPair
  export type ArgumentBindingDiagnostic = import('./invocations').ArgumentBindingDiagnostic
  export type ItemPropertyBindingDiagnostic = import('./invocations').ItemPropertyBindingDiagnostic
  export type ItemPropertyBindingPair = import('./invocations').ItemPropertyBindingPair
  export type ItemPropertyBindingResult = import('./invocations').ItemPropertyBindingResult
  export type LayoutTermValue = import('./layouts').LayoutTermValue
  export type RenderInvocationPair = import('./invocations').RenderInvocationPair
  export type ResolvedActionInvocation = import('./invocations').ResolvedActionInvocation
  export type ResolvedActionTarget = import('./invocations').ResolvedActionTarget
  export type ResolvedNavigationInvocation = import('./invocations').ResolvedNavigationInvocation
  export type ResolvedRenderInvocation = import('./invocations').ResolvedRenderInvocation
  export type TaoType = import('./Type').TaoType
}
