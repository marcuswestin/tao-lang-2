import { ASTUtils } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors, Switch } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioLayoutTermValue,
  StudioSetDesignEntryPatchRequest,
  StudioSetStyleEntryPatchRequest,
  StudioStyleEntry,
  StudioStyleLandingScope,
  StudioStyleProvenance,
  StudioWorkspaceDesignContext,
} from './studio-contract'
import {
  cssHexColor,
  formatLayoutTermValue,
  formatLayoutValues,
  isStudioLayoutEntry,
  layoutEntryHead,
  layoutEntrySlot,
  removeLayoutClauseEntryEdit,
  setLayoutClauseEntryEdit,
  setLayoutClauseEntrySource,
  setRenderLayoutEntrySource,
} from './studio-layout-entries'
import { requireLocalRenderId, requireRenderById } from './studio-render-occurrences'
import { applySourceEdits, requireDesignValueName, requireIdentifier, type SourceEdit } from './studio-source-text'

/** styleProvenance explains where one style entry on a render comes from and how far an edit to it reaches. */
export function styleProvenance(
  files: readonly AST.TaoFile[],
  document: AST.Document,
  design: AST.DesignDeclaration | undefined,
  entry: StudioStyleEntry,
): StudioStyleProvenance {
  const bundleName = entry.length === 1 && typeof entry[0] === 'string' ? entry[0] : undefined
  const bundles = design === undefined ? [] : designSpecMembers(design).filter(bundle => bundle.name === bundleName)
  if (bundleName === undefined || bundles.length !== 1) {
    return { blastRadius: 1, chain: [formatLayoutValues(entry)], landing: { kind: 'element-inline' } }
  }
  const bundle = bundles[0]!
  const blastRadius = [
    ...files.flatMap(file => [
      ...AST.streamAllContents(file).filter(AST.isRender).filter(render =>
        render.layoutClause?.entries.some(candidate => {
          const values = ASTUtils.layoutEntryValues(candidate)
          return values.length === 1 && values[0] === bundleName
        }) === true
      ),
    ]),
  ].length
  const ownerPath = AST.getDocument(bundle).uri.fsPath
  const editable = ownerPath === document.uri.fsPath
  return {
    blastRadius,
    chain: [bundleName, ...bundle.spec.entries.map(candidate => ASTUtils.layoutEntryValues(candidate).join(' '))],
    ...(editable
      ? {}
      : {
        editable: false as const,
        ownerPath,
        reason: 'Imported style bundles are read-only; open their owning file to edit or fork them.',
      }),
    landing: { bundleName, kind: 'style-bundle', mode: 'edit' },
  }
}

type DesignSpecMember = AST.DesignBundle | AST.DesignStyleEntry | AST.DesignTextEntry

function designSpecMembers(design: AST.DesignDeclaration): DesignSpecMember[] {
  const result: DesignSpecMember[] = []
  for (const member of design.block.members) {
    if (AST.isDesignBundle(member)) {
      result.push(member)
    } else if (AST.isDesignStylesBlock(member) || AST.isDesignTextBlock(member)) {
      result.push(...member.entries)
    }
  }
  return result
}

