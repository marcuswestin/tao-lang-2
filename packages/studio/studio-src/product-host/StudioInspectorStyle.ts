import { Errors, Switch } from '@shared/core'
import type { StudioRenderInspection, StudioStyleEntry, StudioStyleLandingScope } from '@source-actions'
import { StudioInspector, studioStyleProperties } from '../StudioInspector'
import { studioInspectorDraftMap, studioInspectorInspection, studioInspectorSelection } from './StudioInspectorModel'

export function StudioInspectorStyleDrafts(inspection: string): string {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return '{}'
  }
  const current = studioInspectorCurrentStyle(parsed)
  const landings = studioInspectorStyleLandings(parsed, current)
  const bundle = parsed.styleProvenance.find(provenance =>
    provenance.editable !== false && provenance.landing.kind === 'style-bundle'
  )
  const bundleName = bundle?.landing.kind === 'style-bundle' ? bundle.landing.bundleName : undefined
  const landing = bundleName !== undefined
    ? landings.find(candidate =>
      candidate.landing.kind === 'style-bundle'
      && candidate.landing.bundleName === bundleName
      && candidate.landing.mode !== 'fork'
    )
    : undefined
  return JSON.stringify({
    landing: landing?.label ?? landings[0]!.label,
    property: String(current[0]),
    value: current.slice(1).join(' '),
  })
}

export function StudioInspectorStyleFieldIds(): string[] {
  return ['property', 'value', 'landing']
}

export function StudioInspectorStyleFieldLabel(fieldId: string): string {
  return fieldId === 'property' ? 'Property' : fieldId === 'landing' ? 'Landing' : 'Value'
}

export function StudioInspectorStyleFieldUsesPicker(fieldId: string): boolean {
  return fieldId === 'property' || fieldId === 'landing'
}

export function StudioInspectorStyleFieldOptions(inspection: string, fieldId: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  if (fieldId === 'property') {
    const supported = studioStyleProperties.map(property => property.head)
    const current = parsed === undefined ? undefined : String(studioInspectorCurrentStyle(parsed)[0])
    return current === undefined || supported.includes(current as (typeof supported)[number])
      ? supported
      : [...supported, current]
  }
  if (fieldId === 'landing' && parsed !== undefined) {
    return studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).map(candidate => candidate.label)
  }
  return []
}

export function StudioInspectorStyleActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  drafts: string,
  busy: boolean,
): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (
    busy
    || parsed === undefined
    || selected === undefined
    || parsed.renderId !== selected.renderId
    || selected.identity.sourceVersion !== currentSourceVersion
  ) {
    return false
  }
  const values = studioInspectorDraftMap(drafts)
  return StudioInspector.styleEntryDraft(values['property'] ?? '', values['value'] ?? '') !== undefined
    && studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).some(candidate =>
      candidate.label === values['landing']
    )
}

export function StudioInspectorStyleAction(inspection: string, selection: string, drafts: string): string {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  const values = studioInspectorDraftMap(drafts)
  const entry = StudioInspector.styleEntryDraft(values['property'] ?? '', values['value'] ?? '')
  const landing = parsed === undefined
    ? undefined
    : studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).find(candidate =>
      candidate.label === values['landing']
    )?.landing
  if (
    parsed === undefined
    || selected === undefined
    || parsed.renderId !== selected.renderId
    || entry === undefined
    || landing === undefined
  ) {
    Errors.throwUserInput('The Studio style draft or landing is invalid.')
  }
  return JSON.stringify(StudioInspector.styleAction({ entry, landing, renderId: selected.renderId }))
}

export function StudioInspectorStylePromotionIds(inspection: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  return parsed === undefined ? [] : studioInspectorStylePromotions(parsed).map((_, index) => String(index))
}

export function StudioInspectorStylePromotionLabel(inspection: string, promotionId: string): string {
  const parsed = studioInspectorInspection(inspection)
  return parsed === undefined ? '' : studioInspectorStylePromotion(parsed, promotionId)?.label ?? ''
}

export function StudioInspectorStylePromotionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  promotionId: string,
): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  return !busy
    && parsed !== undefined
    && selected !== undefined
    && parsed.renderId === selected.renderId
    && selected.identity.sourceVersion === currentSourceVersion
    && studioInspectorStylePromotion(parsed, promotionId) !== undefined
}

export function StudioInspectorStylePromotionAction(
  inspection: string,
  selection: string,
  promotionId: string,
): string {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  const promotion = parsed === undefined ? undefined : studioInspectorStylePromotion(parsed, promotionId)
  if (
    parsed === undefined || selected === undefined || parsed.renderId !== selected.renderId || promotion === undefined
  ) {
    Errors.throwUserInput('The Studio style promotion is no longer available.')
  }
  return JSON.stringify(StudioInspector.styleAction({
    entry: promotion.entry,
    landing: promotion.landing,
    renderId: selected.renderId,
  }))
}

export function StudioInspectorStyleNotes(inspection: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return []
  }
  return [
    ...parsed.styleProvenance.map(provenance => {
      const landing = studioInspectorLandingName(provenance.landing)
      const access = provenance.editable === false ? 'unavailable' : 'editable'
      const owner = provenance.ownerPath === undefined ? '' : ` · owner ${provenance.ownerPath}`
      const reason = provenance.reason === undefined ? '' : ` · ${provenance.reason}`
      return `${provenance.chain.join(' ← ')} · ${landing} · affects ${provenance.blastRadius} render${
        provenance.blastRadius === 1 ? '' : 's'
      } · ${access}${owner}${reason}`
    }),
    ...(parsed.design?.reason === undefined ? [] : [parsed.design.reason]),
  ]
}

