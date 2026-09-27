import { AST } from '@parser'
import { Errors, FS } from '@shared'
import { applySourceEdits, type SourceEdit } from './studio-source-text'

/** ensureNamedImport adds one declaration to the file's `use … from <importPath>`, creating the statement when missing. */
export function ensureNamedImport(
  source: string,
  file: AST.TaoFile,
  declarationName: string,
  importPath: string,
): string {
  const use = file.statements.filter(AST.isUseStatement).find(statement => statement.importPath === importPath)
  if (use?.$cstNode !== undefined) {
    const edit = namedImportEdit(use, declarationName)
    return edit === undefined ? source : applySourceEdits(source, [edit])
  }
  const offset = file.statements[0]?.$cstNode?.offset ?? 0
  return applySourceEdits(source, [{
    end: offset,
    replacement: `use ${declarationName} from ${importPath}\n\n`,
    start: offset,
  }])
}

/** namedImportEdit adds one name to an existing `use` statement in canonical order, or nothing when it already imports it. */
export function namedImportEdit(use: AST.UseStatement, declarationName: string): SourceEdit | undefined {
  const imported = use.importedDeclarations.map(reference => reference.$refText)
  if (use.$cstNode === undefined || imported.includes(declarationName)) {
    return undefined
  }
  return {
    end: use.$cstNode.end,
    replacement: `use ${[...new Set([...imported, declarationName])].toSorted().join(', ')}${
      use.importPath ? ` from ${use.importPath}` : ''
    }`,
    start: use.$cstNode.offset,
  }
}

/** ensureUiNamesImported adds the named `@tao/ui` declarations to the file's import when missing. */
export function ensureUiNamesImported(
  source: string,
  file: AST.TaoFile,
  required: readonly string[],
  workspaceFiles: readonly AST.TaoFile[] = [file],
): string {
  const uses = file.statements.filter(AST.isUseStatement)
  const imported = new Set(uses.flatMap(statement =>
    statement.importPath === '@tao/ui'
      ? statement.importedDeclarations.map(reference => reference.$refText)
      : []
  ))
  if (required.every(name => imported.has(name))) {
    return source
  }
  const currentDirectory = FS.dirname(AST.getDocument(file).uri.fsPath)
  const visibleNames = new Set([
    ...AST.visibleValueDeclarations(file, AST.isDeclaration).map(declaration => declaration.name),
    ...workspaceFiles.flatMap(candidate => {
      if (candidate === file || FS.dirname(AST.getDocument(candidate).uri.fsPath) !== currentDirectory) {
        return []
      }
      return candidate.statements.flatMap(statement =>
        AST.isDeclaration(statement)
          && AST.declarationNamespace(statement) === 'value'
          && 'visibility' in statement
          && statement.visibility === 'folder'
          ? [statement.name]
          : []
      )
    }),
  ])
  const foreignImports = new Map<string, string>()
  for (const use of uses) {
    if (use.importPath === '@tao/ui') {
      continue
    }
    for (const declaration of use.importedDeclarations) {
      foreignImports.set(declaration.$refText, use.importPath ?? 'a bare use statement')
    }
  }
  for (const name of required) {
    if (imported.has(name)) {
      continue
    }
    const occupiedBy = visibleNames.has(name) ? 'a visible project declaration' : foreignImports.get(name)
    if (occupiedBy !== undefined) {
      Errors.throwUserInput(
        `Studio cannot import '${name}' from @tao/ui because the name is already owned by ${occupiedBy}.`,
      )
    }
  }
  const uiUse = uses.find(statement => statement.importPath === '@tao/ui')
  if (uiUse?.$cstNode !== undefined) {
    const names = new Set(uiUse.importedDeclarations.map(reference => reference.$refText))
    for (const name of required) {
      names.add(name)
    }
    return applySourceEdits(source, [{
      end: uiUse.$cstNode.end,
      replacement: `use ${[...names].toSorted().join(', ')} from @tao/ui`,
      start: uiUse.$cstNode.offset,
    }])
  }
  const insertionOffset = file.statements[0]?.$cstNode?.offset ?? 0
  return applySourceEdits(source, [{
    end: insertionOffset,
    replacement: `use ${required.join(', ')} from @tao/ui\n\n`,
    start: insertionOffset,
  }])
}
