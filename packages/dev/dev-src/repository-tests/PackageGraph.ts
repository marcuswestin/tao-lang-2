import { FS, Repo } from '@shared'

/**
 * Which workspace package imports which. The changed-files lane needs this to know that a change
 * in `shared` reaches every suite while a change in `studio` reaches only Studio's own tests.
 *
 * The graph is read from the import statements themselves, not from `package.json`: seven
 * packages import a workspace package their manifest does not declare, and Bun's own `--changed`
 * selection stops at the package boundary, so neither is a sound source for "who depends on this".
 * The alias-to-package mapping is the one `packages/tsconfig.base.json` already owns.
 */

export type PackageGraph = {
  /** Package directory name to the package directory names it imports directly. */
  imports: ReadonlyMap<string, ReadonlySet<string>>
  packages: readonly string[]
}

/** AffectedPackage says why a package is in the affected set: its own change, or one it imports. */
export type AffectedPackage = {
  package: string
  reason: string
}

type TsconfigPaths = { compilerOptions?: { paths?: Record<string, readonly string[]> } }

const IMPORT_PATTERN = /\b(?:from|import|require)\s*\(?\s*['"](@[^'"]+)['"]/g
const PACKAGES_DIRECTORY = 'packages'
const TSCONFIG_BASE = 'packages/tsconfig.base.json'

/** load scans every package's TypeScript for workspace alias imports and returns the graph. */
async function load(repositoryRoot = Repo.getRoot()): Promise<PackageGraph> {
  const packagesRoot = FS.resolvePath(PACKAGES_DIRECTORY, repositoryRoot)
  const packages = await packageDirectories(packagesRoot)
  const owners = await aliasOwners(repositoryRoot, packages)
  const imports = new Map<string, ReadonlySet<string>>()
  await Promise.all(packages.map(async name => {
    imports.set(name, await importedPackages(FS.resolvePath(name, packagesRoot), name, owners))
  }))
  return { imports, packages }
}

async function packageDirectories(packagesRoot: string): Promise<string[]> {
  const names: string[] = []
  for (const name of await FS.listDir(packagesRoot)) {
    if (await FS.isFile(FS.resolvePath(`${name}/package.json`, packagesRoot))) {
      names.push(name)
    }
  }
  return names.sort()
}

/** aliasOwners maps every tsconfig path alias, without its `/*` suffix, to the package it points into. */
async function aliasOwners(repositoryRoot: string, packages: readonly string[]): Promise<Map<string, string>> {
  const tsconfig = await FS.readJson<TsconfigPaths>(FS.resolvePath(TSCONFIG_BASE, repositoryRoot))
  const owners = new Map<string, string>()
  for (const [alias, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
    const owner = targets[0]?.replace(/^\.\//, '').split('/')[0]
    if (owner !== undefined && packages.includes(owner)) {
      owners.set(alias.replace(/\/\*$/, ''), owner)
    }
  }
  return owners
}

async function importedPackages(
  packageRoot: string,
  self: string,
  owners: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const imported = new Set<string>()
  const files = await Repo.filesUnder(packageRoot, { extensions: ['.ts', '.tsx'] })
  await Promise.all(files.map(async file => {
    const source = await FS.readText(file)
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const owner = ownerOf(match[1] ?? '', owners)
      if (owner !== undefined && owner !== self) {
        imported.add(owner)
      }
    }
  }))
  return imported
}

/** ownerOf resolves a specifier to its alias owner, trying the longest alias first. */
function ownerOf(specifier: string, owners: ReadonlyMap<string, string>): string | undefined {
  const segments = specifier.split('/')
  for (let length = segments.length; length > 0; length -= 1) {
    const owner = owners.get(segments.slice(0, length).join('/'))
    if (owner !== undefined) {
      return owner
    }
  }
  return undefined
}

/**
 * affected returns the changed packages and every package that imports one of them, directly or
 * through others, each with the one-line reason a selection summary prints. The order is
 * nearest-first: the changed packages, then their importers, then theirs.
 */
function affected(graph: PackageGraph, changed: Iterable<string>): AffectedPackage[] {
  const reasons = new Map<string, string>()
  const queue: string[] = []
  for (const name of changed) {
    if (!reasons.has(name)) {
      reasons.set(name, 'changed directly')
      queue.push(name)
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const [dependent, imports] of graph.imports) {
      if (imports.has(current) && !reasons.has(dependent)) {
        reasons.set(dependent, `imports ${current}`)
        queue.push(dependent)
      }
    }
  }
  return [...reasons].map(([name, reason]) => ({ package: name, reason }))
}

/** PackageGraph owns the workspace import graph the changed-files lane selects suites from. */
export const PackageGraph = { affected, load } as const
