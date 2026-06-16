import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationProblem } from 'typir'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

type TaoSpecificsForProblems = TaoSpecifics

/** ExpressionsValidator validates and inspects Tao expression types. */
export const ExpressionsValidator = {
  inferExpressionType,
  validateTypirProblems,
}

/** inferExpressionType returns the Typir-inferred type name for a Tao expression. */
function inferExpressionType(
  expression: AST.Expression,
  typir: TaoTypirServices,
): string | undefined {
  return TypeSystemHelpers.safeInferType(typir, expression)?.getName()
}

/** validateTypirProblems reports Typir validation problems as Tao validator diagnostics. */
function validateTypirProblems(
  file: AST.TaoFile,
  typir: TaoTypirServices,
  ctx: ValidationContext,
): void {
  for (const problem of collectTypirProblems(file, typir)) {
    const node = ASTUtils.isNode(problem.languageNode) ? problem.languageNode : file
    ctx.error(problem.message, node)
  }
}

function collectTypirProblems(
  file: AST.TaoFile,
  typir: TaoTypirServices,
): ValidationProblem<TaoSpecificsForProblems>[] {
  return [
    ...typir.validation.Collector.validateBefore(file),
    ...ASTUtils.streamAllContents(file).flatMap(node => typir.validation.Collector.validate(node)),
    ...typir.validation.Collector.validateAfter(file),
  ]
}
