import { Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Text } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { completenessValidationMessages } from './completeness-validator'

/** configurationValidationMessages declares self-hosted construct diagnostics. */
export const configurationValidationMessages = {
  topLevel: (kind: string) => `${kind} declarations are only allowed as top-level declarations.`,
  duplicateProperty: (name: string) => `Configuration property '${name}' is declared more than once.`,
  duplicateKey: 'A configuration declaration can declare at most one @key item contract.',
  duplicateImplementation: 'A configuration declaration can bind exactly one implementation.',
  missingImplementation: (name: string) => `${name} must bind one package-scope implementation.`,
  protocol: (name: string, expected: string) => `${name} implementation must use the '${expected}' protocol.`,
  sidecarLocation: (path: string) => `Configuration implementation sidecar '${path}' must be a sibling .ts file.`,
  sidecarMissing: (path: string) => `Configuration implementation sidecar '${path}' does not exist.`,
  sidecarNamedExport: (path: string, name: string) =>
    `Configuration implementation sidecar '${path}' must export '${name}'.`,
  datasourceKey: 'Datasource declarations cannot declare keyed configuration items.',
  keyProperty: (name: string) =>
    `Key type is only valid for a property of a keyed nav declaration; '${name}' is invalid.`,
  propertyType: (name: string) => `Configuration property '${name}' has an unresolved type.`,
  propertyDefaultType: (name: string, expected: string, actual: string) =>
    `Default value for configuration property '${name}' expects ${expected}, got ${actual}.`,
  valueHeadType: (name: string, expected: string, actual: string) =>
    `${expected} head ${name} expects ${expected}, got ${actual}.`,
} as const

/** configurationValidationChecks validates public declaration contracts and implementation binding. */
export const configurationValidationChecks = {
  [AST.TypeDeclaration.$type]: (declaration, ctx) => {
    if (AST.isConfigurableDeclaration(declaration)) {
      validateDeclaration(declaration, ctx)
    }
  },
  [AST.NavDeclaration.$type]: (declaration, ctx) => validatePrimitiveValue(declaration, 'nav', ctx),
  [AST.DatasourceDeclaration.$type]: (declaration, ctx) => validatePrimitiveValue(declaration, 'datasource', ctx),
} satisfies NodeValidationChecks

/** validateConfigurationSidecarFiles checks sidecar existence and exports without blocking structural validation. */
export async function validateConfigurationSidecarFiles(
  file: AST.TaoFile,
  ctx: ValidationContext,
): Promise<void> {
  for (const implementation of AST.streamAllContents(file).filter(AST.isConfigurationImplementation)) {
    if (!sidecarLocationIsValid(implementation)) {
      continue
    }
    const sidecarPath = implementation.path!
    const documentDirectory = FS.resolvePath(FS.dirname(AST.getDocument(implementation).uri.path))
    const resolvedSidecarPath = FS.resolvePath(sidecarPath, documentDirectory)
    // A synthetic in-memory document has no directory to read, so only path-shape rules apply.
    if (!await FS.isDirectory(documentDirectory)) {
      continue
    }
    if (!await FS.exists(resolvedSidecarPath)) {
      ctx.error(configurationValidationMessages.sidecarMissing(sidecarPath), implementation)
      continue
    }
    let sidecarSource: string
    try {
      sidecarSource = await FS.readText(resolvedSidecarPath)
    } catch {
      ctx.error(configurationValidationMessages.sidecarMissing(sidecarPath), implementation)
      continue
    }
    if (!hasNamedExport(sidecarSource, implementation.exportName)) {
      ctx.error(
        configurationValidationMessages.sidecarNamedExport(sidecarPath, implementation.exportName),
        implementation,
      )
    }
  }
}

function validateDeclaration(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const primitive = AST.configurationPrimitiveOf(declaration)
  if (primitive === 'app') {
    validateConfigurationProperties(declaration, ctx)
    return
  }
  if (primitive !== 'nav' && primitive !== 'datasource') {
    return
  }
  const kind = primitive === 'nav' ? 'Nav' : 'Datasource'
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(configurationValidationMessages.topLevel(kind), declaration)
  }

  validateConfigurationProperties(declaration, ctx)
  validateConfigurationKeyDeclarations(declaration, ctx)
  validateConfigurationImplementations(declaration, ctx)
}

function validateConfigurationProperties(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const property of ownTypeSlots(declaration)?.properties ?? []) {
    if (seen.has(property.name)) {
      ctx.error(configurationValidationMessages.duplicateProperty(property.name), property)
    }
    seen.add(property.name)
    if (Type.ofConfigurationProperty(property).kind === 'unresolved') {
      ctx.error(configurationValidationMessages.propertyType(property.name), property.type ?? property)
    }
    validateConfigurationPropertyDefault(property, ctx)
    if (AST.configurationPropertyIsKey(property) && !AST.configurationKeyOf(declaration)) {
      ctx.error(configurationValidationMessages.keyProperty(property.name), property.type ?? property)
    }
  }
}

function validateConfigurationKeyDeclarations(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const keys = ownTypeSlots(declaration)?.keys ?? []
  if (keys.length > 1) {
    for (const key of keys.slice(1)) {
      ctx.error(configurationValidationMessages.duplicateKey, key)
    }
  }
  if (AST.configurationPrimitiveOf(declaration) === 'datasource') {
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
      validateConfigurationPropertyDefault(property, ctx)
    }
  }
}

