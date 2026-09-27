import type { EntityGenerationDeclaration, GenerationField } from '@generation'
import { Assert, Errors, Json } from '@shared'
import { StudioFeedExamples } from './StudioFeedExamples'
import { StudioFeedInventory, type StudioFeedInventoryRow, type StudioFeedItemId } from './StudioFeedInventory'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioJsonObject } from './StudioProtocol'

type SourceKind = 'fixture' | 'generated' | 'live' | 'library'
type Promotion = Readonly<{ entity: string; fields: StudioJsonObject; name: string }>
type Field = Readonly<{
  name: string
  optional: boolean
  path: string
  type: GenerationField['type']
  relation?: Readonly<{ collection: string; entity: string; fields: readonly Field[] }>
}>
type BrowserRow = Readonly<{
  fields: StudioJsonObject
  id: StudioFeedItemId
  label: string
  source: Readonly<{ fixtureId?: string; kind: SourceKind; label?: string; row: string; seed?: string }>
}>
type BrowserSource = Readonly<{
  issues: readonly string[]
  kind: SourceKind
  rows: readonly BrowserRow[]
  truncated: boolean
}>

export type StudioFeedBrowserInventory = Readonly<{
  entities: readonly Readonly<{
    collection: string
    fields: readonly Field[]
    name: string
    sources: readonly BrowserSource[]
  }>[]
}>

type Candidate = StudioFeedInventoryRow & { fixtureId?: string; sourceLabel?: string }
const rowLimit = 250
const sourceKinds: readonly SourceKind[] = ['fixture', 'generated', 'live', 'library']

/** Compiler declarations constrain all browseable rows; promotion values remain on the server. */
export const StudioFeedBrowser = {
  build(
    manifest: StudioPreviewManifestV2,
    options: Readonly<{
      activeScenarioId?: string
      liveRows?: Readonly<Record<string, readonly StudioFeedInventoryRow[]>>
      seed: string
    }>,
  ): Readonly<{
    inventory: StudioFeedBrowserInventory
    promotions: ReadonlyMap<StudioFeedItemId, Promotion>
  }> {
    Assert.input(options.seed.length > 0, 'Studio feed example generation requires an explicit seed.')
    const declarations = manifest.generationDeclarations.filter(
      (declaration): declaration is EntityGenerationDeclaration => declaration.kind === 'entity',
    )
    const scenario = options.activeScenarioId === undefined
      ? manifest.scenarios[0]
      : manifest.scenarios.find(candidate => candidate.scenarioId === options.activeScenarioId)
    Assert.input(
      options.activeScenarioId === undefined || scenario !== undefined,
      `Studio feed scenario does not exist: ${options.activeScenarioId}.`,
    )
    const promotions = new Map<StudioFeedItemId, Promotion>()
    const entities = declarations.map(declaration => {
      const examples = StudioFeedExamples.generate(declaration, options.seed)
      const sources = sourceKinds.map(kind => {
        const issues: string[] = []
        let candidates: readonly Candidate[]
        if (kind === 'generated') {
          issues.push(
            ...examples.unsupported.filter(field => field.reason !== 'secret').map(field =>
              `${declaration.name}.${field.field}: ${field.reason}.`
            ),
          )
          const blocked = examples.unsupported.some(field => field.required && field.reason !== 'inverse-relation')
          candidates = blocked ? [] : examples.rows.map(row => ({
            fields: row.fields as StudioJsonObject,
            key: row.variant,
            name: row.name,
          }))
          if (blocked && issues.length === 0) {
            issues.push('Generated rows require a private value that cannot be included in the Feed.')
          }
        } else if (kind === 'live') {
          candidates = options.liveRows?.[declaration.name] ?? []
        } else {
          candidates = fixtureRows(manifest, declaration.name, scenario?.fixtureId, kind, issues)
        }
        const rows: BrowserRow[] = []
        for (const candidate of candidates.slice(0, rowLimit)) {
          try {
            for (const field of declaration.fields) {
              if (field.secret || field.optional || field.type.kind !== 'relation' || field.type.inverse) {
                continue
              }
              Assert.input(
                candidate.fields[field.name] !== undefined,
                `Studio feed row is missing required ${declaration.name}.${field.name}.`,
              )
            }
            const item = StudioFeedInventory.build(declaration, [{
              entity: declaration.name,
              kind: kind === 'generated' || kind === 'fixture' ? 'library' : kind,
              rows: [{ ...candidate, key: `${kind}:${candidate.key ?? candidate.name ?? rows.length}` }],
            }]).items[0]!
            if (promotions.has(item.id)) {
              continue
            }
            promotions.set(item.id, item.promotion)
            rows.push({
              fields: item.fields,
              id: item.id,
              label: candidate.name ?? item.promotion.name,
              source: {
                kind,
                row: candidate.key ?? candidate.name ?? String(rows.length),
                ...(candidate.fixtureId === undefined ? {} : { fixtureId: candidate.fixtureId }),
                ...(candidate.sourceLabel === undefined ? {} : { label: candidate.sourceLabel }),
                ...(kind === 'generated' ? { seed: options.seed } : {}),
              },
            })
          } catch (error) {
            issues.push(Errors.asError(error).message)
          }
        }
        return { issues: [...new Set(issues)], kind, rows, truncated: candidates.length > rowLimit }
      })
      return {
        collection: declaration.collection,
        fields: fieldsFor(declaration, declarations),
        name: declaration.name,
        sources,
      }
    })
    return { inventory: { entities }, promotions }
  },
} as const

function fieldsFor(
  declaration: EntityGenerationDeclaration,
  declarations: readonly EntityGenerationDeclaration[],
  prefix = '',
  nested = false,
): readonly Field[] {
  return declaration.fields.filter(field => !field.secret).map(field => {
    const path = `${prefix}${field.name}`
    const type = field.type
    const target = type.kind === 'relation' ? declarations.find(candidate => candidate.name === type.entity) : undefined
    return {
      name: field.name,
      optional: field.optional,
      path,
      type,
      ...(target === undefined || nested ? {} : {
        relation: {
          collection: target.collection,
          entity: target.name,
          fields: type.kind === 'relation' && !type.inverse
            ? fieldsFor(target, declarations, `${path}.`, true).filter(child => child.type.kind !== 'relation')
            : [],
        },
      }),
    }
  })
}

function fixtureRows(
  manifest: StudioPreviewManifestV2,
  entity: string,
  activeFixtureId: string | undefined,
  kind: 'fixture' | 'library',
  issues: string[],
): readonly Candidate[] {
  const rows: Candidate[] = []
  for (const fixture of manifest.fixtures) {
    if ((fixture.fixtureId === activeFixtureId) !== (kind === 'fixture')) {
      continue
    }
    const creates = fixture.plan['creates']
    if (!Array.isArray(creates)) {
      issues.push(`Fixture ${fixture.label} has no available rows.`)
      continue
    }
    for (const row of creates) {
      if (!Json.isRecord(row) || row['entity'] !== entity) {
        continue
      }
      if (typeof row['name'] !== 'string' || !Json.isRecord(row['fields'])) {
        issues.push(`Fixture ${fixture.label} contains an invalid ${entity} row.`)
        continue
      }
      rows.push({
        fields: row['fields'] as StudioJsonObject,
        fixtureId: fixture.fixtureId,
        key: `${fixture.fixtureId}:${row['name']}`,
        name: row['name'],
        sourceLabel: fixture.label,
      })
      if (rows.length > rowLimit) {
        return rows
      }
    }
  }
  return rows
}
