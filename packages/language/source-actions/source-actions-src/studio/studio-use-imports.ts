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
  const uses = file.statements.filter(AST.isUseStatement).filter(statement => statement.importPath === importPath)
  if (uses.some(use => use.all && importedNameSupplied(use, declarationName))) {
    return source
  }
  const use = uses.find(statement => !statement.all) ?? uses[0]
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
  const imported = use.importedDeclarations.map(AST.importLocalName)
  const specifiers = use.importedDeclarations.map(AST.importSpecifierText)
  const occupied = use.importedDeclarations.find(specifier => AST.importLocalName(specifier) === declarationName)
  if (occupied !== undefined && AST.importSourceName(occupied) !== declarationName) {
    Errors.throwUserInput(
      `Studio cannot import '${declarationName}' because the name is already occupied by another import.`,
    )
  }
  if (
    use.$cstNode === undefined || imported.includes(declarationName)
    || (use.all && importedNameSupplied(use, declarationName))
  ) {
    return undefined
  }
  return {
    end: use.$cstNode.end,
    replacement: use.all
      ? `${use.$cstNode.text}\nuse ${declarationName}${use.importPath ? ` from ${use.importPath}` : ''}`
      : `use ${[...new Set([...specifiers, declarationName])].toSorted().join(', ')}${
        use.importPath ? ` from ${use.importPath}` : ''
      }`,
    start: use.$cstNode.offset,
  }
}

function importedNameSupplied(use: AST.UseStatement, name: string): boolean {
  return AST.resolvedImportedBindings(use).some(binding => binding.namespace === 'value' && binding.localName === name)
}

/** ensureUiNamesImported adds the named `@tao/ui` declarations to the file's import when missing. */
export function ensureUiNamesImported(
  source: string,
  file: AST.TaoFile,
  required: readonly string[],
  workspaceFiles: readonly AST.TaoFile[] = [file],
): string {
  const uses = file.statements.filter(AST.isUseStatement)
  const uiUses = uses.filter(statement => statement.importPath === '@tao/ui')
  const uiBindings = uiUses.flatMap(use => AST.resolvedImportedBindings(use))
  const suppliesName = (binding: ReturnType<typeof AST.resolvedImportedBindings>[number], name: string): boolean =>
    binding.namespace === 'value'
    && binding.localName === name
    && (binding.declaration.name === name
      || (AST.isEntityDataDeclaration(binding.declaration) && binding.declaration.singularName === name))
  const imported = new Set(required.filter(name => uiBindings.some(binding => suppliesName(binding, name))))
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
  const uiNames = new Set([
    ...uiBindings.map(binding => binding.localName),
    ...uiUses.flatMap(use =>
      use.importedDeclarations
        .filter(specifier => specifier.target.ref === undefined)
        .map(AST.importLocalName)
    ),
  ])
  for (const use of uses) {
    if (use.importPath === '@tao/ui') {
      continue
    }
    for (const binding of AST.resolvedImportedBindings(use)) {
      if (binding.namespace === 'value') {
        foreignImports.set(binding.localName, use.importPath ?? 'a bare use statement')
      }
    }
    for (const specifier of use.importedDeclarations.filter(specifier => specifier.target.ref === undefined)) {
      foreignImports.set(AST.importLocalName(specifier), use.importPath ?? 'a bare use statement')
    }
  }
  for (const name of required) {
    if (imported.has(name)) {
      continue
    }
    const occupiedBy = visibleNames.has(name)
      ? 'a visible project declaration'
      : uiNames.has(name)
      ? 'another @tao/ui import'
      : foreignImports.get(name)
    if (occupiedBy !== undefined) {
      Errors.throwUserInput(
        `Studio cannot import '${name}' from @tao/ui because the name is already owned by ${occupiedBy}.`,
      )
    }
  }
  const missing = required.filter(name => !imported.has(name))
  const uiUse = uses.find(statement => statement.importPath === '@tao/ui' && !statement.all)
  if (uiUse?.$cstNode !== undefined) {
    const names = new Set(uiUse.importedDeclarations.map(AST.importSpecifierText))
    for (const name of missing) {
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
    replacement: `use ${missing.join(', ')} from @tao/ui\n\n`,
    start: insertionOffset,
  }])
}
