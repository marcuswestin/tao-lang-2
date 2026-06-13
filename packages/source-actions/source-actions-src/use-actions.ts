import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { sliceText, type StatementSlice, type TextPiece } from './text-slices'

/** synthesizeImportSection builds the canonical import section text from use-statement slices. */
export function synthesizeImportSection(
  file: AST.TaoFile,
  useSlices: readonly StatementSlice<AST.UseStatement>[],
): string {
  const usedNames = ASTUtils.referencedNames(file)
  const namesByModule = new Map<string, Set<string>>()
  for (const slice of useSlices) {
    const source = importSource(slice.statement)
    const names = namesByModule.get(source) ?? new Set<string>()
    for (const reference of slice.statement.importedDeclarations) {
      if (shouldKeepImportedReference(reference, usedNames)) {
        names.add(reference.$refText)
      }
    }
    namesByModule.set(source, names)
  }

  const importLines = [...namesByModule.entries()]
    .filter(([, names]) => names.size > 0)
    .sort(([a], [b]) => compareImportSources(a, b))
    .map(([source, names]) => useStatementText([...names].sort(), source))
  const comments = useSlices.map(slice => slice.leading).filter(leading => leading !== '')
  return [...comments, ...importLines].join('\n')
}

/** removeUnusedImportNames rewrites use-statement slices without unused names, dropping empty statements. */
export function removeUnusedImportNames(
  file: AST.TaoFile,
  slices: readonly StatementSlice<AST.Statement>[],
): TextPiece[] {
  const usedNames = ASTUtils.referencedNames(file)
  const pieces: TextPiece[] = []
  for (const slice of slices) {
    const blankBefore = slice.leading !== ''
    if (!AST.isUseStatement(slice.statement)) {
      pieces.push({ text: sliceText(slice), blankBefore })
      continue
    }
    const names = [
      ...new Set(
        slice.statement.importedDeclarations
          .filter(reference => shouldKeepImportedReference(reference, usedNames))
          .map(reference => reference.$refText),
      ),
    ]
    if (names.length === 0) {
      pieces.push({ text: slice.leading, blankBefore })
      continue
    }
    const statementText = useStatementText(names, importSource(slice.statement))
    pieces.push({
      text: slice.leading === '' ? statementText : `${slice.leading}\n${statementText}`,
      blankBefore,
    })
  }
  return pieces
}

// Bare and package sources sort before relative sources, alphabetically within each group.
function compareImportSources(a: string, b: string): number {
  const rankA = importSourceRank(a)
  const rankB = importSourceRank(b)
  if (rankA !== rankB) {
    return rankA - rankB
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function importSourceRank(source: string): number {
  if (source === '') {
    return 0
  }
  return source.startsWith('@') ? 1 : 2
}

function importSource(useStatement: AST.UseStatement): string {
  return useStatement.importPath ?? ''
}

function useStatementText(names: readonly string[], source: string): string {
  const namesText = names.join(', ')
  return source === '' ? `use ${namesText}` : `use ${namesText} from ${source}`
}

function shouldKeepImportedReference(
  reference: AST.UseStatement['importedDeclarations'][number],
  usedNames: Set<string>,
): boolean {
  return usedNames.has(reference.$refText) || reference.ref === undefined
}
