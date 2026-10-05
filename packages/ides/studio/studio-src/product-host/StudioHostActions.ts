import { Errors } from '@shared/core'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import {
  requestStudioProductHostApplyFocusedCellEnvironment,
  requestStudioProductHostApplyInspectorAction,
  requestStudioProductHostCreateFile,
  requestStudioProductHostDeleteFile,
  requestStudioProductHostInsertComponent,
  requestStudioProductHostInsertProjectView,
  requestStudioProductHostMoveGeneratedSource,
  requestStudioProductHostOpenFile,
  requestStudioProductHostOpenScreen,
  requestStudioProductHostOpenSource,
  requestStudioProductHostPanelAction,
  requestStudioProductHostRenameFile,
  requestStudioProductHostUndoInspectorAction,
} from '../StudioProductHostProtocol'

/** OpenFile is the Tao Files panel's typed request into the existing editor host. */
export async function OpenFile(path: string): Promise<void> {
  await requestStudioProductHostOpenFile(path)
}

/** OpenSource opens a revision-bound declaration and selects the first line containing it. */
export async function OpenSource(path: string, sourceVersion: string, start: number): Promise<void> {
  await requestStudioProductHostOpenSource(path, sourceVersion, start)
}

/** File writes share the workbench controller so open drafts and tabs transition atomically. */
export async function CreateFile(path: string): Promise<void> {
  await requestStudioProductHostCreateFile(path)
}

export async function RenameFile(path: string, sourceVersion: string, targetPath: string): Promise<void> {
  await requestStudioProductHostRenameFile(path, sourceVersion, targetPath)
}

export async function MoveGeneratedSource(
  path: string,
  sourceVersion: string,
  targetPackage: string,
  relocateScenarios = true,
): Promise<void> {
  await requestStudioProductHostMoveGeneratedSource(path, sourceVersion, targetPackage, relocateScenarios)
}

export async function DeleteFile(path: string, sourceVersion: string): Promise<void> {
  await requestStudioProductHostDeleteFile(path, sourceVersion)
}

export async function InsertComponent(component: string): Promise<void> {
  await requestStudioProductHostInsertComponent(component)
}

export async function InsertProjectView(viewName: string): Promise<void> {
  await requestStudioProductHostInsertProjectView(viewName)
}

export async function OpenScreen(subjectId: string): Promise<void> {
  await requestStudioProductHostOpenScreen(subjectId)
}

export async function ApplyInspectorAction(actionJson: string, proposed: boolean): Promise<void> {
  await requestStudioProductHostApplyInspectorAction(StudioPanelPayloads.sourceAction(actionJson), proposed)
}

export async function UndoInspectorAction(): Promise<void> {
  await requestStudioProductHostUndoInspectorAction()
}

export async function ProductPanelAction(name: string, payload: string): Promise<void> {
  await requestStudioProductHostPanelAction(name, payload)
}

/** Applies Tao-owned scenario environment draft state through the active workbench cell controller. */
export async function ApplyFocusedCellEnvironment(
  cellId: string,
  cellRevision: number,
  preset: string,
  width: number,
  height: number,
  network: string,
  latency: number,
  errorMessage: string,
  errorStatus: number,
): Promise<void> {
  if (network !== 'error' && network !== 'normal' && network !== 'offline') {
    Errors.throwUserInput(`Unsupported Studio network outcome: ${network}`)
  }
  await requestStudioProductHostApplyFocusedCellEnvironment({ cellId, cellRevision }, {
    network: {
      ...(network === 'error' ? { error: { message: errorMessage, status: errorStatus } } : {}),
      latencyMs: latency,
      outcome: network,
    },
    viewport: {
      ...(preset === 'custom' ? {} : { presetId: preset }),
      height,
      width,
    },
  })
}