/** setStyleEntry lands an exploration in an explicit, parser-owned current-grammar design scope. */
export async function setStyleEntry(
  document: AST.Document,
  request: StudioSetStyleEntryPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'edit styles for renders')
  const render = requireRenderById(document.parseResult.value, request.renderId)
  const files = context.files ?? [document.parseResult.value]
  const landing = request.landing
  if (landing.kind === 'element-inline') {
    const entry = formatStyleEntry(request.entry)
    return await Formatter.formatCode(setRenderLayoutEntrySource(document.textDocument.getText(), render, entry))
  }
  const entry = formatDesignEntry(request.entry)
  const design = requireEditableSelectedDesign(document, files)
  return Switch.kind(landing, {
    'size-token': async landing => await setSizeToken(document, design, render, request.entry, landing.tokenName),
    'style-bundle': async landing => {
      if (landing.mode === 'edit') {
        const bundleName = landing.bundleName
        requireIdentifier(bundleName, 'style bundle')
        const bundles = designSpecMembers(design).filter(bundle => bundle.name === bundleName)
        if (bundles.length !== 1) {
          Errors.throwUserInput(`Studio style bundle is not uniquely declared in this source file: ${bundleName}`)
        }
        return await Formatter.formatCode(
          setLayoutClauseEntrySource(document.textDocument.getText(), bundles[0]!.spec, entry),
        )
      }
      return await forkStyleBundle(document, design, render, landing, entry)
    },
    'element-default': async landing => await setElementDefault(document, design, render, landing.elementName, entry),
    token: async landing => await setColorToken(document, design, render, request.entry, landing.tokenName),
  })
}

/** setDesignEntry (semantic agent PoC) edits one named bundle/style/text member of a named design in this document. */
export async function setDesignEntry(
  document: AST.Document,
  request: StudioSetDesignEntryPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireIdentifier(request.designName, 'design')
  requireIdentifier(request.memberName, 'design member')
  const designs = AST.streamAllContents(document.parseResult.value).filter(AST.isDesignDeclaration)
    .filter(design => design.name === request.designName)
  if (designs.length !== 1) {
    Errors.throwUserInput(`Design is not uniquely declared in this source file: ${request.designName}`)
  }
  const members = designSpecMembers(designs[0]!).filter(member => member.name === request.memberName)
  if (members.length !== 1) {
    Errors.throwUserInput(
      `Design member is not uniquely declared in ${request.designName}: ${request.memberName}`,
    )
  }
  const entry = formatDesignEntry(request.entry)
  // Edit in place and refuse a no-op: moving an unchanged entry to the end of the clause is not a change.
  const spec = members[0]!.spec
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existing = spec.entries.find(candidate => layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot)
  const source = document.textDocument.getText()
  if (existing !== undefined) {
    const current = ASTUtils.layoutEntryValues(existing).join(' ')
    if (current === entry) {
      Errors.throwUserInput(
        `Design member ${request.memberName} already has ${entry}; the requested change is a no-op.`,
      )
    }
    return await Formatter.formatCode(applySourceEdits(source, [{
      end: existing.$cstNode!.end,
      replacement: entry,
      start: existing.$cstNode!.offset,
    }]))
  }
  return await Formatter.formatCode(setLayoutClauseEntrySource(source, spec, entry))
}

/** selectedDesign returns the app's chosen design, or the only declared one, across the workspace files. */
export function selectedDesign(files: readonly AST.TaoFile[]): AST.DesignDeclaration | undefined {
  const selected = files.flatMap(file => [
    ...AST.streamAllContents(file).filter(AST.isAppProperty)
      .filter(property => property.name === 'Design')
      .flatMap(property => {
        const value = property.value
        const target = AST.isValueReference(value) ? value.target.ref : undefined
        return AST.isDesignDeclaration(target) ? [target] : []
      }),
  ])
  const uniqueSelected = [...new Set(selected)]
  if (uniqueSelected.length === 1) {
    return uniqueSelected[0]
  }
  const declarations = files.flatMap(file => [
    ...AST.streamAllContents(file).filter(AST.isDesignDeclaration),
  ])
  return declarations.length === 1 ? declarations[0] : undefined
}

function requireEditableSelectedDesign(
  document: AST.Document,
  files: readonly AST.TaoFile[],
): AST.DesignDeclaration {
  const design = selectedDesign(files)
  if (design === undefined) {
    Errors.throwUserInput('Studio design landing requires one uniquely selected design declaration.')
  }
  const ownerPath = AST.getDocument(design).uri.fsPath
  if (ownerPath !== document.uri.fsPath) {
    Errors.throwUserInput(
      `Studio cannot write imported design ${design.name} from this file; open its owning source file: ${ownerPath}`,
    )
  }
  return design
}

