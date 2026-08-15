import { Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** configurationValidationMessages declares self-hosted construct diagnostics. */
export const configurationValidationMessages = {
  topLevel: (kind: string) => `${kind} declarations are only allowed as top-level declarations.`,
  visible: (kind: string) => `${kind} declarations must declare package, workspace, or public visibility.`,
  duplicateProperty: (name: string) => `Configuration property '${name}' is declared more than once.`,
  duplicateKey: 'A configuration declaration can declare at most one @key item contract.',
  duplicateImplementation: 'A configuration declaration can bind exactly one implementation.',
  missingImplementation: (name: string) => `${name} must bind one package-scope implementation.`,
  protocol: (name: string, expected: string) => `${name} implementation must use the '${expected}' protocol.`,
  sidecarLocation: (path: string) => `Configuration implementation sidecar '${path}' must be a sibling .ts file.`,
  sidecarMissing: (path: string) => `Configuration implementation sidecar '${path}' does not exist.`,
  sidecarDefaultExport: (path: string) => `Configuration implementation sidecar '${path}' must have a default export.`,
  datasourceKey: 'Datasource declarations cannot declare keyed configuration items.',
  keyProperty: (name: string) =>
    `Key type is only valid for a property of a keyed nav declaration; '${name}' is invalid.`,
  propertyType: (name: string) => `Configuration property '${name}' has an unresolved type.`,
} as const

/** configurationValidationChecks validates public declaration contracts and implementation binding. */
export const configurationValidationChecks = {
  [AST.ConfigurableDeclaration.$type]: validateDeclaration,
} satisfies NodeValidationChecks

function validateDeclaration(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
  const kind = AST.isNavDeclaration(declaration) ? 'Nav' : 'Datasource'
  if (!AST.isTaoFile(declaration.$container)) {
    ctx.error(configurationValidationMessages.topLevel(kind), declaration)
  }
  if (!declaration.visibility || declaration.visibility === 'file') {
    ctx.error(configurationValidationMessages.visible(kind), declaration)
  }

  validateConfigurationProperties(declaration, ctx)
  validateConfigurationKeyDeclarations(declaration, ctx)
  validateConfigurationImplementations(declaration, ctx)
}

function validateConfigurationProperties(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
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
}

function validateConfigurationKeyDeclarations(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
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
}

function validateConfigurationImplementations(declaration: AST.ConfigurableDeclaration, ctx: ValidationContext): void {
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
    validateSidecarImplementation(implementation, ctx)
  }
}

function validateSidecarImplementation(
  implementation: AST.ConfigurationImplementation,
  ctx: ValidationContext,
): void {
  const sidecarPath = implementation.sidecarPath
  if (sidecarPath === undefined) {
    return
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
    ctx.error(configurationValidationMessages.sidecarLocation(sidecarPath), implementation)
    return
  }
  if (!FS.existsSync(resolvedSidecarPath)) {
    ctx.error(configurationValidationMessages.sidecarMissing(sidecarPath), implementation)
    return
  }

  let sidecarSource: string
  try {
    sidecarSource = FS.readTextSync(resolvedSidecarPath)
  } catch {
    ctx.error(configurationValidationMessages.sidecarMissing(sidecarPath), implementation)
    return
  }
  if (!hasDefaultExport(sidecarSource)) {
    ctx.error(configurationValidationMessages.sidecarDefaultExport(sidecarPath), implementation)
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path)
}

function hasDefaultExport(source: string): boolean {
  const executableSource = withoutCommentsAndLiterals(source)
  if (/(?:^|[;}\n])\s*export\s+default\s+(?!(?:interface|type)\b)/m.test(executableSource)) {
    return true
  }
  for (const match of executableSource.matchAll(/(?:^|[;}\n])\s*export\s+(?!type\b)\{([^}]*)\}/gm)) {
    const fullMatch = match[0]
    const matchEnd = (match.index ?? 0) + fullMatch.length
    if (/^\s*from\b/.test(executableSource.slice(matchEnd))) {
      continue
    }
    const exports = match[1]?.split(',') ?? []
    if (exports.some(exported => !/^\s*type\b/.test(exported) && /\bas\s+default\s*$/.test(exported))) {
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
