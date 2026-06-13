import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { sliceText, type StatementSlice, type TextPiece } from './text-slices'

/** synthesizeImportSection builds the canonical import section text from use-statement slices. */
export function synthesizeImportSection(
  file: AST.TaoFile,
  useSlices: readonly StatementSlice<AST.UseStatement>[],
): string {
  const usedNames = ASTUtils.referencedNames(file)
  const groups = new Map<string, { names: Set<string>; leading: string[] }>()
  for (const slice of useSlices) {
    const source = importSource(slice.statement)
    const keptNames = slice.statement.importedDeclarations
      .filter(reference => shouldKeepImportedReference(reference, usedNames))
      .map(reference => reference.$refText)
    if (keptNames.length === 0) {
      continue
    }
    const group = groups.get(source) ?? { names: new Set<string>(), leading: [] }
    for (const reference of slice.statement.importedDeclarations) {
      if (shouldKeepImportedReference(reference, usedNames)) {
        group.names.add(reference.$refText)
      }
    }
    if (slice.leading !== '') {
      group.leading.push(slice.leading)
    }
    groups.set(source, group)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareImportSources(a, b))
    .map(([source, group]) => [...group.leading, useStatementText([...group.names].sort(), source)].join('\n'))
    .join('\n')
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