async function forkStyleBundle(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  landing: Extract<StudioStyleLandingScope, { kind: 'style-bundle' }>,
  entry: string,
): Promise<string> {
  requireIdentifier(landing.bundleName, 'style bundle')
  const bundles = designSpecMembers(design).filter(bundle => bundle.name === landing.bundleName)
  if (bundles.length !== 1) {
    Errors.throwUserInput(
      `Studio style bundle is not uniquely declared in this source file: ${landing.bundleName}`,
    )
  }
  const names = designValueNames(design)
  // A render names the fork, so it is a lowercase style even when forked from a Capitalized one.
  const forkName = landing.forkName === undefined
    ? uniqueDesignMemberName(`${lowercaseFirst(landing.bundleName)}Variant`, names)
    : landing.forkName
  requireDesignValueName(forkName, 'forked style bundle')
  if (names.has(forkName)) {
    Errors.throwUserInput(`Studio design member already exists: ${forkName}`)
  }
  const source = document.textDocument.getText()
  const base = bundles[0]!
  const entries = base.spec.entries.map(candidate => candidate.$cstNode!.text)
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingIndex = base.spec.entries.findLastIndex(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (existingIndex === -1) {
    entries.push(entry)
  } else {
    entries[existingIndex] = entry
  }
  const bundleReference = render.layoutClause?.entries.find(candidate => {
    const values = ASTUtils.layoutEntryValues(candidate)
    return values.length === 1 && values[0] === landing.bundleName
  })
  if (bundleReference?.$cstNode === undefined) {
    Errors.throwUserInput(`Selected render no longer applies style bundle ${landing.bundleName}.`)
  }
  const inlineExploration = render.layoutClause?.entries.findLast(candidate =>
    candidate !== bundleReference && layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  const content = applySourceEdits(source, [
    designSpecInsertionEdit(source, design, base, `${forkName} [${entries.join(', ')}]`),
    {
      end: bundleReference.$cstNode.end,
      replacement: forkName,
      start: bundleReference.$cstNode.offset,
    },
    ...(inlineExploration?.$cstNode === undefined
      ? []
      : [removeLayoutClauseEntryEdit(source, render, inlineExploration)]),
  ])
  return await Formatter.formatCode(content)
}

async function setElementDefault(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  elementName: string,
  entry: string,
): Promise<string> {
  requireIdentifier(elementName, 'element default')
  if (ASTUtils.design.standardElementName(render) !== elementName) {
    Errors.throwUserInput(`Selected render is not the standard Tao element ${elementName}.`)
  }
  const source = document.textDocument.getText()
  const defaults = designSpecMembers(design).filter(bundle => bundle.name === elementName)
  if (defaults.length > 1) {
    Errors.throwUserInput(`Studio element default is not uniquely declared: ${elementName}`)
  }
  const designEdit = defaults[0] === undefined
    ? preferredStyleInsertionEdit(source, design, `${elementName} [${entry}]`)
    : setLayoutClauseEntryEdit(source, defaults[0].spec, entry)
  const exploration = requireRenderEntryByHead(render, layoutEntryHead(entry))
  const content = applySourceEdits(source, [designEdit, removeLayoutClauseEntryEdit(source, render, exploration)])
  return await Formatter.formatCode(content)
}

async function setColorToken(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  values: StudioStyleEntry,
  tokenName: string,
): Promise<string> {
  requireDesignValueName(tokenName, 'color token')
  const [head, value, ...rest] = values
  if (!colorEntryHeads.has(head) || typeof value !== 'string' || !cssHexColor.test(value) || rest.length > 0) {
    Errors.throwUserInput(
      'Current Tao design tokens can only promote raw background, bg, border, fg, or ink colors.',
    )
  }
  const source = document.textDocument.getText()
  const colorBlocks = design.block.members.filter(AST.isDesignColorsBlock)
  // An existing color is edited where it stands, even flat; a new one always lands in `colors { }`.
  const entries = [
    ...colorBlocks.flatMap(block => block.entries),
    ...design.block.members.filter(AST.isDesignToken),
  ].filter(candidate => candidate.name === tokenName)
  if (entries.length > 1) {
    Errors.throwUserInput(`Studio color token is not uniquely declared: ${tokenName}`)
  }
  const tokenEdit = entries[0]?.$cstNode === undefined
    ? colorBlocks[0] === undefined
      ? designMemberInsertionEdit(source, design, `colors { ${tokenName} ${value} }`)
      : typedBlockEntryInsertionEdit(source, colorBlocks[0], `${tokenName} ${value}`)
    : {
      end: entries[0].$cstNode.end,
      replacement: `${tokenName} ${value}`,
      start: entries[0].$cstNode.offset,
    }
  const exploration = requireRenderEntryByHead(render, head)
  return await Formatter.formatCode(applySourceEdits(source, [
    tokenEdit,
    {
      end: exploration.$cstNode!.end,
      replacement: `${head} ${tokenName}`,
      start: exploration.$cstNode!.offset,
    },
  ]))
}

const sizeTokenHeads = new Set(['gap', 'height', 'line', 'margin', 'pad', 'radius', 'size', 'width'])

async function setSizeToken(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  values: StudioStyleEntry,
  tokenName: string,
): Promise<string> {
  requireDesignValueName(tokenName, 'size token')
  const [head, ...terms] = values
  const numberIndices = terms.flatMap((term, index) => typeof term === 'number' ? [index] : [])
  if (!sizeTokenHeads.has(head) || numberIndices.length !== 1 || Number(terms[numberIndices[0]!]) <= 0) {
    Errors.throwUserInput(
      'Studio size promotion requires one positive numeric typography, spacing, radius, width, or height value.',
    )
  }
  const numericIndex = numberIndices[0]!
  const numericValue = terms[numericIndex] as number
  const source = document.textDocument.getText()
  const sizeBlocks = design.block.members.filter(AST.isDesignSizesBlock)
  const sizes = sizeBlocks.flatMap(block => block.entries).filter(candidate => candidate.name === tokenName)
  const conflicts = designValueNames(design)
  if (sizes.length > 1 || (sizes.length === 0 && conflicts.has(tokenName))) {
    Errors.throwUserInput(`Studio size token is not uniquely available: ${tokenName}`)
  }
  const sizeEdit = sizes[0]?.$cstNode === undefined
    ? sizeBlocks[0] === undefined
      ? designMemberInsertionEdit(source, design, `sizes { ${tokenName} ${numericValue}.px }`)
      : typedBlockEntryInsertionEdit(source, sizeBlocks[0], `${tokenName} ${numericValue}.px`)
    : {
      end: sizes[0].$cstNode.end,
      replacement: `${tokenName} ${numericValue}.px`,
      start: sizes[0].$cstNode.offset,
    }
  const exploration = requireRenderEntryByHead(render, head)
  const replacementTerms = [...terms]
  replacementTerms[numericIndex] = tokenName
  return await Formatter.formatCode(applySourceEdits(source, [
    sizeEdit,
    {
      end: exploration.$cstNode!.end,
      replacement: [head, ...replacementTerms].map(formatLayoutTermValue).join(' '),
      start: exploration.$cstNode!.offset,
    },
  ]))
}

function requireRenderEntryByHead(render: AST.Render, head: StudioLayoutTermValue): AST.LayoutEntry {
  const slot = layoutEntrySlot([head])
  const entry = render.layoutClause?.entries.findLast(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (entry?.$cstNode === undefined) {
    Errors.throwUserInput(`Selected render no longer has inline design exploration '${head}'.`)
  }
  return entry
}

function uniqueDesignMemberName(base: string, names: ReadonlySet<string>): string {
  if (!names.has(base)) {
    return base
  }
  let suffix = 2
  while (names.has(`${base}${suffix}`)) {
    suffix += 1
  }
  return `${base}${suffix}`
}

function lowercaseFirst(name: string): string {
  return `${name.slice(0, 1).toLowerCase()}${name.slice(1)}`
}

function designValueNames(design: AST.DesignDeclaration): Set<string> {
  const names = new Set<string>()
  for (const member of design.block.members) {
    if (AST.isDesignToken(member) || AST.isDesignBundle(member)) {
      names.add(member.name)
    } else if (AST.isDesignColorsBlock(member)) {
      for (const entry of member.entries) {
        names.add(entry.name)
        for (const family of entry.family?.members ?? []) {
          names.add(`${entry.name}.${family.name}`)
        }
      }
    } else if (AST.isDesignSizesBlock(member) || AST.isDesignTextBlock(member) || AST.isDesignStylesBlock(member)) {
      for (const entry of member.entries) {
        names.add(entry.name)
      }
    }
  }
  return names
}

function designSpecInsertionEdit(
  source: string,
  design: AST.DesignDeclaration,
  base: DesignSpecMember,
  entry: string,
): SourceEdit {
  if (AST.isDesignStyleEntry(base) && AST.isDesignStylesBlock(base.$container)) {
    return typedBlockEntryInsertionEdit(source, base.$container, entry)
  }
  if (AST.isDesignTextEntry(base) && AST.isDesignTextBlock(base.$container)) {
    return typedBlockEntryInsertionEdit(source, base.$container, entry)
  }
  return preferredStyleInsertionEdit(source, design, entry)
}

/** preferredStyleInsertionEdit lands a new style in the design's `styles { }` block, creating it when missing. */
function preferredStyleInsertionEdit(source: string, design: AST.DesignDeclaration, entry: string): SourceEdit {
  const blocks = design.block.members.filter(AST.isDesignStylesBlock)
  return blocks[0] === undefined
    ? designMemberInsertionEdit(source, design, `styles { ${entry} }`)
    : typedBlockEntryInsertionEdit(source, blocks[0], entry)
}

function typedBlockEntryInsertionEdit(source: string, block: AST.Node, entry: string): SourceEdit {
  const cstNode = block.$cstNode
  if (cstNode === undefined) {
    Errors.throwUserInput('Cannot edit a structured design block without source coordinates.')
  }
  const closeBrace = source.lastIndexOf('}', cstNode.end - 1)
  const insertionOffset = closeBrace === -1 ? cstNode.end : closeBrace
  return { end: insertionOffset, replacement: `\n${entry}\n`, start: insertionOffset }
}

function designMemberInsertionEdit(source: string, design: AST.DesignDeclaration, member: string): SourceEdit {
  const cstNode = design.$cstNode
  if (cstNode === undefined) {
    Errors.throwUserInput('Cannot edit a design declaration without source coordinates.')
  }
  const closeBrace = source.lastIndexOf('}', cstNode.end - 1)
  const insertionOffset = closeBrace === -1 ? cstNode.end : closeBrace
  return { end: insertionOffset, replacement: `\n${member}\n`, start: insertionOffset }
}

const colorEntryHeads = new Set<string>(ASTUtils.design.colorHeads)

function formatStyleEntry(entry: StudioStyleEntry): string {
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== 'string') {
    Errors.throwUserInput(`Invalid Studio style entry: ${formatLayoutValues(entry)}`)
  }
  const values = entry as readonly StudioLayoutTermValue[]
  if (isStudioLayoutEntry(values)) {
    Errors.throwUserInput(`Studio style entry targets a layout clause: ${formatLayoutValues(entry)}`)
  }
  return values.map(formatLayoutTermValue).join(' ')
}

function formatDesignEntry(entry: StudioStyleEntry): string {
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== 'string') {
    Errors.throwUserInput(`Invalid Studio design entry: ${formatLayoutValues(entry)}`)
  }
  return (entry as readonly StudioLayoutTermValue[]).map(formatLayoutTermValue).join(' ')
}
