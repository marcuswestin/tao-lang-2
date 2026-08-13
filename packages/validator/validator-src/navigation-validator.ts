import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

/** navigationValidationMessages declares configured navigation diagnostics. */
export const navigationValidationMessages = {
  missingArgument: (destination: string, parameter: string) =>
    `Presentation of ${destination} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (destination: string) =>
    `Presentation of ${destination} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (destination: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Presentation of ${destination} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (destination: string, parameter: string) =>
    `Presentation of ${destination} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (destination: string, parameter: string) =>
    `Destination ${destination} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (destination: string) =>
    `Presentation of ${destination} has more than one argument with the same exact type.`,
  unknownNamedArgument: (destination: string, name: string) =>
    `Destination ${destination} has no parameter named '${name}'.`,
  duplicateNamedArgument: (destination: string, name: string) =>
    `Presentation of ${destination} provides parameter '${name}' more than once.`,
  namedArgumentType: (destination: string, name: string, expected: string, actual: string) =>
    `Labeled argument '${name}:' of destination ${destination} expects ${expected}, got ${actual}.`,
  presentationContext: 'Contextual presentation is allowed only inside a ui declaration.',
  presentationTarget: (actual: string) => `Presentation target expects nav, got ${actual}.`,
  dismissContext: '`dismiss` is allowed only inside a ui declaration.',
  replaceNavigator: (actual: string) => `Replacement expects nav, got ${actual}.`,
  unknownAuxiliary: (app: string, key: string) => `App ${app} has no auxiliary navigator named '@${key}'.`,
  unsupportedConfiguredType: (name: string) => `Type ${name} is not a configurable Tao runtime value.`,
  unknownConfiguration: (type: string, name: string) => `${type} has no configuration slot named '${name}'.`,
  duplicateConfiguration: (type: string, name: string) => `${type} configures '${name}' more than once.`,
  missingConfiguration: (type: string, name: string) => `${type} requires configuration '${name}'.`,
  initialType: (type: string, expected: string, actual: string) =>
    `${type} Initial expects ${expected}, got ${actual}.`,
  localWith: 'Local datasource configuration requires `with { StorageKey "…" }`.',
  storageKeyType: 'Local StorageKey must be text.',
  storageKeyEmpty: 'Local StorageKey must be nonempty.',
} as const

/** validateNavigation validates configured navigation and presentation calls. */
export function validateNavigation(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const presentation of AST.streamAllContents(file).filter(AST.isContextualPresentStatement)) {
    validateContextualPresentation(presentation, ctx)
  }
  for (const dismiss of AST.streamAllContents(file).filter(AST.isDismissStatement)) {
    if (!AST.isUiDeclaration(AST.findOwningView(dismiss))) {
      ctx.error(navigationValidationMessages.dismissContext, dismiss)
    }
  }
  for (const replace of AST.streamAllContents(file).filter(AST.isReplaceStatement)) {
    const actual = Type.ofExpression(replace.navigator)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(navigationValidationMessages.replaceNavigator(Type.displayName(actual)), replace.navigator)
    }
  }
  for (const configured of AST.streamAllContents(file).filter(AST.isConfiguredValue)) {
    validateConfiguredValue(configured, ctx)
  }
}

function validateContextualPresentation(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  if (!AST.isUiDeclaration(AST.findOwningView(presentation))) {
    ctx.error(navigationValidationMessages.presentationContext, presentation)
  }
  const ui = presentation.ui.ref
  if (ui) {
    const resolved = ASTUtils.resolveArgumentBindings(ui, presentation)
    for (const diagnostic of resolved.diagnostics) {
      reportBindingDiagnostic(ui, diagnostic, presentation, ctx)
    }
  }
  if (presentation.target) {
    if (presentation.target.value) {
      const actual = Type.ofExpression(presentation.target.value)
      if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
        ctx.error(navigationValidationMessages.presentationTarget(Type.displayName(actual)), presentation.target)
      }
    } else if (presentation.target.app?.ref && presentation.target.key) {
      const app = presentation.target.app.ref
      const targetKey = presentation.target.key.slice(1)
      const auxiliary = AST.blockStatements(app).find(statement =>
        AST.isAppAuxiliaryNavigator(statement) && statement.name.slice(1) === targetKey
      )
      if (!auxiliary) {
        ctx.error(navigationValidationMessages.unknownAuxiliary(app.name, targetKey), presentation.target)
      }
    }
  }
}

