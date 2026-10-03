import Workspace from '@compiler/workspace'
import { Errors, FS, Platform, ProjectLocal, Repo } from '@shared'
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
      await updateStarterFiles(generated, checkedIn)
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

/** updateStarterFiles publishes authored files without traversing an installed dependency tree. */
export async function updateStarterFiles(generated: string, checkedIn: string): Promise<void> {
  const boundary = Repo.resolvePath('.')
  await ProjectLocal.prepare(generated)
  await ProjectLocal.prepare(checkedIn)
  await FS.withFileMutationLock(checkedIn, boundary, async () => {
    const sources = await checkedProjectFiles(generated, boundary, false)
    const targets = await checkedProjectFiles(checkedIn, boundary, true)
    for (const relativePath of sources) {
      const source = FS.resolvePath(relativePath, generated)
      const target = FS.resolvePath(relativePath, checkedIn)
      await FS.mkdirWithinBoundary(FS.dirname(target), boundary)
      if (await FS.isSymbolicLink(target)) {
        Errors.throwUnexpected(`Refusing to update a starter symbolic link: ${target}`)
      }
      await FS.copyFile(source, target)
    }
    const wanted = new Set(sources)
    for (const relativePath of targets) {
      if (!wanted.has(relativePath)) {
        await FS.removeFileWithinBoundary(FS.resolvePath(relativePath, checkedIn), boundary)
      }
    }
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', checkedIn) })
}

async function checkedProjectFiles(
  directory: string,
  boundary: string,
  preserveDependencies: boolean,
): Promise<string[]> {
  if (!FS.pathIsWithin(directory, boundary)) {
    Errors.throwUnexpected(`Starter path is outside the repository: ${directory}`)
  }
  let ancestor = directory
  while (true) {
    if ((await FS.entryMetadata(ancestor)).kind !== 'directory') {
      Errors.throwUnexpected(`Starter directory is not an ordinary directory: ${ancestor}`)
    }
    if (ancestor === boundary) {
      break
    }
    ancestor = FS.dirname(ancestor)
  }
  const files: string[] = []
  for await (
    const path of FS.walk(directory, {
      excludeDirectory: name => name === 'node_modules' || name === '.tao',
      includeDirectories: true,
      includeHidden: true,
    })
  ) {
    if (FS.basename(path) === 'node_modules') {
      if (preserveDependencies) {
        continue
      }
      Errors.throwUnexpected(`Generated starter contains dependencies: ${path}`)
    }
    const kind = (await FS.entryMetadata(path)).kind
    if (kind !== 'directory' && kind !== 'file') {
      Errors.throwUnexpected(`Starter project entry is not an ordinary file or directory: ${path}`)
    }
    if (kind === 'file') {
      files.push(FS.relativePath(directory, path))
    }
  }
  const taoRoot = ProjectLocal.root(directory)
  const storeRoot = ProjectLocal.storeResolve('', directory)
  const ignorePath = FS.resolvePath('.gitignore', taoRoot)
  for (const path of [taoRoot, storeRoot]) {
    if ((await FS.entryMetadata(path)).kind !== 'directory') {
      Errors.throwUnexpected(`Starter project entry is not an ordinary directory: ${path}`)
    }
  }
  if ((await FS.entryMetadata(ignorePath)).kind !== 'file') {
    Errors.throwUnexpected(`Starter project entry is not an ordinary file: ${ignorePath}`)
  }
  files.push(FS.relativePath(directory, ignorePath))
  for await (const path of FS.walk(storeRoot, { includeDirectories: true, includeHidden: true })) {
    const kind = (await FS.entryMetadata(path)).kind
    if (kind !== 'directory' && kind !== 'file') {
      Errors.throwUnexpected(`Starter project entry is not an ordinary file or directory: ${path}`)
    }
    if (kind === 'file') {
      files.push(FS.relativePath(directory, path))
    }
  }
  return files.sort()
}

/** Compare authored files, committed `.tao/store`, and `.tao/.gitignore` without local state or caches. */
async function projectFilesUnder(directory: string): Promise<string[]> {
  return await checkedProjectFiles(directory, Repo.resolvePath('.'), true)
}
