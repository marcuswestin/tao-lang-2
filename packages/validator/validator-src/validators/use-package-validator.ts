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
      ctx.error(usePackageValidationMessages.underivableName(statement.importPath ?? ''), statement)
      continue
    }
    if (seen.has(name)) {
      ctx.error(usePackageValidationMessages.duplicateNamespace(name), statement)
    }
    seen.set(name, statement)
    const resolution = Packages.resolve(ctx.packagesContext, {
      importPath: statement.importPath,
      fromFilePath,
    })
    if (resolution.relation === 'invalid') {
      ctx.error(usePackageValidationMessages.unresolvedPackage(statement.importPath ?? ''), statement)
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
      ctx.error(usePackageValidationMessages.aliasCycle(declaration.name), declaration)
      return
    }
    if (!AST.isViewDeclaration(target)) {
      ctx.error(
        usePackageValidationMessages.aliasTargetKind(declaration.name, aliasTarget.member.$refText),
        declaration,
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
      ctx.error(usePackageValidationMessages.typeAliasCycle(declaration.name), declaration)
      return
    }
    if (resolution.kind === 'invalid' || !AST.isConfigurableDeclaration(resolution.target)) {
      ctx.error(
        usePackageValidationMessages.typeAliasTargetKind(declaration.name, resolution.target.name),
        declaration,
      )
    }
  },
} satisfies NodeValidationChecks