type StudioInspectorStyleLandingOption = Readonly<{ label: string; landing: StudioStyleLandingScope }>

function studioInspectorCurrentStyle(inspection: StudioRenderInspection): StudioStyleEntry {
  const bundle = inspection.styleProvenance.find(provenance => provenance.landing.kind === 'style-bundle')
  return inspection.explorations.find(entry => studioStyleProperties.some(property => property.head === entry[0]))
    ?? bundle?.chain[1]?.split(/\s+/) as StudioStyleEntry | undefined
    ?? inspection.styleEntries[0]
    ?? ['fg', 'ink']
}

function studioInspectorStyleLandings(
  inspection: StudioRenderInspection,
  current: StudioStyleEntry,
): StudioInspectorStyleLandingOption[] {
  const landings: StudioInspectorStyleLandingOption[] = [
    { label: 'Element inline · selected render only', landing: { kind: 'element-inline' } },
  ]
  for (const provenance of inspection.styleProvenance) {
    if (provenance.editable === false || provenance.landing.kind !== 'style-bundle') {
      continue
    }
    const name = provenance.landing.bundleName
    if (
      !landings.some(candidate => candidate.landing.kind === 'style-bundle' && candidate.landing.bundleName === name)
    ) {
      landings.push({
        label: `Edit style ${name} · affects ${provenance.blastRadius}`,
        landing: provenance.landing,
      })
      landings.push({
        label: `Fork style ${name} · selected render only`,
        landing: { bundleName: name, kind: 'style-bundle', mode: 'fork' },
      })
    }
  }
  if (inspection.elementName !== undefined && inspection.design?.editable !== false) {
    landings.push({
      label: `Promote to ${inspection.elementName} default`,
      landing: { elementName: inspection.elementName, kind: 'element-default' },
    })
  }
  if (studioInspectorRawColor(current) && inspection.design?.editable !== false) {
    landings.push({
      label: `Promote to color token ${String(current[0])}Color`,
      landing: { kind: 'token', tokenName: `${String(current[0])}Color` },
    })
  }
  return landings
}

type StudioInspectorStylePromotion = Readonly<{
  entry: StudioStyleEntry
  label: string
  landing: StudioStyleLandingScope
}>

function studioInspectorStylePromotions(inspection: StudioRenderInspection): StudioInspectorStylePromotion[] {
  const promotions: StudioInspectorStylePromotion[] = []
  const localBundle = inspection.styleProvenance.find(provenance =>
    provenance.editable !== false && provenance.landing.kind === 'style-bundle'
  )
  for (const exploration of inspection.explorations) {
    const entry = exploration as StudioStyleEntry
    const label = exploration.join(' ')
    if (localBundle?.landing.kind === 'style-bundle') {
      promotions.push({
        entry,
        label: `Promote ${label} to forked style`,
        landing: { bundleName: localBundle.landing.bundleName, kind: 'style-bundle', mode: 'fork' },
      })
    }
    if (inspection.elementName !== undefined && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to ${inspection.elementName} default`,
        landing: { elementName: inspection.elementName, kind: 'element-default' },
      })
    }
    if (studioInspectorRawColor(exploration) && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to token`,
        landing: { kind: 'token', tokenName: `${String(exploration[0])}Color` },
      })
    }
    if (studioInspectorRawSize(exploration) && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to size token`,
        landing: { kind: 'size-token', tokenName: `${String(exploration[0])}Size` },
      })
    }
  }
  return promotions
}

function studioInspectorStylePromotion(
  inspection: StudioRenderInspection,
  promotionId: string,
): StudioInspectorStylePromotion | undefined {
  const index = Number(promotionId)
  return Number.isSafeInteger(index) && index >= 0 ? studioInspectorStylePromotions(inspection)[index] : undefined
}

function studioInspectorRawColor(entry: readonly unknown[]): boolean {
  return studioStyleProperties.some(property => property.head === entry[0] && property.valueKind === 'color')
    && typeof entry[1] === 'string'
    && entry[1].startsWith('#')
}

const studioInspectorSizeHeads = new Set(['gap', 'height', 'line', 'margin', 'pad', 'radius', 'size', 'width'])

function studioInspectorRawSize(entry: readonly unknown[]): boolean {
  if (!studioInspectorSizeHeads.has(String(entry[0]))) {
    return false
  }
  const numbers = entry.slice(1).filter((term): term is number => typeof term === 'number')
  return numbers.length === 1 && numbers[0]! > 0 && Number.isFinite(numbers[0]!)
}

function studioInspectorLandingName(landing: StudioStyleLandingScope): string {
  return Switch.kind(landing, {
    'element-default': scope => `element default ${scope.elementName}`,
    'element-inline': () => 'element inline',
    'size-token': scope => `size token ${scope.tokenName}`,
    'style-bundle': scope => `${scope.mode === 'fork' ? 'fork' : 'edit'} style ${scope.bundleName}`,
    token: scope => `token ${scope.tokenName}`,
  })
}
