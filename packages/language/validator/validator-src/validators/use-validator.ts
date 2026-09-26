import { ASTUtils, Packages } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import { useValidationCodes } from '../diagnostic-codes'
import type { ValidationContext } from '../validation'

/** useValidationMessages declares import diagnostics for Tao use statements. */
export const useValidationMessages = {
  unresolvedImport: (importPath: string) => `Cannot resolve import path '${importPath}'.`,
  unresolvedBareUse: () => `Cannot resolve bare use statement from this file.`,
  duplicatePackage: (name: string, paths: readonly string[]) =>
    `Package '${name}' is ambiguous because multiple folders declare it: ${paths.join(', ')}.`,
  packageBoundary: (importPath: string) =>
    `Relative import '${importPath}' crosses a package boundary; use an @package import instead.`,
  packagePathEscape: (importPath: string, packageName: string) =>
    `Package import '${importPath}' must stay inside package '${packageName}'.`,
  projectBoundary: (importPath: string) =>
    `Import '${importPath}' crosses a project boundary; cross-project imports will require a dependency declaration in project { ... }.`,
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
  notVisible: (name: string) =>
    `'${name}' is not visible from here; mark it as 'folder', 'package', 'workspace', or 'public'.`,
} as const

type DeclarationRecord = {
  name: string
  namespace: AST.DeclarationNamespace
  visibility?: AST.DeclarationVisibility
}

type VisibleDeclarationRecord = {
  declaration: AST.Declaration
  name: string
  document: AST.Document
  folderPath: string
}

/** validateUseStatements validates import path resolution and visibility rules. */
export function validateUseStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  const fromFilePath = AST.getDocument(file).uri.path
  const useStatements = file.statements.filter(AST.isUseStatement)
  const localDeclarationNames = new Set(
    declarationsInFile(file).map(declarationRecordKey),
  )
  const referencedNames = ASTUtils.referencedNames(file)
  const previouslyImportedNames = new Set<string>()
  const workspaceFiles = ctx.memo('use-validator.workspaceFiles', () => uniqueWorkspaceFiles(ctx.workspaceFiles))
  const workspaceFilePaths = ctx.memo(
    'use-validator.workspaceFilePaths',
    () => new Set(workspaceFiles.map(workspaceFilePath)),
  )
  for (const useStatement of useStatements) {
    reportDuplicateImports(useStatement, ctx)
    reportUnusedImports(useStatement, ctx, referencedNames)
    validateUseStatement(useStatement, {
      ctx,
      fromFilePath,
      localDeclarationNames,
      previouslyImportedNames,
      workspaceFilePaths,
      workspaceFiles,
    })
  }
  reportUseStatementsOutOfSection(file, ctx)
}

type ValidateUseStatementOptions = {
  ctx: ValidationContext
  fromFilePath: string
  localDeclarationNames: ReadonlySet<string>
  previouslyImportedNames: Set<string>
  workspaceFilePaths: ReadonlySet<string>
  workspaceFiles: readonly AST.TaoFile[]
}

function validateUseStatement(useStatement: AST.UseStatement, options: ValidateUseStatementOptions): void {
  const { ctx, fromFilePath, localDeclarationNames, previouslyImportedNames, workspaceFilePaths, workspaceFiles } =
    options
  const resolution = Packages.resolve(ctx.packagesContext, {
    importPath: useStatement.importPath,
    fromFilePath,
  })
  if (resolution.relation === 'invalid') {
    reportInvalidResolution(useStatement, resolution, ctx)
    return
  }

  const targetFiles = workspaceFiles.filter(file => {
    return Packages.targetMatches(ctx.packagesContext, resolution, {
      filePath: workspaceFilePath(file),
      workspaceFilePaths,
    })
  })
  if (targetFiles.length === 0) {
    ctx.error(useStatement, unresolvedMessage(useStatement))
    return
  }

  const declarations = targetFiles
    .flatMap(declarationsInFile)
    .filter(declaration => declaration.name.length > 0)
  for (const importedName of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    validateImportedName(importedName, {
      useStatement,
      declarations,
      resolution,
      ctx,
      seen: { localDeclarationNames, previouslyImportedNames },
    })
  }
}

