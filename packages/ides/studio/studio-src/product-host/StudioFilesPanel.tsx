import TR from '@runtime/TR'
import { TaoFileIcon } from '@shared/core'
import React from 'react'
import { type StudioIconName, studioIconPaths } from '../client/StudioShell'
import type { TaoStudioHostAction, TaoStudioHostTextAction, TaoStudioHostVisualProps } from './StudioHostProps'

function HostIcon(props: Readonly<{ name: StudioIconName; size?: 'small' }>): React.ReactElement {
  return (
    <svg aria-hidden="true" className="studio-icon" data-size={props.size} viewBox="0 0 24 24">
      <path d={studioIconPaths[props.name]} />
    </svg>
  )
}

/** The file's kind, from its extension, so Tao files read as Tao at a glance in the tree. */
function fileKind(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** FileKindMark shows the lotus for a Tao file, as the IDE extension does, and a text badge otherwise. */
function FileKindMark(props: Readonly<{ name: string }>): React.ReactElement {
  const kind = fileKind(props.name)
  const maskId = `tao-file-icon-${React.useId().replace(/[^\w-]/g, '')}`
  if (kind !== 'tao') {
    return <span aria-hidden="true" className="studio-file-kind" data-kind={kind}>{kind}</span>
  }
  return (
    <svg aria-hidden="true" className="studio-file-icon" data-kind="tao" viewBox={TaoFileIcon.viewBox}>
      <mask id={maskId}>
        <g
          fill="#fff"
          paintOrder="stroke"
          stroke="#000"
          strokeLinejoin="round"
          strokeWidth={TaoFileIcon.petalGap}
        >
          {TaoFileIcon.petals.map(petal => <path d={petal} key={petal} />)}
        </g>
        <path
          d={TaoFileIcon.path}
          fill="none"
          stroke="#000"
          strokeLinecap="round"
          strokeWidth={TaoFileIcon.pathWidth}
        />
      </mask>
      <rect fill="currentColor" height="32" mask={`url(#${maskId})`} width="32" />
    </svg>
  )
}

/** FilesPanelSurface keeps Tao's query-owned tree inside the shell's existing Files destination. */
export function FilesPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <section
      data-studio-files-surface="compact"
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      {props.children}
    </section>
  )
}

export type FileCreateBarProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Change: TaoStudioHostTextAction
    Create: TaoStudioHostAction
    Path: string
  }>

/** FileCreateBar is a compact adapter; Tao still owns its path state and Create action. */
export function FileCreateBar(props: FileCreateBarProps): React.ReactElement {
  const create = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void props.Create.invoke()
  }
  return (
    <form
      aria-label="Create Tao file"
      className="studio-file-create"
      data-studio-file-create="compact"
      onSubmit={create}
      style={props.Layout?.style}
    >
      <input
        aria-label="New Tao file path"
        className="studio-input"
        onChange={event => void props.Change.invoke(TR.Value(event.currentTarget.value))}
        placeholder="Folder/New.tao"
        spellCheck={false}
        value={props.Path}
      />
      <button
        aria-label="Create file"
        className="studio-icon-button"
        disabled={props.Path.trim() === ''}
        title="Create file"
        type="submit"
      >
        <HostIcon name="plus" />
      </button>
    </form>
  )
}

export type TreeFolderProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Expanded: boolean
    Label: string
    Toggle: TaoStudioHostAction
    children?: React.ReactNode
  }>

/** TreeFolder provides IDE disclosure density while Tao owns expansion state and recursive content. */
export function TreeFolder(props: TreeFolderProps): React.ReactElement {
  return (
    <div
      className="studio-tree-folder"
      data-studio-tree-folder={props.Label}
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      <button
        aria-expanded={props.Expanded}
        className="studio-tree-button"
        onClick={() => void props.Toggle.invoke()}
        title={props.Label}
        type="button"
      >
        <span className="studio-tree-chevron">
          <HostIcon name="chevronRight" size="small" />
        </span>
        <span className="studio-tree-label">{props.Label}</span>
      </button>
      {props.Expanded ? <div className="studio-tree-children">{props.children}</div> : undefined}
    </div>
  )
}

export type TreeFileRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    BeginDelete: TaoStudioHostAction
    BeginRename: TaoStudioHostAction
    BeginMove: TaoStudioHostAction
    CancelDelete: TaoStudioHostAction
    CancelRename: TaoStudioHostAction
    ChangeRenamePath: TaoStudioHostTextAction
    ChangeTargetPackage: TaoStudioHostTextAction
    ChangeRelocateScenarios?: TR.ActionValue<[TR.Value<boolean>]>
    RelocateScenarios?: boolean
    ConfirmDelete: boolean
    Delete: TaoStudioHostAction
    DiagnosticCount: number
    Dirty: boolean
    Name: string
    Move: TaoStudioHostAction
    Moving: boolean
    Open: TaoStudioHostAction
    Path: string
    Rename: TaoStudioHostAction
    RenamePath: string
    Renaming: boolean
    TargetPackage: string
  }>

