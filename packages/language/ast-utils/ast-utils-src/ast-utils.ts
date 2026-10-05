import {
  appBoundDatasources,
  effectiveAppConfiguration,
  listedEntryOf,
  referenceBlockOf,
} from './app-configuration'
import { rootAppValue } from './apps'
import { resolveArgumentBindings } from './argument-bindings'
import { associatedCallableWitnessKey } from './associated-callable-witness-key'
import { createAssociatedEffects } from './associated-effect-context'
import { resolveAssociatedMethodInvocation } from './associated-invocations'
import {
  associatedCallableAnalysis,
  associatedCallableDescriptor,
  associatedMethodCallTarget,
  capabilityRequirements,
  materializeAssociatedCallable,
  ownAssociatedMethods,
  ownAssociatedViews,
  withAssociatedEffects,
} from './associated-methods'
import { analyzeCallableEffects } from './callable-effects'
import { bindCallableArguments, callableSignatureOf, compareCallableSignatures } from './callable-signatures'
import { containsCapability, planCapabilityTransport } from './capability-transport'
import { colorValues } from './color-values'
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
import { createRequiresField, resolveDataWriteBindings } from './data-write-bindings'
import { resolveDatasourceValue } from './datasource-values'
import { design } from './design'
import {
  effectFailureCases,
  effectFailureContract,
  effectOutcomeWords,
  failureContractSatisfiesBound,
  invocationFailureCases,
  invocationFailureContract,
  invokedEffect,
  isRootEffectInvocation,
  resolveInvocationFailureDeclaration,
  unhandledOutcomeCases,
  unhandledOutcomeContract,
  unionFailureContracts,
} from './effect-outcomes'
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
  resolveAssociatedActionTarget,
  resolveFunctionInvocation,
  resolveRenderInvocation,
} from './invocations'
import { resolveItemPropertyBindings } from './item-property-bindings'
import { layoutEntryValues, layoutTermValue } from './layouts'
import { numericUnitReadingCollisions, resolveNumericUnitReading } from './numeric-unit-readings'
import { NumericUnits } from './NumericUnits'
import { Packages } from './Packages'
import {
  appAuthBinding,
  authProofKinds,
  concreteConfigurableDeclaration,
  dataCapabilities,
  dataCapabilityNamed,
  datasourceTypeOfBinding,
  isAuthProofKind,
  pairingIssuerOf,
} from './pairing'
import { isPluralCategory, phraseIsPlural, phraseNumberParameters, pluralCategories } from './phrases'
import { literalExpression, parameterRequiresWritable, writableExpression } from './reactive-parameters'
import { referencedNames } from './references'
import { renderTargetIsNav, renderTargetName, resolveRenderTarget } from './render-targets'
import {
  bindRendererSlotArguments,
  compareRendererSlotRenderer,
  rendererSlotDefaultParameterCorrespondence,
  rendererSlotSignatureOf,
} from './renderer-slots'
import { sourceActionResult } from './source-action-results'
import { Type } from './Type'
import { literalDurationOf, Units } from './Units'

export { design, NumericUnits, Packages, Type, Units }
export type {
  AssociatedCallableWitnessKeyContext,
  AssociatedOperatorWitnessDeclaration,
} from './associated-callable-witness-key'
export { declaredCallableFailureContract } from './failure-contracts'
export type { NumericUnitsDeclarationPlan, NumericUnitsSuffixResolution } from './NumericUnits'

/** ASTUtils groups shared semantic helpers for Tao AST consumers. */
export const ASTUtils = {
  resolveNumericUnitReading,
  numericUnitReadingCollisions,
  createAssociatedEffects,
  resolveAssociatedMethodInvocation,
  associatedCallableWitnessKey,
  associatedCallableAnalysis,
  associatedCallableDescriptor,
  associatedMethodCallTarget,
  capabilityRequirements,
  materializeAssociatedCallable,
  ownAssociatedMethods,
  ownAssociatedViews,
  withAssociatedEffects,
  containsCapability,
  planCapabilityTransport,
  parameterRequiresWritable,
  writableExpression,
  literalExpression,
  bindRendererSlotArguments,
  compareRendererSlotRenderer,
  rendererSlotDefaultParameterCorrespondence,
  rendererSlotSignatureOf,
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
  colorValues,
  bindCallableArguments,
  callableSignatureOf,
  compareCallableSignatures,
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
  analyzeCallableEffects,
  effectFailureCases,
  effectFailureContract,
  effectOutcomeWords,
  failureContractSatisfiesBound,
  invocationFailureCases,
  invocationFailureContract,
  invokedEffect,
  isRootEffectInvocation,
  resolveInvocationFailureDeclaration,
  unhandledOutcomeCases,
  unhandledOutcomeContract,
  unionFailureContracts,
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
  resolveAssociatedActionTarget,
  resolveArgumentBindings,
  resolveActionTarget,
  resolveDataWriteBindings,
  createRequiresField,
  resolveFunctionInvocation,
  resolveItemPropertyBindings,
  resolveRenderInvocation,
  resolveRenderTarget,
  rootAppValue,
  sourceActionResult,
  isPluralCategory,
  phraseIsPlural,
  phraseNumberParameters,
  pluralCategories,
  appAuthBinding,
  authProofKinds,
  concreteConfigurableDeclaration,
  dataCapabilities,
  dataCapabilityNamed,
  datasourceTypeOfBinding,
  isAuthProofKind,
  pairingIssuerOf,
} as const

