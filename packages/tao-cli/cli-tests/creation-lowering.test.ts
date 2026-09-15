import { FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import Workspace from '@workspace'
import { lowerCreationPlan, writeCreationFiles } from '../cli-src/create/creation-lowering'
import { type CreationPlan, validateCreationPlan } from '../cli-src/create/creation-plan'
import { starterPlans } from '../cli-src/create/starter-plans'
import { runFix } from '../cli-src/source-commands'

/** Set TAO_UPDATE_STARTERS=1 to rewrite `Apps/Starters` from the reference plans instead of comparing. */
const UPDATE_STARTERS = Platform.runtimeProcess.env['TAO_UPDATE_STARTERS'] === '1'

Describe('tao create lowering', () => {
  for (const starter of starterPlans) {
    Test(`reproduces Apps/Starters/${starter.directory} byte for byte from its reference plan`, async () => {
      Expect(validateCreationPlan(starter.plan)).toEqual([])
      const root = await mkTestDir('tao-create-lowering-')
      try {
        const generated = FS.resolvePath(starter.directory, root)
        await writeCreationFiles(generated, lowerCreationPlan(starter.plan, { description: starter.description }))
        await runFix(generated, { cwd: root })

        const checkedIn = Repo.resolvePath(`Apps/Starters/${starter.directory}`)
        if (UPDATE_STARTERS) {
          if (await FS.exists(checkedIn)) {
            await FS.remove(checkedIn)
          }
          await FS.copyDirectory(generated, checkedIn)
        }
        Expect(await projectFilesUnder(generated)).toEqual(await projectFilesUnder(checkedIn))
        for (const relativePath of await projectFilesUnder(generated)) {
          Expect(await FS.readText(FS.resolvePath(relativePath, generated))).toBe(
            await FS.readText(FS.resolvePath(relativePath, checkedIn)),
          )
        }
      } finally {
        await FS.remove(root)
      }
    })
  }

  Test('lowers a plan outside the starters to a project that validates from its entries', async () => {
    // Three entities, every field type, no time field on one entity (so it orders by its title), a
    // number-only detail, and sample titles that collide once handles are made from them.
    const plan: CreationPlan = {
      name: 'Field Notes',
      id: 'field-notes',
      summary: 'Keeps observations, sites, and gear for a field season.',
      entities: [
        {
          plural: 'Observations',
          singular: 'Observation',
          purpose: 'One observation.',
          fields: [
            { name: 'Summary', type: 'text', title: true },
            { name: 'Details', type: 'text' },
            { name: 'Seen', type: 'number' },
            { name: 'Verified', type: 'yesno' },
            { name: 'ObservedAt', type: 'time' },
          ],
        },
        {
          plural: 'Sites',
          singular: 'Site',
          purpose: 'One site.',
          fields: [{ name: 'Name', type: 'text', title: true }, { name: 'Elevation', type: 'number' }],
        },
        {
          plural: 'GearItems',
          singular: 'GearItem',
          purpose: 'One piece of gear.',
          fields: [{ name: 'Label', type: 'text', title: true }, { name: 'Packed', type: 'yesno' }, {
            name: 'Spare',
            type: 'yesno',
          }],
        },
      ],
      palette: { canvas: '#14201a', ink: '#e8f1ea', accent: '#7bd389' },
      samples: {
        Observations: [{ Summary: 'Heron at dawn', Details: 'Two adults.', Seen: 2, Verified: true }, {
          Summary: 'Heron at dusk',
        }],
        Sites: [{ Name: 'North marsh', Elevation: 12 }, { Name: 'north marsh' }],
        GearItems: [{ Label: 'Binoculars', Packed: true }, { Label: '10x scope', Spare: true }, { Label: 'Notebook' }],
      },
    }
    Expect(validateCreationPlan(plan)).toEqual([])

    const root = await mkTestDir('tao-create-lowering-')
    try {
      const generated = FS.resolvePath('field-notes', root)
      await writeCreationFiles(generated, lowerCreationPlan(plan))
      await runFix(generated, { cwd: root })
      const workspace = await Workspace.open(generated)
      const problems: string[] = []
      for (const entry of ['App.tao', 'FieldNotes.test.tao']) {
        const result = await workspace.validate(FS.resolvePath(entry, generated))
        problems.push(
          ...result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d =>
            `${entry}: ${d.message}`
          ),
        )
      }
      Expect(problems).toEqual([])

      const chrome = await FS.readText(FS.resolvePath('Chrome.tao', generated))
      Expect(chrome).toContain('SelectionNav')
      Expect(chrome).toContain('Label "Gear items"')
      Expect(await FS.readText(FS.resolvePath('Data.tao', generated))).toContain('order by Name')
      const scenarios = await FS.readText(FS.resolvePath('Scenarios.tao', generated))
      Expect(scenarios).toContain('NorthMarsh = create Site')
      Expect(scenarios).toContain('NorthMarsh2 = create Site')
      Expect(scenarios).toContain('Row10xScope = create GearItem')
    } finally {
      await FS.remove(root)
    }
  })
})

async function projectFilesUnder(directory: string): Promise<string[]> {
  const paths: string[] = []
  for await (const path of FS.walk(directory, { extensions: ['.tao', '.json'] })) {
    const relative = FS.relativePath(directory, path)
    if (relative.endsWith('.tao') || relative === 'tsconfig.json') {
      paths.push(relative)
    }
  }
  return paths.sort()
}