function validateConfigurationImplementations(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const implementations = ownTypeSlots(declaration)?.implementations ?? []
  if (implementations.length > 1) {
    for (const implementation of implementations.slice(1)) {
      ctx.error(configurationValidationMessages.duplicateImplementation, implementation)
    }
  }
  if (!AST.configurationImplementationOf(declaration)) {
    ctx.error(configurationValidationMessages.missingImplementation(declaration.name), declaration)
  }
  const expectedProtocol = AST.configurationPrimitiveOf(declaration) === 'nav' ? 'nav' : 'provider'
  for (const implementation of implementations) {
    if (implementation.protocol !== expectedProtocol) {
      ctx.error(configurationValidationMessages.protocol(declaration.name, expectedProtocol), implementation)
    }
    validateSidecarLocation(implementation, ctx)
  }
}

function validatePrimitiveValue(
  declaration: AST.NavDeclaration | AST.DatasourceDeclaration,
  primitive: 'nav' | 'datasource',
  ctx: ValidationContext,
): void {
  if (declaration.value) {
    const actual = Type.ofExpression(declaration.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive })) {
      ctx.error(
        configurationValidationMessages.valueHeadType(declaration.name, primitive, Type.displayName(actual)),
        declaration.value,
      )
    }
    return
  }
  if (declaration.block) {
    const required = AST.primitiveOwnSlots(ctx.workspaceFiles, primitive)
      .filter(Type.propertyRequiresValue)
      .map(property => property.name)
    if (required.length > 0) {
      ctx.error(completenessValidationMessages.incomplete(declaration.name, required), declaration.block)
    }
  }
}

function validateConfigurationPropertyDefault(
  property: AST.ConfigurationProperty,
  ctx: ValidationContext,
): void {
  if (!property.value || !property.type) {
    return
  }
  const expected = Type.ofReference(property.type)
  const actual = Type.ofExpression(property.value)
  const absent = actual.kind === 'primitive' && actual.primitive === 'none'
  if (
    !absent && expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)
  ) {
    ctx.error(
      configurationValidationMessages.propertyDefaultType(
        property.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      property.value,
    )
  }
}

function ownTypeSlots(declaration: AST.TypeDeclaration): AST.ItemTypeExpression | undefined {
  return declaration.type && AST.isDerivedTypeExpression(declaration.type)
    ? declaration.type.slots
    : declaration.type && AST.isItemTypeExpression(declaration.type)
    ? declaration.type
    : undefined
}

function validateSidecarLocation(
  implementation: AST.ConfigurationImplementation,
  ctx: ValidationContext,
): void {
  if (!sidecarLocationIsValid(implementation) && implementation.path !== undefined) {
    ctx.error(configurationValidationMessages.sidecarLocation(implementation.path), implementation)
  }
}

function sidecarLocationIsValid(implementation: AST.ConfigurationImplementation): boolean {
  const sidecarPath = implementation.path
  if (sidecarPath === undefined) {
    return false
  }

  const documentPath = AST.getDocument(implementation).uri.path
  const documentDirectory = FS.resolvePath(FS.dirname(documentPath))
  const resolvedSidecarPath = FS.resolvePath(sidecarPath, documentDirectory)
  if (
    isAbsolutePath(sidecarPath)
    || FS.extname(sidecarPath) !== '.ts'
    || sidecarPath.endsWith('.d.ts')
    || FS.dirname(resolvedSidecarPath) !== documentDirectory
  ) {
    return false
  }
  return true
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path)
}

function hasNamedExport(source: string, name: string): boolean {
  const executableSource = withoutCommentsAndLiterals(source)
  const escaped = Text.escapeRegExp(name)
  const declared = new RegExp(
    `(?:^|[;}\\n])\\s*export\\s+(?!type\\b)(?:async\\s+)?(?:const|let|var|function|class)\\s+${escaped}\\b`,
    'm',
  )
  if (declared.test(executableSource)) {
    return true
  }
  for (const match of executableSource.matchAll(/(?:^|[;}\n])\s*export\s+(?!type\b)\{([^}]*)\}/gm)) {
    const exports = match[1]?.split(',') ?? []
    if (exports.some(exported => new RegExp(`(?:\\bas\\s+${escaped}|^\\s*${escaped})\\s*$`).test(exported))) {
      return true
    }
  }
  return false
}

/** withoutCommentsAndLiterals keeps statement punctuation while blanking false export text. */
function withoutCommentsAndLiterals(source: string): string {
  let result = ''
  let state: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'code'
  for (let index = 0; index < source.length; index++) {
    const character = source[index] ?? ''
    const next = source[index + 1] ?? ''
    if (state === 'code') {
      if (character === '/' && next === '/') {
        result += '  '
        index++
        state = 'line-comment'
      } else if (character === '/' && next === '*') {
        result += '  '
        index++
        state = 'block-comment'
      } else if (character === "'") {
        result += ' '
        state = 'single'
      } else if (character === '"') {
        result += ' '
        state = 'double'
      } else if (character === '`') {
        result += ' '
        state = 'template'
      } else {
        result += character
      }
      continue
    }

    if (character === '\n') {
      result += '\n'
      if (state === 'line-comment') {
        state = 'code'
      }
      continue
    }
    if (state === 'block-comment' && character === '*' && next === '/') {
      result += '  '
      index++
      state = 'code'
      continue
    }
    if (
      (state === 'single' && character === "'")
      || (state === 'double' && character === '"')
      || (state === 'template' && character === '`')
    ) {
      result += ' '
      state = 'code'
      continue
    }
    if ((state === 'single' || state === 'double' || state === 'template') && character === '\\') {
      result += '  '
      index++
      continue
    }
    result += ' '
  }
  return result
}
