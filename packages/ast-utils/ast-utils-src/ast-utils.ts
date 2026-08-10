import { injectionArgumentName } from './injections'
import {
  hasInterpolation,
  interpolationSegments,
  resolveInterpolation,
  visibleValueDeclaration,
} from './interpolation'
import {
  parameterDefaultValue,
  resolveActionInvocation,
  resolveActionTarget,
  resolveItemPropertyBindings,
  resolvePresentInvocation,
  resolveRenderInvocation,
  unboundDefaultedParameters,
} from './invocations'
import { layoutEntryValues, layoutTermValue } from './layouts'
import { Packages } from './Packages'
import { referencedNames } from './references'
import {
  entityField,
  mutationEntity,
  Operators,
  queriedEntity,
  referencedEntity,
  Type,
  visibleDataDeclaration,
} from './Type'

export { Operators, Packages, Type }

/** ASTUtils groups shared semantic helpers for Tao AST consumers. */
export const ASTUtils = {
  hasInterpolation,
  injectionArgumentName,
  interpolationSegments,
  resolveInterpolation,
  visibleValueDeclaration,
  layoutEntryValues,
  layoutTermValue,
  referencedNames,
  resolveActionInvocation,
  resolveActionTarget,
  resolveItemPropertyBindings,
  resolvePresentInvocation,
  resolveRenderInvocation,
  parameterDefaultValue,
  unboundDefaultedParameters,
  entityField,
  mutationEntity,
  queriedEntity,
  referencedEntity,
  visibleDataDeclaration,
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
  export type ResolvedRenderInvocation = import('./invocations').ResolvedRenderInvocation
  export type InterpolationSegment = import('./interpolation').InterpolationSegment
  export type ResolvedInterpolation = import('./interpolation').ResolvedInterpolation
  export type TaoType = import('./Type').TaoType
}
