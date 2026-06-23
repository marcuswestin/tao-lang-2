import ASTUtils, { Packages } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { useValidationCodes } from './diagnostic-codes'
import type { ValidationContext } from './validation'

/** useValidationMessages declares import diagnostics for Tao use statements. */
export const useValidationMessages = {
  unresolvedImport: (importPath: string) => `Cannot resolve import path '${importPath}'.`,
  unresolvedBareUse: () => `Cannot resolve bare use statement from this file.`,
  duplicatePackage: (name: string, paths: readonly string[]) =>
    `Package '${name}' is ambiguous because multiple folders declare it: ${paths.join(', ')}.`,
  packageBoundary: (importPath: string) =>
    `Relative import '${importPath}' crosses a package boundary; use an @package import instead.`,
  duplicateImport: (name: string) => `Imported name '${name}' is declared more than once in this use statement.`,
  repeatedImport: (name: string) => `Imported name '${name}' is already imported by an earlier use statement.`,
  unusedImport: (name: string) => `Imported name '${name}' is not used in this file.`,
  useOutOfSection: '`use` statements belong in the import section before other top-level statements.',
  localDeclarationCollision: (name: string) => `Imported name '${name}' collides with a declaration in this file.`,
  ambiguousImport: (name: string, importPath: string) =>
    `'${name}' matches multiple visible declarations in '${importPath}'.`,
  duplicateVisibleDeclaration: (name: string, folderPath: string) =>
    `Visible declaration '${name}' is declared more than once in folder '${folderPath}'.`,
  missingImport: (name: string, importPath: string) => `'${name}' is not visible from '${importPath}'.`,
  notVisible: (name: string) => `'${name}' is not visible from here; mark it as 'package', 'project', or 'publish'.`,
  appImport: (name: string) => `App '${name}' cannot be imported.`,
} as const

type DeclarationRecord = {
  name: string
  kind: AST.Declaration['$type']
  visibility?: AST.DeclarationVisibility
}

type VisibleDeclarationRecord = {
  declaration: AST.Declaration
  document: AST.Document
  folderPath: string
}

/** validateUseStatements validates import path resolution and visibility rules. */
export function validateUseStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  const fromFilePath = ASTUtils.getDocument(file).uri.path
  const useStatements = file.statements.filter(AST.isUseStatement)
  const localDeclarationNames = new Set(
    file.statements.filter(AST.isDeclaration).map(declaration => declaration.name),
  )
  const referencedNames = ASTUtils.referencedNames(file)
  const previouslyImportedNames = new Set<string>()
  for (const useStatement of useStatements) {
    reportDuplicateImports(useStatement, ctx)
    reportRepeatedAndCollidingImports(useStatement, ctx, localDeclarationNames, previouslyImportedNames)
    reportUnusedImports(useStatement, ctx, referencedNames)
    validateUseStatement(useStatement, ctx, fromFilePath)
  }
  reportUseStatementsOutOfSection(file, ctx)
}

function validateUseStatement(
  useStatement: AST.UseStatement,
  ctx: ValidationContext,
  fromFilePath: string,
): void {
  const resolution = Packages.resolve(ctx.packagesContext, {
    importPath: useStatement.importPath,
    fromFilePath,
  })
  if (resolution.relation === 'invalid') {
    reportInvalidResolution(useStatement, resolution, ctx)
    return
  }

  const workspaceFilePaths = new Set(ctx.workspaceFiles.map(workspaceFilePath))
  const targetFiles = ctx.workspaceFiles.filter(file => {
    return Packages.targetMatches(resolution, {
      filePath: workspaceFilePath(file),
      workspaceFilePaths,
    })
  })
  if (targetFiles.length === 0) {
    ctx.error(unresolvedMessage(useStatement), useStatement)
    return
  }

  const declarations = targetFiles
    .flatMap(declarationsInFile)
    .filter(declaration => declaration.name.length > 0)
  for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    validateImportedName(importedName, useStatement, declarations, resolution, ctx)
  }
}

function reportInvalidResolution(
  useStatement: AST.UseStatement,
  resolution: Packages.Resolution,
  ctx: ValidationContext,
): void {
  if (resolution.invalidReason === 'duplicate-package' && resolution.packageName) {
    ctx.error(
      useValidationMessages.duplicatePackage(resolution.packageName, resolution.duplicatePackagePaths ?? []),
      useStatement,
    )
    return
  }
  if (resolution.invalidReason === 'package-boundary' && useStatement.importPath) {
    ctx.error(useValidationMessages.packageBoundary(useStatement.importPath), useStatement)
    return
  }
  ctx.error(unresolvedMessage(useStatement), useStatement)
}

function unresolvedMessage(useStatement: AST.UseStatement): string {
  return useStatement.importPath
    ? useValidationMessages.unresolvedImport(useStatement.importPath)
    : useValidationMessages.unresolvedBareUse()
}

