import Workspace from '@compiler/workspace'
import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { lowerCreationPlan, writeCreationFiles } from '../cli-src/create/creation-lowering'
import { type CreationPlan, validateCreationPlan } from '../cli-src/create/creation-plan'
import { runFix } from '../cli-src/source-commands'

// The byte-for-byte starter reproductions live in `creation-starter-<name>.test.ts`, one file per
// starter, over the shared helper in `test-starter-lowering.ts`. A test file is the shard atom, so
// keeping them here would pin them to this test's shard and run all three serially.

Describe('tao create lowering', () => {
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
        GearItems: [
          { Label: 'Binoculars', Packed: true },
          { Label: '10x scope', Spare: true },
          { Label: '10x-scope' },
          { Label: 'Notebook' },
        ],
      },
    }
    Expect(validateCreationPlan(plan)).toEqual([])
    const files = lowerCreationPlan(plan)
    Expect(files['.tao/.gitkeep']).toBeUndefined()
    Expect(files['.gitignore']).toBe([
      '# Operating system and editor files',
      '.DS_Store',
      '.idea/',
      '.vscode/',
      '',
      '# Tao generated sidecars',
      '*.tao.ts',
      '/.tao-ts/',
      '',
      '# Tao local state and cache',
      '/.tao/local/',
      '/.tao/cache/',
      '',
      '# Tooling output',
      'node_modules/',
      '.expo/',
      '*.tsbuildinfo',
      '*.log',
      '',
      '# Plain-text secrets',
      '.env',
      '.env.*',
      '',
    ].join('\n'))

    const root = await mkTestDir('tao-create-lowering-')
    try {
      const generated = FS.resolvePath('field-notes', root)
      await writeCreationFiles(generated, files)
      Expect((await FS.listDir(FS.resolvePath('.tao', generated))).toSorted())
        .toEqual(['.gitignore', 'cache', 'local', 'store'])
      await ProjectIdentity.ensure(generated)
      await runFix(generated, { cwd: root })
      const workspace = await Workspace.open(generated)
      const problems: string[] = []
      for (const entry of ['App.tao', 'Scenarios.tao', 'FieldNotes.test.tao']) {
        const result = await workspace.validate(FS.resolvePath(entry, generated))
        problems.push(
          ...result.diagnostics.filter(diagnostic =>
            diagnostic.severity === 'error' || diagnostic.message.includes("Style property 'gap' is already present")
          ).map(d => `${entry}: ${d.message}`),
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
      Expect(scenarios).toContain('Row10xScope2 = create GearItem')
    } finally {
      await FS.remove(root)
    }
    // A hang guard, not a budget: this lowers a whole project and validates it, and the repository
    // test lane now runs every suite's shards beside each other, so a healthy run of it can wait
    // longer than the old bound before it gets the machine.
  }, 60_000)
})
