import {
  appBoundDatasources,
  effectiveAppConfiguration,
  listedEntryOf,
  referenceBlockOf,
} from './app-configuration'
import { rootAppValue } from './apps'
import { resolveArgumentBindings } from './argument-bindings'
import {
  commandSlots,
  commandStaticMemberText,
  commandStaticShortcut,
  mentionFills,
  parseShortcut,
  reservedCommandShortcuts,
} from './commands'
import {
  datasourceCollectionNames,
  datasourceCollections,
  datasourceDataEntry,
  datasourceMembershipSlot,
  derivedDatasourceBase,
  ownConfigurationBlock,
  planDataStores,
  storeOfCollection,
  storeOfDatasource,
} from './data-stores'
import { resolveDataWriteBindings } from './data-write-bindings'
import { resolveDatasourceValue } from './datasource-values'
import { design } from './design'
import { guardBranches } from './guards'
import { injectionArgumentName } from './injections'
import {
  outlineControlDescriptor,
  outlineLoopDescriptor,
  outlineSiblingRegionDescriptor,
  outlineSiblingRegionForRender,
  outlineSiblingRegionMemberDeclarations,
} from './interaction-outline'
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

export { design, Packages, Type, Units }

/** ASTUtils groups shared semantic helpers for Tao AST consumers. */
export const ASTUtils = {
  appBoundDatasources,
  effectiveAppConfiguration,
  listedEntryOf,
  referenceBlockOf,
  commandSlots,
  commandStaticMemberText,
  commandStaticShortcut,
  parseShortcut,
  reservedCommandShortcuts,
  mentionFills,
  guardBranches,
  datasourceMembershipSlot,
  datasourceCollectionNames,
  datasourceCollections,
  datasourceDataEntry,
  derivedDatasourceBase,
  ownConfigurationBlock,
  planDataStores,
  storeOfCollection,
  storeOfDatasource,
  resolveDatasourceValue,
  design,
  injectionArgumentName,
  layoutEntryValues,
  layoutTermValue,
  literalDurationOf,
  outlineControlDescriptor,
  outlineLoopDescriptor,
  outlineSiblingRegionDescriptor,
  outlineSiblingRegionForRender,
  outlineSiblingRegionMemberDeclarations,
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
} as const

export namespace ASTUtils {
  export type ActionInvocationPair = import('./invocations').ActionInvocationPair
  export type AppDatasourceBinding = import('./app-configuration').AppDatasourceBinding
  export type AppPropertySource = import('./app-configuration').AppPropertySource
  export type EffectiveAppConfiguration = import('./app-configuration').EffectiveAppConfiguration
  export type EffectiveAppProperty = import('./app-configuration').EffectiveAppProperty
  export type ListedEntry = import('./app-configuration').ListedEntry
  export type ArgumentBindingDiagnostic = import('./argument-bindings').ArgumentBindingDiagnostic
  export type CommandSlot = import('./commands').CommandSlot
  export type ParsedShortcut = import('./commands').ParsedShortcut
  export type DataWriteBindingDiagnostic = import('./data-write-bindings').DataWriteBindingDiagnostic
  export type DataWriteBindingPair = import('./data-write-bindings').DataWriteBindingPair
  export type DataWriteBindingResult = import('./data-write-bindings').DataWriteBindingResult
  export type DataEntityDefinition = import('./Type').DataEntityDefinition
  export type DataFieldDefinition = import('./Type').DataFieldDefinition
  export type DataStore = import('./data-stores').DataStore
  export type DataStoreKind = import('./data-stores').DataStoreKind
  export type DataStorePlan = import('./data-stores').DataStorePlan
  export type ResolvedDatasource = import('./datasource-values').ResolvedDatasource
  export type ItemPropertyBindingDiagnostic = import('./item-property-bindings').ItemPropertyBindingDiagnostic
  export type ItemPropertyBindingPair = import('./item-property-bindings').ItemPropertyBindingPair
  export type ItemPropertyBindingResult = import('./item-property-bindings').ItemPropertyBindingResult
  export type ItemShape = import('./Type').ItemShape
  export type ImplicitChangeBinding = import('./invocations').ImplicitChangeBinding
  export type LayoutTermValue = import('./layouts').LayoutTermValue
  export type OutlineControlDescriptor = import('./interaction-outline').OutlineControlDescriptor
  export type OutlineLoopDescriptor = import('./interaction-outline').OutlineLoopDescriptor
  export type OutlineSiblingRegionDescriptor = import('./interaction-outline').OutlineSiblingRegionDescriptor
  export type OutlineTextPath = import('./interaction-outline').OutlineTextPath
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
