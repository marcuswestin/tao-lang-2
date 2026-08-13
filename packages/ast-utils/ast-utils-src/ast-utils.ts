import { injectionArgumentName } from './injections'
import {
  resolveActionInvocation,
  resolveActionTarget,
  resolveArgumentBindings,
  resolveDataWriteBindings,
  resolveFunctionInvocation,
  resolveItemPropertyBindings,
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
  resolveArgumentBindings,
  resolveActionTarget,
  resolveDataWriteBindings,
  resolveFunctionInvocation,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
} as const

export namespace ASTUtils {
  export type ActionInvocationPair = import('./invocations').ActionInvocationPair
  export type ArgumentBindingDiagnostic = import('./invocations').ArgumentBindingDiagnostic
  export type DataWriteBindingDiagnostic = import('./invocations').DataWriteBindingDiagnostic
  export type DataWriteBindingPair = import('./invocations').DataWriteBindingPair
  export type DataWriteBindingResult = import('./invocations').DataWriteBindingResult
  export type DataEntityDefinition = import('./Type').DataEntityDefinition
  export type DataFieldDefinition = import('./Type').DataFieldDefinition
  export type ItemPropertyBindingDiagnostic = import('./invocations').ItemPropertyBindingDiagnostic
  export type ItemPropertyBindingPair = import('./invocations').ItemPropertyBindingPair
  export type ItemPropertyBindingResult = import('./invocations').ItemPropertyBindingResult
  export type ImplicitChangeBinding = import('./invocations').ImplicitChangeBinding
  export type LayoutTermValue = import('./layouts').LayoutTermValue
  export type RenderEventBindingDiagnostic = import('./invocations').RenderEventBindingDiagnostic
  export type RenderEventBindingPair = import('./invocations').RenderEventBindingPair
  export type RenderInvocationPair = import('./invocations').RenderInvocationPair
  export type ResolvedActionInvocation = import('./invocations').ResolvedActionInvocation
  export type ResolvedActionTarget = import('./invocations').ResolvedActionTarget
  export type ResolvedFunctionInvocation = import('./invocations').ResolvedFunctionInvocation
  export type ResolvedRenderInvocation = import('./invocations').ResolvedRenderInvocation
  export type TaoType = import('./Type').TaoType
}
