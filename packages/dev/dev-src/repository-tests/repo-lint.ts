import { FS, HCI, Platform, Repo } from '@shared'

const TRANCHE_STATUS_PATTERN = /^\/\/ Tranche status: (open|absorbed)$/gm
const NORMALIZED_TRANCHE_STATUS = '// Tranche status: <status>'

export type WordFlowerPair = {
  currentPath: string
  currentSource: string
  label: string
  nextPath: string
  nextSource: string
}

type SourceFile = {
  path: string
  source: string
}

/** wordFlowerPairIssues checks one independent Current/Next WordFlower contract pair. */
export function wordFlowerPairIssues(pair: WordFlowerPair): string[] {
  const currentStatuses = trancheStatuses(pair.currentSource)
  const nextStatuses = trancheStatuses(pair.nextSource)
  const issues: string[] = []

  if (currentStatuses.length !== 1) {
    issues.push(`${pair.currentPath} must contain exactly one tranche status header.`)
  } else if (currentStatuses[0] !== 'absorbed') {
    issues.push(`${pair.currentPath} must remain at tranche status absorbed.`)
  }
  if (nextStatuses.length !== 1) {
    issues.push(`${pair.nextPath} must contain exactly one tranche status header.`)
  }
  if (currentStatuses.length !== 1 || nextStatuses.length !== 1) {
    return issues
  }

  const contractsMatch = normalizedTrancheSource(pair.currentSource) === normalizedTrancheSource(pair.nextSource)
  const expectedNextStatus = contractsMatch ? 'absorbed' : 'open'
  if (nextStatuses[0] !== expectedNextStatus) {
    issues.push(
      contractsMatch
        ? `${pair.nextPath} matches ${pair.currentPath} after normalizing the status header and must be absorbed.`
        : `${pair.nextPath} diverges from ${pair.currentPath} and must be open.`,
    )
  }
  if (
    contractsMatch && currentStatuses[0] === 'absorbed' && nextStatuses[0] === 'absorbed'
    && pair.currentSource !== pair.nextSource
  ) {
    issues.push(`${pair.label} must be byte-identical after absorption.`)
  }
  return issues
}

/** missingTestAppReadmeEntries returns Test App directories without an exact README heading. */
export function missingTestAppReadmeEntries(appNames: readonly string[], readme: string): string[] {
  const headings = new Set(
    [...readme.matchAll(/^## (.+?)\s*$/gm)].map(match => match[1]!),
  )
  return [...appNames].sort().filter(name => !headings.has(name))
}

/** duplicateDescribeTitleIssues finds static Describe titles reused across test files. */
export function duplicateDescribeTitleIssues(files: readonly SourceFile[]): string[] {
  const pathsByTitle = new Map<string, Set<string>>()
  for (const file of files) {
    for (
      const match of file.source.matchAll(
        /^\s*Describe\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\$]|\$(?!\{))*)`)/gm,
      )
    ) {
      const title = match[1] ?? match[2] ?? match[3]!
      const paths = pathsByTitle.get(title) ?? new Set<string>()
      paths.add(file.path)
      pathsByTitle.set(title, paths)
    }
  }
  return [...pathsByTitle]
    .filter(([, paths]) => paths.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([title, paths]) => `Describe title "${title}" is duplicated across ${[...paths].sort().join(', ')}.`)
}

/** repoLintIssues checks repository-wide contracts that do not belong to package behavior suites. */
export async function repoLintIssues(repoRoot = Repo.getRoot()): Promise<string[]> {
  const issues: string[] = []
  const pairs = await readWordFlowerPairs(repoRoot)
  for (const pair of pairs) {
    issues.push(...wordFlowerPairIssues(pair))
  }

  const testAppsPath = FS.resolvePath('Apps/Test Apps', repoRoot)
  const readmePath = FS.resolvePath('README.md', testAppsPath)
  const appNames: string[] = []
  for (const name of await FS.listDir(testAppsPath)) {
    if (!name.startsWith('.') && await FS.isDirectory(FS.resolvePath(name, testAppsPath))) {
      appNames.push(name)
    }
  }
  const missingEntries = missingTestAppReadmeEntries(appNames, await FS.readText(readmePath))
  issues.push(...missingEntries.map(name => `${readmePath} needs a \`## ${name}\` entry.`))

  const testFiles: SourceFile[] = []
  for await (
    const path of FS.walk(FS.resolvePath('packages', repoRoot), {
      excludeDirectory: name => name === 'node_modules' || name.startsWith('_gen_'),
      extensions: ['.ts'],
    })
  ) {
    if (path.endsWith('.test.ts')) {
      testFiles.push({ path: FS.relativePath(repoRoot, path), source: await FS.readText(path) })
    }
  }
  issues.push(...duplicateDescribeTitleIssues(testFiles))
  return issues
}

async function readWordFlowerPairs(repoRoot: string): Promise<WordFlowerPair[]> {
  const definitions = [
    {
      label: 'WordFlower app contract',
      currentPath: 'Apps/WordFlower/1 - Current/WordFlower.tao',
      nextPath: 'Apps/WordFlower/2 - Next/WordFlower.tao-next',
    },
    {
      label: 'WordFlower test sidecar contract',
      currentPath: 'Apps/WordFlower/1 - Current/WordFlower.test.tao',
      nextPath: 'Apps/WordFlower/2 - Next/WordFlower.test.tao-next',
    },
  ] as const
  return Promise.all(definitions.map(async definition => {
    const currentPath = FS.resolvePath(definition.currentPath, repoRoot)
    const nextPath = FS.resolvePath(definition.nextPath, repoRoot)
    return {
      currentPath: definition.currentPath,
      currentSource: await FS.readText(currentPath),
      label: definition.label,
      nextPath: definition.nextPath,
      nextSource: await FS.readText(nextPath),
    }
  }))
}

function trancheStatuses(source: string): string[] {
  return [...source.matchAll(TRANCHE_STATUS_PATTERN)].map(match => match[1]!)
}

function normalizedTrancheSource(source: string): string {
  return source.replace(TRANCHE_STATUS_PATTERN, NORMALIZED_TRANCHE_STATUS)
}

if (import.meta.main) {
  const issues = await repoLintIssues()
  for (const issue of issues) {
    HCI.writeErrorLine(`repo lint: ${issue}`)
  }
  Platform.runtimeProcess.setExitCode(issues.length === 0 ? 0 : 1)
}
