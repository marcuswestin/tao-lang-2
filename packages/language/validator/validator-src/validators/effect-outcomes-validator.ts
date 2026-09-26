import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** effectOutcomeValidationMessages declares `when do` diagnostics and the unhandled-failure warning. */
const effectOutcomeValidationMessages = {
  duplicateOutcome: (outcome: string) => `Outcome '${outcome}' is named more than once in this \`when do\`.`,
  unknownOutcome: (outcome: string, effect: string) =>
    `'${outcome}' is not an outcome of ${effect}; name \`saved\`, \`rejected\`, \`error\`, or a case it declares.`,
  savedPayload: '`saved` carries no message, so it takes no name.',
  emptyPayload: (outcome: string) => `\`${outcome}\` carries no message, so it takes no name.`,
  unhandledFailure: (effect: string, cases: readonly string[]) =>
    `${capitalized(effect)} can fail with ${
      caseList(cases)
    }, and nothing here handles it; use \`when do\` to name what happens.`,
  unhandledOutcome: (effect: string, cases: readonly string[]) =>
    `${capitalized(effect)} can fail with ${
      caseList(cases)
    }, and this \`when do\` does not handle it; name it or add \`rejected\`.`,
} as const

/**
 * EffectOutcomesValidator checks `when do` outcomes against the verb's failure contract, and warns
 * where a root invocation leaves a declared failure with nowhere to go.
 */
export const EffectOutcomesValidator = {
  checks: {
    [AST.WhenDoStatement.$type]: (statement, ctx) => {
      validateOutcomes(statement, ctx)
      if (ASTUtils.isRootEffectInvocation(statement)) {
        warnUnhandled(statement, ASTUtils.unhandledOutcomeCases(statement), ctx, 'outcome')
      }
    },
    [AST.DoStatement.$type]: (invocation, ctx) => {
      if (!AST.isWhenDoStatement(invocation.$container)) {
        warnRootInvocation(invocation, ctx)
      }
    },
    [AST.EventHandler.$type]: warnRootInvocation,
    [AST.LoopSelectHandler.$type]: warnRootInvocation,
    [AST.CommandDoClause.$type]: warnRootInvocation,
  } satisfies NodeValidationChecks,
  messages: effectOutcomeValidationMessages,
} as const

function validateOutcomes(statement: AST.WhenDoStatement, ctx: ValidationContext): void {
  const declared = new Set(ASTUtils.invocationFailureCases(statement))
  const effect = ASTUtils.invokedEffect(statement)
  const auth = AST.isAuthLibraryDeclaration(effect, 'SignIn') || AST.isAuthLibraryDeclaration(effect, 'SignOut')
  const words = auth ? ['completed', 'cancelled', 'rejected', 'error'] : ASTUtils.effectOutcomeWords
  const allowed = new Set<string>([...words, ...declared])
  const seen = new Set<string>()
  for (const outcome of statement.outcomes) {
    if (seen.has(outcome.case)) {
      ctx.error(outcome, effectOutcomeValidationMessages.duplicateOutcome(outcome.case))
    }
    seen.add(outcome.case)
    if (!allowed.has(outcome.case)) {
      ctx.error(outcome, effectOutcomeValidationMessages.unknownOutcome(outcome.case, effectName(statement)))
    }
    if (['completed', 'cancelled'].includes(outcome.case) && outcome.payload) {
      ctx.error(outcome.payload, effectOutcomeValidationMessages.emptyPayload(outcome.case))
    }
    if (outcome.case === 'saved' && outcome.payload) {
      ctx.error(outcome.payload, effectOutcomeValidationMessages.savedPayload)
    }
  }
}

function warnRootInvocation(
  invocation: AST.DoStatement | AST.EventHandler | AST.LoopSelectHandler | AST.CommandDoClause,
  ctx: ValidationContext,
): void {
  // An inline command body is its own root; the invocations inside it are warned where they are.
  if (AST.isCommandDoClause(invocation) && AST.isActionExpression(invocation.action)) {
    return
  }
  if (ASTUtils.isRootEffectInvocation(invocation)) {
    warnUnhandled(invocation, ASTUtils.invocationFailureCases(invocation), ctx, 'failure')
  }
}

function warnUnhandled(
  invocation: ASTUtils.EffectInvocation,
  cases: readonly string[],
  ctx: ValidationContext,
  kind: 'failure' | 'outcome',
): void {
  if (cases.length === 0) {
    return
  }
  const message = kind === 'failure'
    ? effectOutcomeValidationMessages.unhandledFailure(effectName(invocation), cases)
    : effectOutcomeValidationMessages.unhandledOutcome(effectName(invocation), cases)
  ctx.warning(AST.isWhenDoStatement(invocation) ? invocation.invocation : invocation, message)
}

function effectName(invocation: ASTUtils.EffectInvocation): string {
  const effect = ASTUtils.invokedEffect(invocation)
  return effect && !AST.isActionExpression(effect) ? `\`${effect.name}\`` : 'this action'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function caseList(cases: readonly string[]): string {
  if (cases.length <= 2) {
    return cases.join(' or ')
  }
  return `${cases.slice(0, -1).join(', ')}, or ${cases.at(-1)}`
}
