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
  const current = new Map(directory.currentFiles.filter(isWordFlowerParityFile).map(file => [file.path, file]))
  const next = new Map(
    directory.nextFiles.filter(isWordFlowerParityFile).map(file => [currentWordFlowerPath(file.path), file]),
  )
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

function isWordFlowerParityFile(file: SourceFile): boolean {
  return file.path !== '.tao-project/lock.jsonc'
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

/** justRecipeIssues keeps the language benchmark out of correctness gates without spawning nested Just processes. */
export function justRecipeIssues(source: string): string[] {
  const recipes = justRecipeDefinitions(source)
  const variables = justVariables(source)
  const issues: string[] = []
  const benchmark = recipes.get('bench')
  if (benchmark === undefined || !benchmark.includes('language-performance.ts')) {
    issues.push("Justfile recipe 'bench' must run the language performance benchmark.")
  }
  for (const lane of ['check', 'verify', 'full-verify']) {
    if (!recipes.has(lane)) {
      issues.push(`Justfile must declare recipe '${lane}'.`)
      continue
    }
    const closure = justRecipeClosure(lane, recipes, variables)
    if (/\blanguage-performance(?:\.ts)?\b|\bbench\b/.test(closure)) {
      issues.push(`Justfile recipe '${lane}' must not invoke the language performance benchmark.`)
    }
  }
  return issues
}

function justRecipeDefinitions(source: string): Map<string, string> {
  const lines = source.split('\n')
  const recipes = new Map<string, string>()
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]!.match(/^([a-z_][a-z0-9_-]*)(?:\s+[^:]*)?:/i)
    if (match === null || /^[A-Z0-9_]+$/.test(match[1]!)) {
      continue
    }
    const body = [lines[index]!]
    while (index + 1 < lines.length && /^\s/.test(lines[index + 1]!)) {
      body.push(lines[++index]!)
    }
    recipes.set(match[1]!, body.filter(line => !line.trimStart().startsWith('#')).join('\n'))
  }
  return recipes
}

function justVariables(source: string): ReadonlyMap<string, string> {
  return new Map([...source.matchAll(/^([A-Z][A-Z0-9_]*)\s*:=\s*(.*)$/gm)].map(match => [match[1]!, match[2]!]))
}

