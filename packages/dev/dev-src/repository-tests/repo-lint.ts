import { FS, HCI, Platform, Repo } from '@shared'

const TRANCHE_STATUS_PATTERN = /^\/\/ Tranche status: (open|absorbed)$/gm

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

/** wordFlowerDirectoryIssues checks status headers and enforces mapped byte parity at absorption. */
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
  } else if (nextStatuses[0] === 'absorbed') {
    issues.push(...wordFlowerAbsorbedParityIssues(directory))
  }
  return issues
}

function wordFlowerAbsorbedParityIssues(directory: WordFlowerDirectory): string[] {
  const current = new Map(directory.currentFiles.map(file => [file.path, file]))
  const next = new Map(directory.nextFiles.map(file => [currentWordFlowerPath(file.path), file]))
  const paths = [...new Set([...current.keys(), ...next.keys()])].sort()
  return paths.flatMap(path => {
    const currentFile = current.get(path)
    const nextFile = next.get(path)
    if (currentFile === undefined) {
      return [`${directory.nextPath} is absorbed but ${path} is missing from ${directory.currentPath}.`]
    }
    if (nextFile === undefined) {
      return [`${directory.nextPath} is absorbed but ${path} is missing from its mapped files.`]
    }
    return Buffer.from(normalizedWordFlowerBytes(currentFile)).equals(normalizedWordFlowerBytes(nextFile))
      ? []
      : [`${directory.nextPath} is absorbed but ${path} differs from ${directory.currentPath}.`]
  })
}

function currentWordFlowerPath(path: string): string {
  return path.endsWith('.tao-next') ? path.slice(0, -'-next'.length) : path
}

function normalizedWordFlowerBytes(file: SourceFile): Uint8Array {
  const bytes = file.bytes ?? Buffer.from(file.source)
  const binary = Buffer.from(bytes).toString('latin1')
  return Buffer.from(
    binary.replace(
      /^\/\/ Tranche status: (?:open|absorbed)$/gm,
      '// Tranche status: normalized',
    ),
    'latin1',
  )
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

function trancheStatuses(source: string): string[] {
  return [...source.matchAll(TRANCHE_STATUS_PATTERN)].map(match => match[1]!)
}

if (import.meta.main) {
  const issues = await repoLintIssues()
  for (const issue of issues) {
    HCI.writeErrorLine(`repo lint: ${issue}`)
  }
  Platform.runtimeProcess.setExitCode(issues.length === 0 ? 0 : 1)
}
