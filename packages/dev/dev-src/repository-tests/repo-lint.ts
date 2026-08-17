import { FS, HCI, Platform, Repo } from '@shared'

const TRANCHE_STATUS_PATTERN = /^\/\/ Tranche status: (open|absorbed)$/gm
const NORMALIZED_TRANCHE_STATUS = '// Tranche status: <status>'

export type WordFlowerDirectory = {
  currentFiles: readonly SourceFile[]
  currentPath: string
  nextFiles: readonly SourceFile[]
  nextPath: string
}

type SourceFile = {
  bytes?: Uint8Array
  path: string
  source: string
}

/** wordFlowerDirectoryIssues checks the recursive Current/Next WordFlower contract. */
export function wordFlowerDirectoryIssues(directory: WordFlowerDirectory): string[] {
  const currentStatuses = directoryTrancheStatuses(directory.currentFiles)
  const nextStatuses = directoryTrancheStatuses(directory.nextFiles)
  const issues: string[] = []

  if (currentStatuses.length !== 1) {
    issues.push(`${directory.currentPath} must contain exactly one tranche status header across the directory.`)
  } else if (currentStatuses[0] !== 'absorbed') {
    issues.push(`${directory.currentPath} must remain at tranche status absorbed.`)
  }
  if (nextStatuses.length !== 1) {
    issues.push(`${directory.nextPath} must contain exactly one tranche status header across the directory.`)
  }
  if (currentStatuses.length !== 1 || nextStatuses.length !== 1) {
    return issues
  }

  const contractsMatch = mappedDirectoriesMatch(directory.currentFiles, directory.nextFiles)
  const expectedNextStatus = contractsMatch ? 'absorbed' : 'open'
  if (nextStatuses[0] !== expectedNextStatus) {
    issues.push(
      contractsMatch
        ? `${directory.nextPath} matches ${directory.currentPath} after mapping .tao-next files and normalizing the directory status and must be absorbed.`
        : `${directory.nextPath} diverges from ${directory.currentPath} after mapping .tao-next files and must be open.`,
    )
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
  issues.push(...wordFlowerDirectoryIssues(await readWordFlowerDirectory(repoRoot)))

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

async function readWordFlowerDirectory(repoRoot: string): Promise<WordFlowerDirectory> {
  const currentPath = 'Apps/WordFlower/1 - Current'
  const nextPath = 'Apps/WordFlower/2 - Next'
  return {
    currentFiles: await readDirectoryFiles(FS.resolvePath(currentPath, repoRoot)),
    currentPath,
    nextFiles: await readDirectoryFiles(FS.resolvePath(nextPath, repoRoot)),
    nextPath,
  }
}

async function readDirectoryFiles(directoryPath: string): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  for await (const path of FS.walk(directoryPath, { includeHidden: true })) {
    const bytes = await FS.readFile(path)
    files.push({
      bytes,
      path: FS.relativePath(directoryPath, path),
      source: Buffer.from(bytes).toString('utf8'),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function directoryTrancheStatuses(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => trancheStatuses(file.source))
}

function mappedDirectoriesMatch(
  currentFiles: readonly SourceFile[],
  nextFiles: readonly SourceFile[],
): boolean {
  const current = normalizedDirectoryFiles(currentFiles, false)
  const next = normalizedDirectoryFiles(nextFiles, true)
  return current.length === next.length && current.every((file, index) => {
    const nextFile = next[index]!
    return file.path === nextFile.path && Buffer.from(file.bytes).equals(Buffer.from(nextFile.bytes))
  })
}

function normalizedDirectoryFiles(
  files: readonly SourceFile[],
  mapNextExtension: boolean,
): Array<{ bytes: Uint8Array; path: string }> {
  return files
    .map(file => ({
      bytes: normalizedTrancheBytes(file.bytes ?? Buffer.from(file.source, 'utf8')),
      path: mapNextExtension ? file.path.replace(/\.tao-next$/, '.tao') : file.path,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function trancheStatuses(source: string): string[] {
  return [...source.matchAll(TRANCHE_STATUS_PATTERN)].map(match => match[1]!)
}

function normalizedTrancheSource(source: string): string {
  return source.replace(TRANCHE_STATUS_PATTERN, NORMALIZED_TRANCHE_STATUS)
}

/** Preserve every non-status byte, including input that is not valid UTF-8. */
function normalizedTrancheBytes(bytes: Uint8Array): Uint8Array {
  const bytePreservingSource = Buffer.from(bytes).toString('latin1')
  return Buffer.from(normalizedTrancheSource(bytePreservingSource), 'latin1')
}

if (import.meta.main) {
  const issues = await repoLintIssues()
  for (const issue of issues) {
    HCI.writeErrorLine(`repo lint: ${issue}`)
  }
  Platform.runtimeProcess.setExitCode(issues.length === 0 ? 0 : 1)
}
