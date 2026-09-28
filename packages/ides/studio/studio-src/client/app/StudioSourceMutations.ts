import { Errors } from '@shared/core'
import type { EditorView } from 'codemirror'
import type { StudioCompileCompletion } from '../../StudioCompileCoordinator'
import type { StudioDraftFile } from '../../StudioDraftSync'
import { StudioInspector, type StudioInspectorSelection, type studioPaletteComponents } from '../../StudioInspector'
import type {
  StudioCanonicalSourceAction,
  StudioSourceActionEnvelope,
  StudioSourceActionIdentity,
} from '../../StudioProtocol'
import type { StudioSketchEdit } from '../matrix/StudioMatrixSketches'
import { StudioApiClient, StudioApiError } from '../StudioApiClient'
import { StudioDialog } from '../StudioDialog'
import { projectRelativePath, StudioEditorInsertion } from '../StudioEditor'
import { showSourceActionError, sourceActionLabel } from '../StudioVisualEditing'
import { studioEditLabel, type StudioEditLogEntry } from './StudioEditLog'

type StudioSourceMutationResult = Readonly<{ compile: StudioCompileCompletion; path: string }>

type StudioUndoCheckpoint = Readonly<{
  at: number
  id: string
  identity: StudioSourceActionIdentity
  kind: 'source'
  label: string
  path: string
  /** False once its file changed outside a visual edit: the log keeps the edit but ⌘Z passes over it. */
  undoable: boolean
}>

/** A Draw edit on the same stack: it can walk back whichever file is open, while its sketch is unchanged. */
type StudioSketchUndoCheckpoint =
  & Readonly<{ at: number; id: string; kind: 'sketch'; undoable: boolean }>
  & StudioSketchEdit

export type StudioSourceMutationsDeps = Readonly<{
  activeFile: () => StudioDraftFile | undefined
  activePath: () => string | undefined
  /** Drops the inspector selection: render ids do not survive the recompile a mutation causes. */
  clearInspection: () => void
  /** Folds a mutation's compile result into the status line without regressing a newer compile. */
  completeCompile: (completion: StudioCompileCompletion) => void
  /** The active cell's source identity, when the active file is the one the preview renders. */
  currentIdentity: () => StudioSourceActionIdentity | undefined
  editor: () => EditorView | undefined
  focusEditor: () => void
  inspected: () => StudioInspectorSelection | undefined
  openFile: (path: string, refresh: true) => Promise<unknown>
  project: string
  publish: () => void
  renderInspector: () => void
  requireActiveDraftSaved: () => boolean
  status: HTMLElement
}>

/**
 * Visual source edits: every canonical source action goes through one mutation envelope, and the
 * checkpoints it commits form the undo stack for the file they landed in.
 */
export class StudioSourceMutations {
  #checkpoints: (StudioUndoCheckpoint | StudioSketchUndoCheckpoint)[] = []
  readonly #deps: StudioSourceMutationsDeps
  #busy = false

  constructor(deps: StudioSourceMutationsDeps) {
    this.#deps = deps
  }

  busy(): boolean {
    return this.#busy
  }

  canUndo(): boolean {
    return this.#undoTarget() !== undefined
  }

