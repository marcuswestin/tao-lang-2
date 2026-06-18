import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import { Text } from '@shared'
import { type Compiled, gen, genJoin, genName, genTextLines } from '../codegen-util'
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
  const type = Type.ofExpression(expression)
  if (type.kind === 'primitive') {
    return type.primitive === 'number' ? gen`number` : gen`string`
  }
  if (type.kind === 'list') {
    return gen`any[]`
  }
  return gen`any`
}

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}
