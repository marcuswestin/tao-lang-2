import { Errors, FS } from '@shared'

const HOST_TEST_SOURCE_PATTERNS = [
  'packages/testing/e2e-testing/**/*.{ts,tsx}',
  'packages/apps/runtime/TaoRuntime-src/host-testing/**/*.{ts,tsx}',
  'packages/apps/runtime/TaoRuntime-src/core/**/*.{ts,tsx}',
] as const

export type HostTestSourceExpansion = Readonly<{
  paths: readonly string[]
  patterns: readonly string[]
}>

/** Expands every registered source glob independently so a stale or misspelled scope fails closed. */
export async function expandHostTestSourcePatterns(
  repositoryRoot: string,
  patterns: readonly string[] = HOST_TEST_SOURCE_PATTERNS,
): Promise<HostTestSourceExpansion> {
  if (patterns.length === 0) {
    Errors.throwUnexpected('Host-testing source registration needs at least one pattern.')
  }
  const expanded = new Set<string>()
  for (const pattern of patterns) {
    const matches = await expandPattern(repositoryRoot, pattern)
    if (matches.length === 0) {
      Errors.throwUnexpected(`Host-testing source pattern matched no files: ${pattern}`)
    }
    for (const path of matches) {
      expanded.add(path)
    }
  }
  return { paths: [...expanded].sort(), patterns: [...patterns] }
}

async function expandPattern(repositoryRoot: string, pattern: string): Promise<string[]> {
  const root = FS.resolvePath(staticRoot(pattern), repositoryRoot)
  if (!FS.pathIsWithin(root, repositoryRoot) || !await FS.isDirectory(root)) {
    return []
  }
  const paths: string[] = []
  for await (
    const path of FS.walk(root, {
      excludeDirectory: name => name === '.artifacts' || name === 'node_modules' || name.startsWith('_gen_'),
    })
  ) {
    const relative = FS.relativePath(repositoryRoot, path)
    if (FS.matchesGlob(relative, pattern)) {
      paths.push(relative)
    }
  }
  return paths.sort()
}

function staticRoot(pattern: string): string {
  const wildcard = pattern.search(/[?*]/u)
  const prefix = wildcard === -1 ? pattern : pattern.slice(0, wildcard)
  const slash = prefix.lastIndexOf('/')
  return slash === -1 ? '.' : prefix.slice(0, slash)
}
