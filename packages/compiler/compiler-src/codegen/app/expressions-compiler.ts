import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, refResolved } from '../codegen-util'

/** compileExpression compiles a Tao expression into a runtime value expression. */
export function compileExpression(expression: AST.Expression): Compiled {
  return Switch.type(expression, {
    NumberLiteral: compileNumberLiteral,
    StringLiteral: compileStringLiteral,
    ValueReference: compileValueReference,
  })
}

/** compileStringLiteral compiles a Tao string literal into a Tao text value. */
export function compileStringLiteral(str: AST.StringLiteral): Compiled {
  return gen`taoValue(${JSON.stringify(str.value)})`
}

/** compileNumberLiteral compiles a Tao number literal into a Tao number value. */
export function compileNumberLiteral(num: AST.NumberLiteral): Compiled {
  return gen`taoValue(${num.value})`
}

/** compileValueReference compiles an alias or parameter reference into a Tao value expression. */
export function compileValueReference(reference: AST.ValueReference): Compiled {
  const target = refResolved(reference.target, 'value reference')
  if (AST.isAliasDeclaration(target)) {
    return gen`${target.name}.evaluate()`
  }
  return gen`_ViewProps.${target.name}.evaluate()`
}
