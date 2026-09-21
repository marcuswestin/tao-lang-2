import { Assert, Errors, Switch } from '@shared/core'
import type { StudioCellEnvironment, StudioParameterSchema } from '../../StudioPreviewManifest'
import type { StudioJsonObject, StudioJsonValue } from '../../StudioProtocol'
import {
  type StudioScenarioControlModel,
  StudioScenarioControls,
  type StudioScenarioDraft,
  type StudioScenarioResult,
} from '../StudioScenarioControls'

type StudioControl<Value> = { element: HTMLElement; read: () => Value }

/** The per-cell scenario and environment form groups, each rendered once and read back on apply. */
export const StudioCellControls = {
  arguments: renderArgumentControls,
  network: renderNetworkControls,
  networkLabel,
  readDraft: readScenarioDraft,
  scheme: renderSchemeControls,
  viewport: renderViewportControls,
} as const

function readScenarioDraft(
  model: StudioScenarioControlModel | undefined,
  readArguments: () => StudioJsonObject,
  readNetwork: () => StudioCellEnvironment['network'],
  readViewport: () => StudioCellEnvironment['viewport'],
): StudioScenarioResult<StudioScenarioDraft> {
  if (model === undefined) {
    return { issues: ['Studio scenario identity is unavailable.'], ok: false }
  }
  try {
    return StudioScenarioControls.validateDraft(model, {
      arguments: readArguments(),
      network: readNetwork(),
      viewport: readViewport(),
    })
  } catch (error) {
    return { issues: [Errors.messageOf(error)], ok: false }
  }
}

function renderArgumentControls(
  parameters: readonly StudioParameterSchema[],
  args: StudioJsonObject,
): StudioControl<StudioJsonObject> {
  const group = controlGroup('Arguments')
  const readers: Array<readonly [string, () => StudioJsonValue | undefined]> = []
  if (parameters.length === 0) {
    group.fields.append(controlNote('No editable arguments'))
  }
  for (const parameter of parameters) {
    const current = args[parameter.parameterId] ?? parameter.defaultValue
    const control = parameterControl(parameter, current)
    group.fields.append(control.element)
    readers.push([parameter.parameterId, control.read])
  }
  return {
    element: group.element,
    read: () =>
      Object.fromEntries(readers.flatMap(([id, read]) => {
        const value = read()
        return value === undefined ? [] : [[id, value]]
      })),
  }
}

function parameterControl(
  parameter: StudioParameterSchema,
  value: StudioJsonValue | undefined,
): StudioControl<StudioJsonValue | undefined> {
  const field = controlField(parameter.label)
  const mount = (
    control: HTMLElement,
    read: () => StudioJsonValue | undefined,
  ): StudioControl<StudioJsonValue | undefined> => {
    field.control.append(control)
    return { element: field.element, read }
  }
  const textControl = (placeholder?: string): StudioControl<StudioJsonValue | undefined> => {
    const input = document.createElement('input')
    input.required = parameter.required
    input.type = 'text'
    if (placeholder !== undefined) {
      input.placeholder = placeholder
    }
    if (typeof value === 'string') {
      input.value = value
    }
    return mount(input, () => input.value === '' && !parameter.required ? undefined : input.value)
  }
  return Switch.kind<StudioParameterSchema['type'], StudioControl<StudioJsonValue | undefined>>(parameter.type, {
    boolean: () => {
      const input = document.createElement('input')
      input.checked = value === true
      input.type = 'checkbox'
      return mount(input, () => input.checked)
    },
    choice: type => {
      const select = document.createElement('select')
      for (const choice of type.values) {
        const option = document.createElement('option')
        option.value = JSON.stringify(choice)
        option.textContent = String(choice)
        option.selected = Object.is(choice, value)
        select.append(option)
      }
      return mount(select, () => JSON.parse(select.value) as StudioJsonValue)
    },
    json: () => {
      const input = document.createElement('textarea')
      input.rows = 2
      input.value = value === undefined ? '' : JSON.stringify(value)
      return mount(input, () => input.value.trim() === '' ? undefined : JSON.parse(input.value) as StudioJsonValue)
    },
    number: type => {
      const input = document.createElement('input')
      input.required = parameter.required
      input.type = 'number'
      if (type.minimum !== undefined) {
        input.min = String(type.minimum)
      }
      if (type.maximum !== undefined) {
        input.max = String(type.maximum)
      }
      if (type.step !== undefined) {
        input.step = String(type.step)
      }
      if (typeof value === 'number') {
        input.value = String(value)
      }
      return mount(input, () => input.value === '' ? undefined : requiredFiniteNumber(input, parameter.label))
    },
    text: () => textControl(),
    time: () => textControl('Time'),
  })
}

