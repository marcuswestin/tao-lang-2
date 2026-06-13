import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationProblem } from 'typir'
import { safeInferType, type TaoTypirServices } from './type-system'
import type { ValidationContext } from './validation'

/** inferExpressionType returns the Typir-inferred type name for a Tao expression. */
export function inferExpressionType(expression: AST.Expression, typir: TaoTypirServices): string | undefined {
  return safeInferType(typir, expression)?.getName()
}

/** validateTypirProblems reports Typir validation problems as Tao validator diagnostics. */
export function validateTypirProblems(file: AST.TaoFile, typir: TaoTypirServices, ctx: ValidationContext): void {
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

type TaoSpecificsForProblems = import('./type-system').TaoSpecifics
