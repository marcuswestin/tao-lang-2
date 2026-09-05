import {
  compileGenerationSchema,
  type EntityGenerationDeclaration,
  generateValidated,
  type GenerationFailure,
  type GenerationProvider,
  type JsonObject,
} from '@generation'
import { Errors, Json } from '@shared'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioFixturePlan, StudioFixtureValue } from './StudioProtocol'

export type StudioFixtureGenerationResult =
  | { fixture: StudioFixturePlan; status: 'ready' }
  | {
    code: GenerationFailure['code']
    error: string
    issues?: readonly string[]
    status: 'failed'
  }

/** StudioFixtureGeneration turns compiler-owned entity metadata into one source-action-ready fixture plan. */
export class StudioFixtureGeneration {
  constructor(readonly provider: GenerationProvider) {}

  availability() {
    return this.provider.availability()
  }

  async generate(manifest: StudioPreviewManifestV2, input: unknown): Promise<StudioFixtureGenerationResult> {
    const availability = await this.provider.availability()
    if (availability.status === 'unavailable') {
      return failed('model_unavailable', availability.reason)
    }
    const scenarioId = fixtureGenerationScenarioId(input)
    const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === scenarioId)
    if (scenario === undefined) {
      throw new Errors.UserInputError(`Studio scenario does not exist: ${scenarioId}`)
    }
    const fixture = manifest.fixtures.find(candidate => candidate.fixtureId === scenario.fixtureId)
    if (fixture === undefined) {
      throw new Errors.UserInputError(`Studio scenario fixture does not exist: ${scenario.fixtureId}`)
    }
    const unsupportedClause = unsupportedFixtureClause(fixture.plan)
    if (unsupportedClause !== undefined) {
      return failed('validation_failed', unsupportedClause)
    }
    const sourcePlan = studioFixturePlan(fixture.plan)
    if (sourcePlan.creates.length === 0) {
      return failed('validation_failed', 'The scene fixture has no entity rows to generate.')
    }

    const declarations = new Map(
      manifest.generationDeclarations
        .filter((declaration): declaration is EntityGenerationDeclaration => declaration.kind === 'entity')
        .map(declaration => [declaration.name, declaration]),
    )
    const jobs: Array<{
      declaration: EntityGenerationDeclaration
      fixedFields: Record<string, StudioFixtureValue>
      relationFields: Record<string, StudioFixtureValue>
      row: StudioFixturePlan['creates'][number]
    }> = []
    for (const row of sourcePlan.creates) {
      const declaration = declarations.get(row.entity)
      if (declaration === undefined) {
        return failed('schema_mismatch', `The scene entity has no generation declaration: ${row.entity}`)
      }
      const fixedFields: Record<string, StudioFixtureValue> = {}
      const relationFields: Record<string, StudioFixtureValue> = {}
      for (const field of declaration.fields) {
        if (field.type.kind === 'scalar' && field.type.scalar === 'time') {
          const templateValue = row.fields[field.name]
          if (templateValue !== undefined) {
            if (!isNow(templateValue)) {
              return failed(
                'validation_failed',
                `The scene fixture time ${row.entity}.${field.name} must use Tao's executable now value.`,
              )
            }
            fixedFields[field.name] = templateValue
          } else if (isNow(field.defaultValue)) {
            fixedFields[field.name] = field.defaultValue
          } else if (!field.optional) {
            return failed(
              'validation_failed',
              `The required time ${row.entity}.${field.name} needs a fixture now value or a now default.`,
            )
          }
          continue
        }
        if (field.type.kind !== 'relation' || field.type.inverse) {
          continue
        }
        const templateValue = row.fields[field.name]
        if (templateValue === undefined) {
          if (!field.optional) {
            return failed(
              'validation_failed',
              `The scene fixture does not provide the required relation ${row.entity}.${field.name}.`,
            )
          }
          continue
        }
        if (!isFixtureReference(templateValue)) {
          return failed(
            'validation_failed',
            `The scene fixture relation ${row.entity}.${field.name} is not a fixture reference.`,
          )
        }
        relationFields[field.name] = templateValue
      }
      jobs.push({ declaration, fixedFields, relationFields, row })
    }