function reportInvalidResolution(
  useStatement: AST.UseStatement,
  resolution: Packages.Resolution,
  ctx: ValidationContext,
): void {
  if (resolution.invalidReason === 'duplicate-package' && resolution.packageName) {
    ctx.error(
      useStatement,
      useValidationMessages.duplicatePackage(resolution.packageName, resolution.duplicatePackagePaths ?? []),
    )
    return
  }
  if (resolution.invalidReason === 'package-boundary' && useStatement.importPath) {
    ctx.error(useStatement, useValidationMessages.packageBoundary(useStatement.importPath))
    return
  }
  if (resolution.invalidReason === 'project-boundary' && useStatement.importPath) {
    ctx.error(useStatement, useValidationMessages.projectBoundary(useStatement.importPath))
    return
  }
  if (resolution.invalidReason === 'package-path-escape' && useStatement.importPath && resolution.packageName) {
    ctx.error(
      useStatement,
      useValidationMessages.packagePathEscape(useStatement.importPath, resolution.packageName),
    )
    return
  }
  ctx.error(useStatement, unresolvedMessage(useStatement))
}

function unresolvedMessage(useStatement: AST.UseStatement): string {
  return useStatement.importPath
    ? useValidationMessages.unresolvedImport(useStatement.importPath)
    : useValidationMessages.unresolvedBareUse()
}

type ValidateImportedNameOptions = {
  useStatement: AST.UseStatement
  declarations: readonly DeclarationRecord[]
  resolution: Packages.Resolution
  ctx: ValidationContext
  seen: {
    localDeclarationNames: ReadonlySet<string>
    previouslyImportedNames: Set<string>
  }
}

function validateImportedName(importedName: string, options: ValidateImportedNameOptions): void {
  const { useStatement, declarations, resolution, ctx, seen } = options
  const matches = declarations.filter(declaration => declaration.name === importedName)
  if (matches.length === 0) {
    ctx.error(useStatement, useValidationMessages.missingImport(importedName, importLabel(useStatement)))
    return
  }
  const visibleMatches = matches.filter(declaration => importedDeclarationIsVisible(declaration, resolution))
  if (visibleMatches.length === 0) {
    ctx.error(useStatement, useValidationMessages.notVisible(importedName))
    return
  }
  for (const namespace of new Set(visibleMatches.map(match => match.namespace))) {
    if (seen.localDeclarationNames.has(`${namespace}:${importedName}`)) {
      ctx.error(useStatement, useValidationMessages.localDeclarationCollision(importedName))
    }
  }
  const matchesByNamespace = new Map<AST.DeclarationNamespace, DeclarationRecord[]>()
  for (const match of visibleMatches) {
    const records = matchesByNamespace.get(match.namespace) ?? []
    records.push(match)
    matchesByNamespace.set(match.namespace, records)
  }
  if ([...matchesByNamespace.values()].some(records => records.length > 1)) {
    ctx.error(useStatement, useValidationMessages.ambiguousImport(importedName, importLabel(useStatement)))
    return
  }
  for (const match of visibleMatches) {
    const key = declarationRecordKey(match)
    if (seen.previouslyImportedNames.has(key)) {
      ctx.error(useStatement, useValidationMessages.repeatedImport(importedName), {
        code: useValidationCodes.repeatedImport,
      })
    } else {
      seen.previouslyImportedNames.add(key)
    }
  }
}

function importedDeclarationIsVisible(
  declaration: DeclarationRecord,
  resolution: Packages.Resolution,
): boolean {
  return Packages.isVisible(declaration.visibility, resolution)
}

function importLabel(useStatement: AST.UseStatement): string {
  return useStatement.importPath ?? 'current package'
}

