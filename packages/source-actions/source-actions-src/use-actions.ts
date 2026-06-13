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
    const names = namesByModule.get(slice.statement.modulePath) ?? new Set<string>()
    for (const reference of slice.statement.importedDeclarations) {
      if (shouldKeepImportedReference(reference, usedNames)) {
        names.add(reference.$refText)
      }
    }
    namesByModule.set(slice.statement.modulePath, names)
  }

  const importLines = [...namesByModule.entries()]
    .filter(([, names]) => names.size > 0)
    .sort(([a], [b]) => compareModulePaths(a, b))
    .map(([modulePath, names]) => `use ${[...names].sort().join(', ')} from ${modulePath}`)
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
    const statementText = `use ${names.join(', ')} from ${slice.statement.modulePath}`
    pieces.push({
      text: slice.leading === '' ? statementText : `${slice.leading}\n${statementText}`,
      blankBefore,
    })
  }
  return pieces
}

// Package sources (`@...`) sort before relative sources, alphabetically within each group.
function compareModulePaths(a: string, b: string): number {
  const rankA = a.startsWith('@') ? 0 : 1
  const rankB = b.startsWith('@') ? 0 : 1
  if (rankA !== rankB) {
    return rankA - rankB
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function shouldKeepImportedReference(
  reference: AST.UseStatement['importedDeclarations'][number],
  usedNames: Set<string>,
): boolean {
  return usedNames.has(reference.$refText) || reference.ref === undefined
}
