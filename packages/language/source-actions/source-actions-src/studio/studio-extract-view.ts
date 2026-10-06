import { ASTUtils, Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST, Langium } from '@parser'
import { Errors, Switch } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioCopyViewPatchRequest,
  StudioExtractViewPatchRequest,
  StudioGroupRendersPatchRequest,
  StudioWorkspaceDesignContext,
  StudioWrapRenderContainer,
} from './studio-contract'
import {
  directViewRenderStatement,
  requireLocalRenderId,
  requireRenderById,
  type StudioLexicalValue,
  visibleInsertionValues,
} from './studio-render-occurrences'
import {
  applySourceEdits,
  blockStatementSlices,
  indentSnippet,
  lineIndentAt,
  requireExactKeys,
  requireViewName,
} from './studio-source-text'
import { ensureUiNamesImported } from './studio-use-imports'

/** SiblingSelection is a run of adjacent child renders in one block, in source order. */
type SiblingSelection = Readonly<{
  block: AST.Block
  /** The selected source including the first prefix cluster, dedented to column zero. */
  body: string
  end: number
  indent: string
  /**
   * What a replacement starts with: the line's indent when the first render begins its line, and
   * nothing when it follows other text there, as a bare `| true -> Text(Name)` arm or a one-line
   * `Col() { Text("A") }` block does.
   */
  leading: string
  /** The first render's CST offset relative to the dedented body, after its prefix cluster. */
  renderOffset: number
  renders: readonly AST.ViewRender[]
  start: number
}>

/**
 * groupRenders wraps adjacent sibling renders in one new Row, Col or Stack in place: the canvas's
 * "wrap inline" grouping. The wrapper takes no clauses, so the group's children keep their own.
 */
export async function groupRenders(
  document: AST.Document,
  request: StudioGroupRendersPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['kind', 'renderIds', 'wrapper'], 'Group renders request')
  if (request.wrapper !== 'Col' && request.wrapper !== 'Row' && request.wrapper !== 'Stack') {
    Errors.throwUserInput(`Unsupported Studio wrapper: ${String(request.wrapper)}`)
  }
  const file = document.parseResult.value
  const source = document.textDocument.getText()
  const selection = requireSiblingSelection(document, request.renderIds, 'group')
  ensureUiNamesImported(source, file, [request.wrapper], context.files)
  const grouped = applySourceEdits(source, [{
    end: selection.end,
    replacement: `${selection.leading}${request.wrapper}() {\n${
      indentSnippet(selection.body, `${selection.indent}   `)
    }\n${selection.indent}}`,
    start: selection.start,
  }])
  return await Formatter.formatCode(ensureUiNamesImported(grouped, file, [request.wrapper], context.files))
}

/**
 * extractView turns adjacent sibling renders into a new view declared right after the view that owned
 * them, and renders it in their place. Every value the selection reads from outside itself becomes a
 * parameter of the same name, passed by name at the call site. Several renders are grouped under the
 * container their parent laid them out in (Row, Stack, otherwise Col), since a view renders one root.
 * Queries, state, actions and commands are refused rather than guessed at, because passing them changes
 * who owns a read or a write; so are caller content and render slots, which only the owning view places.
 */
