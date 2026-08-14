import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** invocationValidationMessages declares render invocation diagnostics. */
const invocationValidationMessages = {
  missingArgument: (view: string, parameter: string) =>
    `Render of ${view} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (view: string) =>
    `Render of ${view} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (view: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Render of ${view} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (view: string, parameter: string) =>
    `Render of ${view} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (view: string, parameter: string) =>
    `Renderable ${view} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (view: string) => `Render of ${view} has more than one argument with the same exact type.`,
  unknownNamedArgument: (view: string, name: string) => `Renderable ${view} has no parameter named '${name}'.`,
  duplicateNamedArgument: (view: string, name: string) =>
    `Render of ${view} provides parameter '${name}' more than once.`,
  namedArgumentType: (view: string, name: string, expected: string, actual: string) =>
    `Labeled argument '${name}:' of ${view} expects ${expected}, got ${actual}.`,
  duplicateEvent: (view: string, event: AST.EventName) => `Render of ${view} configures 'on ${event}' more than once.`,
  unsupportedEvent: (view: string, event: AST.EventName, parameter: string) =>
    `Renderable ${view} cannot handle 'on ${event}'; parameter '${parameter}' must have the standard event action type.`,
  eventArgumentConflict: (view: string, event: AST.EventName, parameter: string) =>
    `Render of ${view} cannot provide both '${parameter}:' and 'on ${event}'.`,
  eventActionType: (view: string, event: AST.EventName, expected: string, actual: string) =>
    `'on ${event}' of ${view} expects ${expected}, got ${actual}.`,
  unexpectedEventPayload: (event: AST.EventName) =>
    `'on ${event}' does not provide a payload; only 'on change' may bind one.`,
  implicitChangeTarget: (view: string) =>
    `Render of ${view} must provide 'on change' because automatic change binding requires `
    + `Value: to directly reference writable text state.`,
} as const

/** InvocationsValidator validates render invocations through shared type-based binding diagnostics. */
export const InvocationsValidator = {
  checks: {
    [AST.Render.$type]: reportInvocationDiagnostics,
  } satisfies NodeValidationChecks,
  messages: invocationValidationMessages,
}

function reportInvocationDiagnostics(render: AST.Render, ctx: ValidationContext): void {
  const invocation = ASTUtils.resolveRenderInvocation(render)
  if (!invocation.view) {
    return
  }
  const view = invocation.view
  for (const diagnostic of invocation.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.missingArgument(view.name, Type.parameterName(diagnostic.parameter)),
          render,
        )
      },
      'unmatched-argument': diagnostic => {
        ctx.error(invocationValidationMessages.unmatchedArgument(view.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.ambiguousArgument(view.name, diagnostic.parameters),
          diagnostic.argument,
        )
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(
          invocationValidationMessages.ambiguousParameter(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          render,
        )
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(invocationValidationMessages.duplicateArgumentType(view.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(
          invocationValidationMessages.duplicateParameterType(
            view.name,
            Type.parameterName(diagnostic.parameter),
          ),
          render,
        )
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(invocationValidationMessages.unknownNamedArgument(view.name, diagnostic.name), diagnostic.argument)
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          invocationValidationMessages.duplicateNamedArgument(view.name, Type.parameterName(diagnostic.parameter)),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          invocationValidationMessages.namedArgumentType(
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
  for (const diagnostic of invocation.eventDiagnostics) {
    Switch.kind(diagnostic, {
      'duplicate-event': diagnostic => {
        ctx.error(
          invocationValidationMessages.duplicateEvent(view.name, diagnostic.handler.event),
          diagnostic.handler,
        )
      },
      'unsupported-event': diagnostic => {
        const parameter = diagnostic.parameter
          ? Type.parameterName(diagnostic.parameter)
          : eventParameterName(diagnostic.handler.event)
        ctx.error(
          invocationValidationMessages.unsupportedEvent(view.name, diagnostic.handler.event, parameter),
          diagnostic.handler,
        )
      },
      'event-argument-conflict': diagnostic => {
        ctx.error(
          invocationValidationMessages.eventArgumentConflict(
            view.name,
            diagnostic.handler.event,
            Type.parameterName(diagnostic.parameter),
          ),
          diagnostic.handler,
        )
      },
      'event-action-type': diagnostic => {
        ctx.error(
          invocationValidationMessages.eventActionType(
            view.name,
            diagnostic.handler.event,
            Type.displayName(Type.ofParameter(diagnostic.parameter)),
            Type.displayName(diagnostic.actual),
          ),
          diagnostic.handler,
        )
      },
      'unexpected-event-payload': diagnostic => {
        ctx.error(
          invocationValidationMessages.unexpectedEventPayload(diagnostic.handler.event),
          diagnostic.handler.payload ?? diagnostic.handler,
        )
      },
      'implicit-change-target': diagnostic => {
        ctx.error(
          invocationValidationMessages.implicitChangeTarget(view.name),
          diagnostic.valueArgument,
        )
      },
    })
  }
}

function eventParameterName(event: AST.EventName): string {
  return `${event[0]!.toUpperCase()}${event.slice(1)}`
}
