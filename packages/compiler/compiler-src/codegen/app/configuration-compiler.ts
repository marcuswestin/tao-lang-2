import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { compileDeclarationIdentity } from './declaration-identity'
import { compileRuntimeType } from './runtime-type-compiler'

export const ConfigurationCompiler = {
  /** ConfigurableDeclaration emits one declaration-identity binding and evaluates its injection once. */
  ConfigurableDeclaration(declaration: AST.ConfigurableDeclaration): Compiled {
    if (declaration.aliasTarget) {
      return gen.noop()
    }
    const implementation = AST.configurationImplementationOf(declaration)
    Assert.defined(implementation, 'validated configurable declaration has one implementation')
    const factory = configurationFactory(declaration, implementation)
    return AST.configurationPrimitiveOf(declaration) === 'nav'
      ? gen`${gen.scopeName({ name: configurationRuntimeBindingName(declaration) })} = TR.Navigation.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
          ${compileDeclarationIdentity(declaration)},
        )`
      : gen`${gen.scopeName({ name: configurationRuntimeBindingName(declaration) })} = TR.Data.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
          ${compileDeclarationIdentity(declaration)},
        )`
  },

  /** ConfigurationDeclarations emits sidecar-facing TypeScript configuration contracts for one Tao file. */
  ConfigurationDeclarations(taoFile: AST.TaoFile, importLines: readonly string[] = []): Compiled {
    const declarations = taoFile.statements.filter(isRuntimeConfigurableDeclaration)
    const hasProperties = declarations.some(declaration =>
      !declaration.aliasTarget
      && (AST.configurationPropertiesOf(declaration).length > 0
        || (AST.configurationKeyOf(declaration)?.block.properties.length ?? 0) > 0)
    )
    return gen`
      ${gen.textLines(importLines.join('\n'))}
      ${hasProperties ? gen`import type TR from '@runtime/TR'` : gen.noop()}

      ${gen.list(declarations, configurationDeclarationType, { newLines: 2 })}
    `
  },

  /** ConfigurationTypes emits the same contracts inside the generated runtime module. */
  ConfigurationTypes(taoFile: AST.TaoFile): Compiled {
    return gen.list(
      taoFile.statements.filter(isRuntimeConfigurableDeclaration),
      configurationDeclarationType,
      { newLines: 2 },
    )
  },
} as const

/** isRuntimeConfigurableDeclaration excludes app contracts, whose identity belongs to app values. */
export function isRuntimeConfigurableDeclaration(
  declaration: AST.Node,
): declaration is AST.ConfigurableDeclaration {
  if (!AST.isConfigurableDeclaration(declaration)) {
    return false
  }
  const primitive = AST.configurationPrimitiveOf(declaration)
  return primitive === 'nav' || primitive === 'datasource'
}

/** isTransparentConfigurableAlias identifies a pass-through with no declaration identity of its own. */
export function isTransparentConfigurableAlias(
  declaration: AST.Node,
): declaration is AST.TypeDeclaration {
  return AST.isTypeDeclaration(declaration)
    && declaration.aliasTarget !== undefined
    && isRuntimeConfigurableDeclaration(declaration)
}

/** configurationSidecarBindingName returns the local alias for one sidecar's named export. */
export function configurationSidecarBindingName(declaration: AST.ConfigurableDeclaration): string {
  return `__tao_configuration_implementation_${declaration.name}__`
}

/** configurationRuntimeBindingName separates reusable type identities from same-name Tao values. */
export function configurationRuntimeBindingName(declaration: AST.ConfigurableDeclaration): string {
  return `__tao_type_${declaration.name}`
}

/** configurationAliasTargetTypeBindingName is the private imported target config type for an alias. */
export function configurationAliasTargetTypeBindingName(declaration: AST.TypeDeclaration): string {
  const target = declaration.aliasTarget
  Assert.defined(target, 'transparent configurable alias has a target')
  return `__tao_package_${target.namespace.$refText}_${target.member.$refText}Config`
}

function configurationFactory(
  declaration: AST.ConfigurableDeclaration,
  implementation: AST.ConfigurationImplementation,
): Compiled {
  Assert.defined(implementation.path, 'validated configuration implementation names a module')
  return gen`Reflect.apply(
    ${gen.Name({ name: configurationSidecarBindingName(declaration) })},
    undefined,
    [],
  )`
}