export async function extractView(
  document: AST.Document,
  request: StudioExtractViewPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['kind', 'name', 'renderIds'], 'Make view request')
  const file = document.parseResult.value
  const source = document.textDocument.getText()
  const selection = requireSiblingSelection(document, request.renderIds, 'make a view from')
  const owner = AST.findOwningView(selection.block)
  if (owner?.$cstNode === undefined) {
    Errors.throwUserInput('Can only make a view from elements a view renders.')
  }
  requireNoOwnerPlacements(selection)
  const parameters = selectionParameters(selection, owner)
  const parameterNames = parameters.map(parameter => parameter.name)
  const name = request.name ?? nextFreeViewName(file, context.files, parameterNames)
  requireNewViewName(file, name, context.files)
  if (parameterNames.includes(name)) {
    Errors.throwUserInput(`The new view takes a value named ${name}; choose another view name.`)
  }
  const root = selection.renders.length === 1 ? undefined : selectionRootContainer(selection.block)
  const body = root === undefined
    ? `${selection.body.slice(0, selection.renderOffset)}render ${selection.body.slice(selection.renderOffset)}`
    : `render ${root}() {\n${indentSnippet(selection.body, '   ')}\n}`
  const declaration = `view ${name}(${parameters.map(parameter => parameter.declaration).join(', ')}) {\n${
    indentSnippet(body, '   ')
  }\n}`
  const call = `${name}(${parameterNames.map(parameterName => `${parameterName}: ${parameterName}`).join(', ')})`
  const extracted = applySourceEdits(source, [
    { end: selection.end, replacement: `${selection.leading}${call}`, start: selection.start },
    { end: owner.$cstNode.end, replacement: `\n\n${declaration}`, start: owner.$cstNode.end },
  ])
  const withUi = root === undefined ? extracted : ensureUiNamesImported(extracted, file, [root], context.files)
  const readContext = AST.readContextDeclaration(owner)
  const needsReadContext = readContext !== undefined
    && parameters.some(parameter => parameter.typeDeclaration === readContext)
  const visibleContext = AST.visibleFileDeclarations(file, AST.isTypeDeclaration)
    .find(type => type.name === 'ReadContext')
  if (needsReadContext && visibleContext !== undefined && visibleContext !== readContext) {
    Errors.throwUserInput("Studio cannot import 'ReadContext' because a visible project type already owns that name.")
  }
  // Prepend after the other edits so their original source offsets remain valid. A second use
  // from @tao/data is legal when the file already imports a different contract from it.
  return await Formatter.formatCode(
    needsReadContext && visibleContext === undefined ? `use ReadContext from @tao/data\n\n${withUi}` : withUi,
  )
}

/** A view made from several siblings roots them in the direction their nearest enclosing container laid them out. */
function selectionRootContainer(block: AST.Block): StudioWrapRenderContainer {
  let node: AST.Node | undefined = block.$container
  while (node !== undefined && !AST.isRender(node)) {
    node = node.$container
  }
  const container = node?.view?.$refText
  return container === 'Row' || container === 'Stack' ? container : 'Col'
}

/** Caller content and a declared render slot are placed only by the view that declares them. */
function requireNoOwnerPlacements(selection: SiblingSelection): void {
  const placesOwnerContent = selection.renders
    .flatMap(render => AST.streamAllContents(render))
    .some(node => AST.isCallerContentStatement(node) || (AST.isRenderSlotUse(node) && node.render === undefined))
  if (placesOwnerContent) {
    Errors.throwUserInput(
      'Studio cannot make a view from elements that place @@content or a render slot: caller content and render slots stay in the view that owns them.',
    )
  }
}

/**
 * copyView duplicates a declared view under a new name, right after the original: how the Draw canvas
 * detaches a render rectangle into a view of its own.
 */
export async function copyView(
  document: AST.Document,
  request: StudioCopyViewPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  const file = document.parseResult.value
  const matches = file.statements.filter(AST.isViewDeclaration).filter(statement => statement.name === request.view)
  if (matches.length !== 1 || matches[0]?.$cstNode === undefined) {
    Errors.throwUserInput(`Studio view is not uniquely declared in this source file: ${request.view}`)
  }
  requireNewViewName(file, request.name, context.files)
  const cstNode = matches[0]!.$cstNode!
  const nameNode = Langium.GrammarUtils.findNodeForProperty(cstNode, 'name')
  if (nameNode === undefined) {
    Errors.throwUserInput(`Studio cannot find the declared name of view: ${request.view}`)
  }
  const originalText = cstNode.text
  const nameStart = nameNode.offset - cstNode.offset
  const nameEnd = nameNode.end - cstNode.offset
  const copyText = `${originalText.slice(0, nameStart)}${request.name}${originalText.slice(nameEnd)}`
  const source = document.textDocument.getText()
  return await Formatter.formatCode(
    applySourceEdits(source, [{
      end: cstNode.end,
      replacement: `${originalText}\n\n${copyText}`,
      start: cstNode.offset,
    }]),
  )
}

function requireNewViewName(file: AST.TaoFile, name: unknown, files: readonly AST.TaoFile[] = [file]): void {
  requireViewName(name)
  if (viewNameTaken(file, name, files)) {
    Errors.throwUserInput(`A declaration named ${name} is already visible here; choose another view name.`)
  }
}

