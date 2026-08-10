import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

/** navigationValidationMessages declares structural and typed stack diagnostics. */
export const navigationValidationMessages = {
  duplicateDestination: (stack: string, destination: string) =>
    `Stack ${stack} declares destination '${destination}' more than once.`,
  missingInitial: (stack: string, destination: string) =>
    `Stack ${stack} initial destination '${destination}' is not declared.`,
  parameterizedInitial: (stack: string, destination: string) =>
    `Stack ${stack} initial destination '${destination}' must not require arguments.`,
  unknownDestination: (stack: string, destination: string) =>
    `Stack ${stack} has no destination named '${destination}'.`,
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
    `Named argument '.${name}' of destination ${destination} expects ${expected}, got ${actual}.`,
} as const

/** validateNavigation validates declared stacks and presentation calls. */
export function validateNavigation(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const stack of AST.streamAllContents(file).filter(AST.isStackDeclaration)) {
    validateStack(stack, ctx)
  }
  for (const presentation of AST.streamAllContents(file).filter(AST.isPresentStatement)) {
    validatePresentation(presentation, ctx)
  }
}

function validateStack(stack: AST.StackDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const destination of stack.block.destinations) {
    const name = destination.view.$refText
    if (seen.has(name)) {
      ctx.error(navigationValidationMessages.duplicateDestination(stack.name, name), destination)
    }
    seen.add(name)
  }

  const initialName = stack.block.initial.destinationName
  const initial = stack.block.destinations.find(destination => destination.view.$refText === initialName)
  if (!initial) {
    ctx.error(navigationValidationMessages.missingInitial(stack.name, initialName), stack.block.initial)
    return
  }
  const initialView = initial.view.ref
  if (initialView && AST.parametersOf(initialView).length > 0) {
    ctx.error(navigationValidationMessages.parameterizedInitial(stack.name, initialName), stack.block.initial)
  }
}

function validatePresentation(presentation: AST.PresentStatement, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveNavigationInvocation(presentation)
  const stack = resolved.stack
  if (!stack) {
    return
  }
  if (!resolved.destination || !resolved.view) {
    ctx.error(
      navigationValidationMessages.unknownDestination(stack.name, presentation.destinationName),
      presentation,
    )
    return
  }

  for (const diagnostic of resolved.diagnostics) {
    reportBindingDiagnostic(resolved.view, diagnostic, presentation, ctx)
  }
}

function reportBindingDiagnostic(
  view: AST.ViewDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  presentation: AST.PresentStatement,
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
