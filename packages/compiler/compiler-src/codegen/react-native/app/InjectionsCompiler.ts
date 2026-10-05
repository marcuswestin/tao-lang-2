import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Switch, Text } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'
import {
  type InlineInjection,
  inlineInjectionBindingName,
} from './injection-plan'
import { compileNativeParameter } from './reactive-parameters'

export const InjectionsCompiler = {
  /** Injection calls an isolated generated module with only explicitly declared values. */
  Injection(injection: AST.Injection): Compiled {
    return CompileRawInjection(injection)
  },

  /** InjectionBoundary emits authored TypeScript in a module with only the public ambient bindings. */
  InjectionBoundary(injection: InlineInjection): Compiled {
    const argumentList = AST.isConfigurationImplementation(injection)
      ? []
      : AST.injectionArgumentsOf(injection)
    const parameters = gen.join(argumentList, CompileInjectionParameter)
    const code = stripTsFence(injection.tsCodeBlock)

    return gen`
      import TR from '@runtime/TR'
      import * as RN from 'react-native'

      void TR
      void RN

      export default function(${parameters}) {
        ${gen.textLines(code)}
      }
    `
  },
} as const

function CompileRawInjection(injection: AST.Injection): Compiled {
  const argumentList = AST.injectionArgumentsOf(injection)
  const ambientProps = injectionAmbientProps(injection)
  const values = gen.join(argumentList, argument => CompileInjectionValue(argument, ambientProps))
  const binding = { name: inlineInjectionBindingName(injection) }

  return gen`Reflect.apply(${gen.Name(binding)}, undefined, [${values}])`
}

/**
 * injectionAmbientProps resolves the props a `render inject` root's `@@layout`/`@@tag` ambients
 * read. `render inject` is only ever the sole root render statement of its owning view (validated),
 * so that view's own header -- once merged with what it received from its own caller -- is exactly
 * the occurrence-root chain those ambients should see (Decisions §R9).
 */
function injectionAmbientProps(injection: AST.Injection): Compiled {
  const owningView = AST.findOwningView(injection)
  return owningView?.layoutClause ? gen`_DeclarationProps` : gen`_ViewProps.__tao`
}

function CompileInjectionParameter(argument: AST.InjectionArgument): Compiled {
  const name = ASTUtils.injectionArgumentName(argument)
  if (AST.isNamedInjectionArgument(argument) && argument.ambient) {
    return gen`${gen.Name({ name })}: ${CompileAmbientParameterType(argument.ambient)}`
  }
  const expression = argument.value
  Assert.defined(expression, 'validated ordinary injection argument has a Tao expression')
  const parameter = AST.isValueReference(expression) ? expression.target.ref : undefined
  const type = CompileExpressionJsType(expression)
  return gen`${gen.Name({ name })}: ${
    AST.isParameterDeclaration(parameter) && parameter.mutable
      ? gen`{ value: ${type}; change(next: ${type}): void }`
      : type
  }`
}

function CompileInjectionValue(argument: AST.InjectionArgument, ambientProps: Compiled): Compiled {
  if (AST.isNamedInjectionArgument(argument) && argument.ambient) {
    return CompileAmbientValue(argument.ambient, ambientProps)
  }
  const expression = argument.value
  Assert.defined(expression, 'validated ordinary injection argument has a Tao expression')
  const parameter = AST.isValueReference(expression) ? expression.target.ref : undefined
  return AST.isParameterDeclaration(parameter) && parameter.mutable
    ? compileNativeParameter(parameter)
    : gen`${Compile.Expression(expression)}.jsValue`
}

function CompileAmbientParameterType(ambient: AST.RenderAmbientChannel): Compiled {
  return Switch(ambient.channel, {
    '@@content': () => gen`import('react').ReactNode`,
    '@@layout': () => gen`ReturnType<typeof TR.VisualLayout>`,
    '@@tag': () => gen`string | undefined`,
  })
}

function CompileAmbientValue(ambient: AST.RenderAmbientChannel, ambientProps: Compiled): Compiled {
  return Switch(ambient.channel, {
    '@@content': () => gen`_ViewProps.children`,
    '@@layout': () => gen`TR.VisualLayout(${ambientProps})`,
    '@@tag': () => gen`TR.VisualTag(${ambientProps})`,
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
        numeric: () => gen`number`,
        none: () => gen`null`,
        text: () => gen`string`,
        time: () => gen`number`,
        duration: () => gen`number`,
        // A color is its design name; the mounted design resolves it.
        color: () => gen`string`,
        shortcut: () => gen`string`,
        command: () => gen`TR.CommandValue`,
        design: () => gen`any`,
        view: () => gen`import('react').ReactNode`,
        scene: () => gen`import('react').ReactNode`,
        nav: () => gen`TR.NavigationValue`,
        datasource: () => gen`any`,
        data: () => gen`any`,
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
