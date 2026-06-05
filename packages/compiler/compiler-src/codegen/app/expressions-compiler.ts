import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genName, resolveRef } from '../codegen-util'
import { Compile } from './Compile'

export default {
  /** CompileExpression compiles a Tao expression into a runtime value expression. */
  CompileExpression(expression: AST.Expression): Compiled {
    return Switch.type(expression, {
      NumberLiteral: Compile.NumberLiteral,
      StringLiteral: Compile.StringLiteral,
      ValueReference: Compile.ValueReference,
    })
  },

  /** CompileStringLiteral compiles a Tao string literal into a Tao text value. */
  CompileStringLiteral(str: AST.StringLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(str.value)})`
  },

  /** CompileNumberLiteral compiles a Tao number literal into a Tao number value. */
  CompileNumberLiteral(num: AST.NumberLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(num.value)})`
  },

  /** CompileValueReference compiles an alias or parameter reference into a Tao value expression. */
  CompileValueReference(reference: AST.ValueReference): Compiled {
    const target = resolveRef(reference.target, 'value reference')
    return Switch.type(target, {
      AliasDeclaration: alias => gen`${genName(alias)}.evaluate()`,
      ParameterDeclaration: parameter => gen`_ViewProps.${genName(parameter)}.evaluate()`,
    })
  },
} as const