function justRecipeClosure(
  name: string,
  recipes: ReadonlyMap<string, string>,
  variables: ReadonlyMap<string, string>,
  visited = new Set<string>(),
): string {
  if (visited.has(name)) {
    return ''
  }
  visited.add(name)
  const definition = recipes.get(name) ?? ''
  const expanded = definition.replace(
    /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g,
    (_, variable: string) => variables.get(variable) ?? '',
  )
  const referenced = [...expanded.matchAll(/\b([a-z_][a-z0-9_-]*)\b/gi)]
    .map(match => match[1]!)
    .filter(recipe => recipes.has(recipe))
  return [expanded, ...referenced.map(recipe => justRecipeClosure(recipe, recipes, variables, visited))].join('\n')
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

/*
 * Package-source conventions. Each convention is near-perfectly held today, so each allowlist names
 * the remaining exceptions and what closes them. An allowlisted file that is scanned and no longer
 * breaks its convention is reported as stale so the exemption gets dropped with the work that fixed
 * it; an allowlisted file that is not scanned at all stays silent.
 */

/** Studio kind dispatches that predate the shared `Switch` helper; convert them to close this list. */
const NATIVE_SWITCH_ALLOWLIST = [
  'packages/studio/studio-src/StudioProductHostProtocol.ts',
]

/**
 * `Test-Bun.ts` is the sanctioned home for `bun:test`. The two runtime tests close with the shared
 * `MockModule` helper planned in "Repository simplification" 2.6.
 */
const BUN_TEST_IMPORT_ALLOWLIST = [
  'packages/shared/shared-src/testing/Test-Bun.ts',
  // Both close with plan item 2.6, when they adopt `MockModule` and `reactNativeStubs`.
  'packages/runtime/TR-tests/TR-selectable-loop.test.ts',
  'packages/runtime/TR-tests/TR-views.test.ts',
]

/** Langium stays behind the parser package; every other package consumes `AST` from `@parser`. */
const LANGIUM_PARSER_PREFIX = 'packages/parser/'

/**
 * Relative escapes into another package's source. Both close with the "Repository simplification"
 * Part 5 deep-import cleanup, which promotes each target into a public package entry.
 */
const CROSS_PACKAGE_SOURCE_IMPORT_ALLOWLIST = [
  'packages/dev/dev-src/studio/StudioPackagedTestCommand.ts',
  'packages/runtime-toolchain/runtime-toolchain-tests/studio-scenario-e2e.jest-test.tsx',
]

/*
 * Raw `Error` throws that predate Tao's error taxonomy. Unlike the other convention lists this one
 * is a ratchet rather than a near-empty exception set: it names every file that still throws a raw
 * `Error` today, and a package's entries go stale — and must be deleted — as that package is swept
 * onto `Assert` and `Errors`. `packages/shared` is deliberately absent; it was swept first and must
 * stay clean. `packages/runtime` imports nothing from `@shared` by design, so its entries are
 * swept against `TR-assert.ts`, which mirrors the shared `Assert` the way `TR-switch.ts` already
 * mirrors the shared `Switch`.
 *
 * An entry can also survive its package's sweep, and the surviving ones all name a file whose throw
 * is emitted text rather than this repository's own program: a `<script>` body or a string evaluated
 * in a browser page, where no Tao module is loaded at all. Generated app code is no longer such a
 * case — it reaches the taxonomy through `TR.Errors`. Each surviving site states its reason where it
 * is written, so read the file before deleting its entry.
 */
const RAW_THROW_ALLOWLIST = [
  'packages/dev/dev-src/studio/StudioCdp.ts',
  'packages/dev/dev-src/studio/StudioElectrobun.ts',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts',
  'packages/studio/studio-src/StudioWelcome.ts',
]

/*
 * The pattern and its message are written so this rule never matches its own source: the pattern
 * spells the throw with escapes, and the message says "throws a raw `Error`" rather than quoting
 * the construct it forbids.
 */
/**
 * The three leaf modules construct the classes because they are the helpers everyone else calls;
 * everywhere else a Tao error is thrown through `Errors.throw*`, which returns `never` and narrows.
 * `packages/runtime` keeps its own `TR-errors` vocabulary and is outside this rule.
 */
const CONSTRUCTED_THROW_ALLOWLIST = [
  'packages/shared/shared-src/core/Assert.ts',
  'packages/shared/shared-src/core/Errors.ts',
  'packages/shared/shared-src/core/Switch_TypeSafe.ts',
]

const CONSTRUCTED_THROW_DETAIL = 'constructs a Tao error only to throw it; call `Errors.throwUserInput(...)`,'
  + ' `Errors.throwUnexpected(...)`, or `Errors.throwHostEnvironment(...)` instead, which also narrow control flow.'

const RAW_THROW_DETAIL = 'throws a raw `Error`; use `Assert(...)` for invariants, `Assert.input(...)`'
  + " or `Errors.throwUserInput(...)` for the author's mistakes, and `Errors.throwHostEnvironment(...)`"
  + ' for host and environment failures.'

/**
 * A raw `Error` handed to a promise rejection reaches a reader exactly as a thrown one does, but the
 * throw rule cannot see it. This is its own ratchet so the two lists stay legible: the entries here
 * are the sites that predate the taxonomy, not an exemption for new ones.
 */
const REJECTED_RAW_ERROR_ALLOWLIST = [
  'packages/code-editor/code-editor-src/CodeEditor.tsx',
  'packages/dev/dev-src/studio/StudioCdp.ts',
  'packages/dev/dev-src/studio/StudioTestProcessRunner.ts',
  'packages/generation/generation-live/apple-foundation-models.live.ts',
  'packages/generation/generation-src/apple-foundation-models-service.ts',
  'packages/runtime-toolchain/runtime-toolchain-src/testing/test-compiler/Worker.ts',
  'packages/runtime/TR-tests/TR-data.test.ts',
  'packages/shared/shared-tests/test-helpers.test.ts',
  'packages/stdlib/@tao/data/providers/instantdb/InstantDB.ts',
  'packages/studio/studio-src/client/StudioApiClient.ts',
  'packages/studio/studio-src/client/StudioMatrixView.ts',
  'packages/studio/studio-tests/studio-client.test.ts',
]

const REJECTED_RAW_ERROR_DETAIL = 'rejects with a raw `Error`; reach for the same taxonomy a throw'
  + ' would use, since a rejection reaches the reader the same way.'

const NATIVE_SWITCH_PATTERN = /^[ \t]*switch[ \t]*\(/gm
const CONSTRUCTED_THROW_PATTERN =
  /\bthrow\s+new\s+(?:Errors\.)?(?:UserInput|UnexpectedBehavior|HostEnvironment)Error\s*\(/g
const RAW_THROW_PATTERN = /\bthrow\s+new\s+Error\s*\(/g
const REJECTED_RAW_ERROR_PATTERN = /(?:reject|rejectPendingLoad|fail)\??\.?\(?\s*\(?\s*new\s+Error\s*\(/g
const BUN_TEST_IMPORT_PATTERN = /\bfrom\s*['"]bun:test['"]/g
const LANGIUM_IMPORT_PATTERN = /\bfrom\s*['"]langium(?:\/[^'"]*)?['"]/g
const RELATIVE_IMPORT_PATTERN = /\bfrom\s*['"](\.{1,2}\/[^'"]*)['"]/g
const PACKAGE_SOURCE_DIRECTORY_PATTERN = /(?:^|\/)[^/]*-src\//

type ConventionMatch = {
  detail: string
  line: number
  path: string
}

/** ConventionRule is one pattern-and-allowlist convention over package source. */
export type ConventionRule = {
  allowlist: readonly string[]
  detail: string
  /** Path prefixes the rule does not apply to at all, as opposed to files still allowed an exception. */
  excludePathPrefixes?: readonly string[]
  pattern: RegExp
  staleDetail: string
}

/**
 * CONVENTION_RULES is the table `repoLintIssues` walks. Adding a convention is one entry here: the
 * pattern, what an offending line is told, the files still allowed one, and what a stale allowlist
 * entry is told.
 */
export const CONVENTION_RULES = {
  constructedThrow: {
    allowlist: CONSTRUCTED_THROW_ALLOWLIST,
    detail: CONSTRUCTED_THROW_DETAIL,
    excludePathPrefixes: ['packages/runtime/'],
    pattern: CONSTRUCTED_THROW_PATTERN,
    staleDetail: 'no longer constructs a Tao error to throw it; drop its repo lint allowlist entry.',
  },
  bunTestImport: {
    allowlist: BUN_TEST_IMPORT_ALLOWLIST,
    detail: 'imports `bun:test`; use `@shared/test` instead.',
    pattern: BUN_TEST_IMPORT_PATTERN,
    staleDetail: 'no longer imports `bun:test`; drop its repo lint allowlist entry.',
  },
  nativeSwitch: {
    allowlist: NATIVE_SWITCH_ALLOWLIST,
    detail: 'uses a native `switch`; dispatch with `Switch` from `@shared` instead.',
    pattern: NATIVE_SWITCH_PATTERN,
    staleDetail: 'no longer uses a native `switch`; drop its repo lint allowlist entry.',
  },
  rawThrow: {
    allowlist: RAW_THROW_ALLOWLIST,
    detail: RAW_THROW_DETAIL,
    pattern: RAW_THROW_PATTERN,
    staleDetail: 'no longer throws a raw `Error`; drop its repo lint allowlist entry.',
  },
  rejectedRawError: {
    allowlist: REJECTED_RAW_ERROR_ALLOWLIST,
    detail: REJECTED_RAW_ERROR_DETAIL,
    pattern: REJECTED_RAW_ERROR_PATTERN,
    staleDetail: 'no longer rejects with a raw `Error`; drop its repo lint allowlist entry.',
  },
} as const satisfies Record<string, ConventionRule>

/** conventionRuleIssues reports one rule's offending lines and its stale allowlist entries. */
export function conventionRuleIssues(
  rule: ConventionRule,
  files: readonly SourceFile[],
  allowlist: readonly string[] = rule.allowlist,
): string[] {
  const scanned = files.filter(file => !rule.excludePathPrefixes?.some(prefix => file.path.startsWith(prefix)))
  return conventionIssues(scanned, conventionMatches(scanned, rule.pattern, rule.detail), allowlist, rule.staleDetail)
}

/** langiumImportIssues reports Langium imports outside the parser package. */
export function langiumImportIssues(files: readonly SourceFile[]): string[] {
  return conventionMatches(
    files.filter(file => !file.path.startsWith(LANGIUM_PARSER_PREFIX)),
    LANGIUM_IMPORT_PATTERN,
    `imports \`langium\` outside ${LANGIUM_PARSER_PREFIX}; use \`AST\` from \`@parser\` instead.`,
  )
    .map(issueLine)
    .sort()
}

/** crossPackageSourceImportIssues reports relative imports that reach into another package's source. */
export function crossPackageSourceImportIssues(
  files: readonly SourceFile[],
  allowlist: readonly string[] = CROSS_PACKAGE_SOURCE_IMPORT_ALLOWLIST,
): string[] {
  const matches = files.flatMap(file =>
    [...file.source.matchAll(RELATIVE_IMPORT_PATTERN)].flatMap(match => {
      const target = importTargetPath(file.path, match[1]!)
      if (!crossesPackages(file.path, target) || !PACKAGE_SOURCE_DIRECTORY_PATTERN.test(target)) {
        return []
      }
      return [{
        detail: `imports \`${target}\` from another package; import that package's entry instead.`,
        line: lineNumber(file.source, match.index),
        path: file.path,
      }]
    })
  )
  return conventionIssues(
    files,
    matches,
    allowlist,
    "no longer imports another package's source; drop its repo lint allowlist entry.",
  )
}

/*
 * `./dev`'s lane commands must be able to start in a checkout that has never generated the parser,
 * so the entry loads its Studio and Expo command modules with `await import(...)` inside each
 * action. A static import pulls `@studio` — and through it `packages/parser/parser-src/_gen_tao-parser`
 * — into `gates`, `test`, `doctor`, and `agent-config` at startup, so the very graph that generates
 * the parser could never run; it also turns any top-level fault in Studio code into a failure of the
 * gate runner itself rather than of one node.
 */
const DEV_ENTRY_PATH = 'packages/dev/dev-src/dev.ts'
const DEV_LAZY_IMPORT_PREFIXES = ['./studio/', './expo-dev-loop/', '@studio']
/** Matches a static `import` statement, wrapped or not, and never the `import(...)` call form. */
const STATIC_IMPORT_PATTERN = /^import\b(?!\s*\()[^'"]*['"]([^'"]+)['"]/gm

/** devLazyStudioImportIssues reports static Studio or Expo imports in the `./dev` entry. */
export function devLazyStudioImportIssues(
  files: readonly SourceFile[],
  entryPath: string = DEV_ENTRY_PATH,
): string[] {
  return files
    .filter(file => file.path === entryPath)
    .flatMap(file =>
      [...file.source.matchAll(STATIC_IMPORT_PATTERN)]
        .filter(match => DEV_LAZY_IMPORT_PREFIXES.some(prefix => match[1]!.startsWith(prefix)))
        .map(match => ({
          detail: `statically imports \`${match[1]}\`; load it with \`await import(...)\` inside the command`
            + ' action so the lane commands start in a checkout that has never generated the parser.',
          line: lineNumber(file.source, match.index),
          path: file.path,
        }))
    )
    .map(issueLine)
    .sort()
}

function conventionIssues(
  files: readonly SourceFile[],
  matches: readonly ConventionMatch[],
  allowlist: readonly string[],
  staleDetail: string,
): string[] {
  const allowed = new Set(allowlist)
  const scanned = new Set(files.map(file => file.path))
  const offending = new Set(matches.map(match => match.path))
  return [
    ...matches.filter(match => !allowed.has(match.path)).map(issueLine),
    ...allowlist.filter(path => scanned.has(path) && !offending.has(path)).map(path => `${path} ${staleDetail}`),
  ].sort()
}

function conventionMatches(files: readonly SourceFile[], pattern: RegExp, detail: string): ConventionMatch[] {
  return files.flatMap(file =>
    [...file.source.matchAll(pattern)].map(match => ({
      detail,
      line: lineNumber(file.source, match.index),
      path: file.path,
    }))
  )
}

function issueLine(match: ConventionMatch): string {
  return `${match.path}:${match.line} ${match.detail}`
}

function lineNumber(source: string, index: number | undefined): number {
  return source.slice(0, index ?? 0).split('\n').length
}

function crossesPackages(fromPath: string, toPath: string): boolean {
  const fromPackage = packageName(fromPath)
  const toPackage = packageName(toPath)
  return fromPackage !== undefined && toPackage !== undefined && fromPackage !== toPackage
}

function packageName(path: string): string | undefined {
  const [root, name] = path.split('/')
  return root === 'packages' ? name : undefined
}

function importTargetPath(fromPath: string, specifier: string): string {
  return FS.slashPath(FS.joinPath(`${FS.dirname(fromPath)}/${specifier}`))
}

/** repoLintIssues checks repository-wide contracts that do not belong to package behavior suites. */
export async function repoLintIssues(repoRoot = Repo.getRoot()): Promise<string[]> {
  const issues: string[] = []
  issues.push(...wordFlowerDirectoryIssues(await readWordFlowerDirectory(repoRoot)))
  issues.push(...justRecipeIssues(await FS.readText(FS.resolvePath('Justfile', repoRoot))))

  // Test apps and starters each document every folder in their README, one `## <Name>` entry per app.
  for (const collection of ['Apps/Test Apps', 'Apps/Starters']) {
    const collectionPath = FS.resolvePath(collection, repoRoot)
    if (!(await FS.isDirectory(collectionPath))) {
      continue
    }
    const readmePath = FS.resolvePath('README.md', collectionPath)
    const appNames: string[] = []
    for (const name of await FS.listDir(collectionPath)) {
      if (!name.startsWith('.') && await FS.isDirectory(FS.resolvePath(name, collectionPath))) {
        appNames.push(name)
      }
    }
    const missingEntries = missingTestAppReadmeEntries(appNames, await FS.readText(readmePath))
    issues.push(...missingEntries.map(name => `${readmePath} needs a \`## ${name}\` entry.`))
  }

  const packageFiles: SourceFile[] = []
  for await (
    const path of FS.walk(FS.resolvePath('packages', repoRoot), {
      excludeDirectory: name => name === 'node_modules' || name.startsWith('_gen_'),
      extensions: ['.ts', '.tsx'],
    })
  ) {
    packageFiles.push({ path: FS.relativePath(repoRoot, path), source: await FS.readText(path) })
  }
  issues.push(...duplicateDescribeTitleIssues(packageFiles.filter(file => file.path.endsWith('.test.ts'))))
  for (const rule of Object.values(CONVENTION_RULES)) {
    issues.push(...conventionRuleIssues(rule, packageFiles))
  }
  issues.push(...langiumImportIssues(packageFiles))
  issues.push(...crossPackageSourceImportIssues(packageFiles))
  issues.push(...devLazyStudioImportIssues(packageFiles))
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
