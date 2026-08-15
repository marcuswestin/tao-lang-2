import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert, Text } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { compileRuntimeType } from './runtime-type-compiler'

export const ConfigurationCompiler = {
  /** ConfigurableDeclaration emits one declaration-identity binding and evaluates its injection once. */
  ConfigurableDeclaration(declaration: AST.ConfigurableDeclaration): Compiled {
    const implementation = AST.configurationImplementationOf(declaration)
    Assert.defined(implementation, 'validated configurable declaration has one implementation')
    const factory = configurationFactory(declaration, implementation)
    return AST.isNavDeclaration(declaration)
      ? gen`${gen.scopeName(declaration)} = TR.Navigation.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
        )`
      : gen`${gen.scopeName(declaration)} = TR.Data.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
        )`
  },

  /** ConfigurationDeclarations emits sidecar-facing TypeScript configuration contracts for one Tao file. */
  ConfigurationDeclarations(taoFile: AST.TaoFile): Compiled {
    const declarations = taoFile.statements.filter(AST.isConfigurableDeclaration)
    const hasProperties = declarations.some(declaration =>
      AST.configurationPropertiesOf(declaration).length > 0
      || (AST.configurationKeyOf(declaration)?.block.properties.length ?? 0) > 0
    )
    return gen`
      ${hasProperties ? gen`import type TR from '@runtime/TR'` : gen.noop()}

      ${gen.list(declarations, configurationDeclarationType, { newLines: 2 })}
    `
  },

  /** ConfigurationTypes emits the same contracts inside the generated runtime module. */
  ConfigurationTypes(taoFile: AST.TaoFile): Compiled {
    return gen.list(
      taoFile.statements.filter(AST.isConfigurableDeclaration),
      configurationDeclarationType,
      { newLines: 2 },
    )
  },
} as const

/** configurationSidecarBindingName returns the generated default-import binding for one implementation. */
export function configurationSidecarBindingName(declaration: AST.ConfigurableDeclaration): string {
  return `__tao_configuration_implementation_${declaration.name}__`
}

function configurationFactory(
  declaration: AST.ConfigurableDeclaration,
  implementation: AST.ConfigurationImplementation,
): Compiled {
  if (implementation.tsCodeBlock !== undefined) {
    const code = stripTsFence(implementation.tsCodeBlock)
    return gen`Reflect.apply(
      function __tao_configuration_implementation__() {
        ${gen.textLines(code)}
      },
      undefined,
      [],
    )`
  }

  Assert.defined(implementation.sidecarPath, 'validated configuration implementation has one source')
  return gen`Reflect.apply(
    ${gen.Name({ name: configurationSidecarBindingName(declaration) })},
    undefined,
    [],
  )`
}

function configurationDeclarationType(declaration: AST.ConfigurableDeclaration): Compiled {
  if (AST.isNavDeclaration(declaration)) {
    return normalizedNavConfigurationType(declaration)
  }
  const properties = AST.configurationPropertiesOf(declaration)
  const key = AST.configurationKeyOf(declaration)
  if (properties.length === 0 && key === undefined) {
    return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<Record<never, never>>`
  }
  return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
    ${gen.list(properties, configurationPropertyType)}
    ${key ? configurationKeyType(key) : gen.noop()}
  }>`
}

function normalizedNavConfigurationType(declaration: AST.NavDeclaration): Compiled {
  const properties = AST.configurationPropertiesOf(declaration)
  const key = AST.configurationKeyOf(declaration)
  if (key !== undefined && hasSelectionConfigurationShape(properties, key)) {
    return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
      readonly display: TR.Evaluable
      readonly initial: string
      readonly items: Readonly<Record<string, Readonly<{
        readonly label: TR.Evaluable
        readonly content: TR.Presentable | TR.NavigationValue
      }>>>
    }>`
  }

  if (key === undefined && properties.length === 1 && properties[0]?.name === 'Initial') {
    const initialType = Type.ofConfigurationProperty(properties[0])
    if (isPrimitive(initialType, 'ui')) {
      return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
        readonly initial: TR.Presentable
      }>`
    }
    if (isPresentableUnion(initialType)) {
      return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
        readonly initial: TR.Presentable | TR.NavigationValue
      }>`
    }
  }

  // A custom inline implementation may declare a future profile shape that the compiler does not
  // normalize today. Keep those declarations compilable while making a sidecar prove its own
  // concrete protocol/configuration join in TypeScript.
  return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<Record<string, unknown>>`
}

function hasSelectionConfigurationShape(
  properties: readonly AST.ConfigurationPropertyDeclaration[],
  key: AST.ConfigurationKeyDeclaration,
): boolean {
  const initial = properties.find(property => property.name === 'Initial')
  const display = properties.find(property => property.name === 'Display')
  const label = key.block.properties.find(property => property.name === 'Label')
  const content = key.block.properties.find(property => property.name === 'Content')
  return properties.length === 2
    && key.block.properties.length === 2
    && initial !== undefined
    && AST.configurationPropertyIsKey(initial)
    && display !== undefined
    && isPrimitive(Type.ofConfigurationProperty(display), 'text')
    && label !== undefined
    && isPrimitive(Type.ofConfigurationProperty(label), 'text')
    && content !== undefined
    && isPresentableUnion(Type.ofConfigurationProperty(content))
}

function isPrimitive(type: ASTUtils.TaoType, primitive: 'text' | 'ui' | 'nav'): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}

function isPresentableUnion(type: ASTUtils.TaoType): boolean {
  return type.kind === 'union'
    && type.members.length === 2
    && type.members.some(member => isPrimitive(member, 'ui'))
    && type.members.some(member => isPrimitive(member, 'nav'))
}

function configurationPropertyType(property: AST.ConfigurationPropertyDeclaration): Compiled {
  return gen`readonly ${gen.jsLiteral(property.name)}: ${compileRuntimeType(Type.ofConfigurationProperty(property))}`
}

function configurationKeyType(key: AST.ConfigurationKeyDeclaration): Compiled {
  return gen`readonly [key: \`@\${string}\`]: Readonly<{
    ${gen.list(key.block.properties, configurationPropertyType)}
  }>`
}

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}
