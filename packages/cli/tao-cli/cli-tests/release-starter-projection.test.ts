import { Workspace } from '@compiler/workspace'
import { Diagnostics, ReleaseCapabilities } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { lowerCreationPlan } from '../cli-src/create/creation-lowering'
import { starterPlans } from '../cli-src/create/starter-plans'

Describe('public starter release projection', () => {
  Test('both early-phase starters validate with scenarios and keep explicit styles ahead of overrides', async () => {
    for (const starter of starterPlans) {
      const releaseProfile = ReleaseCapabilities.profile(1)
      const files = lowerCreationPlan(starter.plan, { description: starter.description, releaseProfile })
      Expect(files['Design.tao']).toContain('baseText [ink ink]')
      Expect(files['Design.tao']).not.toContain('NavigationHeader [')
      Expect(files['Design.tao']).not.toContain('      FormButton [')
      const feature = files[`${starter.plan.entities[0]!.plural}/${starter.plan.entities[0]!.plural}.tao`]!
      Expect(feature).toContain('FormButton("Open") [baseFormButton, buttonSecondary]')
      Expect(feature).toContain('[baseTextInput] {')
      Expect(feature).toContain('[baseText, sectionTitle]')
      await withTaoFiles('release-starter-', files, async (_paths, root) => {
        const workspace = await Workspace.openProfile(root, releaseProfile)
        for (const entry of ['App.tao', 'Scenarios.tao', `${starter.directory}.test.tao`]) {
          const result = await workspace.validate(entry)
          Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
        }
      })
      Expect(
        lowerCreationPlan(starter.plan, {
          description: starter.description,
          releaseProfile: ReleaseCapabilities.profile(2),
        }),
      ).toEqual(files)
    }
  })

  Test('phase three and development preserve the complete generated source', () => {
    for (const starter of starterPlans) {
      const development = lowerCreationPlan(starter.plan, {
        releaseProfile: ReleaseCapabilities.profile('development'),
      })
      Expect(development['Design.tao']).toContain('      Text [ink ink]')
      Expect(development['Design.tao']).toContain('NavigationHeader [background surface, border line]')
      Expect(lowerCreationPlan(starter.plan)).toEqual(development)
      Expect(lowerCreationPlan(starter.plan, { releaseProfile: ReleaseCapabilities.profile(3) })).toEqual(development)
    }
  })
})
