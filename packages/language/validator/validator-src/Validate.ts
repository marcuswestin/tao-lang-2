import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { HCI, Platform } from '@shared'
import { NodeValidation, type NodeValidationChecks, type NodeValidationReuse } from './node-validation'
import type { ValidationContext } from './validation'
import { accessValidationChecks } from './validators/access-validator'
import { ActionsValidator } from './validators/ActionsValidator'
import { AliasesValidator } from './validators/aliases-validator'
import { AppValidator } from './validators/app-validator'
import { associatedMethodsValidationChecks } from './validators/associated-methods-validator'
import { bridgeValidationChecks, validateBridgedSidecarFiles } from './validators/bridge-validator'
import { capabilityTransportValidationChecks } from './validators/capability-transport-validator'
import { colorValueValidationChecks } from './validators/color-values-validator'
import { commandValidationChecks } from './validators/commands-validator'
import { completenessValidationChecks } from './validators/completeness-validator'
import {
  configurationValidationChecks,
  validateConfigurationSidecarFiles,
} from './validators/configuration-validator'
import {
  configuredValueValidationChecks,
  validateConfiguredValuesFile,
} from './validators/configured-values-validator'
import { dataValidationChecks, validateDataFile } from './validators/data-validator'
import { validateDatasourceMembership } from './validators/datasource-membership-validator'
import { declarationSlotValidationChecks } from './validators/declaration-slots-validator'
import { DesignValidator } from './validators/design-validator'
import { EffectOutcomesValidator } from './validators/effect-outcomes-validator'
import { FunctionalCoreValidator } from './validators/FunctionalCoreValidator'
import { injectionValidationChecks } from './validators/injections-validator'
import { InteractionValidator } from './validators/interaction-validator'
import { InvocationsValidator } from './validators/invocations-validator'
import { LayoutValidator } from './validators/layout-validator'
import { navigationValidationChecks } from './validators/navigation-validator'
import { numericUnitReadingsValidationChecks } from './validators/numeric-unit-readings-validator'
import { numericUnitsValidationChecks } from './validators/numeric-units-validator'
import { packageValidationChecks, validatePackageFile } from './validators/package-validator'
import { pairingValidationChecks, validateAppPairing } from './validators/pairing-validator'
import { PhrasesValidator } from './validators/phrases-validator'
import { preludeValidationChecks, validatePreludeFile } from './validators/prelude-validator'
import { ReactiveParametersValidator } from './validators/ReactiveParametersValidator'
import { validateReleaseCapabilities } from './validators/release-capabilities-validator'
import { rendererSlotsValidationChecks } from './validators/renderer-slots-validator'
import { ResponsesValidator } from './validators/responses-validator'
import {
  scenarioValidationChecks,
  validateScenarioFile,
} from './validators/scenarios-validator'
import { StateValidator } from './validators/StateValidator'
import { testValidationChecks } from './validators/tests-validator'
import { typeValidationChecks } from './validators/types-validator'
import { unitsValidationChecks } from './validators/units-validator'
import {
  usePackageValidationChecks,
  validatePackageUseStatements,
} from './validators/use-package-validator'
import { validateUseStatements, validateVisibleDeclarations } from './validators/use-validator'
import { ViewsValidator } from './validators/views-validator'

const nodeValidationChecks = NodeValidation.compile(
  [
    packageValidationChecks,
    ViewsValidator.checks,
    ActionsValidator.checks,
    EffectOutcomesValidator.checks,
    StateValidator.checks,
    ReactiveParametersValidator.checks,
    AliasesValidator.checks,
    LayoutValidator.checks,
    injectionValidationChecks,
    InteractionValidator.checks,
    testValidationChecks,
    typeValidationChecks,
    associatedMethodsValidationChecks,
    capabilityTransportValidationChecks,
    InvocationsValidator.checks,
    FunctionalCoreValidator.checks,
    PhrasesValidator.checks,
    dataValidationChecks,
    accessValidationChecks,
    DesignValidator.checks,
    colorValueValidationChecks,
    configurationValidationChecks,
    pairingValidationChecks,
    completenessValidationChecks,
    commandValidationChecks,
    declarationSlotValidationChecks,
    preludeValidationChecks,
    ResponsesValidator.checks,
    navigationValidationChecks,
    unitsValidationChecks,
    numericUnitsValidationChecks,
    numericUnitReadingsValidationChecks,
    rendererSlotsValidationChecks,
    bridgeValidationChecks,
    usePackageValidationChecks,
    configuredValueValidationChecks,
    scenarioValidationChecks,
  ] satisfies readonly NodeValidationChecks[],
)

// Type-inference checks run as their own pass after the structural checks, so a
// file's inferred-type diagnostics stay grouped after its structural ones.
const typeInferenceChecks = NodeValidation.compile(
  [
    ActionsValidator.typeChecks,
    StateValidator.typeChecks,
  ] satisfies readonly NodeValidationChecks[],
)

