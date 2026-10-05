import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { sliceText, type StatementSlice, type TextPiece } from './text-slices'

/** synthesizeImportSection builds the canonical import section text from use-statement slices. */
export function synthesizeImportSection(
  file: AST.TaoFile,
  useSlices: readonly StatementSlice<AST.UseStatement>[],
  usePackageSlices: readonly StatementSlice<AST.UsePackageStatement>[] = [],
): string {
  const usedNames = ASTUtils.referencedNames(file)
  const wildcardTargets = new Map<string, Set<AST.Declaration>>()
  for (const slice of useSlices) {
    if (!slice.statement.all) {
      continue
    }
    const source = importSource(slice.statement)
    const targets = wildcardTargets.get(source) ?? new Set<AST.Declaration>()
    for (const declaration of AST.resolvedImportedDeclarations(slice.statement)) {
      targets.add(declaration)
    }
    wildcardTargets.set(source, targets)
  }
  const groups = new Map<string, { all: boolean; names: Set<string>; leading: string[] }>()
  for (const slice of useSlices) {
    const source = importSource(slice.statement)
    const targets = wildcardTargets.get(source)
    const declarations = targets === undefined ? [] : AST.resolvedImportedDeclarations(slice.statement)
    const keptReferences = keptImportedReferences(slice.statement, usedNames).filter(reference => {
      if (targets === undefined) {
        return true
      }
      const requested = declarations.filter(declaration =>
        declaration.name === reference.$refText
        || (AST.isEntityDataDeclaration(declaration) && declaration.singularName === reference.$refText)
      )
      // A named spelling can expose both namespaces; keep it when the wildcard leaves an identity out.
      return requested.length === 0 || requested.some(declaration => !targets.has(declaration))
    })
    if (!slice.statement.all && keptReferences.length === 0) {
      continue
    }
    const group = groups.get(source) ?? { all: false, names: new Set<string>(), leading: [] }
    group.all ||= slice.statement.all
    for (const reference of keptReferences) {
      group.names.add(reference.$refText)
    }
    if (keepsOriginalImportList(slice.statement, keptReferences) && slice.leading !== '') {
      group.leading.push(slice.leading)
    }
    groups.set(source, group)
  }

  const lines = new Map<string, { text: string; leading: string[] }>()
  for (const [source, group] of groups) {
    const text = [
      ...(group.all ? [useStatementText(['all'], source)] : []),
      ...(group.names.size > 0 ? [useStatementText([...group.names].sort(), source)] : []),
    ].join('\n')
    lines.set(source, { text, leading: group.leading })
  }
  // A namespace import sorts by the same source ranking; its text is its own canonical rendering.
  for (const slice of usePackageSlices) {
    const statement = slice.statement
    const source = statement.importPath ?? ''
    const asClause = statement.name ? ` as ${statement.name}` : ''
    const text = `use package ${source}${asClause}`
    const existing = lines.get(source)
    if (existing) {
      existing.text = `${existing.text}\n${text}`
    } else {
      lines.set(source, { text, leading: slice.leading === '' ? [] : [slice.leading] })
    }
  }

  return [...lines.entries()]
    .sort(([a], [b]) => compareImportSources(a, b))
    .map(([, line]) => [...line.leading, line.text].join('\n'))
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
    if (slice.statement.all) {
      const statementText = useStatementText(['all'], importSource(slice.statement))
      pieces.push({
        text: slice.leading === '' ? statementText : `${slice.leading}\n${statementText}`,
        blankBefore,
      })
      continue
    }
    const keptReferences = keptImportedReferences(slice.statement, usedNames)
    const names = [...new Set(keptReferences.map(reference => reference.$refText))]
    if (names.length === 0) {
      continue
    }
    const statementText = useStatementText(names, importSource(slice.statement))
    const keepLeading = keepsOriginalImportList(slice.statement, keptReferences)
    pieces.push({
      text: !keepLeading || slice.leading === '' ? statementText : `${slice.leading}\n${statementText}`,
      blankBefore: keepLeading && blankBefore,
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

function keptImportedReferences(
  useStatement: AST.UseStatement,
  usedNames: Set<string>,
): AST.UseStatement['importedDeclarations'] {
  return useStatement.importedDeclarations.filter(reference => shouldKeepImportedReference(reference, usedNames))
}

function keepsOriginalImportList(
  useStatement: AST.UseStatement,
  keptReferences: AST.UseStatement['importedDeclarations'],
): boolean {
  return keptReferences.length === useStatement.importedDeclarations.length
}

function shouldKeepImportedReference(
  reference: AST.UseStatement['importedDeclarations'][number],
  usedNames: Set<string>,
): boolean {
  return usedNames.has(reference.$refText) || reference.ref === undefined
}