  /** The undo stack as the edit log shows it: newest first, and only the next edit ⌘Z can walk back offers Undo. */
  edits(): readonly StudioEditLogEntry[] {
    const target = this.canUndo() ? this.#undoTarget() : undefined
    return this.#checkpoints.toReversed().map(checkpoint => ({
      at: checkpoint.at,
      id: checkpoint.id,
      label: checkpoint.label,
      path: checkpoint.path,
      undoable: checkpoint === target,
    }))
  }

  /**
   * The file changed outside a visual edit (saved from the code editor), so none of its earlier visual
   * edits can be walked back any more; they stay in the log as history.
   */
  retirePath(path: string): void {
    this.#checkpoints = this.#checkpoints.map(checkpoint =>
      checkpoint.kind === 'source' && checkpoint.path === path && checkpoint.undoable
        ? { ...checkpoint, undoable: false }
        : checkpoint
    )
  }

  /** A Draw edit joins the stack in time order with the visual source edits. */
  recordSketchEdit(edit: StudioSketchEdit): void {
    this.#checkpoints.push({
      ...edit,
      at: Date.now(),
      id: `sketch:${crypto.randomUUID()}`,
      kind: 'sketch',
      undoable: true,
    })
    this.#deps.publish()
  }

  /** Whether a mutation may start now; when it may not, the status line already says why. */
  canMutate(): boolean {
    return !this.#busy && this.#deps.requireActiveDraftSaved()
  }

  async apply(envelope: StudioSourceActionEnvelope): Promise<boolean> {
    return await this.#run(
      `Applying ${sourceActionLabel(envelope.action)}…`,
      async () => {
        const result = await StudioApiClient.sourceAction(envelope)
        if (result.checkpoint.status === 'committed' && this.#checkpoints.at(-1)?.id !== result.checkpoint.id) {
          this.#checkpoints.push({
            at: Date.now(),
            id: result.checkpoint.id,
            identity: envelope.identity,
            kind: 'source',
            label: studioEditLabel(envelope.action),
            path: result.path,
            undoable: true,
          })
        }
        return result
      },
    )
  }

  /** Answers whether the edit landed; a refusal has already said why in the status line. */
  async submitLocal(action: StudioCanonicalSourceAction, identity: StudioSourceActionIdentity): Promise<boolean> {
    if (!this.#canEditRender(identity)) {
      return false
    }
    return await this.apply(this.#localEnvelope(action, identity))
  }

  /** A shared-style edit lands everywhere the style is used, so the person confirms its diff first. */
  async submitProposedLocal(action: StudioCanonicalSourceAction, identity: StudioSourceActionIdentity): Promise<void> {
    if (!this.#canEditRender(identity)) {
      return
    }
    const envelope = this.#localEnvelope(action, identity)
    const { status } = this.#deps
    this.#setBusy(true)
    status.dataset['state'] = 'compiling'
    status.textContent = 'Preparing a canonical source proposal…'
    try {
      const proposal = await StudioApiClient.sourceActionProposal(envelope)
      const confirmed = await StudioDialog.confirm({
        confirmLabel: 'Apply edit',
        detail: 'This style is shared, so the change lands everywhere it is used.',
        diff: proposal.diff,
        title: 'Apply this shared style edit?',
      })
      if (!confirmed) {
        status.dataset['state'] = 'idle'
        status.textContent = 'Style edit was not applied.'
        return
      }
    } catch (error) {
      showSourceActionError(status, error)
      return
    } finally {
      this.#setBusy(false)
    }
    await this.apply(envelope)
  }

  /** An envelope a preview built itself; it names the file, which need not be the active one. */
  async submitPreview(envelope: StudioSourceActionEnvelope): Promise<void> {
    if (!this.canMutate()) {
      return
    }
    const path = projectRelativePath(this.#deps.project, envelope.identity.path)
    if (
      path === undefined
      || (path === this.#deps.activePath()
        && envelope.identity.sourceVersion !== this.#deps.activeFile()?.sourceVersion)
    ) {
      this.#refuseStaleRender()
      return
    }
    await this.apply(envelope)
  }

  /** A preview-built action whose identity names its own file and version, such as a frame dropped into a view. */
  async submitPreviewAction(action: StudioCanonicalSourceAction, identity: StudioSourceActionIdentity): Promise<void> {
    await this.submitPreview(this.#localEnvelope(action, identity))
  }

  async undoLatest(): Promise<void> {
    const checkpoint = this.#undoTarget()
    if (checkpoint?.kind === 'sketch') {
      await this.#undoSketchEdit(checkpoint)
      return
    }
    if (checkpoint === undefined || checkpoint.path !== this.#deps.activePath() || !this.canMutate()) {
      return
    }
    const currentIdentity = this.#deps.currentIdentity()
    if (currentIdentity === undefined) {
      return
    }
    const identity: StudioSourceActionIdentity = {
      ...currentIdentity,
      ...(checkpoint.identity.occurrence === undefined ? {} : { occurrence: checkpoint.identity.occurrence }),
    }
    await this.#run('Undoing visual source edit…', async () => {
      let result: Awaited<ReturnType<typeof StudioApiClient.undoSourceAction>>
      try {
        result = await StudioApiClient.undoSourceAction(StudioInspector.undo({
          checkpointId: checkpoint.id,
          identity,
          requestId: `undo:${crypto.randomUUID()}`,
        }))
      } catch (error) {
        if (!isStaleSourceRefusal(error)) {
          throw error
        }
        // The file changed after this edit, and so after every earlier one in it: none can walk back.
        this.retirePath(checkpoint.path)
        Errors.throwUserInput(
          `${checkpoint.path} changed after “${checkpoint.label}”, so its visual edits can no longer be undone.`,
        )
      }
      this.#checkpoints = this.#checkpoints.filter(candidate => candidate.id !== checkpoint.id)
      return result
    })
  }

  /**
   * The newest edit ⌘Z can still walk back: a Draw edit, or a source edit in the open file. Source
   * edits in other files wait for their file to open.
   */
  #undoTarget(): StudioUndoCheckpoint | StudioSketchUndoCheckpoint | undefined {
    const activePath = this.#deps.activePath()
    return this.#checkpoints.findLast(checkpoint =>
      checkpoint.undoable && (checkpoint.kind === 'sketch' || checkpoint.path === activePath)
    )
  }

  /**
   * A Draw edit walks back through the sketch catalog, not a source file, so it needs no saved draft.
   * When its sketch changed since, it and every earlier edit of that sketch stay in the log as history.
   */
  async #undoSketchEdit(checkpoint: StudioSketchUndoCheckpoint): Promise<void> {
    if (this.#busy) {
      return
    }
    const { status } = this.#deps
    this.#setBusy(true)
    status.dataset['state'] = 'compiling'
    status.textContent = `Undoing ${checkpoint.label}…`
    try {
      if (await checkpoint.undo()) {
        this.#checkpoints = this.#checkpoints.filter(candidate => candidate.id !== checkpoint.id)
        status.dataset['state'] = 'idle'
        status.textContent = `Undid ${checkpoint.label}.`
        return
      }
      this.#checkpoints = this.#checkpoints.map(candidate =>
        candidate.kind === 'sketch' && candidate.scope === checkpoint.scope
          ? { ...candidate, undoable: false }
          : candidate
      )
      status.dataset['state'] = 'error'
      status.textContent =
        `${checkpoint.path} changed after “${checkpoint.label}”, so its drawing edits can no longer be undone.`
    } catch (error) {
      showSourceActionError(status, error)
    } finally {
      this.#setBusy(false)
    }
  }

  insertComponent(component: (typeof studioPaletteComponents)[number]): void {
    const identity = this.#deps.currentIdentity()
    if (identity !== undefined) {
      void this.submitLocal(
        { ...this.#insertionGap(), component: component.component, kind: 'insert-component' },
        identity,
      )
    }
  }

  /** A preview insertion resolves imported views and required arguments at the exact selected source gap. */
  insertProjectView(projectView: ReturnType<typeof StudioInspector.projectViews>[number]): void {
    const identity = this.#deps.currentIdentity()
    if (identity !== undefined) {
      void this.submitLocal(
        {
          ...this.#insertionGap(),
          kind: 'insert-project-view',
          viewName: projectView.viewName,
          viewSourcePath: projectView.sourcePath,
        },
        identity,
      )
      return
    }
    const editor = this.#deps.editor()
    if (editor !== undefined) {
      const position = editor.state.selection.main.head
      editor.dispatch(StudioEditorInsertion.transaction(editor.state.doc, projectView.snippet, position))
      this.#deps.focusEditor()
      return
    }
  }

  /** The palette gap: a selected element receives the insertion before itself. */
  #insertionGap(): Readonly<{ beforeId?: string }> {
    const inspected = this.#deps.inspected()
    return inspected === undefined ? {} : { beforeId: inspected.renderId }
  }

  /**
   * One envelope for every mutation: mark busy, say what is happening, send the request, drop the
   * stale selection, reopen the file the server rewrote, and fold its compile into the status line.
   */
  async #run(message: string, request: () => Promise<StudioSourceMutationResult>): Promise<boolean> {
    const { status } = this.#deps
    this.#setBusy(true)
    status.dataset['state'] = 'compiling'
    status.textContent = message
    try {
      const result = await request()
      this.#deps.clearInspection()
      this.#deps.publish()
      await this.#deps.openFile(result.path, true)
      this.#deps.completeCompile(result.compile)
      return true
    } catch (error) {
      showSourceActionError(status, error)
      return false
    } finally {
      this.#setBusy(false)
    }
  }

  /** A render edit needs the preview and the active file to agree on the source version. */
  #canEditRender(identity: StudioSourceActionIdentity): boolean {
    if (!this.canMutate()) {
      return false
    }
    const activeFile = this.#deps.activeFile()
    if (activeFile === undefined || identity.sourceVersion !== activeFile.sourceVersion) {
      this.#refuseStaleRender()
      return false
    }
    return true
  }

  #refuseStaleRender(): void {
    this.#deps.status.dataset['state'] = 'error'
    this.#deps.status.textContent = 'Wait for the refreshed preview before editing this render.'
  }

  #localEnvelope(
    action: StudioCanonicalSourceAction,
    identity: StudioSourceActionIdentity,
  ): StudioSourceActionEnvelope {
    const operationId = crypto.randomUUID()
    const occurrence = sourceActionUsesRenderOccurrence(action)
      ? identity.occurrence ?? this.#deps.inspected()?.identity.occurrence
      : undefined
    return StudioInspector.singleAction({
      action,
      checkpointId: `checkpoint:${operationId}`,
      identity: {
        ...identity,
        ...(occurrence === undefined ? {} : { occurrence }),
      },
      requestId: `request:${operationId}`,
    })
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy
    this.#deps.publish()
    this.#deps.renderInspector()
  }
}

/** The server refuses an undo whose file no longer holds the source the edit left behind. */
function isStaleSourceRefusal(error: unknown): boolean {
  return error instanceof StudioApiError && error.status === 409 && error.details?.['code'] === 'stale-source'
}

function sourceActionUsesRenderOccurrence(action: StudioCanonicalSourceAction): boolean {
  return action.kind === 'move-render'
    || action.kind === 'set-layout-entry'
    || action.kind === 'clear-layout-entry'
    || action.kind === 'set-style-entry'
    || action.kind === 'wrap-render'
    || action.kind === 'group-renders'
    || action.kind === 'extract-view'
    || (action.kind === 'insert-component' || action.kind === 'insert-project-view')
      && (typeof action['beforeId'] === 'string' || typeof action['afterId'] === 'string')
}
