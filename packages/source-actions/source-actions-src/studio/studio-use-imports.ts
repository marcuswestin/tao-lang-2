import { AST } from '@parser'
import { applySourceEdits } from './studio-source-text'

/** ensureNamedImport adds one declaration to the file's `use … from <importPath>`, creating the statement when missing. */
export function ensureNamedImport(
  source: string,
  file: AST.TaoFile,
  declarationName: string,
  importPath: string,
): string {
  const use = file.statements.filter(AST.isUseStatement).find(statement => statement.importPath === importPath)
  if (use?.$cstNode !== undefined) {
    const imported = use.importedDeclarations.map(reference => reference.$refText)
    return imported.includes(declarationName)
      ? source
      : applySourceEdits(source, [{
        end: use.$cstNode.end,
        replacement: `use ${[...new Set([...imported, declarationName])].toSorted().join(', ')} from ${importPath}`,
        start: use.$cstNode.offset,
      }])
  }
  const offset = file.statements[0]?.$cstNode?.offset ?? 0
  return applySourceEdits(source, [{
    end: offset,
    replacement: `use ${declarationName} from ${importPath}\n\n`,
    start: offset,
  }])
}

/** ensureUiNamesImported adds the named `@tao/ui` declarations to the file's import when missing. */
export function ensureUiNamesImported(source: string, file: AST.TaoFile, required: readonly string[]): string {
  const uses = file.statements.filter(AST.isUseStatement)
  const imported = new Set(uses.flatMap(statement =>
    statement.importPath === '@tao/ui'
      ? statement.importedDeclarations.map(reference => reference.$refText)
      : []
  ))
  if (required.every(name => imported.has(name))) {
    return source
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