function validateConfiguredValue(value: AST.ConfiguredValue, ctx: ValidationContext): void {
  const typeName = value.type.ref?.name
  if (!typeName) {
    return
  }
  // A one-field unlabeled item constructor and a navigation configuration are intentionally
  // token-identical. The resolved owner type decides which semantic validator owns the block.
  if (Type.ofConfiguredValue(value).kind === 'item' && typeName !== 'Local' && typeName !== 'Memory') {
    return
  }
  const contracts: Record<string, { slots: readonly string[]; required: readonly string[] }> = {
    StackNav: { slots: ['Initial'], required: ['Initial'] },
    SlotNav: { slots: ['Initial'], required: ['Initial'] },
    OverlayNav: { slots: [], required: [] },
    Local: { slots: ['StorageKey'], required: ['StorageKey'] },
    Memory: { slots: [], required: [] },
  }
  const contract = contracts[typeName]
  if (!contract) {
    ctx.error(navigationValidationMessages.unsupportedConfiguredType(typeName), value)
    return
  }
  const entries = new Map<string, AST.ConfigurationEntry>()
  for (const entry of value.block.entries) {
    if (!contract.slots.includes(entry.name)) {
      ctx.error(navigationValidationMessages.unknownConfiguration(typeName, entry.name), entry)
      continue
    }
    if (entries.has(entry.name)) {
      ctx.error(navigationValidationMessages.duplicateConfiguration(typeName, entry.name), entry)
    }
    entries.set(entry.name, entry)
  }
  for (const required of contract.required) {
    if (!entries.has(required)) {
      ctx.error(navigationValidationMessages.missingConfiguration(typeName, required), value)
    }
  }
  const initial = entries.get('Initial')
  if (initial) {
    const actual = Type.ofExpression(initial.value)
    const expected: ASTUtils.TaoType = typeName === 'StackNav'
      ? { kind: 'primitive', primitive: 'ui' }
      : { kind: 'union', members: [{ kind: 'primitive', primitive: 'ui' }, { kind: 'primitive', primitive: 'nav' }] }
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        navigationValidationMessages.initialType(typeName, Type.displayName(expected), Type.displayName(actual)),
        initial,
      )
    }
  }
  if (typeName === 'Local') {
    if (!AST.isProviderConfiguredValue(value) || !value.with) {
      ctx.error(navigationValidationMessages.localWith, value)
    }
    const storageKey = entries.get('StorageKey')?.value
    if (storageKey) {
      const actual = Type.ofExpression(storageKey)
      if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'text' })) {
        ctx.error(navigationValidationMessages.storageKeyType, storageKey)
      }
      if (AST.isStringLiteral(storageKey) && storageKey.value.length === 0) {
        ctx.error(navigationValidationMessages.storageKeyEmpty, storageKey)
      }
    }
  }
}

function reportBindingDiagnostic(
  view: AST.VisualDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  Switch.kind(diagnostic, {
    'missing-argument': diagnostic => {
      ctx.error(
        navigationValidationMessages.missingArgument(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'unmatched-argument': diagnostic => {
      ctx.error(navigationValidationMessages.unmatchedArgument(view.name), diagnostic.argument)
    },
    'ambiguous-argument': diagnostic => {
      ctx.error(navigationValidationMessages.ambiguousArgument(view.name, diagnostic.parameters), diagnostic.argument)
    },
    'ambiguous-parameter': diagnostic => {
      ctx.error(
        navigationValidationMessages.ambiguousParameter(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'duplicate-argument-type': diagnostic => {
      ctx.error(navigationValidationMessages.duplicateArgumentType(view.name), diagnostic.argument)
    },
    'duplicate-parameter-type': diagnostic => {
      ctx.error(
        navigationValidationMessages.duplicateParameterType(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'unknown-named-argument': diagnostic => {
      ctx.error(navigationValidationMessages.unknownNamedArgument(view.name, diagnostic.name), diagnostic.argument)
    },
    'duplicate-named-argument': diagnostic => {
      ctx.error(
        navigationValidationMessages.duplicateNamedArgument(view.name, Type.parameterName(diagnostic.parameter)),
        diagnostic.argument,
      )
    },
    'named-argument-type': diagnostic => {
      ctx.error(
        navigationValidationMessages.namedArgumentType(
          view.name,
          Type.parameterName(diagnostic.parameter),
          Type.displayName(Type.ofParameter(diagnostic.parameter)),
          Type.displayName(Type.ofArgument(diagnostic.argument)),
        ),
        diagnostic.argument,
      )
    },
  })
}
