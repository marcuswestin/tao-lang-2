import TR from '@runtime/TR'
import React from 'react'
import type {
  TaoStudioHostAction,
  TaoStudioHostNumberAction,
  TaoStudioHostTextAction,
  TaoStudioHostVisualProps,
} from './StudioHostProps'

/**
 * Presentation-only label for the scenario inspector. The stylesheet has carried
 * `.studio-scenario-inspector-label` all along, but nothing emitted the class, so those rules were
 * dead and the labels fell back to the react-native-web text defaults.
 */
export function StudioScenarioInspectorLabel(
  props: TaoStudioHostVisualProps & Readonly<{ Label: string }>,
): React.ReactElement {
  return (
    <span className="studio-scenario-inspector-label" data-testid={props.Tag} style={props.Layout?.style}>
      {props.Label}
    </span>
  )
}

type StudioScenarioControlGroupProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Title: string
    children?: React.ReactNode
  }>

/** Presentation-only grouping for Tao-owned scenario controls: a collapsible section, open by default. */
export function StudioScenarioControlGroup(
  props: StudioScenarioControlGroupProps,
): React.ReactElement {
  return (
    <details
      aria-label={props.Title}
      className="studio-section studio-tao-scenario-controls"
      data-studio-section={props.Title}
      data-testid={props.Tag}
      open
      style={props.Layout?.style}
    >
      <summary>{props.Title}</summary>
      <div className="studio-section-body studio-inspector-controls">{props.children}</div>
    </details>
  )
}

type StudioButtonProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Disabled: boolean
    Label: string
    Press: TaoStudioHostAction
    Variant: string
  }>

/** A workbench button. Tao owns the label, the action, and whether it is enabled; the sheet owns the look. */
export function StudioButton(props: StudioButtonProps): React.ReactElement {
  return (
    <button
      className="studio-button"
      data-size="small"
      data-testid={props.Tag}
      data-variant={props.Variant}
      disabled={props.Disabled}
      onClick={() => void props.Press.invoke()}
      style={props.Layout?.style}
      type="button"
    >
      {props.Label}
    </button>
  )
}

type StudioChoiceProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Change: TaoStudioHostTextAction
    Label: string
    Options: readonly string[]
    Value: string
  }>

