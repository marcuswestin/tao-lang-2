import type { AST } from '@parser'
import { Switch } from '@shared'
import {
  insertComponent,
  insertProjectView,
  insertSeparator,
  insertSpacer,
  toggleFlowDirection,
} from './studio/studio-components'
import type {
  StudioSourcePatch,
  StudioSourcePatchRequest,
  StudioWorkspaceDesignContext,
} from './studio/studio-contract'
import { setDesignEntry, setStyleEntry } from './studio/studio-design-styles'
import { copyView, extractView, groupRenders } from './studio/studio-extract-view'
import { setLayoutEntry } from './studio/studio-layout-entries'
import { bindText, inspectRender, setTextContent } from './studio/studio-render-inspection'
import { validateOccurrencePrecondition } from './studio/studio-render-occurrences'
import { moveRender, removeRender, wrapRender } from './studio/studio-render-tree'
import {
  addRenderScenario,
  appendScenarioSteps,
  insertCapturedFixture,
  retargetScenarioRender,
  setScenarioArguments,
} from './studio/studio-scenarios'
import {
  addSketchEntityParameter,
  bindSketchField,
  snapSketchToFlow,
  unsnapSketchFromFlow,
} from './studio/studio-sketches'
import { contentVersion, fullDocumentEdit } from './studio/studio-source-text'

/** StudioActions exposes source transforms used by Tao Studio visual editing. */
export const StudioActions = {
  addRenderScenario,
  addSketchEntityParameter,
  appendScenarioSteps,
  applyPatch,
  bindSketchField,
  bindText,
  copyView,
  extractView,
  groupRenders,
  insertCapturedFixture,
  insertComponent,
  insertProjectView,
  insertSeparator,
  insertSpacer,
  inspectRender,
  moveRender,
  removeRender,
  retargetScenarioRender,
  setLayoutEntry,
  setScenarioArguments,
  snapSketchToFlow,
  setStyleEntry,
  setTextContent,
  sourceVersion: contentVersion,
  toggleFlowDirection,
  wrapRender,
} as const

/** applyPatch applies a typed Studio source-action request to a Tao document. */
async function applyPatch(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<StudioSourcePatch> {
  const source = document.textDocument.getText()
  const content = await applyPatchContent(document, request, context)
  return {
    content,
    edits: fullDocumentEdit(source, content),
    sourcePath: document.uri.fsPath,
    sourceVersion: contentVersion(content),
  }
}

async function applyPatchContent(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  context: StudioWorkspaceDesignContext,
): Promise<string> {
  validateOccurrencePrecondition(document, request, context.occurrence)
  return await Switch.kind(request, {
    'add-render-scenario': async action => await addRenderScenario(document, action),
    'add-sketch-entity-parameter': async action => await addSketchEntityParameter(document, action, context),
    'append-scenario-steps': async action => await appendScenarioSteps(document, action),
    'bind-sketch-field': async action => await bindSketchField(document, action),
    'bind-text': async action => await bindText(document, action),
    'copy-view': async action => await copyView(document, action, context),
    'extract-view': async action => await extractView(document, action, context),
    'group-renders': async action => await groupRenders(document, action, context),
    'insert-captured-fixture': async action => await insertCapturedFixture(document, action),
    'insert-component': async action => await insertComponent(document, action.component, action),
    'insert-project-view': async action => await insertProjectView(document, action, context),
    'insert-separator': async action => await insertSeparator(document, action),
    'insert-spacer': async action => await insertSpacer(document, action),
    'move-render': async action => await moveRender(document, action),
    'remove-render': async action => await removeRender(document, action),
    'retarget-scenario-render': async action => await retargetScenarioRender(document, action),
    'set-design-entry': async action => await setDesignEntry(document, action),
    'set-layout-entry': async action => await setLayoutEntry(document, action),
    'set-scenario-arguments': async action => await setScenarioArguments(document, action),
    'set-style-entry': async action => await setStyleEntry(document, action, context),
    'set-text-content': async action => await setTextContent(document, action),
    'snap-sketch-to-flow': async action => await snapSketchToFlow(document, action),
    'toggle-flow-direction': async action => await toggleFlowDirection(document, action),
    'unsnap-sketch-from-flow': async action => await unsnapSketchFromFlow(document, action),
    'wrap-render': async action => await wrapRender(document, action, context),
  })
}