/**
 * nextFreeViewName numbers an unnamed view the way the canvas numbers a drawn one, View1, View2, …,
 * skipping the names of the values the new view takes.
 */
function nextFreeViewName(
  file: AST.TaoFile,
  files: readonly AST.TaoFile[] = [file],
  parameterNames: readonly string[] = [],
): string {
  let index = 1
  while (viewNameTaken(file, `View${index}`, files) || parameterNames.includes(`View${index}`)) {
    index += 1
  }
  return `View${index}`
}

/** A data declaration names its entity as well as its collection: `data Notes / Note` takes both. */
function viewNameTaken(file: AST.TaoFile, name: string, files: readonly AST.TaoFile[]): boolean {
  return [file, ...files].some(candidate =>
    candidate.statements.some(statement =>
      (AST.isDeclaration(statement) && AST.declarationNamespace(statement) === 'value' && statement.name === name)
      || (AST.isEntityDataDeclaration(statement) && statement.singularName === name)
      || (AST.isUseStatement(statement)
        && (AST.resolvedImportedBindings(statement).some(binding =>
          binding.namespace === 'value'
          && (binding.localName === name
            || (statement.all && AST.isEntityDataDeclaration(binding.declaration)
              && binding.declaration.singularName === name))
        ) || statement.importedDeclarations.some(item =>
          AST.importLocalName(item) === name && item.target.ref === undefined
        )))
    )
  )
}

function requireSiblingSelection(document: AST.Document, renderIds: unknown, operation: string): SiblingSelection {
  if (!Array.isArray(renderIds) || renderIds.length === 0 || !renderIds.every(id => typeof id === 'string')) {
    Errors.throwUserInput(`Studio needs at least one selected element to ${operation}.`)
  }
  if (new Set(renderIds).size !== renderIds.length) {
    Errors.throwUserInput(`Studio selection names an element twice.`)
  }
  const file = document.parseResult.value
  const source = document.textDocument.getText()
  const selected = renderIds.map(id => {
    requireLocalRenderId(document, id, `${operation} elements`)
    const statement = directViewRenderStatement(requireRenderById(file, id))
    if (statement === undefined) {
      Errors.throwUserInput(`Can only ${operation} elements inside a container, not a view's root render.`)
    }
    const tags = [
      ...AST.renderPrefixCluster(statement),
      ...AST.streamAllContents(statement),
    ].filter(AST.isTagStatement)
    if (tags.some(tag => tag.tag.startsWith('#studio_rect_'))) {
      Errors.throwUserInput(`Unsnap the sketch first; Studio cannot ${operation} a snapped sketch element.`)
    }
    return statement
  })
  const block = selected[0]!.$container
  if (!AST.isBlock(block) || selected.some(render => render.$container !== block)) {
    Errors.throwUserInput(`Can only ${operation} elements that share one container.`)
  }
  const slices = blockStatementSlices(source, block)
  const indexes = selected.map(render => slices.findIndex(slice => slice.statement === render)).toSorted((a, b) =>
    a - b
  )
  if (indexes.some((index, position) => index !== indexes[0]! + position)) {
    Errors.throwUserInput(`Can only ${operation} adjacent elements; move them next to each other first.`)
  }
  const renders = indexes.map(index => slices[index]!.statement as AST.ViewRender)
  const first = renders[0]!.$cstNode!
  const last = renders.at(-1)!.$cstNode!
  const indent = lineIndentAt(source, first.offset)
  const start = slices[indexes[0]!]!.start
  const beginsLine = source.lastIndexOf('\n', start - 1) + 1 === start
  const dedent = (text: string): string =>
    text.split('\n')
      .map(line => line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())
      .join('\n')
  const body = dedent(source.slice(start, last.end))
  const renderOffset = dedent(source.slice(start, first.offset)).length
  return { block, body, end: last.end, indent, leading: beginsLine ? indent : '', renderOffset, renders, start }
}

type ExtractedParameter = Readonly<{ declaration: string; name: string; typeDeclaration?: AST.TypeDefinition }>

type ExtractedValue = StudioLexicalValue | AST.CasePayload

