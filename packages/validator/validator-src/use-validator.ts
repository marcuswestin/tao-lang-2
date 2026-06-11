import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { moduleTargetMatchesFile, resolveModulePath } from '@parser/module-resolution'
import type { ValidationContext } from './validation'

/** useValidationMessages declares import diagnostics for Tao use statements. */
export const useValidationMessages = {
  unresolvedModule: (modulePath: string) => `Cannot resolve module path '${modulePath}'.`,
  duplicateImport: (name: string) => `Imported name '${name}' is declared more than once in this use statement.`,
  repeatedImport: (name: string) => `Imported name '${name}' is already imported by an earlier use statement.`,
  localDeclarationCollision: (name: string) => `Imported name '${name}' collides with a declaration in this file.`,
  ambiguousImport: (name: string, modulePath: string) =>
    `'${name}' matches multiple visible declarations in '${modulePath}'.`,
  sameModuleMissing: (name: string) => `'${name}' is not declared in this module.`,
  sameModuleHidden: (name: string) =>
    `'${name}' is marked as 'hide' and cannot be imported from another file in this module.`,
  crossModuleMissing: (name: string, modulePath: string) => `'${name}' is not exported from '${modulePath}'.`,
  crossModuleNotShared: (name: string) => `'${name}' must be marked as 'share' to be imported from this module.`,
  appImport: (name: string) => `App '${name}' cannot be imported.`,
} as const

type DeclarationRecord = {
  name: string
  kind: AST.Declaration['$type']
  visibility?: AST.DeclarationVisibility
}

/** validateUseStatements validates module path resolution and import visibility rules. */
export function validateUseStatements(
  file: AST.TaoFile,
  ctx: ValidationContext,
  options: {
    workspaceFiles: readonly AST.TaoFile[]
    filePath: string
    stdLibRoot?: string
  },
): void {
  const useStatements = file.statements.filter(AST.isUseStatement)
  const localDeclarationNames = new Set(
    file.statements.filter(AST.isDeclaration).map(declaration => declaration.name),
  )
  const previouslyImportedNames = new Set<string>()
  for (const useStatement of useStatements) {
    reportDuplicateImports(useStatement, ctx)
    reportRepeatedAndCollidingImports(useStatement, ctx, localDeclarationNames, previouslyImportedNames)
    validateUseStatement(useStatement, ctx, options)
  }
}

function validateUseStatement(
  useStatement: AST.UseStatement,
  ctx: ValidationContext,
  options: {
    workspaceFiles: readonly AST.TaoFile[]
    filePath: string
    stdLibRoot?: string
  },
): void {
  const resolution = resolveModulePath(useStatement.modulePath, options.filePath, options.stdLibRoot)
  if (!resolution) {
    ctx.error(useValidationMessages.unresolvedModule(useStatement.modulePath), useStatement)
    return
  }

  const targetFiles = options.workspaceFiles.filter(file => {
    const documentPath = ASTUtils.getDocument(file).uri.path
    return moduleTargetMatchesFile(resolution.targetPath, documentPath)
  })
  if (targetFiles.length === 0) {
    ctx.error(useValidationMessages.unresolvedModule(useStatement.modulePath), useStatement)
    return
  }

  const declarations = targetFiles
    .flatMap(targetFile => declarationsInFile(targetFile))
    .filter(declaration => declaration.name.length > 0)
  for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    validateImportedName(importedName, useStatement, declarations, resolution.sameModule, ctx)
  }
}

function validateImportedName(
  importedName: string,
  useStatement: AST.UseStatement,
  declarations: readonly DeclarationRecord[],
  sameModule: boolean,
  ctx: ValidationContext,
): void {
  const matches = declarations.filter(declaration => declaration.name === importedName)
  if (matches.length === 0) {
    if (sameModule) {
      ctx.error(useValidationMessages.sameModuleMissing(importedName), useStatement)
      return
    }
    ctx.error(useValidationMessages.crossModuleMissing(importedName, useStatement.modulePath), useStatement)
    return
  }
  if (matches.some(declaration => declaration.kind === AST.AppDeclaration.$type)) {
    ctx.error(useValidationMessages.appImport(importedName), useStatement)
    return
  }

  if (sameModule) {
    const visibleMatches = matches.filter(declaration => declaration.visibility !== 'hide')
    if (visibleMatches.length === 0) {
      ctx.error(useValidationMessages.sameModuleHidden(importedName), useStatement)
      return
    }
    if (visibleMatches.length > 1) {
      ctx.error(useValidationMessages.ambiguousImport(importedName, useStatement.modulePath), useStatement)
    }
    return
  }

  const sharedMatches = matches.filter(declaration => declaration.visibility === 'share')
  if (sharedMatches.length === 0) {
    ctx.error(useValidationMessages.crossModuleNotShared(importedName), useStatement)
    return
  }
  if (sharedMatches.length > 1) {
    ctx.error(useValidationMessages.ambiguousImport(importedName, useStatement.modulePath), useStatement)
  }
}

function reportDuplicateImports(useStatement: AST.UseStatement, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const name of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    if (seen.has(name)) {
      ctx.error(useValidationMessages.duplicateImport(name), useStatement)
      continue
    }
    seen.add(name)
  }
}

function reportRepeatedAndCollidingImports(
  useStatement: AST.UseStatement,
  ctx: ValidationContext,
  localDeclarationNames: ReadonlySet<string>,
  previouslyImportedNames: Set<string>,
): void {
  for (const name of new Set(useStatement.importedDeclarations.map(reference => reference.$refText))) {
    if (previouslyImportedNames.has(name)) {
      ctx.error(useValidationMessages.repeatedImport(name), useStatement)
    } else {
      previouslyImportedNames.add(name)
    }
    if (localDeclarationNames.has(name)) {
      ctx.error(useValidationMessages.localDeclarationCollision(name), useStatement)
    }
  }
}

function declarationsInFile(file: AST.TaoFile): DeclarationRecord[] {
  return file.statements
    .filter(AST.isDeclaration)
    .map((declaration) => ({
      name: declaration.name,
      kind: declaration.$type,
      visibility: declarationVisibility(declaration),
    }))
}

function declarationVisibility(declaration: AST.Declaration): AST.DeclarationVisibility | undefined {
  return 'visibility' in declaration ? declaration.visibility : undefined
}