function renderViewportControls(environment: StudioCellEnvironment): StudioControl<StudioCellEnvironment['viewport']> {
  const group = controlGroup('Viewport')
  const preset = document.createElement('select')
  const presets = [
    { height: 844, label: 'Phone', presetId: 'phone', width: 390 },
    { height: 1180, label: 'Tablet', presetId: 'tablet', width: 820 },
    { height: 900, label: 'Laptop', presetId: 'laptop', width: 1440 },
  ] as const
  for (const item of presets) {
    const option = document.createElement('option')
    option.value = item.presetId
    option.textContent = item.label
    preset.append(option)
  }
  if (
    environment.viewport.presetId !== undefined
    && !presets.some(item => item.presetId === environment.viewport.presetId)
  ) {
    const authored = document.createElement('option')
    authored.value = environment.viewport.presetId
    authored.textContent = environment.viewport.presetId
    preset.append(authored)
  }
  const custom = document.createElement('option')
  custom.value = 'custom'
  custom.textContent = 'Custom'
  preset.append(custom)
  preset.value = environment.viewport.presetId ?? 'custom'

  const width = dimensionInput(environment.viewport.width, 'Width')
  const height = dimensionInput(environment.viewport.height, 'Height')
  preset.addEventListener('change', () => {
    const selected = presets.find(item => item.presetId === preset.value)
    if (selected !== undefined) {
      width.value = String(selected.width)
      height.value = String(selected.height)
    }
  })
  width.addEventListener('input', () => {
    preset.value = 'custom'
  })
  height.addEventListener('input', () => {
    preset.value = 'custom'
  })
  group.fields.append(labelControl('Device', preset), labelControl('Width', width), labelControl('Height', height))
  return {
    element: group.element,
    read: () => ({
      ...(preset.value === 'custom' ? {} : { presetId: preset.value }),
      height: requiredFiniteNumber(height, 'Viewport height'),
      width: requiredFiniteNumber(width, 'Viewport width'),
    }),
  }
}

function renderNetworkControls(environment: StudioCellEnvironment): StudioControl<StudioCellEnvironment['network']> {
  const group = controlGroup('Network')
  const outcome = document.createElement('select')
  for (const value of ['normal', 'offline', 'error'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    outcome.append(option)
  }
  outcome.value = environment.network.outcome
  const latency = dimensionInput(environment.network.latencyMs, 'Latency')
  latency.min = '0'
  const message = document.createElement('input')
  message.type = 'text'
  message.value = environment.network.error?.message ?? 'Injected Studio network failure'
  const status = dimensionInput(environment.network.error?.status ?? 503, 'Status')
  status.min = '100'
  status.max = '599'
  const errorFields = [labelControl('Error', message), labelControl('Status', status)]
  const updateErrorVisibility = (): void => {
    for (const field of errorFields) {
      field.hidden = outcome.value !== 'error'
    }
  }
  outcome.addEventListener('change', updateErrorVisibility)
  updateErrorVisibility()
  group.fields.append(labelControl('Mode', outcome), labelControl('Latency ms', latency), ...errorFields)
  return {
    element: group.element,
    read: () => ({
      ...(outcome.value === 'error'
        ? {
          error: {
            message: message.value.trim() || 'Injected Studio network failure',
            status: requiredFiniteNumber(status, 'Network error status'),
          },
        }
        : {}),
      latencyMs: requiredFiniteNumber(latency, 'Network latency'),
      outcome: outcome.value as StudioCellEnvironment['network']['outcome'],
    }),
  }
}

function renderSchemeControls(environment: StudioCellEnvironment): HTMLElement {
  const group = controlGroup('Scheme')
  const select = document.createElement('select')
  select.disabled = true
  select.title = 'Scenario appearance is authored in Tao; Studio shows the runtime resolution here.'
  for (const value of ['system', 'light', 'dark'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    option.selected = value === environment.scheme.requested
    select.append(option)
  }
  group.fields.append(
    labelControl('Requested', select),
    controlNote(
      `${environment.scheme.resolved} · ${environment.scheme.source} · ${environment.scheme.capability}`,
    ),
  )
  return group.element
}

function controlGroup(title: string): { element: HTMLElement; fields: HTMLElement } {
  const element = document.createElement('fieldset')
  element.className = 'studio-preview-control-group'
  const legend = document.createElement('legend')
  legend.textContent = title
  const fields = document.createElement('div')
  fields.className = 'studio-preview-control-fields'
  element.append(legend, fields)
  return { element, fields }
}

function controlField(label: string): { control: HTMLElement; element: HTMLLabelElement } {
  const element = document.createElement('label')
  element.className = 'studio-preview-control-field'
  const caption = document.createElement('span')
  caption.textContent = label
  const control = document.createElement('span')
  control.className = 'studio-preview-control-input'
  element.append(caption, control)
  return { control, element }
}

function labelControl(label: string, control: HTMLElement): HTMLLabelElement {
  const field = controlField(label)
  field.control.append(control)
  return field.element
}

function controlNote(text: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'studio-preview-control-note'
  note.textContent = text
  return note
}

function dimensionInput(value: number, label: string): HTMLInputElement {
  const input = document.createElement('input')
  input.setAttribute('aria-label', label)
  input.min = '1'
  input.step = '1'
  input.type = 'number'
  input.value = String(value)
  return input
}

function requiredFiniteNumber(input: HTMLInputElement, label: string): number {
  const value = input.valueAsNumber
  Assert.input(Number.isFinite(value), `${label} must be a number.`)
  return value
}

function networkLabel(environment: StudioCellEnvironment): string {
  const latency = environment.network.latencyMs === 0 ? '' : ` +${environment.network.latencyMs}ms`
  return `${environment.network.outcome}${latency} · Scheme ${environment.scheme.resolved}`
}