function validateImportedName(
  importedName: string,
  useStatement: AST.UseStatement,
  declarations: readonly DeclarationRecord[],
  resolution: Packages.Resolution,
  ctx: ValidationContext,
): void {
  const matches = declarations.filter(declaration => declaration.name === importedName)
  if (matches.length === 0) {
    ctx.error(useValidationMessages.missingImport(importedName, importLabel(useStatement)), useStatement)
    return
  }
  if (
    matches.some(declaration => declaration.kind === AST.AppDeclaration.$type)
    && !canImportApp(useStatement, resolution)
  ) {
    ctx.error(useValidationMessages.appImport(importedName), useStatement)
    return
  }

  const visibleMatches = matches.filter(declaration =>
    importedDeclarationIsVisible(declaration, resolution, useStatement)
  )
  if (visibleMatches.length === 0) {
    ctx.error(useValidationMessages.notVisible(importedName), useStatement)
    return
  }
  if (visibleMatches.length > 1) {
    ctx.error(useValidationMessages.ambiguousImport(importedName, importLabel(useStatement)), useStatement)
  }
}

function importedDeclarationIsVisible(
  declaration: DeclarationRecord,
  resolution: Packages.Resolution,
  useStatement: AST.UseStatement,
): boolean {
  if (declaration.kind === AST.AppDeclaration.$type) {
    return canImportApp(useStatement, resolution)
  }
  return Packages.isVisible(declaration.visibility, resolution)
}

function canImportApp(useStatement: AST.UseStatement, resolution: Packages.Resolution): boolean {
  return useBelongsToTestSidecar(useStatement)
    && (resolution.relation === 'same-file' || resolution.relation === 'same-directory')
}

function useBelongsToTestSidecar(useStatement: AST.UseStatement): boolean {
  if (!AST.isTaoFile(useStatement.$container)) {
    return false
  }
  return Packages.isTestSourcePath(ASTUtils.getDocument(useStatement.$container).uri.path)
}

function importLabel(useStatement: AST.UseStatement): string {
  return useStatement.importPath ?? 'current package'
}

function reportDuplicateImports(useStatement: AST.UseStatement, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const name of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    if (seen.has(name)) {
      ctx.error(useValidationMessages.duplicateImport(name), useStatement, {
        code: useValidationCodes.duplicateImport,
      })
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
      ctx.error(useValidationMessages.repeatedImport(name), useStatement, {
        code: useValidationCodes.repeatedImport,
      })
    } else {
      previouslyImportedNames.add(name)
    }
    if (localDeclarationNames.has(name)) {
      ctx.error(useValidationMessages.localDeclarationCollision(name), useStatement)
    }
  }
}

function reportUnusedImports(
  useStatement: AST.UseStatement,
  ctx: ValidationContext,
  referencedNames: ReadonlySet<string>,
): void {
  for (const name of new Set(useStatement.importedDeclarations.map(reference => reference.$refText))) {
    if (!referencedNames.has(name)) {
      ctx.warning(useValidationMessages.unusedImport(name), useStatement, {
        code: useValidationCodes.unusedImport,
      })
    }
  }
}

function reportUseStatementsOutOfSection(file: AST.TaoFile, ctx: ValidationContext): void {
  const firstNonUseIndex = file.statements.findIndex(statement => !AST.isUseStatement(statement))
  if (firstNonUseIndex === -1) {
    return
  }
  for (const statement of file.statements.slice(firstNonUseIndex)) {
    if (AST.isUseStatement(statement)) {
      ctx.warning(useValidationMessages.useOutOfSection, statement, {
        code: useValidationCodes.useOutOfSection,
      })
    }
  }
}

function declarationsInFile(file: AST.TaoFile): DeclarationRecord[] {
  return file.statements
    .filter(AST.isDeclaration)
    .map((declaration) => ({
      name: declaration.name,
      kind: declaration.$type,
      visibility: Packages.visibilityOf(declaration),
    }))
}

/** validateVisibleDeclarations validates repeated visible declaration names in each loaded folder. */
export function validateVisibleDeclarations(
  ctx: ValidationContext,
  targetFile?: AST.TaoFile,
): void {
  const declarationsByFolder = new Map<string, Map<string, VisibleDeclarationRecord[]>>()
  const targetDocument = targetFile ? ASTUtils.getDocument(targetFile) : undefined
  for (const file of ctx.workspaceFiles) {
    const document = ASTUtils.getDocument(file)
    const folderPath = FS.dirname(document.uri.path)
    const visibleDeclarations = file.statements
      .filter(AST.isDeclaration)
      .filter(declaration => Packages.visibilityOf(declaration) !== undefined)
    const declarationsByName = declarationsByFolder.get(folderPath) ?? new Map()
    declarationsByFolder.set(folderPath, declarationsByName)

    for (const declaration of visibleDeclarations) {
      const records = declarationsByName.get(declaration.name) ?? []
      records.push({ declaration, document, folderPath })
      declarationsByName.set(declaration.name, records)
    }
  }

  for (const declarationsByName of declarationsByFolder.values()) {
    for (const records of declarationsByName.values()) {
      const documents = new Set(records.map(record => record.document))
      if (documents.size < 2) {
        continue
      }
      for (const record of records) {
        if (targetDocument === undefined || targetDocument === record.document) {
          ctx.error(
            useValidationMessages.duplicateVisibleDeclaration(record.declaration.name, record.folderPath),
            record.declaration,
          )
        }
      }
    }
  }
}

function workspaceFilePath(file: AST.TaoFile): string {
  return ASTUtils.getDocument(file).uri.path
}
