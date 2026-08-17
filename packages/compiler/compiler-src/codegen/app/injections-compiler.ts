import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch, Text } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import {
  type InlineInjection,
  inlineInjectionBindingName,
} from './injection-plan'

export const InjectionsCompiler = {
  /** Injection calls an isolated generated module with only explicitly declared values. */
  Injection(injection: AST.Injection): Compiled {
    return CompileRawInjection(injection)
  },

  /** TypedInjectionExpression wraps a declared TypeScript result as a Tao runtime value. */
  TypedInjectionExpression(injection: AST.TypedInjectionExpression): Compiled {
    return gen`TR.Value(${CompileRawInjection(injection)})`
  },

  /** InjectionBoundary emits authored TypeScript in a module with only the public ambient bindings. */
  InjectionBoundary(injection: InlineInjection): Compiled {
    const argumentList = AST.isConfigurationImplementation(injection)
      ? []
      : AST.injectionArgumentsOf(injection)
    const parameters = gen.join(argumentList, CompileInjectionParameter)
    const resultType = AST.isTypedInjectionExpression(injection)
      ? CompileTaoJsType(Type.ofReference(injection.type))
      : undefined
    const returnAnnotation = resultType ? gen`: ${resultType}` : gen.noop()
    const tsCodeBlock = injection.tsCodeBlock
    Assert.defined(tsCodeBlock, 'inline injection has authored TypeScript')
    const code = stripTsFence(tsCodeBlock)

    return gen`
      import TR from '@runtime/TR'
      import * as RN from 'react-native'

      void TR
      void RN

      export default function(${parameters})${returnAnnotation} {
        ${gen.textLines(code)}
      }
    `
  },
} as const

function CompileRawInjection(injection: AST.Injection | AST.TypedInjectionExpression): Compiled {
  const argumentList = AST.injectionArgumentsOf(injection)
  const values = gen.join(argumentList, CompileInjectionValue)
  const binding = { name: inlineInjectionBindingName(injection) }

  return gen`Reflect.apply(${gen.Name(binding)}, undefined, [${values}])`
}

function CompileInjectionParameter(argument: AST.InjectionArgument): Compiled {
  const name = ASTUtils.injectionArgumentName(argument)
  if (AST.isNamedInjectionArgument(argument) && argument.ambient) {
    return gen`${gen.Name({ name })}: ${CompileAmbientParameterType(argument.ambient)}`
  }
  const expression = argument.value
  Assert.defined(expression, 'validated ordinary injection argument has a Tao expression')
  return gen`${gen.Name({ name })}: ${CompileExpressionJsType(expression)}`
}

function CompileInjectionValue(argument: AST.InjectionArgument): Compiled {
  if (AST.isNamedInjectionArgument(argument) && argument.ambient) {
    return CompileAmbientValue(argument.ambient)
  }
  const expression = argument.value
  Assert.defined(expression, 'validated ordinary injection argument has a Tao expression')
  return gen`${Compile.Expression(expression)}.jsValue`
}

function CompileAmbientParameterType(ambient: AST.RenderAmbientChannel): Compiled {
  return Switch(ambient.channel, {
    '@@content': () => gen`import('react').ReactNode`,
    '@@layout': () => gen`ReturnType<typeof TR.VisualLayout>`,
    '@@tag': () => gen`string | undefined`,
  })
}

function CompileAmbientValue(ambient: AST.RenderAmbientChannel): Compiled {
  return Switch(ambient.channel, {
    '@@content': () => gen`_ViewProps.children`,
    '@@layout': () => gen`TR.VisualLayout(_ViewProps.__tao)`,
    '@@tag': () => gen`TR.VisualTag(_ViewProps.__tao)`,
  })
}

function CompileExpressionJsType(expression: AST.Expression): Compiled {
  return CompileTaoJsType(Type.ofExpression(expression))
}

function CompileTaoJsType(type: ASTUtils.TaoType): Compiled {
  return Switch.kind(type, {
    primitive: type =>
      Switch(type.primitive, {
        action: () => {
          const parameters = type.primitive === 'action' ? type.parameters : []
          return gen`TR.ActionValue<[${
            gen.join(
              parameters,
              parameter => gen`${Compile.RuntimeType(parameter.type)}${parameter.optional ? '?' : ''}`,
            )
          }]>`
        },
        boolean: () => gen`boolean`,
        number: () => gen`number`,
        none: () => gen`null`,
        text: () => gen`string`,
        time: () => gen`number`,
        design: () => gen`any`,
        visual: () => gen`import('react').ReactNode`,
        presentable: () => gen`TR.Presentable`,
        view: () => gen`import('react').ReactNode`,
        layout: () => gen`import('react').ReactNode`,
        frame: () => gen`import('react').ReactNode`,
        nav: () => gen`TR.NavigationValue`,
        ui: () => gen`TR.Presentable`,
        datasource: () => gen`any`,
        app: () => gen`any`,
      }),
    list: type => type.element ? gen`Array<${CompileTaoJsType(type.element)}>` : gen`any[]`,
    item: () => gen`any`,
    entity: () => gen`any`,
    enum: () => gen`TR.EnumCaseIdentity`,
    unresolved: () => gen`any`,
    union: type =>
      type.members.length === 0 ? gen`any` : gen.join(type.members, CompileTaoJsType, { separator: ' | ' }),
  })
}

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}
