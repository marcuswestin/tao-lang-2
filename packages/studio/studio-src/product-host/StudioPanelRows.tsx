import React from 'react'
import { projectRelativePath } from '../client/StudioEditor'
import { studioPaletteMime, StudioPaletteTransfer } from '../client/StudioVisualEditing'
import { studioPaletteComponents } from '../StudioInspector'
import { studioProductHostState } from '../StudioProductHostProtocol'
import type { TaoStudioHostAction, TaoStudioHostVisualProps } from './StudioHostProps'

export function StudioPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Title: string }>,
): React.ReactElement {
  return (
    <section className="studio-tao-panel" data-testid={props.Tag} style={props.Layout?.style}>
      <h2>{props.Title}</h2>
      {props.children}
    </section>
  )
}

export type StudioPaletteRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Detail: string
    Insert: TaoStudioHostAction
    Kind: string
    Label: string
    Name: string
  }>

/** PaletteRow is a native drag/click adapter; the inventory and insertion action remain Tao-owned. */
export function StudioPaletteRow(props: StudioPaletteRowProps): React.ReactElement {
  const component = props.Kind === 'component'
    ? studioPaletteComponents.find(candidate => candidate.component === props.Name)
    : undefined
  return (
    <button
      className="studio-palette-button"
      data-tao-studio-component={component?.label}
      data-tao-studio-project-view={props.Kind === 'project-view' ? props.Name : undefined}
      draggable={component !== undefined}
      onClick={() => void props.Insert.invoke()}
      onDragStart={event => {
        if (component !== undefined) {
          event.dataTransfer.setData(
            studioPaletteMime,
            StudioPaletteTransfer.serialize({
              component: component.component,
              kind: 'component',
              snippet: component.snippet,
            }),
          )
        }
      }}
      style={props.Layout?.style}
      title={`${props.Detail} · insert ${props.Label}`}
      type="button"
    >
      {props.Label}
    </button>
  )
}

type StudioSourceRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Detail: string
    Label: string
    Open: TaoStudioHostAction
  }>

export function StudioSourceRow(props: StudioSourceRowProps): React.ReactElement {
  return (
    <button
      className="studio-screen-item"
      onClick={() => void props.Open.invoke()}
      style={props.Layout?.style}
      title={props.Detail}
      type="button"
    >
      <strong>{props.Label}</strong>
      <span>{projectRelativeDetail(props.Detail)}</span>
    </button>
  )
}

/** Paths under the open project read relative to it; anything else is shown as given. */
function projectRelativeDetail(detail: string): string {
  const root = studioProductHostState().projectRoot
  return root === undefined ? detail : projectRelativePath(root, detail) ?? detail
}

type StudioSearchHitProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Detail: string
    Kind: string
    Label: string
    Open: TaoStudioHostAction
    Path: string
  }>

/** A search hit is a row: where it is, what matched, and only that. */
export function StudioSearchHit(props: StudioSearchHitProps): React.ReactElement {
  const separator = props.Label.lastIndexOf(':')
  const file = separator < 0 ? props.Label : props.Label.slice(0, separator)
  const line = separator < 0 ? '' : props.Label.slice(separator + 1)
  return (
    <button
      className="studio-search-hit"
      data-testid={props.Tag}
      onClick={() => void props.Open.invoke()}
      style={props.Layout?.style}
      title={projectRelativeDetail(props.Path)}
      type="button"
    >
      <span className="studio-search-hit-line">
        {file}
        {line === '' ? undefined : (
          <>
            · line <b>{line}</b>
          </>
        )}
        {props.Kind === 'text' ? undefined : <span className="studio-search-hit-kind">· {props.Kind}</span>}
      </span>
      <span className="studio-search-hit-text">{props.Detail}</span>
    </button>
  )
}

/**
 * Entity rows arrive serialized: objects keyed by field, or tuples. A table keeps the columns lined up
 * across rows, with the field names as the header when the rows carry them.
 */
export function StudioDataRows(
  props: TaoStudioHostVisualProps & Readonly<{ Rows: readonly string[] }>,
): React.ReactElement {
  const parsed = props.Rows.map(row => {
    try {
      return JSON.parse(row) as unknown
    } catch {
      return row
    }
  })
  const columns: string[] = []
  for (const row of parsed) {
    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) {
          columns.push(key)
        }
      }
    }
  }
  const cellText = (cell: unknown): string =>
    typeof cell === 'string' ? cell : cell === undefined ? '' : JSON.stringify(cell)
  const rows = parsed.map(row =>
    Array.isArray(row)
      ? row.map(cellText)
      : row !== null && typeof row === 'object'
      ? columns.map(column => cellText((row as Record<string, unknown>)[column]))
      : [typeof row === 'string' ? row : JSON.stringify(row)]
  )
  const width = Math.max(columns.length, rows.reduce((widest, cells) => Math.max(widest, cells.length), 0))
  return (
    <table className="studio-data-table" data-testid={props.Tag} style={props.Layout?.style}>
      {columns.length === 0 ? undefined : (
        <thead>
          <tr>{columns.map(column => <th key={column}>{column}</th>)}</tr>
        </thead>
      )}
      <tbody>
        {rows.map((cells, rowIndex) => (
          <tr key={rowIndex}>
            {Array.from(
              { length: width },
              (_, column) => <td key={column} title={cells[column] ?? ''}>{cells[column] ?? ''}</td>,
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A data table is named by its entity and datasource; the declaration tuple behind the datasource stays internal. */
export function StudioDataTableTitle(datasource: string, entity: string): string {
  return `${entity} · ${datasource}`
}

export function StudioPanelSelected(tab: string, panel: string): boolean {
  return tab === panel
}