/**
 * selectionParameters lists the outside values the selection reads, in first-read order. A read of
 * anything else the owning view binds outside the selection is refused: the new view could not see it.
 */
function selectionParameters(selection: SiblingSelection, owner: AST.ViewDeclaration): readonly ExtractedParameter[] {
  const visible = new Map<string, ExtractedValue>([
    ...visibleInsertionValues(selection.block, selection.renders[0]!.$cstNode!.offset),
    ...enclosingCasePayloads(selection.block),
  ])
  const names = new Map<AST.Node, string>([...visible].map(([name, value]) => [value, name]))
  const read = new Map<string, ExtractedValue>()
  for (const render of selection.renders) {
    const roots = [...AST.renderPrefixCluster(render), render]
    for (const node of roots.flatMap(root => [root, ...AST.streamAllContents(root)])) {
      for (const reference of AST.streamReferences(node)) {
        const target = 'ref' in reference.reference ? reference.reference.ref : undefined
        const name = target === undefined ? undefined : names.get(target)
        if (name !== undefined) {
          if (!read.has(name)) {
            read.set(name, visible.get(name)!)
          }
        } else if (
          AST.isValueDeclaration(target)
          && target !== owner
          && isWithin(target, owner)
          && !selection.renders.some(selected => isWithin(target, selected))
        ) {
          Errors.throwUserInput(
            `Studio cannot make a view that reads ${reference.reference.$refText}: ${owner.name} binds it outside the selection.`,
          )
        }
      }
    }
  }
  return [...read].map(([name, value]) => {
    const type = Type.ofValueDeclaration(value)
    return {
      declaration: parameterDeclaration(name, value),
      name,
      typeDeclaration: type.kind === 'item' ? type.nominal : undefined,
    }
  })
}

/** enclosingCasePayloads lists the case payloads (`error -> Message`) of the branches around a block, innermost last. */
function enclosingCasePayloads(block: AST.Block): Array<[string, AST.CasePayload]> {
  return [block, ...AST.ancestorBlocks(block)].flatMap((candidate): Array<[string, AST.CasePayload]> => {
    const branch = candidate.$container
    const payload = AST.isWhenRenderBranch(branch) || AST.isGuardRenderBranch(branch) ? branch.payload : undefined
    return payload === undefined ? [] : [[payload.name, payload]]
  }).toReversed()
}

function isWithin(node: AST.Node, ancestor: AST.Node): boolean {
  for (let current: AST.Node | undefined = node; current !== undefined; current = current.$container) {
    if (current === ancestor) {
      return true
    }
  }
  return false
}

function parameterDeclaration(name: string, value: ExtractedValue): string {
  if (AST.isParameterDeclaration(value)) {
    const text = value.$cstNode?.text
    if (text === undefined) {
      Errors.throwUserInput(`Cannot copy parameter ${name} without its source.`)
    }
    return text
  }
  if (
    AST.isEntityQueryDeclaration(value)
    || AST.isStateDeclaration(value)
    || AST.isActionDeclaration(value)
    || AST.isCommandDeclaration(value)
  ) {
    Errors.throwUserInput(
      `Studio cannot make a view that reads ${name} yet: queries, state, actions and commands stay in the view that owns them.`,
    )
  }
  const type = sourceTypeName(Type.ofValueDeclaration(value))
  if (type === undefined) {
    Errors.throwUserInput(`Studio cannot name the type of ${name}; give it an explicit type, then make the view.`)
  }
  return `${name} ${type}`
}

/** sourceTypeName spells a resolved type as a parameter type, or nothing where no plain spelling exists. */
function sourceTypeName(type: ASTUtils.TaoType): string | undefined {
  const plain = () => {
    const name = Type.displayName(type)
    return name.includes('.') ? undefined : name
  }
  return Switch.kind(type, {
    entity: plain,
    capability: plain,
    enum: plain,
    item: item => item.nominal === undefined ? undefined : plain(),
    list: list => list.element === undefined || sourceTypeName(list.element) === undefined ? undefined : plain(),
    primitive: primitive => primitive.primitive === 'action' ? undefined : plain(),
    union: () => undefined,
    unresolved: () => undefined,
  })
}
