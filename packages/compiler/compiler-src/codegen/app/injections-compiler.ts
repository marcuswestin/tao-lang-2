import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Text } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

export const InjectionsCompiler = {
  /** Injection generates a self-invoked block of the injected TS code. */
  Injection(injection: AST.Injection): Compiled {
    const argumentList = AST.injectionArgumentsOf(injection)
    const parameters = gen.join(argumentList, CompileInjectionParameter)
    const values = gen.join(argumentList, CompileInjectionValue)
    const code = stripTsFence(injection.tsCodeBlock)

    return gen`
      Reflect.apply(
        function __injection__(${parameters}) {
          ${gen.textLines(code)}
        },
        undefined,
        [${values}],
      )
    `
  },
} as const

function CompileInjectionParameter(argument: AST.InjectionArgument): Compiled {
  const name = ASTUtils.injectionArgumentName(argument)
  return gen`${gen.name({ name })}: ${CompileExpressionJsType(argument.value)}`
}

function CompileInjectionValue(argument: AST.InjectionArgument): Compiled {
  return gen`${Compile.Expression(argument.value)}.jsValue`
}

function CompileExpressionJsType(expression: AST.Expression): Compiled {
  const type = Type.ofExpression(expression)
  if (type.kind === 'primitive') {
    if (type.primitive === 'action') {
      return gen`TR.ActionValue`
    }
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
