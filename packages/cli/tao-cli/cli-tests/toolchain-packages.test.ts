import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { VERDICT_IRRELEVANT_GROUPS, verdictPackageFiles } from '../cli-src/toolchain-packages'

/**
 * Leaving a group out of the toolchain identity is a promise that nothing a verdict depends on can
 * reach it. Broken, the promise is a stale green: an edit that changes what `tao check` reports, or
 * what an app compiles to, while every memo keyed on the old identity still matches. These tests are
 * the proof of that promise, so they are written against the real manifests on disk rather than a
 * fixture — a fixture would keep agreeing after the repository stopped.
 */

type Packages = {
  /** Workspace package name to the first folder under `packages/` that holds it. */
  groupOf: Map<string, string>
  /** Workspace package name to the workspace dependencies it declares. */
  dependenciesOf: Map<string, string[]>
}

async function readPackages(): Promise<Packages> {
  const root = Repo.getRoot()
  const packagesRoot = FS.resolvePath('packages', root)
  const groupOf = new Map<string, string>()
  const dependenciesOf = new Map<string, string[]>()
  for (const manifest of await Repo.filesUnder(packagesRoot)) {
    if (FS.basename(manifest) !== 'package.json') {
      continue
    }
    const relative = FS.relativePath(packagesRoot, manifest)
    const segments = relative.split('/')
    // Depth one is a package directly under `packages/`; depth two is a package inside a group.
    // Anything deeper is a nested manifest, such as a fixture's, and names no workspace package.
    if (segments.length > 3) {
      continue
    }
    const parsed = await Bun.file(manifest).json() as { dependencies?: Record<string, string>; name?: string }
    if (parsed.name === undefined) {
      continue
    }
    // The same reading the file filter uses: the first folder under `packages/`, whether the
    // package sits inside a group or directly under it. `packages/dev` is its own first folder, so
    // naming `dev` excludes it exactly as naming `testing` excludes the group of that name.
    groupOf.set(parsed.name, segments[0] as string)
    dependenciesOf.set(
      parsed.name,
      Object.entries(parsed.dependencies ?? {}).filter(([, range]) => range.startsWith('workspace:')).map(([name]) =>
        name
      ),
    )
  }
  return { dependenciesOf, groupOf }
}

/**
 * The one declared edge from a verdict-relevant package into an excluded group. `tao-cli` depends on
 * `tao-dev` for a single lazily imported command, which runs no part of a check or a compile. The
 * test below pins that it stays single and stays lazy; a second import, or a top-level one, means
 * the CLI now loads the developer tooling on every run and the exclusion no longer holds.
 */
const ALLOWED_EDGE = { from: 'tao-cli', to: 'tao-dev' } as const

Describe('the package groups left out of the toolchain identity', () => {
  // Direct edges from every verdict-relevant package, which is the whole closure question: a path
  // from one of them into an excluded group has to cross the boundary somewhere, and its first
  // crossing edge starts at a verdict-relevant package. Walking transitively would ask the same
  // thing more slowly.
  Test('are unreachable from every package a verdict depends on', async () => {
    const packages = await readPackages()
    const excluded = new Set(VERDICT_IRRELEVANT_GROUPS)
    const isExcluded = (name: string) => excluded.has(packages.groupOf.get(name) ?? '')
    const verdictPackages = [...packages.groupOf.keys()].filter(name => !isExcluded(name))
    Expect(verdictPackages.length).toBeGreaterThan(5)

    const violations: string[] = []
    for (const name of verdictPackages) {
      for (const dependency of packages.dependenciesOf.get(name) ?? []) {
        if (isExcluded(dependency) && !(name === ALLOWED_EDGE.from && dependency === ALLOWED_EDGE.to)) {
          violations.push(`${name} -> ${dependency}`)
        }
      }
    }

    Expect(violations).toEqual([])
  })

  // Stated separately from the edge walk above, because this is the half that walking manifests
  // cannot settle: the edge is allowed only for as long as nothing on the verdict path follows it.
  Test('are reached from the CLI only by one lazy import, outside any check or compile', async () => {
    const sourceRoot = FS.resolvePath('packages/cli/tao-cli/cli-src', Repo.getRoot())
    const references: string[] = []
    for (const path of await Repo.filesUnder(sourceRoot)) {
      if (!path.endsWith('.ts')) {
        continue
      }
      const source = await FS.readText(path)
      for (const [index, line] of source.split('\n').entries()) {
        if (line.includes('tao-dev') || line.includes('tao-studio') || line.includes('tao-e2e-testing')) {
          references.push(`${FS.relativePath(sourceRoot, path)}:${index + 1} ${line.trim()}`)
        }
      }
    }

    Expect(references).toHaveLength(1)
    // Lazy: inside an action, so nothing outside `studio-review` loads it. A bare `import ... from`
    // at the top of a module would be the regression this catches.
    Expect(references[0]).toContain("await import('tao-dev/studio-review')")
  })

  Test('leaves out exactly the named groups and keeps everything else', async () => {
    const packagesRoot = FS.resolvePath('packages', Repo.getRoot())
    const files = await verdictPackageFiles(packagesRoot)
    const groups = new Set(files.map(path => FS.relativePath(packagesRoot, path).split('/')[0]))

    for (const group of VERDICT_IRRELEVANT_GROUPS) {
      Expect(groups.has(group)).toBe(false)
    }
    // The groups a verdict genuinely depends on are still hashed, which is the half of this that
    // keeps the cache honest rather than merely fast.
    Expect(groups.has('language')).toBe(true)
    Expect(groups.has('compiler')).toBe(true)
    Expect(groups.has('apps')).toBe(true)
    Expect(groups.has('shared')).toBe(true)
    // A denylist, so a group nobody has thought about is hashed rather than skipped.
    Expect(groups.has('cli')).toBe(true)
  })
})