/** TreeFileRow exposes compact editing affordances without moving CRUD state or decisions out of Tao. */
export function TreeFileRow(props: TreeFileRowProps): React.ReactElement {
  const rename = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void props.Rename.invoke()
  }
  return (
    <div data-studio-tree-file={props.Path} data-testid={props.Tag} style={props.Layout?.style}>
      <div className="studio-tree-row">
        <button
          className="studio-tree-button"
          onClick={() => void props.Open.invoke()}
          title={props.Path}
          type="button"
        >
          <FileKindMark name={props.Name} />
          <span className="studio-tree-label">{props.Name}</span>
          {props.Dirty ? <span aria-label="Unsaved draft" className="studio-tree-dirty" role="img"></span> : undefined}
          {props.DiagnosticCount > 0
            ? (
              <span aria-label={`${props.DiagnosticCount} problems`} className="studio-tree-diagnostics">
                {props.DiagnosticCount}
              </span>
            )
            : undefined}
        </button>
        <button
          aria-label={`Rename ${props.Name}`}
          className="studio-tree-action"
          onClick={() => void props.BeginRename.invoke()}
          title="Rename"
          type="button"
        >
          <HostIcon name="pen" size="small" />
        </button>
        <button
          aria-label={`Delete ${props.Name}`}
          className="studio-tree-action"
          data-action="delete"
          onClick={() => void props.BeginDelete.invoke()}
          title="Delete"
          type="button"
        >
          <HostIcon name="x" size="small" />
        </button>
        <button
          aria-label={`Move ${props.Name} to package`}
          className="studio-tree-action"
          hidden={!props.Path.startsWith('@/studio/')}
          onClick={() => void props.BeginMove.invoke()}
          title="Move to package"
          type="button"
        >
          <HostIcon name="arrowRight" size="small" />
        </button>
      </div>
      {props.Renaming
        ? (
          <form aria-label={`Rename ${props.Name}`} className="studio-inline-editor" onSubmit={rename}>
            <input
              aria-label={`New path for ${props.Name}`}
              autoFocus
              className="studio-input"
              onChange={event => void props.ChangeRenamePath.invoke(TR.Value(event.currentTarget.value))}
              spellCheck={false}
              value={props.RenamePath}
            />
            <button
              aria-label="Save rename"
              className="studio-button"
              data-size="small"
              data-variant="primary"
              type="submit"
            >
              Save
            </button>
            <button
              aria-label="Cancel rename"
              className="studio-button"
              data-size="small"
              data-variant="ghost"
              onClick={() => void props.CancelRename.invoke()}
              type="button"
            >
              Cancel
            </button>
          </form>
        )
        : undefined}
      {props.Moving
        ? (
          <form
            aria-label={`Move ${props.Name} to package`}
            className="studio-inline-editor"
            onSubmit={event => {
              event.preventDefault()
              void props.Move.invoke()
            }}
          >
            <input
              aria-label={`Target package for ${props.Name}`}
              autoFocus
              className="studio-input"
              onChange={event => void props.ChangeTargetPackage.invoke(TR.Value(event.currentTarget.value))}
              placeholder="@views"
              spellCheck={false}
              value={props.TargetPackage}
            />
            <label>
              <input
                checked={props.RelocateScenarios ?? true}
                onChange={event => void props.ChangeRelocateScenarios?.invoke(TR.Value(event.currentTarget.checked))}
                type="checkbox"
              />
              Move scenarios to app Scenarios.tao
            </label>
            <button
              aria-label="Move to package"
              className="studio-button"
              data-size="small"
              data-variant="primary"
              type="submit"
            >
              Move
            </button>
          </form>
        )
        : undefined}
      {props.ConfirmDelete
        ? (
          <div aria-label={`Confirm delete ${props.Name}`} className="studio-delete-confirmation" role="alert">
            <span>Delete {props.Name}?</span>
            <button
              className="studio-button"
              data-size="small"
              data-variant="ghost"
              onClick={() => void props.CancelDelete.invoke()}
              type="button"
            >
              Cancel
            </button>
            <button
              className="studio-button"
              data-size="small"
              data-variant="danger"
              onClick={() => void props.Delete.invoke()}
              type="button"
            >
              Delete
            </button>
          </div>
        )
        : undefined}
    </div>
  )
}
