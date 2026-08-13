import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** configurationValidationMessages declares self-hosted construct diagnostics. */
export const configurationValidationMessages = {
  topLevel: (kind: string) => `${kind} declarations are only allowed as top-level declarations.`,
  visible: (kind: string) => `${kind} declarations must declare package, workspace, or public visibility.`,
  duplicateProperty: (name: string) => `Configuration property '${name}' is declared more than once.`,
  duplicateKey: 'A configuration declaration can declare at most one @key item contract.',
  duplicateImplementation: 'A configuration declaration can bind exactly one implementation.',
  missingImplementation: (name: string) => `${name} must bind one package-scope implementation.`,
  protocol: (name: string, expected: string) => `${name} implementation must use the '${expected}' protocol.`,
  datasourceKey: 'Datasource declarations cannot declare keyed configuration items.',
  keyProperty: (name: string) =>
    `Key type is only valid for a property of a keyed nav declaration; '${name}' is invalid.`,
  propertyType: (name: string) => `Configuration property '${name}' has an unresolved type.`,
} as const

/** validateConfigurationDeclarations validates public declaration contracts and implementation binding. */
export function validateConfigurationDeclarations(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const declaration of AST.streamAllContents(file).filter(AST.isConfigurableDeclaration)) {
    validateDeclaration(declaration, ctx)
  }
}

function validateDeclaration(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const kind = AST.isNavDeclaration(declaration) ? 'Nav' : 'Datasource'
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(configurationValidationMessages.topLevel(kind), declaration)
  }
  if (!declaration.visibility || declaration.visibility === 'file') {
    ctx.error(configurationValidationMessages.visible(kind), declaration)
  }

  const seen = new Set<string>()
  for (const property of AST.configurationPropertiesOf(declaration)) {
    if (seen.has(property.name)) {
      ctx.error(configurationValidationMessages.duplicateProperty(property.name), property)
    }
    seen.add(property.name)
    if (Type.ofConfigurationProperty(property).kind === 'unresolved') {
      ctx.error(configurationValidationMessages.propertyType(property.name), property.type)
    }
    if (AST.configurationPropertyIsKey(property) && !AST.configurationKeyOf(declaration)) {
      ctx.error(configurationValidationMessages.keyProperty(property.name), property.type)
    }
  }

  const keys = declaration.block.entries.filter(AST.isConfigurationKeyDeclaration)
  if (keys.length > 1) {
    for (const key of keys.slice(1)) {
      ctx.error(configurationValidationMessages.duplicateKey, key)
    }
  }
  if (AST.isDatasourceDeclaration(declaration)) {
    for (const key of keys) {
      ctx.error(configurationValidationMessages.datasourceKey, key)
    }
  }
  for (const key of keys) {
    const keyProperties = new Set<string>()
    for (const property of key.block.properties) {
      if (keyProperties.has(property.name)) {
        ctx.error(configurationValidationMessages.duplicateProperty(property.name), property)
      }
      keyProperties.add(property.name)
      if (AST.configurationPropertyIsKey(property)) {
        ctx.error(configurationValidationMessages.keyProperty(property.name), property.type)
      }
      if (Type.ofConfigurationProperty(property).kind === 'unresolved') {
        ctx.error(configurationValidationMessages.propertyType(property.name), property.type)
      }
    }
  }

  const implementations = declaration.block.entries.filter(AST.isConfigurationImplementation)
  if (implementations.length === 0) {
    ctx.error(configurationValidationMessages.missingImplementation(declaration.name), declaration)
  }
  if (implementations.length > 1) {
    for (const implementation of implementations.slice(1)) {
      ctx.error(configurationValidationMessages.duplicateImplementation, implementation)
    }
  }
  const expectedProtocol = AST.isNavDeclaration(declaration) ? 'nav' : 'provider'
  for (const implementation of implementations) {
    if (implementation.protocol !== expectedProtocol) {
      ctx.error(configurationValidationMessages.protocol(declaration.name, expectedProtocol), implementation)
    }
  }
}