/** An enumeration with a few short values, shown whole so the current one is visible without opening anything. */
export function StudioSegmented(props: StudioChoiceProps): React.ReactElement {
  const selected = Math.max(0, props.Options.indexOf(props.Value))
  return (
    <div
      aria-label={props.Label}
      className="studio-segmented"
      data-testid={props.Tag}
      role="radiogroup"
      style={props.Layout?.style}
    >
      {props.Options.map((option, index) => (
        <button
          aria-checked={option === props.Value}
          key={option}
          onClick={() => void props.Change.invoke(TR.Value(option))}
          onKeyDown={event => {
            const next = StudioRadioKeys.nextIndex(event.key, index, props.Options.length)
            if (next === undefined || next === index) {
              return
            }
            event.preventDefault()
            const nextOption = props.Options[next]
            if (nextOption !== undefined) {
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              buttons?.[next]?.focus()
              void props.Change.invoke(TR.Value(nextOption))
            }
          }}
          role="radio"
          tabIndex={index === selected ? 0 : -1}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export const StudioRadioKeys = {
  nextIndex(key: string, current: number, count: number): number | undefined {
    if (count <= 0) {
      return undefined
    }
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      return (current + 1) % count
    }
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      return (current - 1 + count) % count
    }
    if (key === 'Home') {
      return 0
    }
    return key === 'End' ? count - 1 : undefined
  },
} as const

/** An enumeration with many or long values; a native select keeps the field one line tall. */
export function StudioChoice(props: StudioChoiceProps): React.ReactElement {
  return (
    <select
      aria-label={props.Label}
      className="studio-select"
      data-testid={props.Tag}
      onChange={event => void props.Change.invoke(TR.Value(event.currentTarget.value))}
      style={props.Layout?.style}
      value={props.Value}
    >
      {props.Options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

/** Several small inputs on one labelled line, such as a width and a height. */
export function StudioInspectorRow(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Label: string }>,
): React.ReactElement {
  return (
    <div className="studio-field-row" data-testid={props.Tag} style={props.Layout?.style}>
      <span className="studio-field-row-label">{props.Label}</span>
      <div className="studio-field-row-inputs">{props.children}</div>
    </div>
  )
}

/** A row of buttons; the section body would otherwise stack them one per line. */
export function StudioActions(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return <div className="studio-actions" data-testid={props.Tag} style={props.Layout?.style}>{props.children}</div>
}

type StudioSchemeNoteProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Capability: string
    Requested: string
    Resolved: string
    Source: string
  }>

/** One line for the scheme; what was requested and what the host can do stay available on hover. */
export function StudioSchemeNote(props: StudioSchemeNoteProps): React.ReactElement {
  return (
    <p
      className="studio-note"
      data-testid={props.Tag}
      style={props.Layout?.style}
      title={`Requested ${props.Requested} · ${props.Capability}`}
    >
      Scheme {props.Resolved}, from {props.Source === 'scenario' ? 'the scenario' : props.Source}
    </p>
  )
}

/** The scenario's name block: the entry label Tao renders first, then where it comes from. */
export function StudioScenarioIdentity(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <div className="studio-scenario-identity" data-testid={props.Tag} style={props.Layout?.style}>
      {props.children}
    </div>
  )
}

type StudioScenarioSourceProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Cell: string
    Group: string
    Subject: string
  }>

/** Group and subject by name, and the cell's revision; the cell's id stays on hover. */
export function StudioScenarioSource(props: StudioScenarioSourceProps): React.ReactElement {
  const subject = props.Subject.slice(props.Subject.lastIndexOf('#') + 1)
  const cellParts = props.Cell.split(' · ')
  const revision = cellParts.find(part => part.startsWith('revision')) ?? props.Cell
  return (
    <div className="studio-scenario-source" data-testid={props.Tag} style={props.Layout?.style}>
      <b>{props.Group}</b>
      <span>{subject}</span>
      <span className="studio-scenario-cell" title={props.Cell}>{revision}</span>
    </div>
  )
}

type StudioNumericInputProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Change: TaoStudioHostNumberAction
    ChangeValid: TR.ActionValue<[TR.Value<boolean>]>
    Integer: boolean
    Label: string
    Maximum: number
    Minimum: number
    Value: number
  }>

/** Browser numeric input is a leaf: Tao owns the last valid number and validity state. */
export function StudioNumericInput(props: StudioNumericInputProps): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.Value))
  React.useEffect(() => setDraft(String(props.Value)), [props.Value])
  const constraints: StudioNumericDraftConstraints = {
    ...(props.Integer ? { integer: true } : {}),
    ...(props.Maximum > 0 ? { maximum: props.Maximum } : {}),
    minimum: props.Minimum,
  }
  const parsed = studioNumericDraft(draft, constraints)
  return (
    <label className="studio-inspector-field" data-testid={props.Tag} style={props.Layout?.style}>
      <span>{props.Label}</span>
      <input
        aria-label={props.Label}
        aria-invalid={!parsed.valid}
        max={props.Maximum > 0 ? props.Maximum : undefined}
        min={props.Minimum}
        onChange={event => {
          const nextDraft = event.currentTarget.value
          const next = studioNumericDraft(nextDraft, constraints)
          setDraft(nextDraft)
          void props.ChangeValid.invoke(TR.Value(next.valid))
          if (next.valid) {
            void props.Change.invoke(TR.Value(next.value))
          }
        }}
        step={props.Integer ? 1 : 'any'}
        type="number"
        value={draft}
      />
    </label>
  )
}

type StudioNumericDraftConstraints = Readonly<{
  integer?: boolean
  maximum?: number
  minimum?: number
}>

export type StudioNumericDraft = Readonly<
  | { valid: false }
  | { valid: true; value: number }
>

/** Keeps malformed browser input out of Tao's typed number actions without erasing the user's draft. */
export function studioNumericDraft(
  draft: string,
  constraints: StudioNumericDraftConstraints = {},
): StudioNumericDraft {
  if (draft.trim() === '') {
    return { valid: false }
  }
  const value = Number(draft)
  if (
    !Number.isFinite(value)
    || (constraints.integer === true && !Number.isInteger(value))
    || (constraints.minimum !== undefined && value < constraints.minimum)
    || (constraints.maximum !== undefined && value > constraints.maximum)
  ) {
    return { valid: false }
  }
  return { valid: true, value }
}
