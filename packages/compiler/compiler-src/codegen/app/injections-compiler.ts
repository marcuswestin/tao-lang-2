import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Switch, Text } from '@shared'
import { type Compiled, gen, genJoin, genName, genTextLines, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export default {
  /** Injection generates a self-invoked block of the injected TS code. */
  Injection(injection: AST.Injection): Compiled {
    const argumentList = injection.argumentList?.arguments ?? []
    const parameters = genJoin(argumentList, CompileInjectionParameter)
    const values = genJoin(argumentList, CompileInjectionValue)
    const code = stripTsFence(injection.tsCodeBlock)

    return gen`
      Reflect.apply(
        function __injection__(${parameters}) {
          ${genTextLines(code)}
        },
        undefined,
        [${values}],
      )
    `
  },
} as const

function CompileInjectionParameter(argument: AST.InjectionArgument): Compiled {
  const name = ASTUtils.injectionArgumentName(argument)
  return gen`${genName({ name })}: ${CompileExpressionJsType(argument.value)}`
}

function CompileInjectionValue(argument: AST.InjectionArgument): Compiled {
  return gen`${Compile.Expression(argument.value)}.jsValue`
}

function CompileExpressionJsType(expression: AST.Expression): Compiled {
  return Switch.type(expression, {
    NumberLiteral: () => gen`number`,
    StringLiteral: () => gen`string`,
    ValueReference: reference => {
      const target = resolveRef(reference.target)
      return Switch.type(target, {
        AliasDeclaration: alias => CompileExpressionJsType(alias.value),
        ParameterDeclaration: parameter => CompilePrimitiveJsType(parameter.type),
      })
    },
  })
}

function CompilePrimitiveJsType(type: AST.PrimitiveType): Compiled {
  return Switch.value(type, {
    number: () => gen`number`,
    text: () => gen`string`,
  })
}

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}