    const creates: Array<StudioFixturePlan['creates'][number]> = []
    for (const { declaration, fixedFields, relationFields, row } of jobs) {
      const generationDeclaration = {
        ...declaration,
        fields: declaration.fields.filter(field => field.type.kind !== 'scalar' || field.type.scalar !== 'time'),
      }
      const compiled = compileGenerationSchema(generationDeclaration, {
        declarations: manifest.generationDeclarations,
      })
      let modelFields: Record<string, StudioFixtureValue> = {}
      if (Object.keys(compiled.schema.properties ?? {}).length > 0) {
        const run = generateValidated<JsonObject>({
          guide: [
            compiled.guide,
            `Generate one realistic ${row.entity} row for the ${scenario.label} Studio scene.`,
          ].filter(Boolean).join('\n'),
          inputs: [{
            name: 'scene',
            value: { fixture: fixture.label, row: row.name, scenario: scenario.label },
          }],
          provider: this.provider,
          schema: compiled.schema,
        })
        const [, result] = await Promise.all([consume(run.partials), run.final])
        if (result.status === 'failure') {
          return {
            code: result.code,
            error: result.message,
            ...(result.issues === undefined ? {} : { issues: result.issues }),
            status: 'failed',
          }
        }
        modelFields = studioFixtureFields(result.value, declaration.name)
      }
      creates.push({
        entity: row.entity,
        fields: { ...modelFields, ...fixedFields, ...relationFields },
        name: row.name,
      })
    }

    return {
      fixture: { accounts: sourcePlan.accounts, creates },
      status: 'ready',
    }
  }
}

function fixtureGenerationScenarioId(value: unknown): string {
  if (!Json.isRecord(value) || typeof value['scenarioId'] !== 'string' || value['scenarioId'].trim().length === 0) {
    throw new Errors.UserInputError('Expected a Studio scenario id for fixture generation.')
  }
  return value['scenarioId']
}

function studioFixturePlan(value: unknown): StudioFixturePlan {
  if (!Json.isRecord(value) || !Array.isArray(value['accounts']) || !Array.isArray(value['creates'])) {
    throw new Errors.UserInputError('The Studio scenario fixture plan is not available for generation.')
  }
  const accounts = value['accounts'].map((account, index) => {
    if (!Json.isRecord(account) || typeof account['name'] !== 'string' || !Json.isRecord(account['fields'])) {
      throw new Errors.UserInputError(`Studio fixture account ${index + 1} is invalid.`)
    }
    return { fields: studioFixtureFields(account['fields'], `account ${account['name']}`), name: account['name'] }
  })
  const creates = value['creates'].map((create, index) => {
    if (
      !Json.isRecord(create)
      || typeof create['entity'] !== 'string'
      || !Json.isRecord(create['fields'])
      || typeof create['name'] !== 'string'
    ) {
      throw new Errors.UserInputError(`Studio fixture row ${index + 1} is invalid.`)
    }
    return {
      entity: create['entity'],
      fields: studioFixtureFields(create['fields'], create['entity']),
      name: create['name'],
    }
  })
  return { accounts, creates }
}

function studioFixtureFields(
  value: Readonly<Record<string, unknown>>,
  owner: string,
): Record<string, StudioFixtureValue> {
  return Object.fromEntries(
    Object.entries(value).map(([name, field]) => {
      if (typeof field === 'boolean' || typeof field === 'number' || typeof field === 'string' || isNow(field)) {
        return [name, field]
      }
      if (isFixtureReference(field)) {
        return [name, { handle: field.handle, kind: 'fixture-reference' as const }]
      }
      throw new Errors.UserInputError(`Generated ${owner}.${name} is not a Tao fixture value.`)
    }),
  )
}

function failed(code: GenerationFailure['code'], error: string): StudioFixtureGenerationResult {
  return { code, error, status: 'failed' }
}

function unsupportedFixtureClause(value: unknown): string | undefined {
  if (!Json.isRecord(value) || !Array.isArray(value['creates'])) {
    return undefined
  }
  for (const create of value['creates']) {
    if (!Json.isRecord(create)) {
      continue
    }
    const row = typeof create['name'] === 'string' ? create['name'] : 'an unnamed row'
    if (typeof create['account'] === 'string') {
      return `Studio fixture generation cannot yet preserve the for-account binding on ${row}.`
    }
    if (create['through'] !== undefined) {
      return `Studio fixture generation cannot yet preserve the through clause on ${row}.`
    }
  }
  return undefined
}

async function consume(values: AsyncIterable<unknown>): Promise<void> {
  for await (const _value of values) {
    // The Studio endpoint currently returns the accepted final plan; consuming partials preserves provider streaming.
  }
}

function isFixtureReference(value: unknown): value is { handle: string; kind: 'fixture-reference' } {
  return Json.isRecord(value) && value['kind'] === 'fixture-reference' && typeof value['handle'] === 'string'
}

function isNow(value: unknown): value is { kind: 'now' } {
  return Json.isRecord(value) && value['kind'] === 'now'
}
