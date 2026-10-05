import { ASTUtils, Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioBindTextPatchRequest,
  StudioLayoutEntry,
  StudioRenderInspection,
  StudioSetTextContentPatchRequest,
  StudioStyleEntry,
  StudioTextBindingCandidate,
  StudioTextInspection,
  StudioWorkspaceDesignContext,
} from './studio-contract'
import { selectedDesign, styleProvenance } from './studio-design-styles'
import { isInlineDesignExploration, isStudioLayoutEntry } from './studio-layout-entries'
import {
  renderOwnerInspection,
  requireLocalRenderId,
  requireRenderById,
  visibleRenderValues,
} from './studio-render-occurrences'
import { renderSiblingMoves } from './studio-render-tree'
import { applySourceEdits, requireExactKeys, taoStringLiteral } from './studio-source-text'

/** inspectRender returns parser-owned current clause values and workspace-aware design provenance. */
export function inspectRender(
  document: AST.Document,
  renderId: string,
  context: StudioWorkspaceDesignContext = {},
): StudioRenderInspection {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, renderId, 'inspect renders')
  const render = requireRenderById(document.parseResult.value, renderId)
  const entries = (render.layoutClause?.entries ?? []).map(entry => ASTUtils.layoutEntryValues(entry))
  const layoutEntries = entries.filter(isStudioLayoutEntry) as unknown as StudioLayoutEntry[]
  const styleEntries = entries.filter(entry => !isStudioLayoutEntry(entry)) as unknown as StudioStyleEntry[]
  const files = context.files ?? [document.parseResult.value]
  const design = selectedDesign(files)
  const ownerPath = design === undefined ? undefined : AST.getDocument(design).uri.fsPath
  const local = ownerPath === undefined || ownerPath === document.uri.fsPath
  const elementName = ASTUtils.design.standardElementName(render)
  const owner = renderOwnerInspection(render)
  return {
    ...(design === undefined || ownerPath === undefined
      ? {}
      : {
        design: {
          editable: local,
          name: design.name,
          ownerPath,
          ...(local ? {} : { reason: 'Imported design values are read-only in this source file.' }),
        },
      }),
    ...(elementName === undefined ? {} : { elementName }),
    explorations: entries.filter(isInlineDesignExploration) as unknown as StudioStyleEntry[],
    layoutEntries,
    moves: renderSiblingMoves(render),
    ...(owner === undefined ? {} : { owner }),
    renderId,
    styleEntries,
    styleProvenance: styleEntries.map(entry => styleProvenance(files, document, design, entry)),
    ...(() => {
      const text = textInspection(document, render)
      return text === undefined ? {} : { text }
    })(),
  }
}

const studioTextLeafNames: ReadonlySet<string> = new Set(['Text', 'TextMultiline'])

type StudioTextLeaf = Readonly<{ argument: AST.Argument; render: AST.Render }>

/** textLeaf recognizes a Text or TextMultiline render whose first positional argument can be edited. */
function textLeaf(render: AST.Render): StudioTextLeaf | undefined {
  const standardName = ASTUtils.design.standardElementName(render)
  if (standardName === undefined || !studioTextLeafNames.has(standardName) || render.block !== undefined) {
    return undefined
  }
  const argument = render.argumentList?.arguments.find(candidate => candidate.label === undefined)
  return argument?.$cstNode === undefined ? undefined : { argument, render }
}

function requireTextLeaf(file: AST.TaoFile, renderId: string, operation: string): StudioTextLeaf {
  const leaf = textLeaf(requireRenderById(file, renderId))
  if (leaf === undefined) {
    Errors.throwUserInput(`Studio can ${operation} only on a Text or TextMultiline leaf with a value.`)
  }
  return leaf
}

function textInspection(document: AST.Document, render: AST.Render): StudioTextInspection | undefined {
  const leaf = textLeaf(render)
  if (leaf === undefined) {
    return undefined
  }
  const expression = document.textDocument.getText().slice(leaf.argument.$cstNode!.offset, leaf.argument.$cstNode!.end)
  const literal = AST.isStringLiteral(leaf.argument.value) ? leaf.argument.value.value : undefined
  return {
    candidates: textBindingCandidates(render),
    expression,
    ...(literal === undefined ? {} : { literal }),
  }
}

function textCandidateType(type: ASTUtils.TaoType): StudioTextBindingCandidate['type'] | undefined {
  if (type.kind === 'primitive' && (type.primitive === 'text' || type.primitive === 'number')) {
    return type.primitive
  }
  return undefined
}

/**
 * textBindingCandidates lists every scalar value and every non-optional scalar entity field, one level
 * deep, that a text leaf could show. Deeper relations and collections wait for a richer picker.
 */
function textBindingCandidates(render: AST.Render): readonly StudioTextBindingCandidate[] {
  const candidates: StudioTextBindingCandidate[] = []
  for (const [name, declaration] of visibleRenderValues(render)) {
    const type = Type.ofValueDeclaration(declaration)
    const scalar = textCandidateType(type)
    if (scalar !== undefined) {
      candidates.push({ expression: name, type: scalar })
      continue
    }
    if (type.kind !== 'entity') {
      continue
    }
    for (const field of Type.dataFields(type.entity)) {
      if (field.optional) {
        continue
      }
      const fieldType = textCandidateType(Type.dataFieldType(field))
      if (fieldType !== undefined) {
        candidates.push({ expression: `${name}.${field.name}`, type: fieldType })
      }
    }
  }
  return candidates.toSorted((left, right) => left.expression.localeCompare(right.expression))
}

/** setTextContent replaces a text leaf's value with a string literal and keeps its other arguments. */
export async function setTextContent(
  document: AST.Document,
  request: StudioSetTextContentPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['content', 'kind', 'renderId'], 'Set text content request')
  if (typeof request.content !== 'string') {
    Errors.throwUserInput('Studio text content must be a string.')
  }
  requireLocalRenderId(document, request.renderId, 'set text content')
  const leaf = requireTextLeaf(document.parseResult.value, request.renderId, 'set text content')
  return await Formatter.formatCode(applySourceEdits(document.textDocument.getText(), [{
    end: leaf.argument.$cstNode!.end,
    replacement: taoStringLiteral(request.content),
    start: leaf.argument.$cstNode!.offset,
  }]))
}

/** bindText points a text leaf at one of the values inspection offered for it, interpolating non-text. */
export async function bindText(document: AST.Document, request: StudioBindTextPatchRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireExactKeys(request, ['expression', 'kind', 'renderId'], 'Bind text request')
  requireLocalRenderId(document, request.renderId, 'bind text')
  const leaf = requireTextLeaf(document.parseResult.value, request.renderId, 'bind text')
  const candidate = textBindingCandidates(leaf.render).find(entry => entry.expression === request.expression)
  if (candidate === undefined) {
    Errors.throwUserInput(`Studio text binding is not visible at this render: ${request.expression}`)
  }
  return await Formatter.formatCode(applySourceEdits(document.textDocument.getText(), [{
    end: leaf.argument.$cstNode!.end,
    replacement: candidate.type === 'text' ? candidate.expression : `"{ ${candidate.expression} }"`,
    start: leaf.argument.$cstNode!.offset,
  }]))
}
