import Formatter from '@formatter'
import type { AST } from '@parser'
import { canonicalizeTopLevel } from './files-actions'
import {
  assembleWithTrailingSource,
  assertNoSyntaxErrors,
  formatWhenChanged,
  hasSyntaxErrors,
  parseSourceText,
  type SourceActionOptions,
  sourceStatementContext,
} from './source-actions-utils'
import {
  StudioActions,
  type StudioAddSketchEntityParameterPatchRequest,
  type StudioAppendScenarioStepsPatchRequest,
  type StudioBindSketchFieldPatchRequest,
  type StudioComponentKind,
  type StudioInsertCapturedFixturePatchRequest,
  type StudioInsertComponentPatchRequest,
  type StudioInsertProjectViewPatchRequest,
  type StudioInsertSeparatorPatchRequest,
  type StudioInsertSpacerPatchRequest,
  type StudioLayoutAlignment,
  type StudioLayoutContentTerm,
  type StudioLayoutEntry,
  type StudioLayoutSizeValue,
  type StudioLayoutSpacingSide,
  type StudioLayoutTermValue,
  type StudioMoveRenderPatchRequest,
  type StudioMoveRenderRequest,
  type StudioRenderGap,
  type StudioRenderInspection,
  type StudioScenarioArgumentValue,
  type StudioSetLayoutEntryPatchRequest,
  type StudioSetScenarioArgumentsPatchRequest,
  type StudioSetStyleEntryPatchRequest,
  type StudioSketchFieldPath,
  type StudioSketchFieldPresentation,
  type StudioSketchScenarioFixtureBinding,
  type StudioSketchSnapContainer,
  type StudioSketchSnapElement,
  type StudioSketchSnapTree,
  type StudioSnapSketchToFlowPatchRequest,
  StudioSourceOccurrenceConflictError,
  type StudioSourceOccurrencePrecondition,
  type StudioSourcePatch,
  type StudioSourcePatchRequest,
  type StudioSourceTextEdit,
  type StudioStyleEntry,
  type StudioStyleLandingScope,
  type StudioStyleProvenance,
  type StudioToggleFlowDirectionPatchRequest,
  type StudioWorkspaceDesignContext,
  type StudioWrapRenderPatchRequest,
} from './studio-actions'
import { removeUnusedImportNames } from './use-actions'
import { moveViewRendersLast } from './views-actions'

/** organizeSource returns the document with canonical statement order and an organized import section. */
async function organizeSource(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  return await formatWhenChanged(document, canonicalizeTopLevel(document))
}

/** removeUnusedImports returns the document with unused imported names dropped, keeping statement order. */
async function removeUnusedImports(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  const context = sourceStatementContext(document)
  return await formatWhenChanged(
    document,
    assembleWithTrailingSource(context, removeUnusedImportNames(context.file, context.slices)),
  )
}

/** moveRendersLast returns the document with each visual declaration's single render moved to the end. */
async function moveRendersLast(document: AST.Document): Promise<string | undefined> {
  if (hasSyntaxErrors(document)) {
    return undefined
  }
  const moved = moveViewRendersLast(document)
  if (moved === undefined) {
    return undefined
  }
  return await formatWhenChanged(document, moved)
}

/** fixSource returns the fully canonical source: renders last, organized imports, formatted. */
async function fixSource(document: AST.Document, options: SourceActionOptions = {}): Promise<string> {
  assertNoSyntaxErrors(document)
  const moved = moveViewRendersLast(document)
  const movedDocument = moved === undefined ? document : await parseSourceText(document, moved, options)
  return await Formatter.formatCode(canonicalizeTopLevel(movedDocument))
}

/** SourceActions exposes Tao source canonicalization transforms. */
const SourceActions = {
  applyStudioPatch: StudioActions.applyPatch,
  fixSource,
  insertStudioComponent: StudioActions.insertComponent,
  inspectStudioRender: StudioActions.inspectRender,
  moveStudioRender: StudioActions.moveRender,
  moveRendersLast,
  organizeSource,
  removeUnusedImports,
  studioSourceVersion: StudioActions.sourceVersion,
}

export {
  type SourceActionOptions,
  type StudioAddSketchEntityParameterPatchRequest,
  type StudioAppendScenarioStepsPatchRequest,
  type StudioBindSketchFieldPatchRequest,
  type StudioComponentKind,
  type StudioInsertCapturedFixturePatchRequest,
  type StudioInsertComponentPatchRequest,
  type StudioInsertProjectViewPatchRequest,
  type StudioInsertSeparatorPatchRequest,
  type StudioInsertSpacerPatchRequest,
  type StudioLayoutAlignment,
  type StudioLayoutContentTerm,
  type StudioLayoutEntry,
  type StudioLayoutSizeValue,
  type StudioLayoutSpacingSide,
  type StudioLayoutTermValue,
  type StudioMoveRenderPatchRequest,
  type StudioMoveRenderRequest,
  type StudioRenderGap,
  type StudioRenderInspection,
  type StudioScenarioArgumentValue,
  type StudioSetLayoutEntryPatchRequest,
  type StudioSetScenarioArgumentsPatchRequest,
  type StudioSetStyleEntryPatchRequest,
  type StudioSketchFieldPath,
  type StudioSketchFieldPresentation,
  type StudioSketchScenarioFixtureBinding,
  type StudioSketchSnapContainer,
  type StudioSketchSnapElement,
  type StudioSketchSnapTree,
  type StudioSnapSketchToFlowPatchRequest,
  StudioSourceOccurrenceConflictError,
  type StudioSourceOccurrencePrecondition,
  type StudioSourcePatch,
  type StudioSourcePatchRequest,
  type StudioSourceTextEdit,
  type StudioStyleEntry,
  type StudioStyleLandingScope,
  type StudioStyleProvenance,
  type StudioToggleFlowDirectionPatchRequest,
  type StudioWorkspaceDesignContext,
  type StudioWrapRenderPatchRequest,
}

export default SourceActions