function configurationDeclarationType(declaration: AST.ConfigurableDeclaration): Compiled {
  if (declaration.aliasTarget) {
    return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = ${
      gen.Name({ name: configurationAliasTargetTypeBindingName(declaration) })
    }`
  }
  if (AST.configurationPrimitiveOf(declaration) === 'nav') {
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

function normalizedNavConfigurationType(declaration: AST.ConfigurableDeclaration): Compiled {
  const properties = AST.configurationPropertiesOf(declaration)
  const key = AST.configurationKeyOf(declaration)
  if (key !== undefined && hasSplitConfigurationShape(properties, key)) {
    return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
      readonly items: Readonly<Record<string, Readonly<{
        readonly content: TR.Presentable | TR.NavigationValue
        readonly width: TR.Evaluable
        readonly resizable: TR.Evaluable
      }>>>
    }>`
  }
  if (key !== undefined && hasSelectionConfigurationShape(properties, key)) {
    return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
      readonly hostSlots?: TR.NavHostSlotConfiguration
      readonly display: TR.Evaluable
      readonly initial: string
      readonly items: Readonly<Record<string, Readonly<{
        readonly label: TR.Evaluable
        readonly icon?: TR.Evaluable
        readonly content: TR.Presentable | TR.NavigationValue
      }>>>
    }>`
  }

  if (key === undefined && properties.length === 1 && properties[0]?.name === 'Initial') {
    const initialType = Type.ofConfigurationProperty(properties[0])
    // `nav` refines `view`, so a view-typed Initial accepts a presentable or a mounted nav value.
    if (isPrimitive(initialType, 'view')) {
      return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<{
        readonly hostSlots?: TR.NavHostSlotConfiguration
        readonly initial: TR.Presentable | TR.NavigationValue
      }>`
    }
  }

  // A custom sidecar implementation may declare a future profile shape that the compiler does not
  // normalize today. Keep those declarations compilable while making a sidecar prove its own
  // concrete protocol/configuration join in TypeScript.
  return gen`export type ${gen.Name({ name: `${declaration.name}Config` })} = Readonly<Record<string, unknown>>`
}

function hasSplitConfigurationShape(
  properties: readonly AST.ConfigurationProperty[],
  key: AST.ConfigurationKeyDeclaration,
): boolean {
  const content = key.block.properties.find(property => property.name === 'Content')
  const width = key.block.properties.find(property => property.name === 'Width')
  const resizable = key.block.properties.find(property => property.name === 'Resizable')
  return properties.length === 0
    && key.block.properties.length === 3
    && content !== undefined && isPrimitive(Type.ofConfigurationProperty(content), 'view')
    && width !== undefined && isPrimitive(Type.ofConfigurationProperty(width), 'number')
    && resizable !== undefined && isPrimitive(Type.ofConfigurationProperty(resizable), 'boolean')
}

function hasSelectionConfigurationShape(
  properties: readonly AST.ConfigurationProperty[],
  key: AST.ConfigurationKeyDeclaration,
): boolean {
  const initial = properties.find(property => property.name === 'Initial')
  const display = properties.find(property => property.name === 'Display')
  const label = key.block.properties.find(property => property.name === 'Label')
  const icon = key.block.properties.find(property => property.name === 'Icon')
  const content = key.block.properties.find(property => property.name === 'Content')
  return properties.length === 2
    && (key.block.properties.length === 2 || key.block.properties.length === 3)
    && initial !== undefined
    && AST.configurationPropertyIsKey(initial)
    && display !== undefined
    && isPrimitive(Type.ofConfigurationProperty(display), 'text')
    && label !== undefined
    && isPrimitive(Type.ofConfigurationProperty(label), 'text')
    && (icon === undefined || isPrimitive(Type.ofConfigurationProperty(icon), 'text'))
    && content !== undefined
    && isPrimitive(Type.ofConfigurationProperty(content), 'view')
}

function isPrimitive(type: ASTUtils.TaoType, primitive: 'boolean' | 'number' | 'text' | 'view' | 'nav'): boolean {
  return type.kind === 'primitive' && type.primitive === primitive
}

function configurationPropertyType(property: AST.ConfigurationProperty): Compiled {
  return gen`readonly ${gen.jsLiteral(property.name)}: ${compileRuntimeType(Type.ofConfigurationProperty(property))}`
}

function configurationKeyType(key: AST.ConfigurationKeyDeclaration): Compiled {
  return gen`readonly [key: \`@\${string}\`]: Readonly<{
    ${gen.list(key.block.properties, configurationPropertyType)}
  }>`
}
