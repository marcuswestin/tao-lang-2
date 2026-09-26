import Workspace from '@compiler/workspace'
import { Errors, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir } from '@shared/test'
import { installTaoSkills } from 'tao-skills'
import { lowerCreationPlan, writeCreationFiles } from '../cli-src/create/creation-lowering'
import { validateCreationPlan } from '../cli-src/create/creation-plan'
import { starterPlans } from '../cli-src/create/starter-plans'
import { runFix } from '../cli-src/source-commands'

/**
 * The two decided design deprecations (Docs/Roadmap/Tao Revolution/Decisions.md, 2026-09-22): a
 * legacy `bg`/`fg` visual head, and a flat pre-typed-block catalog entry. `tao create` writes only
 * the decided `background`/`ink` spelling inside typed `colors {}`/`styles {}` blocks, so a starter
 * design must trip neither warning.
 */
const DESIGN_DEPRECATION_CODES = ['design-check-legacy-visual-head', 'design-check-flat-catalog']

/** Set TAO_UPDATE_STARTERS=1 to rewrite `Apps/Starters` from the reference plans instead of comparing. */
const UPDATE_STARTERS = Platform.runtimeProcess.env['TAO_UPDATE_STARTERS'] === '1'

/**
 * Starter directories that have their own `creation-starter-<name>.test.ts`. A test file is the
 * shard atom, so each starter gets its own file and the shards run them side by side instead of
 * serially inside one file. `expectStarterReproducedFromItsPlan` checks this list against
 * `starterPlans`, which is what a single loop over the plans used to give for free: a new starter
 * without its own file fails every starter test until the file exists.
 */
const STARTERS_WITH_OWN_TEST_FILE: readonly string[] = ['Notebook', 'Pantry']

/**
 * expectStarterReproducedFromItsPlan lowers one starter's reference plan into a temporary directory,
 * formats it the way `tao create` does, and compares the result against the checked-in
 * `Apps/Starters/<directory>` file list and file contents, byte for byte.
 */
export async function expectStarterReproducedFromItsPlan(directory: string): Promise<void> {
  Expect([...starterPlans].map(starter => starter.directory).sort()).toEqual([...STARTERS_WITH_OWN_TEST_FILE].sort())
  const starter = starterPlans.find(candidate => candidate.directory === directory)
    ?? Errors.throwUnexpected(`No starter plan named ${directory}.`)

  Expect(validateCreationPlan(starter.plan)).toEqual([])
  const root = await mkTestDir('tao-create-lowering-')
  try {
    const generated = FS.resolvePath(starter.directory, root)
    await writeCreationFiles(generated, lowerCreationPlan(starter.plan, { description: starter.description }))
    await installTaoSkills(generated)
    await runFix(generated, { cwd: root })

    const workspace = await Workspace.open(generated)
    const validated = await workspace.validate(FS.resolvePath('App.tao', generated))
    Expect(
      validated.diagnostics.filter(diagnostic => DESIGN_DEPRECATION_CODES.includes(diagnostic.code ?? '')),
    ).toEqual([])

    const checkedIn = Repo.resolvePath(`Apps/Starters/${starter.directory}`)
    if (UPDATE_STARTERS) {
      await FS.synchronizeDirectoryFiles(generated, checkedIn)
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
}

/** projectFilesUnder lists the project files a starter comparison covers, in a stable order. */
async function projectFilesUnder(directory: string): Promise<string[]> {
  const paths: string[] = []
  for await (
    const path of FS.walk(directory, {
      excludeDirectory: name => name === 'node_modules',
      includeHidden: true,
    })
  ) {
    paths.push(FS.relativePath(directory, path))
  }
  return paths.sort()
}