export namespace ASTUtils {
  export type NumericUnitReading = import('./numeric-unit-readings').NumericUnitReading
  export type AssociatedCallableDescriptor = import('./associated-methods').AssociatedCallableDescriptor
  export type AssociatedOperatorWitnessDeclaration =
    import('./associated-callable-witness-key').AssociatedOperatorWitnessDeclaration
  export type AssociatedCallableOwner = import('./associated-methods').AssociatedCallableOwner
  export type AssociatedEffectsContext = import('./associated-methods').AssociatedEffectsContext
  export type CapabilityTransportPlan = import('./capability-transport').CapabilityTransportPlan
  export type CapabilityTransportMethod = import('./capability-transport').CapabilityTransportMethod
  export type CapabilityTransportResult = import('./capability-transport').CapabilityTransportResult
  export type AssociatedCapabilityWitness = import('./Type').AssociatedCapabilityWitness
  export type AssociatedDescriptorMaterialization = import('./associated-methods').AssociatedDescriptorMaterialization
  export type AssociatedMethodReceiver = import('./associated-methods').AssociatedMethodReceiver
  export type AssociatedMethodSelection = import('./associated-methods').AssociatedMethodSelection
  export type ActionInvocationPair = import('./invocations').ActionInvocationPair
  export type AppDatasourceBinding = import('./app-configuration').AppDatasourceBinding
  export type AppPropertySource = import('./app-configuration').AppPropertySource
  export type EffectiveAppConfiguration = import('./app-configuration').EffectiveAppConfiguration
  export type EffectiveAppProperty = import('./app-configuration').EffectiveAppProperty
  export type ListedEntry = import('./app-configuration').ListedEntry
  export type ArgumentBindingDiagnostic = import('./argument-bindings').ArgumentBindingDiagnostic
  export type CallableInput = import('./callable-signatures').CallableInput
  export type CallableSignature = import('./callable-signatures').CallableSignature
  export type CallableSignatureComparison = import('./callable-signatures').CallableSignatureComparison
  export type CallableSignatureDiagnostic = import('./callable-signatures').CallableSignatureDiagnostic
  export type CommandSlot = import('./commands').CommandSlot
  export type ParsedShortcut = import('./commands').ParsedShortcut
  export type EffectDeclaration = import('./effect-outcomes').EffectDeclaration
  export type FailureContract = import('./effect-outcomes').FailureContract
  export type EffectInvocation = import('./effect-outcomes').EffectInvocation
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
  export type ItemShapeField = import('./Type').ItemShapeField
  export type ImplicitChangeBinding = import('./invocations').ImplicitChangeBinding
  export type LayoutTermValue = import('./layouts').LayoutTermValue
  export type AppAuthBinding = import('./pairing').AppAuthBinding
  export type AuthProofKind = import('./pairing').AuthProofKind
  export type DataCapability = import('./pairing').DataCapability
  export type DataCapabilityScope = import('./pairing').DataCapabilityScope
  export type DataCapabilityUse = import('./pairing').DataCapabilityUse
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
  export type PluralCategory = import('./phrases').PluralCategory
  export type ResolvedFunctionInvocation = import('./invocations').ResolvedFunctionInvocation
  export type ResolvedAssociatedMethodInvocation = import('./associated-invocations').ResolvedAssociatedMethodInvocation
  export type ResolvedRenderInvocation = import('./invocations').ResolvedRenderInvocation
  export type TaoType = import('./Type').TaoType
  export type UnitFamily = import('./Units').UnitFamily
  export type UnitReading = import('./Units').UnitReading
}
