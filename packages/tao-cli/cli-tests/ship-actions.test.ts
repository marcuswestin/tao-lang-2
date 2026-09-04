import { Describe, Expect, Test } from '@shared/test'
import { planShipActions } from '../cli-src/ship-actions'

const base = {
  appName: 'WordFlower',
  buildNumber: '202609021405',
  noWait: false,
  reuseBuild: false,
  update: false,
  version: '1.2.3',
}

Describe('tao ship action list', () => {
  Test('lists a new App Store build in execution order', () => {
    const actions = planShipActions({ ...base, bump: { from: '1.2.2', to: '1.2.3' } })
    Expect(actions[0]).toContain('Bump project version')
    Expect(actions).toContain('Prebuild the iOS project')
    Expect(actions.at(-1)).toContain('submit it for review')
  })

  Test('lists beta recipients without tagging', () => {
    const actions = planShipActions({
      ...base,
      betaRecipients: ['one@example.com', 'two@example.com'],
      bump: { from: '1.2.2', to: '1.2.3' },
      notes: 'Try editing a document',
    })
    Expect(actions[1]).toBe('Commit the version bump')
    Expect(actions.at(-2)).toContain('one@example.com, two@example.com')
    Expect(actions.at(-1)).toContain('Try editing a document')
  })

  Test('reuses a tested build and does not rebuild', () => {
    const actions = planShipActions({ ...base, reuseBuild: true })
    Expect(actions.some(action => action.startsWith('Resume uploaded App Store Connect build'))).toBe(true)
    Expect(actions).not.toContain('Prebuild the iOS project')
  })

  Test('stops after upload for --no-wait and plans compatible updates separately', () => {
    Expect(planShipActions({ ...base, noWait: true }).at(-1)).toContain('without waiting')
    Expect(planShipActions({ ...base, update: true })).toEqual([
      'Compile WordFlower 1.2.3 in release mode',
      'Export the update bundle and verify it contains no Tao Studio marker',
      'Verify the runtime fingerprint and Tao data schema are compatible with installed builds',
      'Publish the update to the WordFlower channel',
    ])
  })
})
