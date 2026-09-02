import { rootAppValue } from './apps'
import { resolveArgumentBindings } from './argument-bindings'
import { commandSlots, mentionFills } from './commands'
import { resolveDataWriteBindings } from './data-write-bindings'
import { standardDesignElementName } from './design'
import { canonicalDesignVisualHead, designColorHeads, designVisualHeads } from './design-visuals'
import { guardBranches } from './guards'
import { injectionArgumentName } from './injections'
import {
  resolveActionInvocation,
  resolveActionTarget,
  resolveFunctionInvocation,
  resolveRenderInvocation,
} from './invocations'
import { resolveItemPropertyBindings } from './item-property-bindings'
import { layoutEntryValues, layoutTermValue } from './layouts'
import { Packages } from './Packages'
import { referencedNames } from './references'
import { renderTargetIsNav, renderTargetName, resolveRenderTarget } from './render-targets'
import { Type } from './Type'
import { literalDurationOf, Units } from './Units'

export { Packages, Type, Units }

/** ASTUtils groups shared semantic helpers for Tao AST consumers. */
export const ASTUtils = {
  commandSlots,
  mentionFills,
  guardBranches,
  canonicalDesignVisualHead,
  designColorHeads,
  designVisualHeads,
  injectionArgumentName,
  layoutEntryValues,
  layoutTermValue,
  literalDurationOf,
  referencedNames,
  renderTargetIsNav,
  renderTargetName,
  resolveActionInvocation,
  resolveArgumentBindings,
  resolveActionTarget,
  resolveDataWriteBindings,
  resolveFunctionInvocation,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
  resolveRenderTarget,
  rootAppValue,
  standardDesignElementName,
} as const

export namespace ASTUtils {
  export type ActionInvocationPair = import('./invocations').ActionInvocationPair
  export type ArgumentBindingDiagnostic = import('./argument-bindings').ArgumentBindingDiagnostic
  export type CommandSlot = import('./commands').CommandSlot
  export type DataWriteBindingDiagnostic = import('./data-write-bindings').DataWriteBindingDiagnostic
  export type DataWriteBindingPair = import('./data-write-bindings').DataWriteBindingPair
  export type DataWriteBindingResult = import('./data-write-bindings').DataWriteBindingResult
  export type DataEntityDefinition = import('./Type').DataEntityDefinition
  export type DataFieldDefinition = import('./Type').DataFieldDefinition
  export type ItemPropertyBindingDiagnostic = import('./item-property-bindings').ItemPropertyBindingDiagnostic
  export type ItemPropertyBindingPair = import('./item-property-bindings').ItemPropertyBindingPair
  export type ItemPropertyBindingResult = import('./item-property-bindings').ItemPropertyBindingResult
  export type ItemShape = import('./Type').ItemShape
  export type ImplicitChangeBinding = import('./invocations').ImplicitChangeBinding
  export type LayoutTermValue = import('./layouts').LayoutTermValue
  export type RenderEventBindingDiagnostic = import('./invocations').RenderEventBindingDiagnostic
  export type RenderEventBindingPair = import('./invocations').RenderEventBindingPair
  export type RenderInvocationPair = import('./argument-bindings').RenderInvocationPair
  export type RenderTarget = import('./render-targets').RenderTarget
  export type ResolvedActionInvocation = import('./invocations').ResolvedActionInvocation
  export type ResolvedActionTarget = import('./invocations').ResolvedActionTarget
  export type ResolvedFunctionInvocation = import('./invocations').ResolvedFunctionInvocation
  export type ResolvedRenderInvocation = import('./invocations').ResolvedRenderInvocation
  export type TaoType = import('./Type').TaoType
  export type UnitFamily = import('./Units').UnitFamily
  export type UnitReading = import('./Units').UnitReading
}
