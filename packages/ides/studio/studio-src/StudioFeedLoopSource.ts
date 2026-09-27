import { Packages, Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { studioSourceImport } from './StudioSourceImport'

/** Prepares a typed collection loop as source overrides; the Feed transaction owns persistence. */
export const StudioFeedLoopSource = {
  async prepare(
    input: Readonly<{
      entryPath: string
      fieldPath: readonly string[]
      parameterName: string
      projectRoot: string
      rectId?: string
      rowView?: Readonly<{ name: string; path: string }>
      sourceOverrides: Readonly<Record<string, string>>
      viewName: string
      viewSource?: string
    }>,
  ) {
    Assert.input(/^View[1-9][0-9]*$/.test(input.viewName), 'Feed loops require a generated sketch view.')
    Assert.input(
      input.fieldPath.length > 0 && input.fieldPath.length <= 2,
      'Feed loops require one collection field or one related collection.',
    )
    const viewPath = FS.resolvePath(`@/studio/${input.viewName}.tao`, input.projectRoot)
    const sources = {
      ...input.sourceOverrides,
      ...(input.viewSource === undefined ? {} : { [viewPath]: input.viewSource }),
    }
    const workspace = await Workspace.open(input.projectRoot, { sourceOverrides: sources })
    const paths = [
      FS.resolvePath(input.entryPath, input.projectRoot),
      viewPath,
      ...(input.rowView === undefined ? [] : [FS.resolvePath(input.rowView.path, input.projectRoot)]),
    ]
    const results = await workspace.parseFiles(paths)
    const files = [...new Set(results.flatMap(result => result.files.map(file => file.ast)))]
    const file = files.find(candidate => AST.getDocument(candidate).uri.fsPath === viewPath)
    Assert.input(file !== undefined, 'Feed loop sketch source is unavailable.')
    const document = AST.getDocument(file)
    Assert.input(
      document.parseResult.lexerErrors.length === 0 && document.parseResult.parserErrors.length === 0,
      'Feed loop source has syntax errors.',
    )
    const view = file.statements.filter(AST.isViewDeclaration).find(candidate => candidate.name === input.viewName)
    Assert.input(
      view !== undefined && view.visibility === 'public' && view.block !== undefined,
      'Feed loop requires a public sketch view.',
    )
    const parameter = AST.parametersOf(view).find(candidate => Type.parameterName(candidate) === input.parameterName)
    Assert.input(parameter !== undefined, 'Feed loop entity parameter is unavailable.')
    let type = Type.ofParameter(parameter)
    for (const name of input.fieldPath) {
      Assert.input(
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && type.kind === 'entity',
        'Feed collection path cannot traverse this value.',
      )
      const field = Type.dataFields(type.entity).find(candidate => candidate.name === name)
      Assert.input(field !== undefined && !field.optional, 'Feed collection field is unavailable or optional.')
      type = Type.dataFieldType(field)
    }
    Assert.input(
      type.kind === 'list' && type.element?.kind === 'entity',
      'Feed loop requires an entity collection field.',
    )
    const entity = type.element.entity
    const names = new Set(
      file.statements.flatMap(statement =>
        'name' in statement && typeof statement.name === 'string' ? [statement.name] : []
      ),
    )
    for (const statement of file.statements.filter(AST.isUseStatement)) {
      statement.importedDeclarations.forEach(reference => names.add(reference.$refText))
    }
    const packageContext = await Packages.createContext(input.projectRoot, { sourcePaths: Object.keys(sources) })
    const imports: Array<{ name: string; path: string }> = [{ name: 'Col', path: '@tao/ui' }]
    let rowViewName: string
    let rowParameter: string
    let generated = ''
    if (input.rowView !== undefined) {
      const requestedPath = FS.resolvePath(input.rowView.path, input.projectRoot)
      const rowFile = files.find(candidate => AST.getDocument(candidate).uri.fsPath === requestedPath)
      const selected = rowFile?.statements.filter(AST.isViewDeclaration).find(candidate =>
        candidate.name === input.rowView!.name
      )
      Assert.input(
        selected !== undefined && selected.visibility === 'public' && selected !== view,
        'Feed row view must be a different public project view.',
      )
      const parameters = AST.parametersOf(selected)
      const required = parameters.filter(candidate => candidate.defaultValue === undefined)
      Assert.input(required.length === 1, 'Feed row view needs exactly one required entity parameter.')
      const rowType = Type.ofParameter(required[0]!)
      Assert.input(
        rowType.kind === 'entity' && Type.identityKey(rowType) === Type.identityKey(type.element),
        'Feed row view parameter does not match the collection entity.',
      )
      rowViewName = selected.name
      rowParameter = Type.parameterName(required[0]!)
      if (requestedPath !== viewPath) {
        imports.push({ name: rowViewName, path: studioSourceImport(packageContext, viewPath, requestedPath) })
      }
    } else {
      rowViewName = uniqueName(`${entity.singularName}Row`, names)
      rowParameter = entity.singularName
      imports.push({ name: 'Placeholder', path: '@tao/ui' })
      const entityPath = AST.getDocument(entity).uri.fsPath
      if (entityPath !== viewPath) {
        imports.push({ name: entity.singularName, path: studioSourceImport(packageContext, viewPath, entityPath) })
      }
      generated = `\n\nview ${rowViewName}(${entity.singularName}) { render Placeholder("${entity.singularName}") }\n`
    }
    const binder = uniqueName(
      `${entity.singularName}Item`,
      new Set([
        ...names,
        ...AST.streamAllContents(view).flatMap(node =>
          'name' in node && typeof node.name === 'string' ? [node.name] : []
        ),
      ]),
    )
    const collectionPath = [input.parameterName, ...input.fieldPath].join('.')
    const loop = `loop ${collectionPath} / ${binder} { ${rowViewName}(${rowParameter}: ${binder}) }`
    const source = document.textDocument.getText()
    const roots = view.block.statements.filter(AST.isRenderStatement)
    Assert.input(roots.length === 1, 'Feed loop requires one sketch render tree.')
    let edited: string
    if (input.rectId !== undefined) {
      const tag = `#studio_rect_${encodedTag(input.rectId)}`
      const matches = AST.streamAllContents(view).filter(AST.isRender).filter(render =>
        AST.attachedTag(render)?.tag === tag
      )
      Assert.input(
        matches.length === 1 && matches[0]!.block === undefined,
        'Feed loop requires one tagged leaf rectangle.',
      )
      const target = matches[0]!
      const cst = target.$cstNode!
      const prefix = AST.isRenderStatement(target) ? 'render ' : ''
      const layout = target.layoutClause?.$cstNode?.text
      edited = `${source.slice(0, cst.offset)}${prefix}Col()${layout === undefined ? '' : ` ${layout}`} { ${loop} }${
        source.slice(cst.end)
      }`
    } else {
      const root = roots[0]!
      const cst = root.$cstNode!
      if (root.block !== undefined) {
        const offset = root.block.$cstNode!.end - 1
        edited = `${source.slice(0, offset)}\n${loop}\n${source.slice(offset)}`
      } else {
        const invocation = source.slice(cst.offset, cst.end).replace(/^\s*render\s+/, '')
        edited = `${source.slice(0, cst.offset)}render Col() { ${invocation}\n${loop} }${source.slice(cst.end)}`
      }
    }
    const additions: string[] = []
    const uses = file.statements.filter(AST.isUseStatement)
    for (const entry of imports) {
      const existing = uses.flatMap(use => use.importedDeclarations.map(reference => ({ reference, use })))
        .filter(candidate => candidate.reference.$refText === entry.name)
      const declared = file.statements.some(statement => 'name' in statement && statement.name === entry.name)
      Assert.input(!declared, `Feed loop import conflicts with a declaration: ${entry.name}`)
      Assert.input(
        existing.every(candidate =>
          candidate.use.importPath !== undefined && importMatches(viewPath, candidate.use.importPath, entry.path)
        ),
        `Feed loop import conflicts: ${entry.name}`,
      )
      if (existing.length === 0 && !additions.includes(`use ${entry.name} from ${entry.path}`)) {
        additions.push(`use ${entry.name} from ${entry.path}`)
      }
    }
    const offset = file.statements[0]?.$cstNode?.offset ?? 0
    edited = `${edited.slice(0, offset)}${additions.join('\n')}\n${edited.slice(offset)}${generated}`
    sources[viewPath] = await Formatter.formatCode(edited)
    const check = await Workspace.open(input.projectRoot, { sourceOverrides: sources })
    const checked = await check.parseFiles(paths)
    const checkedFile = checked.flatMap(result => result.files).find(candidate =>
      AST.getDocument(candidate.ast).uri.fsPath === viewPath
    )
    Assert.input(checkedFile !== undefined, 'Feed loop proposal disappeared while validating.')
    const checkedDocument = AST.getDocument(checkedFile.ast)
    Assert.input(
      checkedDocument.parseResult.lexerErrors.length === 0 && checkedDocument.parseResult.parserErrors.length === 0,
      'Feed loop proposal is not valid Tao syntax.',
    )
    const start = sources[viewPath]!.lastIndexOf(`loop ${collectionPath}`)
    return {
      proposal: {
        collectionPath,
        entity: entity.singularName,
        generatedRowView: input.rowView === undefined,
        rowParameter,
        rowView: rowViewName,
      },
      selection: { path: viewPath, range: { end: start + `loop ${collectionPath}`.length, start } },
      sources,
    }
  },
} as const

function uniqueName(base: string, used: ReadonlySet<string>): string {
  let name = base
  let index = 2
  while (used.has(name)) {
    name = `${base}${index++}`
  }
  return name
}

function importMatches(file: string, existing: string, proposed: string): boolean {
  return existing === proposed || existing.startsWith('.') && proposed.startsWith('.')
      && FS.resolvePath(existing.replace(/\.tao$/, ''), FS.dirname(file))
        === FS.resolvePath(proposed.replace(/\.tao$/, ''), FS.dirname(file))
}

function encodedTag(value: string): string {
  return Array.from(
    value,
    character =>
      Array.from({ length: character.length }, (_, index) => character.charCodeAt(index).toString(16).padStart(4, '0'))
        .join(''),
  ).join('')
}
