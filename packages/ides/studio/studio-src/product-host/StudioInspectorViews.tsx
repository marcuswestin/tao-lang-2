import React from 'react'
import type { TaoStudioHostVisualProps } from './StudioHostProps'

export function StudioInspectorSection(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Title: string }>,
): React.ReactElement {
  return (
    <section
      className="studio-inspector-accordion"
      data-studio-tao-inspector-context={props.Title}
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      <h2>{props.Title}</h2>
      <div className="studio-inspector-controls">{props.children}</div>
    </section>
  )
}

export function StudioInspectorSummarySurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <div className="studio-inspector-summary" data-testid={props.Tag} style={props.Layout?.style}>
      {props.children}
    </div>
  )
}

export function StudioInspectorField(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Label: string }>,
): React.ReactElement {
  return (
    <div className="studio-inspector-field" data-inspector-field={props.Label} style={props.Layout?.style}>
      <span>{props.Label}</span>
      {props.children}
    </div>
  )
}

export function StudioInspectorUndoMarker(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return <div data-tao-studio-undo="true" style={props.Layout?.style}>{props.children}</div>
}
