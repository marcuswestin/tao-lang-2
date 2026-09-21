import { Errors } from '@shared/core'
import { StudioInspector } from '../../StudioInspector'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type {
  StudioFixturePlan,
  StudioFixtureValue,
  StudioSourceActionEnvelope,
  StudioSourceActionIdentity,
} from '../../StudioProtocol'
import { StudioApiClient } from '../StudioApiClient'
import { projectRelativePath } from '../StudioEditor'
import type { StudioPreviewConnection } from './StudioPreviewConnection'

function fixtureProposalSource(name: string, plan: StudioFixturePlan): string {
  const entries = [
    ...plan.accounts.map(account => `   account ${account.name} { ${fixtureProposalFields(account.fields)} }`),
    ...plan.creates.map(create =>
      `   ${create.name} = create ${create.entity} { ${fixtureProposalFields(create.fields)} }`
    ),
  ]
  return `fixture ${name} {\n${entries.join('\n')}\n}`
}

function fixtureProposalSourceAction(options: {
  fixtureName: string
  identity: StudioSourceActionIdentity
  origin?: 'captured' | 'generated'
  plan: StudioFixturePlan
  requestId: string
}): StudioSourceActionEnvelope {
  return StudioInspector.singleAction({
    action: {
      fixtureName: options.fixtureName,
      kind: 'insert-captured-fixture',
      plan: options.plan,
    },
    checkpointId: `${options.origin ?? 'captured'}-fixture:${options.requestId}`,
    identity: options.identity,
    requestId: options.requestId,
  })
}

function generatedFixtureFailureMessage(result: { error: string; issues?: readonly string[] }): string {
  const issues = result.issues?.filter(issue => issue.trim().length > 0) ?? []
  return issues.length === 0 ? result.error : `${result.error} ${issues.join(' ')}`
}

export const StudioFixtureProposal = {
  source: fixtureProposalSource,
  sourceAction: fixtureProposalSourceAction,
} as const

export const StudioFixtureGenerationFeedback = {
  failure: generatedFixtureFailureMessage,
} as const

function fixtureProposalFields(fields: Readonly<Record<string, StudioFixtureValue>>): string {
  return Object.entries(fields).map(([name, value]) => `${name}: ${fixtureProposalValue(value)}`).join(', ')
}

function fixtureProposalValue(value: StudioFixtureValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return value.kind === 'now' ? 'now' : value.handle
}

/** A cell's source action goes through the app-level applier when one is wired, else straight to the API. */
export async function applyConnectionSourceAction(
  connection: StudioPreviewConnection,
  envelope: StudioSourceActionEnvelope,
): Promise<void> {
  if (connection.applySourceAction !== undefined) {
    await connection.applySourceAction(envelope)
    return
  }
  await StudioApiClient.sourceAction(envelope)
}

export async function configureGenerationAvailability(button: HTMLButtonElement): Promise<void> {
  try {
    const availability = await StudioApiClient.aiAvailability()
    button.textContent = availability.status === 'available' ? 'Generate fixture' : 'AI unavailable'
    button.disabled = availability.status !== 'available'
    button.title = availability.status === 'available'
      ? 'Generate a realistic state for this scene.'
      : availability.reason ?? 'On-device generation is unavailable.'
  } catch (error) {
    button.textContent = 'AI unavailable'
    button.disabled = true
    button.title = Errors.messageOf(error)
  }
}

export function fixtureSourceIdentity(
  connection: StudioPreviewConnection,
  manifest: StudioPreviewManifestV2,
  scenario: StudioPreviewManifestV2['scenarios'][number],
): StudioSourceActionIdentity | undefined {
  const sourceVersion = manifest.sourceVersions[scenario.source.path]
  const path = projectRelativePath(manifest.project.root, scenario.source.path)
  return connection.cellIdentity === undefined || sourceVersion === undefined || path === undefined
    ? undefined
    : {
      ...connection.cellIdentity,
      path,
      previewInstanceId: connection.previewInstanceId,
      scenarioId: scenario.scenarioId,
      sourceVersion,
    }
}
