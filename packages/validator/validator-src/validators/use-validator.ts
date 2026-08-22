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
  appImport: (name: string) => `App '${name}' cannot be imported.`,
} as const

type DeclarationRecord = {
  isAppValue: boolean
  name: string
  namespace: AST.DeclarationNamespace
  visibility?: AST.DeclarationVisibility
}

type VisibleDeclarationRecord = {
  declaration: AST.Declaration
  document: AST.Document
  folderPath: string
}

/** validateUseStatements validates import path resolution and visibility rules. */
export function validateUseStatements(file: AST.TaoFile, ctx: ValidationContext): void {
  const fromFilePath = AST.getDocument(file).uri.path
  const useStatements = file.statements.filter(AST.isUseStatement)
  const localDeclarationNames = new Set(
    file.statements.filter(AST.isDeclaration).map(AST.declarationKey),
  )
  const referencedNames = ASTUtils.referencedNames(file)
  const previouslyImportedNames = new Set<string>()
  for (const useStatement of useStatements) {
    reportDuplicateImports(useStatement, ctx)
    reportUnusedImports(useStatement, ctx, referencedNames)
    validateUseStatement(useStatement, {
      ctx,
      fromFilePath,
      localDeclarationNames,
      previouslyImportedNames,
    })
  }
  reportUseStatementsOutOfSection(file, ctx)
}

type ValidateUseStatementOptions = {
  ctx: ValidationContext
  fromFilePath: string
  localDeclarationNames: ReadonlySet<string>
  previouslyImportedNames: Set<string>
}

function validateUseStatement(useStatement: AST.UseStatement, options: ValidateUseStatementOptions): void {
  const { ctx, fromFilePath, localDeclarationNames, previouslyImportedNames } = options
  const resolution = Packages.resolve(ctx.packagesContext, {
    importPath: useStatement.importPath,
    fromFilePath,
  })
  if (resolution.relation === 'invalid') {
    reportInvalidResolution(useStatement, resolution, ctx)
    return
  }

  const workspaceFiles = uniqueWorkspaceFiles(ctx.workspaceFiles)
  const workspaceFilePaths = new Set(workspaceFiles.map(workspaceFilePath))
  const targetFiles = workspaceFiles.filter(file => {
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
    ctx.error(useValidationMessages.missingImport(importedName, importLabel(useStatement)), useStatement)
    return
  }
  const importableMatches = matches.filter(declaration => !declaration.isAppValue || canImportApp(resolution))
  if (importableMatches.length === 0 && matches.some(declaration => declaration.isAppValue)) {
    ctx.error(useValidationMessages.appImport(importedName), useStatement)
    return
  }
  const visibleMatches = importableMatches.filter(declaration => importedDeclarationIsVisible(declaration, resolution))
  if (visibleMatches.length === 0) {
    ctx.error(useValidationMessages.notVisible(importedName), useStatement)
    return
  }
  for (const namespace of new Set(visibleMatches.map(match => match.namespace))) {
    if (seen.localDeclarationNames.has(`${namespace}:${importedName}`)) {
      ctx.error(useValidationMessages.localDeclarationCollision(importedName), useStatement)
    }
  }
  const matchesByNamespace = new Map<AST.DeclarationNamespace, DeclarationRecord[]>()
  for (const match of visibleMatches) {
    const records = matchesByNamespace.get(match.namespace) ?? []
    records.push(match)
    matchesByNamespace.set(match.namespace, records)
  }
  if ([...matchesByNamespace.values()].some(records => records.length > 1)) {
    ctx.error(useValidationMessages.ambiguousImport(importedName, importLabel(useStatement)), useStatement)
    return
  }
  for (const match of visibleMatches) {
    const key = declarationRecordKey(match)
    if (seen.previouslyImportedNames.has(key)) {
      ctx.error(useValidationMessages.repeatedImport(importedName), useStatement, {
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
  if (declaration.isAppValue) {
    return canImportApp(resolution)
  }
  return Packages.isVisible(declaration.visibility, resolution)
}

function canImportApp(resolution: Packages.Resolution): boolean {
  return resolution.relation === 'same-file' || resolution.relation === 'same-directory'
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
      isAppValue: AST.isConcreteAppValueDeclaration(declaration),
      name: declaration.name,
      namespace: AST.declarationNamespace(declaration),
      visibility: Packages.visibilityOf(declaration),
    }))
}

/** validateVisibleDeclarations validates repeated visible declaration names in each loaded folder. */
export function validateVisibleDeclarations(
  ctx: ValidationContext,
  targetFile?: AST.TaoFile,
): void {
  const declarationsByFolder = new Map<string, Map<string, VisibleDeclarationRecord[]>>()
  const targetDocument = targetFile ? AST.getDocument(targetFile) : undefined
  for (const file of uniqueWorkspaceFiles(ctx.workspaceFiles)) {
    const document = AST.getDocument(file)
    const folderPath = FS.dirname(document.uri.path)
    const visibleDeclarations = file.statements
      .filter(AST.isDeclaration)
      .filter(declaration => Packages.visibilityOf(declaration) !== undefined)
    const declarationsByName = declarationsByFolder.get(folderPath) ?? new Map()
    declarationsByFolder.set(folderPath, declarationsByName)

    for (const declaration of visibleDeclarations) {
      const records = declarationsByName.get(AST.declarationKey(declaration)) ?? []
      records.push({ declaration, document, folderPath })
      declarationsByName.set(AST.declarationKey(declaration), records)
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
  return AST.getDocument(file).uri.path
}

function declarationRecordKey(declaration: DeclarationRecord): string {
  return `${declaration.namespace}:${declaration.name}`
}

function uniqueWorkspaceFiles(files: readonly AST.TaoFile[]): AST.TaoFile[] {
  return [...new Map(files.map(file => [workspaceFilePath(file), file])).values()]
}