function reportDuplicateImports(useStatement: AST.UseStatement, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const name of useStatement.importedDeclarations.map(reference => reference.$refText)) {
    if (seen.has(name)) {
      ctx.error(useStatement, useValidationMessages.duplicateImport(name), {
        code: useValidationCodes.duplicateImport,
      })
      continue
    }
    seen.add(name)
  }
}

function reportUnusedImports(
  useStatement: AST.UseStatement,
  ctx: ValidationContext,
  referencedNames: ReadonlySet<string>,
): void {
  for (const name of new Set(useStatement.importedDeclarations.map(reference => reference.$refText))) {
    if (!referencedNames.has(name)) {
      ctx.warning(useStatement, useValidationMessages.unusedImport(name), {
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
      ctx.warning(statement, useValidationMessages.useOutOfSection, {
        code: useValidationCodes.useOutOfSection,
      })
    }
  }
}

function declarationsInFile(file: AST.TaoFile): DeclarationRecord[] {
  return file.statements
    .filter(AST.isDeclaration)
    .flatMap(declaration => declarationRecords(declaration))
}

function declarationRecords(declaration: AST.Declaration): DeclarationRecord[] {
  const visibility = Packages.visibilityOf(declaration)
  return [
    { name: declaration.name, namespace: AST.declarationNamespace(declaration), visibility },
    ...(AST.isEntityDataDeclaration(declaration)
      ? [{ name: declaration.singularName, namespace: 'type' as const, visibility }]
      : []),
  ]
}

/** visibleDeclarationsByFolder indexes every visible declaration by folder, then by name. */
function visibleDeclarationsByFolder(ctx: ValidationContext): Map<string, Map<string, VisibleDeclarationRecord[]>> {
  const declarationsByFolder = new Map<string, Map<string, VisibleDeclarationRecord[]>>()
  for (const file of uniqueWorkspaceFiles(ctx.workspaceFiles)) {
    const document = AST.getDocument(file)
    const folderPath = FS.dirname(document.uri.path)
    const declarationsByName = declarationsByFolder.get(folderPath) ?? new Map<string, VisibleDeclarationRecord[]>()
    declarationsByFolder.set(folderPath, declarationsByName)
    for (const declaration of file.statements.filter(AST.isDeclaration)) {
      if (Packages.visibilityOf(declaration) === undefined) {
        continue
      }
      for (const binding of declarationRecords(declaration)) {
        const key = declarationRecordKey(binding)
        const records = declarationsByName.get(key) ?? []
        records.push({ declaration, name: binding.name, document, folderPath })
        declarationsByName.set(key, records)
      }
    }
  }
  return declarationsByFolder
}

/** validateVisibleDeclarations validates repeated visible declaration names in each loaded folder. */
export function validateVisibleDeclarations(
  ctx: ValidationContext,
  targetFile?: AST.TaoFile,
): void {
  const declarationsByFolder = ctx.memo('use-validator.declarationsByFolder', () => visibleDeclarationsByFolder(ctx))
  const targetDocument = targetFile ? AST.getDocument(targetFile) : undefined

  for (const declarationsByName of declarationsByFolder.values()) {
    for (const records of declarationsByName.values()) {
      const documents = new Set(records.map(record => record.document))
      if (documents.size < 2) {
        continue
      }
      for (const record of records) {
        if (targetDocument === undefined || targetDocument === record.document) {
          ctx.error(
            record.declaration,
            useValidationMessages.duplicateVisibleDeclaration(record.name, record.folderPath),
          )
        }
      }
    }
  }
}

function workspaceFilePath(file: AST.TaoFile): string {
  return AST.getDocument(file).uri.path
}

function declarationRecordKey(declaration: DeclarationRecord): string {
  return `${declaration.namespace}:${declaration.name}`
}

function uniqueWorkspaceFiles(files: readonly AST.TaoFile[]): AST.TaoFile[] {
  return [...new Map(files.map(file => [workspaceFilePath(file), file])).values()]
}
