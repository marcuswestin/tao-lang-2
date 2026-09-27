import { AST } from '@parser'
import { Assert, FS } from '@shared'

type RelocationRequest = Readonly<{
  document: AST.Document
  name: string
  projectRoot: string
  relocateScenarios: boolean
  scenariosDocument: AST.Document
  targetPackage: string
  targetPath: string
}>

/** Prepares a generated view's move and scenario relocation using parsed source ranges. */
export const StudioScenarioRelocation = {
  prepare(request: RelocationRequest): { movedSource: string; scenariosSource?: string } {
    const { document, name, scenariosDocument, targetPackage, targetPath } = request
    const source = document.textDocument.getText()
    const file = document.parseResult.value
    const groups = file.statements.filter(AST.isScenarioGroupDeclaration)
      .filter(group => group.subject?.$refText === name)
    const edits = file.statements.filter(AST.isUseStatement).flatMap(use => {
      const path = rebasedImport(use, document.uri.fsPath, targetPath, request.projectRoot)
      return path === use.importPath ? [] : [{
        end: use.$cstNode!.end,
        replacement: `use ${use.importedDeclarations.map(reference => reference.$refText).join(', ')} from ${path}`,
        start: use.$cstNode!.offset,
      }]
    })
    if (!request.relocateScenarios || groups.length === 0) {
      return { movedSource: applyEdits(source, edits) }
    }
    const destination = scenariosDocument.parseResult.value
    const existingGroups = destination.statements.filter(AST.isScenarioGroupDeclaration)
    Assert.input(
      groups.every(group =>
        !existingGroups.some(existing => existing.name === group.name && existing.subject?.$refText === name)
      ),
      `Scenarios.tao already declares a scenario group for ${name}.`,
    )
    const referenced = new Set(
      groups.flatMap(group => [group, ...AST.streamAllContents(group)])
        .flatMap(node =>
          [...AST.streamReferences(node)].flatMap(reference =>
            'ref' in reference.reference && reference.reference.ref !== undefined ? [reference.reference.ref] : []
          )
        ),
    )
    const imports = new Map<string, string | undefined>([[name, targetPackage]])
    for (const use of file.statements.filter(AST.isUseStatement)) {
      for (const reference of use.importedDeclarations) {
        if (reference.ref !== undefined && referenced.has(reference.ref)) {
          imports.set(
            reference.$refText,
            rebasedImport(
              use,
              document.uri.fsPath,
              scenariosDocument.uri.fsPath,
              request.projectRoot,
            ),
          )
        }
      }
    }
    for (const declaration of file.statements.filter(AST.isDeclaration)) {
      if (declaration.name !== name && referenced.has(declaration)) {
        Assert.input(
          'visibility' in declaration && declaration.visibility === 'public',
          `Cannot relocate scenarios that depend on private declaration ${declaration.name}.`,
        )
        imports.set(declaration.name, targetPackage)
      }
    }
    const existingUses = destination.statements.filter(AST.isUseStatement)
    const additions: string[] = []
    for (const [imported, path] of imports) {
      Assert.input(
        !destination.statements.some(statement => AST.isDeclaration(statement) && statement.name === imported),
        `Scenarios.tao already declares ${imported}; its scenario import would conflict.`,
      )
      const matches = existingUses.filter(use =>
        use.importedDeclarations.some(reference => reference.$refText === imported)
      )
      Assert.input(
        matches.every(use =>
          importIdentity(use.importPath, scenariosDocument.uri.fsPath, request.projectRoot)
            === importIdentity(path, scenariosDocument.uri.fsPath, request.projectRoot)
        ),
        `Scenarios.tao already imports ${imported} from another source.`,
      )
      if (matches.length === 0) {
        additions.push(`use ${imported}${path === undefined ? '' : ` from ${path}`}`)
      }
    }
    for (const group of groups) {
      edits.push({ end: group.$cstNode!.end, replacement: '', start: group.$cstNode!.offset })
    }
    const current = scenariosDocument.textDocument.getText()
    const offset = destination.statements[0]?.$cstNode?.offset ?? current.length
    const prefix = additions.length === 0 ? '' : `${additions.join('\n')}\n\n`
    return {
      movedSource: applyEdits(source, edits),
      scenariosSource: `${current.slice(0, offset)}${prefix}${current.slice(offset)}\n\n${
        groups.map(group => group.$cstNode!.text).join('\n\n')
      }\n`,
    }
  },
} as const

function rebasedImport(use: AST.UseStatement, from: string, to: string, root: string): string | undefined {
  const path = use.importPath
  if (path === undefined || !path.startsWith('.')) {
    return path
  }
  const absolute = FS.resolvePath(path, FS.dirname(from))
  const rootRelative = FS.relativePath(root, absolute)
  if (rootRelative.startsWith('@')) {
    const importsFile = rootRelative.endsWith('.tao') || AST.resolvedImportedDeclarations(use)
      .some(declaration => AST.getDocument(declaration).uri.fsPath === `${absolute}.tao`)
    return importsFile ? FS.dirname(rootRelative) : rootRelative
  }
  const relative = FS.relativePath(FS.dirname(to), absolute)
  return relative.startsWith('.') ? relative : `./${relative}`
}

function importIdentity(path: string | undefined, from: string, root: string): string | undefined {
  if (path === undefined) {
    return undefined
  }
  const resolved = path.startsWith('.')
    ? FS.resolvePath(path, FS.dirname(from))
    : path.startsWith('@')
    ? FS.resolvePath(path, root)
    : path
  return resolved.endsWith('.tao') ? resolved.slice(0, -4) : resolved
}

function applyEdits(source: string, edits: readonly { end: number; replacement: string; start: number }[]): string {
  return edits.toSorted((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.replacement + result.slice(edit.end), source)
}
