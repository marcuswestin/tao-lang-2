import React from 'react'
import { studioCellLabel } from '../client/StudioEditor'
import type { TaoStudioHostVisualProps } from './StudioHostProps'

export function StudioContextPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <section
      aria-label="Active workbench context"
      className="studio-context-panel-surface"
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      {props.children}
    </section>
  )
}

type StudioContextSummaryProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    CellId: string
    FilePath: string
    RenderId: string
    ScenarioId: string
    ViewportHeight: number
    ViewportWidth: number
  }>

/** Compact presentation-only adapter; Tao owns the StudioContext query and supplied values. */
export function StudioContextSummary(props: StudioContextSummaryProps): React.ReactElement {
  const scenario = studioCellLabel(props.ScenarioId) || 'No focused scenario'
  return (
    <div className="studio-context-summary" data-focused-cell={props.CellId} data-testid={props.Tag}>
      <strong title={props.FilePath}>{props.FilePath || 'No open file'}</strong>
      <span title={props.ScenarioId}>{scenario}</span>
      {props.ViewportWidth > 0 && props.ViewportHeight > 0
        ? <span>{props.ViewportWidth}×{props.ViewportHeight}</span>
        : undefined}
      {props.RenderId === '' ? undefined : <span className="studio-context-selected">render selected</span>}
    </div>
  )
}
