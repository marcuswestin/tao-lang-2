import { AST } from '@parser'
import { Switch } from '@shared'
import { type Compiled, gen, genScopeName, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** Expression compiles a Tao expression into a runtime value expression. */
  Expression(expression: AST.Expression): Compiled {
    return Switch.type(expression, {
      NumberLiteral: Compile.NumberLiteral,
      StringLiteral: Compile.StringLiteral,
      ValueReference: Compile.ValueReference,
    })
  },

  /** StringLiteral compiles a Tao string literal into a Tao text value. */
  StringLiteral(str: AST.StringLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(str.value)})`
  },

  /** NumberLiteral compiles a Tao number literal into a Tao number value. */
  NumberLiteral(num: AST.NumberLiteral): Compiled {
    return gen`new TR.Value(${JSON.stringify(num.value)})`
  },

  /** ValueReference compiles an alias or parameter reference into a Tao value expression. */
  ValueReference(reference: AST.ValueReference): Compiled {
    const target = resolveRef(reference.target)
    return Switch.type(target, {
      AliasDeclaration: alias => gen`${genScopeName(alias)}.evaluate()`,
      ParameterDeclaration: parameter => gen`${genScopeName(parameter)}.evaluate()`,
    })
  },
} as const
