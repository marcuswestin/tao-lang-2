import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { Switch, Text } from '@shared'
import { type Compiled, gen, genJoin, genName, genTextLines, resolveRef } from '../codegen-util'
import { Compile } from '../Compile'

export const InjectionsCompiler = {
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

function CompileExpressionJsType(
  expression: AST.Expression,
  seenAliases = new Set<AST.AliasDeclaration>(),
  seenStates = new Set<AST.StateDeclaration>(),
): Compiled {
  const actionTarget = ASTUtils.resolveActionTarget(expression)
  if (actionTarget.kind === 'named' || actionTarget.kind === 'dynamic') {
    return gen`TR.ActionValue`
  }

  return Switch.type(expression, {
    ActionExpression: () => gen`TR.ActionValue`,
    NumberLiteral: () => gen`number`,
    StringLiteral: () => gen`string`,
    ValueReference: reference => {
      const target = resolveRef(reference.target)
      return Switch.type(target, {
        ActionDeclaration: () => gen`TR.ActionValue`,
        AliasDeclaration: alias => {
          if (seenAliases.has(alias)) {
            return gen`unknown`
          }
          seenAliases.add(alias)
          return CompileExpressionJsType(alias.value, seenAliases, seenStates)
        },
        ParameterDeclaration: parameter => CompilePrimitiveJsType(parameter.type),
        StateDeclaration: state => {
          if (seenStates.has(state)) {
            return gen`unknown`
          }
          seenStates.add(state)
          return CompileExpressionJsType(state.value, seenAliases, seenStates)
        },
      })
    },
  })
}

function CompilePrimitiveJsType(type: AST.PrimitiveType): Compiled {
  return Switch.value(type, {
    action: () => gen`TR.ActionValue`,
    number: () => gen`number`,
    text: () => gen`string`,
  })
}

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}
