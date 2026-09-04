export type ShipActionInput = {
  appName: string
  betaRecipients?: readonly string[]
  buildNumber: string
  bump?: { from: string; to: string }
  noWait: boolean
  notes?: string
  reuseBuild: boolean
  update: boolean
  version: string
}

/** planShipActions is the reviewable action list printed before the Y/n gate. */
export function planShipActions(input: ShipActionInput): string[] {
  if (input.update) {
    return [
      `Compile ${input.appName} ${input.version} in release mode`,
      'Export the update bundle and verify it contains no Tao Studio marker',
      'Verify the runtime fingerprint and Tao data schema are compatible with installed builds',
      `Publish the update to the ${input.appName} channel`,
    ]
  }
  const actions: string[] = []
  if (input.bump) {
    actions.push(`Bump project version ${input.bump.from} -> ${input.bump.to}`)
    actions.push(`Commit the version bump${input.betaRecipients === undefined ? ` and tag v${input.bump.to}` : ''}`)
  } else if (input.betaRecipients === undefined) {
    actions.push(`Tag the release v${input.version}`)
  }
  if (input.reuseBuild) {
    actions.push(`Resume uploaded App Store Connect build ${input.buildNumber} without rebuilding`)
  } else {
    actions.push(`Compile ${input.appName} ${input.version} (${input.buildNumber}) in release mode`)
    actions.push('Export the release bundle and verify it contains no Tao Studio marker')
    actions.push('Prebuild the iOS project')
    actions.push('Archive and sign with the App Store Connect API key')
    actions.push('Upload to App Store Connect')
  }
  if (input.noWait && !input.reuseBuild) {
    actions.push('Return after upload without waiting for Apple processing')
    return actions
  }
  if (input.betaRecipients !== undefined) {
    const recipients = input.betaRecipients.length === 0
      ? 'the existing TestFlight groups'
      : input.betaRecipients.join(', ')
    actions.push(`Distribute through TestFlight to ${recipients}`)
    actions.push(`Set What to Test: ${input.notes ?? 'from the Git log since the previous build'}`)
  } else {
    actions.push(`Create or reuse App Store version ${input.version}, attach the build, and submit it for review`)
  }
  return actions
}
