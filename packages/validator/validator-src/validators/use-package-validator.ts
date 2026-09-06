import { Packages } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const usePackageValidationMessages = {
  unresolvedPackage: (importPath: string) => `Cannot resolve package path '${importPath}'.`,
  underivableName: (importPath: string) => `Cannot derive a namespace name from '${importPath}'; name it with \`as\`.`,
  duplicateNamespace: (name: string) => `Package namespace '${name}' is declared more than once in this file.`,
  aliasTargetKind: (name: string, member: string) => `View alias '${name}' must target a view; '${member}' is not one.`,
  aliasCycle: (name: string) => `View alias '${name}' cycles back to itself.`,
  typeAliasTargetKind: (name: string, member: string) =>
    `Type alias '${name}' must target a configurable type; '${member}' is not one.`,
  typeAliasCycle: (name: string) => `Type alias '${name}' cycles back to itself.`,
} as const

/** validatePackageUseStatements validates namespace imports and their derived names. */
export function validatePackageUseStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  const fromFilePath = AST.getDocument(file).uri.path
  const seen = new Map<string, AST.UsePackageStatement>()
  for (const statement of file.statements.filter(AST.isUsePackageStatement)) {
    const name = AST.packageNamespaceName(statement)
    if (!name) {
      ctx.error(statement, usePackageValidationMessages.underivableName(statement.importPath ?? ''))
      continue
    }
    if (seen.has(name)) {
      ctx.error(statement, usePackageValidationMessages.duplicateNamespace(name))
    }
    seen.set(name, statement)
    const resolution = Packages.resolve(ctx.packagesContext, {
      importPath: statement.importPath,
      fromFilePath,
    })
    if (resolution.relation === 'invalid') {
      ctx.error(statement, usePackageValidationMessages.unresolvedPackage(statement.importPath ?? ''))
    }
  }
}

/** usePackageValidationChecks validates pass-through view aliases. */
export const usePackageValidationChecks = {
  [AST.ViewDeclaration.$type]: (declaration, ctx) => {
    const aliasTarget = declaration.aliasTarget
    if (!aliasTarget) {
      return
    }
    const member = aliasTarget.member.ref
    if (!member) {
      // The unresolved reference is already a linker diagnostic.
      return
    }
    const target = AST.viewAliasTarget(declaration)
    if (!target) {
      ctx.error(declaration, usePackageValidationMessages.aliasCycle(declaration.name))
      return
    }
    if (!AST.isViewDeclaration(target)) {
      ctx.error(
        declaration,
        usePackageValidationMessages.aliasTargetKind(declaration.name, aliasTarget.member.$refText),
      )
    }
  },
  [AST.TypeDeclaration.$type]: (declaration, ctx) => {
    const aliasTarget = declaration.aliasTarget
    if (!aliasTarget) {
      return
    }
    const member = aliasTarget.member.ref
    if (!member) {
      return
    }
    const resolution = AST.configurableTypeAliasResolution(declaration)
    if (resolution.kind === 'unresolved') {
      return
    }
    if (resolution.kind === 'cycle') {
      ctx.error(declaration, usePackageValidationMessages.typeAliasCycle(declaration.name))
      return
    }
    if (resolution.kind === 'invalid' || !AST.isConfigurableDeclaration(resolution.target)) {
      ctx.error(
        declaration,
        usePackageValidationMessages.typeAliasTargetKind(declaration.name, resolution.target.name),
      )
    }
  },
} satisfies NodeValidationChecks