// These handlers read local containment and linked dependencies and only report through ctx.
// Registration is deliberately separate from the complete dispatch: a new validator stays cold.
// Configured/inferred constructors and member access retain their implicit lookup checks each run.
const reusableNodeChecks = new Set([
  ...NodeValidation.compile([
    AliasesValidator.checks,
    ActionsValidator.checks,
    StateValidator.checks,
    ReactiveParametersValidator.checks,
    FunctionalCoreValidator.checks,
    unitsValidationChecks,
    {
      [AST.TypeDeclaration.$type]: typeValidationChecks[AST.TypeDeclaration.$type],
      [AST.ItemTypeExpression.$type]: typeValidationChecks[AST.ItemTypeExpression.$type],
      [AST.ParameterDeclaration.$type]: typeValidationChecks[AST.ParameterDeclaration.$type],
      [AST.ParameterizedDeclaration.$type]: typeValidationChecks[AST.ParameterizedDeclaration.$type],
    },
  ]).values(),
].flat())

function validateTaoFile(
  file: AST.TaoFile,
  ctx: ValidationContext,
  effects?: ASTUtils.AssociatedEffectsContext,
  documentReuse?: Pick<NodeValidationReuse, 'run'>,
): readonly AST.Node[] {
  if (effects) {
    return ASTUtils.withAssociatedEffects(effects, () => validateTaoFile(file, ctx, undefined, documentReuse))
  }
  const nodeReuse = documentReuse ? { ...documentReuse, checks: reusableNodeChecks } : undefined
  const profileEnabled = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
  if (!profileEnabled) {
    validateReleaseCapabilities(file, ctx)
    AppValidator.validate(file, ctx)
    validatePackageFile(file, ctx)
    AliasesValidator.validateFile(file, ctx)
    validateDataFile(file, ctx)
    validateDatasourceMembership(file, ctx)
    validateAppPairing(file, ctx)
    validateScenarioFile(file, ctx)
    validatePreludeFile(file, ctx)
    const nodes = ctx.nodesInFile?.(file) ?? AST.streamAllContents(file)
    NodeValidation.validate(nodes, file, ctx, nodeValidationChecks, undefined, nodeReuse)
    validateConfiguredValuesFile(file, ctx)

    const document = AST.getDocument(file)
    if (document.uri.scheme === 'file') {
      validateVisibleDeclarations(ctx, file)
      validateUseStatements(file, ctx)
      validatePackageUseStatements(file, ctx)
    }
    return nodes
  }

  const fileChecks: Record<string, number> = {}
  const nodeHandlers: Record<string, number> = {}
  const time = (name: string, action: () => void): void => {
    const startedAt = performance.now()
    try {
      action()
    } finally {
      fileChecks[name] = (fileChecks[name] ?? 0) + performance.now() - startedAt
    }
  }
  let nodes: readonly AST.Node[] = []
  try {
    time('release-capabilities', () => validateReleaseCapabilities(file, ctx))
    time('app', () => AppValidator.validate(file, ctx))
    time('package', () => validatePackageFile(file, ctx))
    time('aliases', () => AliasesValidator.validateFile(file, ctx))
    time('data', () => validateDataFile(file, ctx))
    time('datasource-membership', () => validateDatasourceMembership(file, ctx))
    time('app-pairing', () => validateAppPairing(file, ctx))
    time('scenario', () => validateScenarioFile(file, ctx))
    time('prelude', () => validatePreludeFile(file, ctx))
    nodes = ctx.nodesInFile?.(file) ?? AST.streamAllContents(file)
    NodeValidation.validate(nodes, file, ctx, nodeValidationChecks, (name, duration) => {
      nodeHandlers[name] = (nodeHandlers[name] ?? 0) + duration
    }, nodeReuse)
    time('configured-values', () => validateConfiguredValuesFile(file, ctx))

    const document = AST.getDocument(file)
    if (document.uri.scheme === 'file') {
      time('visible-declarations', () => validateVisibleDeclarations(ctx, file))
      time('use-statements', () => validateUseStatements(file, ctx))
      time('package-use-statements', () => validatePackageUseStatements(file, ctx))
    }
    return nodes
  } finally {
    HCI.logProcessInfo(
      'validator',
      JSON.stringify({
        type: 'studio-validation-checks-profile',
        file: AST.getDocument(file).uri.toString(),
        fileChecks,
        nodeHandlers,
      }),
    )
  }
}

function validateTypes(
  file: AST.TaoFile,
  nodes: readonly AST.Node[],
  ctx: ValidationContext,
  effects?: ASTUtils.AssociatedEffectsContext,
): void {
  if (effects) {
    return ASTUtils.withAssociatedEffects(effects, () => validateTypes(file, nodes, ctx))
  }
  NodeValidation.validate(nodes, file, ctx, typeInferenceChecks)
}

async function validateForeignImplementationFiles(file: AST.TaoFile, ctx: ValidationContext): Promise<void> {
  await ActionsValidator.validateForeignFiles(file, ctx)
  await ViewsValidator.validateForeignFiles(file, ctx)
  await validateConfigurationSidecarFiles(file, ctx)
  await validateBridgedSidecarFiles(file, ctx)
}

/** Validate exposes Tao AST validation passes. */
export const Validate = {
  App: AppValidator.validate,
  ForeignImplementationFiles: validateForeignImplementationFiles,
  TaoFile: validateTaoFile,
  Types: validateTypes,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
} as const
