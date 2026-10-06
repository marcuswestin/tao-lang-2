import { CLI, FS, Repo } from '@shared'
import { PackageGraph } from './PackageGraph'
import { runtimeArrayConventionIssues } from './RuntimeArrayConventions'
import { runtimeElementConventionIssues } from './RuntimeElementConventions'
import { isAuditedSource } from './simplify-audit/AuditedSource'
import { instructionBudget, instructionCharacterCount } from './simplify-audit/InstructionBudgets'
import { kindChainsIn } from './simplify-audit/KindChains'
import { testBudgetConventionIssues } from './TestBudgetConventions'

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
  return !file.path.split('/').some(segment =>
    segment === '.tao' || segment === '.tao-ts' || segment === 'node_modules'
  ) && !file.path.endsWith('.tao.ts')
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

/** LedgerEntry is one backlog file as this rule sees it: its file name and the fields it records. */
export type LedgerEntry = {
  name: string
  /** The entry's own `**Status:**`, or an empty string when the file states none. */
  status: string
  /** Whether Status continues on another physical line, which the index cannot represent. */
  statusMultiline?: boolean
  /** The entry's own `# DEVENV-... — Title` heading text, without the leading `# `, or `''` when absent. */
  heading?: string
  /** The entry's own `**Section:**`; meaningful only for an entry that lives in the open directory. */
  section?: string
}

/** LedgerSide is one half of the backlog: the entry files in a directory and the index that lists them. */
export type LedgerSide = {
  entries: readonly LedgerEntry[]
  index: string
}

/** Statuses that mean an entry has been addressed, and therefore belongs in the archive. */
const ARCHIVED_STATUSES = new Set(['Closed', 'Resolved'])
const OPEN_INDEX = 'Developer environment upgrades.md'
const ARCHIVE_INDEX = 'Developer environment upgrades archive.md'
const OPEN_LINK_PREFIX = 'Developer environment upgrades/'
const ARCHIVE_LINK_PREFIX = 'Developer environment upgrades/Archive/'

/**
 * Allowed `**Section:**` values for an open-backlog entry, paired with the open index heading each
 * one generates, in the order the index prints them. Meaningless for an archived entry, which the
 * archive index lists as one flat, generated list instead. The `devenv-upgrades` skill owns when to
 * use each value.
 */
const LEDGER_SECTIONS = [
  ['Deferred', 'Deferred project — begin after the large branches land'],
  ['External', 'External and observational findings'],
] as const
const LEDGER_SECTION_VALUES: ReadonlySet<string> = new Set(LEDGER_SECTIONS.map(([value]) => value))
const LEDGER_SECTION_LIST = LEDGER_SECTIONS.map(([value]) => `\`${value}\``).join(' or ')

/**
 * The developer-environment backlog is one file per entry plus a generated index, so that two
 * branches adding an entry each add a file — the one thing two branches ever touch at once here, and
 * merging two new files never conflicts. `Developer environment upgrades.md` and
 * `Developer environment upgrades archive.md` are rendered from the entry files by
 * `writeDeveloperEnvironmentLedgerIndexes` (the `_fix-ledger-index` gate); nobody hand-edits them, so
 * the three drift symptoms this rule used to catch one at a time — a file the index never linked, a
 * link to a file that no longer exists, a link a kept-both merge duplicated — can no longer happen on
 * their own and collapse into one check below: the committed index text matches what the entry files
 * generate.
 *
 * New entries are named `DEVENV-NAME-WORDS-ETC.md` after their own title rather than by the next
 * free number, because the number was the collision: every branch read the same highest id and
 * chose the same successor, so the ledger renumbered on nearly every merge. A name derived from the
 * title collides only when two branches genuinely record the same finding, which is a duplicate
 * worth catching. Numbered entries predate that and stay valid; nothing renumbers them.
 *
 * The backlog has two halves, open and archived, and an entry belongs to the half its own status
 * names: the open index would otherwise regrow the unread tail the per-file layout was meant to end,
 * one addressed entry at a time. An ID is unique across both halves, because an archived entry is
 * still quoted by ID from commit messages and from other entries' dependencies. Within the open half,
 * an entry also names the generated section it prints under, in its own `**Section:**` field.
 */
export function developerEnvironmentLedgerIssues(open: LedgerSide, archived: LedgerSide): string[] {
  const issues: string[] = []
  const byId = new Map<string, string[]>()
  for (
    const [side, linkPrefix, archiveSide] of [
      [open, OPEN_LINK_PREFIX, false],
      [archived, ARCHIVE_LINK_PREFIX, true],
    ] as const
  ) {
    const entries = [...side.entries].filter(entry => entry.name.endsWith('.md'))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      // A numbered entry keeps its number as its identity; a named one is identified by the whole
      // name, which is the point of the scheme — two branches cannot pick the same name by accident
      // the way they both picked the next free number.
      const numbered = entry.name.match(/^(DEVENV-\d+)-/)?.[1]
      const named = entry.name.match(/^(DEVENV-[A-Z0-9]+(?:-[A-Z0-9]+)*)\.md$/)?.[1]
      const id = numbered ?? named
      if (id === undefined) {
        issues.push(
          `${linkPrefix}${entry.name} must be named DEVENV-NAME-WORDS-ETC.md, with the title's`
            + ' words in capitals joined by dashes.',
        )
        continue
      }
      byId.set(id, [...byId.get(id) ?? [], `${linkPrefix}${entry.name}`])
      if (entry.statusMultiline === true) {
        issues.push(
          `${linkPrefix}${entry.name} must keep \`**Status:**\` on one physical line; move detail to an update field.`,
        )
      }
      if (ARCHIVED_STATUSES.has(entry.status) !== archiveSide) {
        issues.push(
          archiveSide
            ? `${linkPrefix}${entry.name} is \`${entry.status}\`; an entry that is not addressed`
              + ' belongs in the open backlog.'
            : `${OPEN_LINK_PREFIX}${entry.name} is \`${entry.status}\`; move it into`
              + ' `Developer environment upgrades/Archive/` in the change that addressed it.',
        )
      }
      if (!archiveSide && !LEDGER_SECTION_VALUES.has(entry.section ?? '')) {
        issues.push(`${linkPrefix}${entry.name} needs a \`**Section:**\` of ${LEDGER_SECTION_LIST}.`)
      }
    }
  }
  for (const [id, names] of [...byId].sort(([left], [right]) => left.localeCompare(right))) {
    if (names.length > 1) {
      issues.push(
        `Developer environment upgrades: ${id} is claimed by ${names.join(', ')}; rename the`
          + ' later-merged file.',
      )
    }
  }
  const generated = developerEnvironmentIndexes(open, archived)
  if (open.index !== '' && open.index !== generated.openIndex) {
    issues.push(`${OPEN_INDEX} is out of date with its entry files; run \`just _fix-ledger-index\` to regenerate it.`)
  }
  if (archived.index !== '' && archived.index !== generated.archiveIndex) {
    issues.push(
      `${ARCHIVE_INDEX} is out of date with its entry files; run \`just _fix-ledger-index\` to regenerate it.`,
    )
  }
  return issues
}

const OPEN_INDEX_HEADER = [
  '# Developer environment upgrades',
  '',
  'The durable backlog for repository setup, automation, verification, worktree, diagnostic, and',
  'host-environment improvements. Product defects belong in their product roadmap; an entry here may',
  'link one when the developer workflow is also affected.',
  '',
  '**Generated.** `just _fix-ledger-index` renders this page from the entry files under',
  '[`Developer environment upgrades/`](<Developer environment upgrades/>); do not hand-edit it. Entry',
  'format, the `**Section:**` values, and how entries are selected, worked, and archived live in the',
  '`devenv-upgrades` skill. An addressed entry moves to',
  '[`Developer environment upgrades archive.md`](<Developer environment upgrades archive.md>) in the',
  'change that addressed it.',
].join('\n')

const ARCHIVE_INDEX_HEADER = [
  '# Developer environment upgrades — archive',
  '',
  'The closed record of [`Developer environment upgrades.md`](<Developer environment upgrades.md>).',
  '',
  '**Generated.** `just _fix-ledger-index` renders this page from the entry files under',
  '[`Developer environment upgrades/Archive/`](<Developer environment upgrades/Archive/>); do not',
  'hand-edit it. Archiving rules live in the `devenv-upgrades` skill.',
].join('\n')

/** developerEnvironmentIndexes renders both ledger index files from their entry files, deterministically. */
export function developerEnvironmentIndexes(
  open: LedgerSide,
  archived: LedgerSide,
): { archiveIndex: string; openIndex: string } {
  const openEntries = [...open.entries].filter(entry => entry.name.endsWith('.md'))
  const archivedEntries = [...archived.entries].filter(entry => entry.name.endsWith('.md'))
  const sections = LEDGER_SECTIONS.map(([value, heading]) => {
    const lines = openEntries
      .filter(entry => (entry.section ?? '') === value)
      .sort((left, right) => (left.heading ?? '').localeCompare(right.heading ?? ''))
      .map(entry => ledgerIndexLine(entry, OPEN_LINK_PREFIX))
    return [`## ${heading}`, '', ...lines].join('\n')
  })
  const archiveLines = archivedEntries
    .sort((left, right) => (left.heading ?? '').localeCompare(right.heading ?? ''))
    .map(entry => ledgerIndexLine(entry, ARCHIVE_LINK_PREFIX))
  return {
    archiveIndex: `${ARCHIVE_INDEX_HEADER}\n\n## Entries\n\n${archiveLines.join('\n')}\n`,
    openIndex: `${OPEN_INDEX_HEADER}\n\n${sections.join('\n\n')}\n`,
  }
}

function ledgerIndexLine(entry: LedgerEntry, linkPrefix: string): string {
  return `- [${entry.heading ?? ''}](<${linkPrefix}${entry.name}>) — ${entry.status}`
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
  for (const lane of ['check', 'verify', 'verify-full']) {
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
const NATIVE_SWITCH_ALLOWLIST: readonly string[] = []

/**
 * `Test-Bun.ts` is the sanctioned home for `bun:test`. The two runtime tests close with the shared
 * `MockModule` helper planned in "Repository simplification" 2.6.
 */
const BUN_TEST_IMPORT_ALLOWLIST = [
  'packages/shared/shared-src/testing/Test-Bun.ts',
  // Both close with plan item 2.6, when they adopt `MockModule` and `reactNativeStubs`.
  'packages/apps/runtime/TR-tests/TR-selectable-loop.test.ts',
  'packages/apps/runtime/TR-tests/TR-views.test.ts',
]

/** Langium stays behind the parser package; every other package consumes `AST` from `@parser`. */
const LANGIUM_PARSER_PREFIX = 'packages/language/parser/'

/**
 * Relative escapes into another package's source. Both close with the "Repository simplification"
 * Part 5 deep-import cleanup, which promotes each target into a public package entry.
 */
const CROSS_PACKAGE_SOURCE_IMPORT_ALLOWLIST = [
  'packages/ides/studio-tooling/studio-tooling-src/StudioPackagedTestCommand.ts',
  'packages/apps/expo-host/expo-host-tests/studio-scenario-e2e.jest-test.tsx',
]

/*
 * Raw `Error` throws that predate Tao's error taxonomy. Unlike the other convention lists this one
 * is a ratchet rather than a near-empty exception set: it names every file that still throws a raw
 * `Error` today, and a package's entries go stale — and must be deleted — as that package is swept
 * onto `Assert` and `Errors`. `packages/shared` is deliberately absent; it was swept first and must
 * stay clean. `packages/apps/runtime` imports nothing from `@shared` by design, so its entries are
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
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobun.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts',
  'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts',
  'packages/ides/studio/studio-src/StudioWelcome.ts',
]

/*
 * The pattern and its message are written so this rule never matches its own source: the pattern
 * spells the throw with escapes, and the message says "throws a raw `Error`" rather than quoting
 * the construct it forbids.
 */
/**
 * The three leaf modules construct the classes because they are the helpers everyone else calls;
 * everywhere else a Tao error is thrown through `Errors.throw*`, which returns `never` and narrows.
 * `packages/apps/runtime` keeps its own `TR-errors` vocabulary and is outside this rule.
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
 * A raw `Error` handed to a promise rejection reaches a reader exactly as a thrown one does. Each
 * exemption names one exact `path:line`, so an emitted script or a test probe cannot grant the rest
 * of its file permission to add more unclassified errors.
 */
const RAW_ERROR_ALLOWLIST = [
  'packages/apps/expo-host/expo-host-tests/studio-device-host-e2e.jest-test.tsx:344',
  'packages/apps/expo-host/plugins/with-ios-fmt-compat.cjs:14',
  'packages/apps/providers/icloud/plugins/with-tao-icloud.cjs:32',
  'packages/apps/runtime/TR-tests/TR-async.test.ts:43',
  'packages/apps/runtime/TR-tests/TR-async.test.ts:57',
  'packages/apps/runtime/TR-tests/TR-error-containment.test.ts:40',
  'packages/apps/runtime/TR-tests/TR-error-containment.test.ts:46',
  'packages/apps/runtime/TR-tests/TR-error-containment.test.ts:67',
  'packages/apps/runtime/TR-tests/TR-error-containment.test.ts:69',
  'packages/apps/runtime/TR-tests/TR-studio-device-client.test.ts:486',
  'packages/apps/runtime/TR-tests/TR-studio-device-client.test.ts:507',
  'packages/apps/runtime/TR-tests/TR-studio-device-client.test.ts:508',
  'packages/apps/runtime/TR-tests/TR-studio-preview.test.ts:306',
  'packages/apps/runtime/TR-tests/TR-studio-preview.test.ts:328',
  'packages/apps/runtime/TR-tests/TR-studio-preview.test.ts:1093',
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:40',
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:80',
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:103',
  'packages/cli/agent-cli/agent-cli-tests/claude-profiles-generation.test.ts:87',
  'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts:241',
  'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts:354',
  'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts:362',
  'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts:379',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:243',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1040',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1045',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1050',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1075',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1314',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1335',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1523',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1567',
  'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts:1593',
  // Emitted browser and Electrobun bodies, where no Tao module loads.
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:261',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:336',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:346',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:383',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:404',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:410',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:454',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:652',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:684',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:852',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts:1019',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobun.ts:102',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:208',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:211',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:213',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:215',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:217',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:218',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:289',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:439',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:458',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:572',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:577',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:582',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:595',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:606',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:613',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:637',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:647',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:670',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:691',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:700',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:705',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:844',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:871',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:878',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:884',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:905',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts:908',
  'packages/ides/studio/studio-src/StudioWelcome.ts:83',
  'packages/ides/studio/studio-tests/studio-client.test.ts:722',
  'packages/ides/studio/studio-tests/studio-client.test.ts:3873',
  // Expo config plugins execute as standalone CommonJS host scripts.
  'packages/apps/providers/icloud/plugins/with-tao-icloud.cjs:32',
  'packages/apps/expo-host/plugins/with-ios-fmt-compat.cjs:14',
  // The shared leaf builds the Web-standard cancellation error itself.
  // Companion's standalone Expo loader cannot import TypeScript error wrappers.
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:14',
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:58',
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:62',
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:117',
  'packages/shared/shared-src/core/Errors.ts:160',
  // Tests hand raw unknown failures to production boundaries to prove their classification.
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:40',
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:80',
  'packages/cli/agent-cli/agent-cli-tests/agent-config-generation.test.ts:103',
  'packages/cli/agent-cli/agent-cli-tests/claude-profiles-generation.test.ts:87',
  'packages/ides/studio-tooling/studio-tooling-tests/studio-companion-device.test.ts:598',
  'packages/ides/studio/studio-src/StudioWelcome.ts:83',
  'packages/ides/studio/studio-tests/studio-server-datasource.test.ts:196',
  'packages/shared/shared-src/core/Errors.ts:160',
]

const RAW_ERROR_DETAIL = 'constructs a raw `Error`; where an error object must exist rather than be thrown,'
  + ' build `new Errors.UserInputError(...)`, `new Errors.UnexpectedBehaviorError(...)`, or'
  + ' `new Errors.HostEnvironmentError(...)`, wrap an unknown with `Errors.asError(...)`, or cancel with `Errors.abortError(...)`.'

/*
 * Platform-wrapper conventions. Code reaches the host through the shared `CLI`, `FS`, `HCI`,
 * `Platform`, and `Time` wrappers rather than `node:` modules, the global console, the process
 * object, or Bun's convenience APIs. `packages/shared` is the wrappers themselves and
 * `packages/apps/runtime` imports nothing from `@shared`, so both are outside these rules rather than
 * allowlisted. Each list is a ratchet like the raw-throw list: it names every file that still
 * reaches past a wrapper today, and an entry goes stale — and must be deleted — when its file is
 * swept.
 *
 * An entry that survives a sweep is one of two things, and says which: emitted text — a script body
 * rendered into a string, a bundler `define` key, a test asserting on generated source, a jest test
 * silencing the global it captures — or a seam no wrapper covers yet. `node:net` sockets and the
 * stream classes a test constructs are the open seams; a new use of one goes behind `Platform`
 * rather than onto the list. Hashing, signing, and random ids have their `Platform` functions. A type-only `node:` import names a
 * shape, not a behavior, and is outside the import rule.
 */
const PLATFORM_WRAPPER_HOMES = ['packages/shared/', 'packages/apps/runtime/']

const NODE_IMPORT_ALLOWLIST = [
  // `node:crypto` in the fenced verification runner, which moves to `Platform.sha256Hex` with it,
  // and other `node:` imports that follow them in the same files.
  'packages/testing/verification/verification-src/GreenTree.ts',
  'packages/testing/verification/verification-src/ParserGenerate.ts',
  'packages/testing/verification/verification-src/TestLedger.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioCdp.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts',
  'packages/ides/studio-tooling/studio-tooling-tests/studio-review.test.ts',
  'packages/services/update-server/update-server-tests/update-server.test.ts',
  // `node:crypto` key signing for App Store Connect.
  'packages/cli/tao-cli/cli-tests/app-store-connect-auth.test.ts',
  // `node:net` port probes and socket connections.
  'packages/apps/expo-host/expo-host-src/dev-loop/expo-runner/Ports.ts',
  'packages/apps/expo-host/expo-host-tests/expo-dev-loop.test.ts',
  'packages/ai/generation/generation-live/apple-foundation-models.live.ts',
  // Test fixtures that emit or describe direct Node imports without executing them in Tao code.
  'packages/testing/verification/verification-tests/repo-lint.test.ts',
  'packages/testing/verification/verification-tests/work-graph.test.ts',
  // Stream classes a test constructs to stand in for a terminal.
  'packages/cli/tao-cli/cli-tests/compile-command.test.ts',
  'packages/cli/tao-cli/cli-tests/create-command.test.ts',
  'packages/cli/tao-cli/cli-tests/dev-command.test.ts',
  'packages/cli/tao-cli/cli-tests/test-cli-files.ts',
  // Studio's `node:fs` reads close with its own sweep onto `FS`.
  'packages/ides/studio/studio-src/StudioClientAssets.ts:3',
  'packages/ides/studio/studio-src/device/StudioDeviceTrustStore.ts:5',
  // Node-loaded configuration and Expo config plugins cannot use the ESM shared wrappers.
  'packages/apps/expo-host/app-config.cjs:1',
  'packages/apps/expo-host/jest.shared.config.cjs:1',
  'packages/apps/expo-host/expo-host-tests/fixtures/jest-runner-policy/jest.config.cjs:1',
  // The Jest runner adapter is loaded by Node before TypeScript shared wrappers can execute.
  'packages/apps/expo-host/jest-runner-adapter.cjs:1',
  'packages/apps/expo-host/jest-runner-adapter.cjs:2',
  'packages/apps/expo-host/jest-runner-adapter.cjs:3',
  // Jest loads its direct-cache coordinator before TypeScript shared wrappers are available.
  'packages/apps/expo-host/jest-direct-cache.cjs:2',
  'packages/apps/expo-host/jest-direct-cache.cjs:3',
  'packages/apps/expo-host/jest-direct-cache.cjs:4',
  'packages/apps/expo-host/jest-direct-cache.cjs:5',
  'packages/apps/expo-host/app-config.cjs:2',
  'packages/apps/expo-host/metro.config.cjs:2',
  'packages/apps/expo-host/metro.config.cjs:3',
  'packages/apps/expo-host/plugins/with-ios-fmt-compat.cjs:1',
  'packages/apps/expo-host/plugins/with-ios-fmt-compat.cjs:2',
  // Standalone Expo prebuild loader: shared TypeScript aliases are unavailable.
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:1',
  'packages/ides/studio-companion-app/plugins/with-launcher-history.cjs:2',
  // A test proves the packaged CommonJS entry can resolve its generated dependency.
  'packages/apps/providers/icloud/icloud-tests/icloud-native.test.ts:167',
]

const CONSOLE_CALL_ALLOWLIST = [
  // Browser code, where `HCI` has no stream to write to.
  'packages/ides/studio/studio-src/code-editor/CodeEditor.tsx',
  'packages/ides/studio/studio-src/TaoStudioProductHost.tsx',
  'packages/ides/studio/studio-src/product-host/StudioEditorSurface.tsx',
  // Device-side stdlib provider running inside the app, where `HCI` has no terminal either.
  'packages/apps/stdlib/@tao/data/providers/icloud/ICloud.ts',
  // Emitted text: the Electrobun main, a `bun -e` body, and bundles a test writes to disk.
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioWatchHealth.ts',
  'packages/apps/expo-host/expo-host-tests/release-bundle-proof.test.ts',
  'packages/services/update-server/update-server-tests/update-server.test.ts',
  // Tests that capture or silence the global a library writes through.
  'packages/apps/expo-host/expo-host-tests/runtime-containment.jest-test.tsx',
  'packages/apps/expo-host/expo-host-tests/studio-device-host-e2e.jest-test.tsx',
  'packages/cli/tao-cli/cli-tests/completion-command.test.ts',
]

const PROCESS_ACCESS_ALLOWLIST = [
  // Emitted text: the Electrobun main, a bundler `define` key, child scripts a test renders, and
  // tests asserting on generated source.
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts',
  'packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts',
  'packages/testing/verification/verification-tests/machine-lanes.test.ts',
  'packages/testing/verification/verification-tests/native-host-lease.test.ts',
  'packages/ides/studio-tooling/studio-tooling-tests/studio-electrobun.test.ts',
  'packages/ides/studio-tooling/studio-tooling-tests/studio-port-lease.test.ts',
  'packages/testing/verification/verification-tests/test-ledger.test.ts',
  'packages/apps/expo-host/expo-host-tests/runtime.test.ts',
  // Generated child-process fixtures run without the repository's Platform module.
  'packages/cli/tao-cli/cli-tests/test-command-budget-cli.test.ts',
  'packages/cli/tao-cli/cli-tests/test-command-fixtures.ts',
  'packages/cli/tao-cli/cli-tests/test-command-publication-cli.test.ts',
  'packages/cli/tao-cli/cli-tests/test-command-reporting-cli.test.ts',
  // Studio's environment reads close with its own sweep onto `Platform.runtimeProcess`.
  'packages/ides/studio/studio-src/agent-chat/AgentChatProvider.ts',
  'packages/ides/studio/studio-src/agent-chat/AgentChatServer.ts',
]

/** The Electrobun main is emitted text that runs where no Tao module is loaded. */
const BUN_CONVENIENCE_ALLOWLIST = [
  'packages/ides/studio-tooling/studio-tooling-src/StudioElectrobunAppSource.ts',
]

const NODE_IMPORT_DETAIL = 'imports a `node:` module directly; reach for `FS`, `CLI`, `Platform`, or `HCI`'
  + ' from `@shared`, and add the seam there when none fits.'
const CONSOLE_CALL_DETAIL = 'writes through the global console; use `HCI.writeLine` or `HCI.writeErrorLine`'
  + ' for a person, and `Platform.runtimeConsole` where the output must stay raw.'
const PROCESS_ACCESS_DETAIL = 'reads the process environment, arguments, streams, or exit state directly;'
  + ' go through `Platform.runtimeProcess`.'
const BUN_CONVENIENCE_DETAIL = 'calls a Bun convenience API directly; use `Time.sleep`, `Platform.randomUUID`,'
  + ' `Platform.semverSatisfies`, or `Platform.parseToml`, which keep the Bun dependency inside the wrappers.'

const NATIVE_SWITCH_PATTERN = /^[ \t]*switch[ \t]*\(/gm
const CONSTRUCTED_THROW_PATTERN =
  /\bthrow\s+new\s+(?:Errors\.)?(?:UserInput|UnexpectedBehavior|HostEnvironment)Error\s*\(/g
const RAW_THROW_PATTERN = /\bthrow\s+new\s+Error\s*\(/g
const RAW_ERROR_PATTERN = /\bnew\s+Error\s*\(/g
const BUN_TEST_IMPORT_PATTERN = /\bfrom\s*['"]bun:test['"]/g
/*
 * The wrapper patterns are written so this file never matches them: each spells its target with an
 * escape or a group, and the details above name the construct without writing it.
 */
/** A static import/re-export, dynamic import, or CommonJS require from `node:`; `type` remains type-only. */
const NODE_IMPORT_PATTERN =
  /(?:^\s*(?:import|export)\s+(?!type\b)(?:[^'"\n]*\s+from\s+)?['"]node:|\b(?:import|require)\s*\(\s*['"]node:)/gm
const CONSOLE_CALL_PATTERN = /(?<![\w$.\-])console\.(?:debug|error|info|log|warn)\b/g
const PROCESS_ACCESS_PATTERN = /(?<![\w$.])process\.(?:argv|cwd|env|exitCode|exit|stderr|stdin|stdout)\b/g
const BUN_CONVENIENCE_PATTERN = /\bBun\.(?:randomUUIDv7|semver|sleep|TOML)\b/g
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
  /** When true, each allowlist entry is one exact `path:line`, rather than permission for its whole file. */
  allowlistBySite?: boolean
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
    excludePathPrefixes: ['packages/apps/runtime/'],
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
  rawError: {
    allowlist: RAW_ERROR_ALLOWLIST,
    allowlistBySite: true,
    detail: RAW_ERROR_DETAIL,
    pattern: RAW_ERROR_PATTERN,
    staleDetail: 'no longer constructs a raw `Error`; drop its repo lint allowlist entry.',
  },
  nodeImport: {
    allowlist: NODE_IMPORT_ALLOWLIST,
    allowlistBySite: true,
    detail: NODE_IMPORT_DETAIL,
    excludePathPrefixes: PLATFORM_WRAPPER_HOMES,
    pattern: NODE_IMPORT_PATTERN,
    staleDetail: 'no longer imports a `node:` module; drop its repo lint allowlist entry.',
  },
  consoleCall: {
    allowlist: CONSOLE_CALL_ALLOWLIST,
    detail: CONSOLE_CALL_DETAIL,
    excludePathPrefixes: PLATFORM_WRAPPER_HOMES,
    pattern: CONSOLE_CALL_PATTERN,
    staleDetail: 'no longer writes through the global console; drop its repo lint allowlist entry.',
  },
  processAccess: {
    allowlist: PROCESS_ACCESS_ALLOWLIST,
    detail: PROCESS_ACCESS_DETAIL,
    excludePathPrefixes: PLATFORM_WRAPPER_HOMES,
    pattern: PROCESS_ACCESS_PATTERN,
    staleDetail: 'no longer reads the process object directly; drop its repo lint allowlist entry.',
  },
  bunConvenience: {
    allowlist: BUN_CONVENIENCE_ALLOWLIST,
    detail: BUN_CONVENIENCE_DETAIL,
    excludePathPrefixes: PLATFORM_WRAPPER_HOMES,
    pattern: BUN_CONVENIENCE_PATTERN,
    staleDetail: 'no longer calls a Bun convenience API; drop its repo lint allowlist entry.',
  },
} as const satisfies Record<string, ConventionRule>

/** conventionRuleIssues reports one rule's offending lines and its stale allowlist entries. */
export function conventionRuleIssues(
  rule: ConventionRule,
  files: readonly SourceFile[],
  allowlist: readonly string[] = rule.allowlist,
): string[] {
  const scanned = files.filter(file => !rule.excludePathPrefixes?.some(prefix => file.path.startsWith(prefix)))
  const matches = conventionMatches(scanned, rule.pattern, rule.detail)
  return rule.allowlistBySite === true
    ? conventionSiteIssues(scanned, matches, allowlist, rule.staleDetail)
    : conventionIssues(scanned, matches, allowlist, rule.staleDetail)
}

const TEST_SOURCE_PATH_PATTERN = /(?:\.test\.[cm]?[jt]sx?|\.host\.spec\.[jt]s|\.jest-test\.[jt]sx?)$/u
const DIRECT_TEST_TEMP_DIRECTORY_PATTERN = /\b(?:FS\.mkTmpDir|(?:nodeFs|fs)\.mkdtemp(?:Sync)?)\s*\(/gu
const DIRECT_TEST_GIT_INIT_PATTERN = /\bgit\w*\b[^\n]{0,80}?['"]init['"]/gu

/**
 * testScratchConventionIssues keeps test-created directories on the shared lifecycle, and Git
 * fixtures on the helpers that keep them outside this checkout and fail when `git init` does.
 */
export function testScratchConventionIssues(files: readonly SourceFile[]): string[] {
  return files
    .filter(file => TEST_SOURCE_PATH_PATTERN.test(file.path) || file.path.includes('/studio-smoke/'))
    .flatMap(file => [
      ...[...file.source.matchAll(DIRECT_TEST_TEMP_DIRECTORY_PATTERN)].map(match =>
        `${file.path}:${lineNumber(file.source, match.index)} creates a test directory directly; `
        + 'use `mkTestDir` for fixtures or `Repo.mkScratchDir` for host specs.'
      ),
      ...[...file.source.matchAll(DIRECT_TEST_GIT_INIT_PATTERN)].map(match =>
        `${file.path}:${lineNumber(file.source, match.index)} runs \`git init\` directly; `
        + 'use `mkGitTestDir` and `initGitTestRepository`, which keep the repository outside this checkout.'
      ),
    ])
    .sort()
}

/**
 * KIND_CHAIN_ALLOWLIST names the files that still dispatch through an `if`/`else if` chain over one
 * `.kind`, `.type`, or `.$type`. It only shrinks: a simplification pass converts each to a `Switch`
 * helper, and an entry goes stale when its file no longer holds a chain.
 */
const KIND_CHAIN_ALLOWLIST = [
  'packages/compiler/compiler-src/codegen/react-native/app/ExpressionsCompiler.ts',
  'packages/apps/providers/icloud/icloud-src/cloudkit-native.ts',
  'packages/language/validator/validator-src/validators/types-validator.ts',
]

/** instructionBudgetIssues reports instruction files over their budget; detail belongs in a skill's `references/`. */
export function instructionBudgetIssues(files: readonly SourceFile[]): string[] {
  return files.flatMap(file => {
    const budget = instructionBudget(file.path)
    const characters = instructionCharacterCount(file.source)
    return budget !== undefined && characters > budget
      ? [
        `${file.path} is ${characters} characters, over its ${budget}-character budget; move detail `
        + 'into a reference file or a gate. Folding one bullet into another does not help — the '
        + 'budget counts what an agent carries, not how many lines it is spread over.',
      ]
      : []
  }).sort()
}

/** kindChainIssues reports discriminant chains in non-test package source, which `Switch` would check for exhaustiveness. */
export function kindChainIssues(
  files: readonly SourceFile[],
  allowlist: readonly string[] = KIND_CHAIN_ALLOWLIST,
): string[] {
  const scanned = files.filter(file => isAuditedSource(file.path))
  const matches = scanned.flatMap(file =>
    kindChainsIn(file.path, file.source).map(chain => ({
      detail:
        `dispatches ${chain.length} branches on \`${chain.discriminant}\`; use a \`Switch\` helper over the union instead.`,
      line: chain.line,
      path: chain.path,
    }))
  )
  return conventionIssues(
    scanned,
    matches,
    allowlist,
    'no longer dispatches through a discriminant chain; drop its repo lint allowlist entry.',
  )
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
  packages: readonly string[],
  allowlist: readonly string[] = CROSS_PACKAGE_SOURCE_IMPORT_ALLOWLIST,
): string[] {
  const matches = files.flatMap(file =>
    [...file.source.matchAll(RELATIVE_IMPORT_PATTERN)].flatMap(match => {
      const target = importTargetPath(file.path, match[1]!)
      if (!crossesPackages(file.path, target, packages) || !PACKAGE_SOURCE_DIRECTORY_PATTERN.test(target)) {
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
 * action. A static import pulls `@studio` — and through it `packages/language/parser/parser-src/_gen_tao-parser`
 * — into `gates`, `test`, `doctor`, and `agent-config` at startup, so the very graph that generates
 * the parser could never run; it also turns any top-level fault in Studio code into a failure of the
 * gate runner itself rather than of one node.
 */
export const DEV_ENTRY_PATH = 'packages/cli/dev-cli/dev-cli-src/dev.ts'
/**
 * Package aliases the entry must reach only behind `await import(...)`. `@studio` pulls in the
 * generated parser; `@studio-tooling`, `@expo-host` (its bare root, not only `/dev-loop`), and
 * `@expo-host/dev-loop` are Studio's and the Expo dev loop's own packages, heavy for the same
 * reason.
 */
const DEV_LAZY_IMPORT_SPECIFIERS = ['@studio', '@studio-tooling', '@expo-host', '@expo-host/dev-loop']

/**
 * Alias roots `resolveLocalModule` also follows into local source, so a heavy static import
 * reached through one of these — not only through a relative path — is still traced for a
 * transitive `DEV_LAZY_IMPORT_SPECIFIERS` hit. Kept to the two aliases the lazy-loaded packages
 * themselves route through; a general tsconfig-paths resolver is not worth it for this lint.
 */
const ALIAS_SOURCE_ROOTS: Record<string, string> = {
  '@agent-cli': 'packages/cli/agent-cli/agent-cli-src',
  '@cli-kit': 'packages/cli/cli-kit/cli-kit-src',
  '@verification': 'packages/testing/verification/verification-src',
}
/** Matches static imports and re-exports, wrapped or not, and never the `import(...)` call form. */
const STATIC_MODULE_PATTERN = /^(?:import\b(?!\s*\()|export\b)[^'"]*['"]([^'"]+)['"]/gm

/** devLazyStudioImportIssues reports static Studio or Expo imports in the `./dev` entry. */
export function devLazyStudioImportIssues(
  files: readonly SourceFile[],
  entryPath: string = DEV_ENTRY_PATH,
): string[] {
  const byPath = new Map(files.map(file => [file.path, file]))
  if (!byPath.has(entryPath)) {
    // A file map built from the real repository always carries its own entry; one that does not
    // means `DEV_ENTRY_PATH` moved out from under this rule, which would otherwise vacate it
    // silently — the entry stops being traced and every static Studio or Expo import inside it
    // stops being caught.
    return [
      `${entryPath}:1 does not exist, so this rule is not watching the \`./dev\` entry at all; update`
      + ' `DEV_ENTRY_PATH` in packages/testing/verification/verification-src/repo-lint.ts to its new path.',
    ]
  }
  const queue: Array<{ chain: readonly string[]; path: string }> = [{ chain: [entryPath], path: entryPath }]
  const visited = new Set<string>()
  const issues: Array<{ detail: string; line: number; path: string }> = []
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.path)) {
      continue
    }
    visited.add(current.path)
    const file = byPath.get(current.path)
    if (file === undefined) {
      continue
    }
    for (const match of file.source.matchAll(STATIC_MODULE_PATTERN)) {
      const specifier = match[1]!
      const target = resolveLocalModule(file.path, specifier, byPath)
      const forbidden = DEV_LAZY_IMPORT_SPECIFIERS.some(prefix =>
        specifier === prefix || specifier.startsWith(`${prefix}/`)
      )
      if (forbidden) {
        const chain = [...current.chain, target ?? specifier]
        issues.push({
          detail: `statically reaches \`${target ?? specifier}\` through ${chain.join(' -> ')}; load the boundary with`
            + ' `await import(...)` inside the command action so the lane commands start in a checkout that has never'
            + ' generated the parser.',
          line: lineNumber(file.source, match.index),
          path: file.path,
        })
      } else if (target !== undefined && !visited.has(target)) {
        queue.push({ chain: [...current.chain, target], path: target })
      }
    }
  }
  return issues.map(issueLine).sort()
}

function resolveLocalModule(
  importingPath: string,
  specifier: string,
  files: ReadonlyMap<string, SourceFile>,
): string | undefined {
  if (specifier.startsWith('.')) {
    const parts = importingPath.split('/')
    parts.pop()
    for (const segment of specifier.split('/')) {
      if (segment === '.' || segment === '') {
        continue
      }
      if (segment === '..') {
        parts.pop()
      } else {
        parts.push(segment)
      }
    }
    return sourceCandidate(parts.join('/'), files)
  }
  for (const [alias, sourceRoot] of Object.entries(ALIAS_SOURCE_ROOTS)) {
    if (specifier.startsWith(`${alias}/`)) {
      return sourceCandidate(`${sourceRoot}/${specifier.slice(alias.length + 1)}`, files)
    }
  }
  return undefined
}

function sourceCandidate(base: string, files: ReadonlyMap<string, SourceFile>): string | undefined {
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .find(candidate => files.has(candidate))
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

/**
 * A site-keyed allowlist takes both shapes, and the shape is the claim being made.
 *
 * `path:line` blesses one occurrence, so a second direct use in the same file still fails. That
 * precision costs a maintenance tax the line number cannot pay for everywhere: the number is a
 * coordinate, not a fact about the code, and every edit above a blessed site silently invalidates
 * it — adding tests thirty lines above two fixtures once broke both of their entries at once.
 *
 * A bare `path` blesses the file, which is the honest claim where the whole file is the exception:
 * a test asserting on generated source, or a host-facing tool whose job is reaching the host. It
 * still goes stale when the file stops matching at all, so the ratchet only ever tightens. Keep
 * `path:line` where a new use in an already-listed file must fail — the packages whose code ships
 * inside built apps — and use `path` elsewhere.
 */
function conventionSiteIssues(
  files: readonly SourceFile[],
  matches: readonly ConventionMatch[],
  allowlist: readonly string[],
  staleDetail: string,
): string[] {
  const allowedSites = new Set(allowlist.filter(entry => sitePath(entry) !== entry))
  const allowedFiles = new Set(allowlist.filter(entry => sitePath(entry) === entry))
  const scanned = new Set(files.map(file => file.path))
  const matchSites = new Set(matches.map(match => `${match.path}:${match.line}`))
  const matchedPaths = new Set(matches.map(match => match.path))
  return [
    ...matches
      .filter(match => !allowedFiles.has(match.path) && !allowedSites.has(`${match.path}:${match.line}`))
      .map(issueLine),
    ...allowlist
      .filter(entry => {
        const path = sitePath(entry)
        return scanned.has(path) && (path === entry ? !matchedPaths.has(path) : !matchSites.has(entry))
      })
      .map(entry => `${entry} ${staleDetail}`),
  ].sort()
}

/** sitePath returns an allowlist entry's file, which is the entry itself when it blesses the whole file. */
function sitePath(entry: string): string {
  const separator = entry.lastIndexOf(':')
  return separator < 0 || !/^\d+$/u.test(entry.slice(separator + 1)) ? entry : entry.slice(0, separator)
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

function crossesPackages(fromPath: string, toPath: string, packages: readonly string[]): boolean {
  const fromPackage = packageName(fromPath, packages)
  const toPackage = packageName(toPath, packages)
  return fromPackage !== undefined && toPackage !== undefined && fromPackage !== toPackage
}

/** packageName resolves a repository path to its package directory name. A grouped package nests
 * one or two levels deeper (`packages/<group>/<package>/...`,
 * `packages/<group>/<group>/<package>/...`) than a top-level one. */
function packageName(path: string, packages: readonly string[]): string | undefined {
  if (!path.startsWith('packages/')) {
    return undefined
  }
  return PackageGraph.ownerFromRelativePath(path.slice('packages/'.length), packages)
}

function importTargetPath(fromPath: string, specifier: string): string {
  return FS.slashPath(FS.joinPath(`${FS.dirname(fromPath)}/${specifier}`))
}

/**
 * LintIssueSource is one more repository-wide check, read the same way `repoLintIssues`'s own
 * checks are. `verification` owns the checks whose rule data it can see; a check whose rule data
 * lives in a package that depends on `verification` (agent-config freshness, delegation profile
 * shape) is instead registered here by that package's own CLI entry, so `verification` never
 * imports back into it.
 */
export type LintIssueSource = (repoRoot: string) => Promise<readonly string[]>

/** repoLintIssues checks repository-wide contracts that do not belong to package behavior suites. */
export async function repoLintIssues(
  repoRoot = Repo.getRoot(),
  extraIssueSources: readonly LintIssueSource[] = [],
): Promise<string[]> {
  const issues: string[] = []
  issues.push(...wordFlowerDirectoryIssues(await readWordFlowerDirectory(repoRoot)))
  issues.push(...justRecipeIssues(await FS.readText(FS.resolvePath('Justfile', repoRoot))))
  for (const source of extraIssueSources) {
    issues.push(...await source(repoRoot))
  }
  issues.push(...instructionBudgetIssues(await readInstructionFiles(repoRoot)))
  issues.push(...await readDeveloperEnvironmentLedgerIssues(repoRoot))

  // Inventory authored Tao sources, since removed apps can leave ignored generated directories.
  for (const collection of ['Apps/Test Apps', 'Apps/Starters']) {
    const collectionPath = FS.resolvePath(collection, repoRoot)
    if (!(await FS.isDirectory(collectionPath))) {
      continue
    }
    const readmePath = FS.resolvePath('README.md', collectionPath)
    const appNames = await readTaoAppNames(repoRoot, collection)
    const missingEntries = missingTestAppReadmeEntries(appNames, await FS.readText(readmePath))
    issues.push(...missingEntries.map(name => `${readmePath} needs a \`## ${name}\` entry.`))
  }

  const executableFiles = await readExecutableFiles(repoRoot)
  const packageFiles = executableFiles.filter(file =>
    file.path.startsWith('packages/') && (file.path.endsWith('.ts') || file.path.endsWith('.tsx'))
  )
  issues.push(...duplicateDescribeTitleIssues(packageFiles.filter(file => file.path.endsWith('.test.ts'))))
  issues.push(...testScratchConventionIssues(packageFiles))
  for (const [name, rule] of Object.entries(CONVENTION_RULES)) {
    const files = name === 'rawError' || name === 'nodeImport' ? executableFiles : packageFiles
    issues.push(...conventionRuleIssues(rule, files))
  }
  issues.push(...kindChainIssues(packageFiles))
  issues.push(...langiumImportIssues(packageFiles))
  const packages = await PackageGraph.packageDirectories(FS.resolvePath('packages', repoRoot))
  issues.push(...crossPackageSourceImportIssues(packageFiles, packages))
  issues.push(...devLazyStudioImportIssues(packageFiles))
  issues.push(...runtimeArrayConventionIssues(packageFiles))
  issues.push(...runtimeElementConventionIssues(packageFiles))
  issues.push(...testBudgetConventionIssues(packageFiles))
  return issues
}

async function readInstructionFiles(repoRoot: string): Promise<SourceFile[]> {
  const paths = ['AGENTS.md']
  const skillsPath = FS.resolvePath('agents/skills', repoRoot)
  if (await FS.isDirectory(skillsPath)) {
    for (const name of await FS.listDir(skillsPath)) {
      paths.push(`agents/skills/${name}/SKILL.md`)
    }
  }
  const files: SourceFile[] = []
  for (const path of paths) {
    const absolutePath = FS.resolvePath(path, repoRoot)
    if (await FS.isFile(absolutePath)) {
      files.push({ path, source: await FS.readText(absolutePath) })
    }
  }
  return files
}

const EXECUTABLE_EXTENSIONS = ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']

async function readTaoAppNames(repoRoot: string, collection: string): Promise<string[]> {
  const inventory = await CLI.run('git', {
    args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', collection],
    cwd: repoRoot,
  })
  const paths: string[] = []
  if (inventory.exitCode === 0) {
    paths.push(...inventory.stdout.split('\0'))
  } else {
    for await (
      const path of FS.walk(FS.resolvePath(collection, repoRoot), {
        extensions: ['.tao'],
        excludeDirectory: name => name === 'node_modules' || name.startsWith('_gen_'),
      })
    ) {
      paths.push(FS.relativePath(repoRoot, path))
    }
  }
  const names = new Set<string>()
  for (const path of paths) {
    const segments = FS.slashPath(path).slice(collection.length + 1).split('/')
    if (
      path.endsWith('.tao') && segments.length > 1
      && !segments.some(segment => segment.startsWith('.') || segment === 'node_modules' || segment.startsWith('_gen_'))
      && await FS.isFile(FS.resolvePath(path, repoRoot))
    ) {
      names.add(segments[0]!)
    }
  }
  return [...names].sort()
}

async function readExecutableFiles(repoRoot: string): Promise<SourceFile[]> {
  const tracked = await CLI.run('git', {
    args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'Apps', 'packages'],
    cwd: repoRoot,
  })
  const paths = tracked.exitCode === 0
    ? tracked.stdout.split('\0').filter(isExecutableRepositoryPath)
    : await walkedExecutablePaths(repoRoot)
  const files: SourceFile[] = []
  for (const path of paths) {
    const absolutePath = FS.resolvePath(path, repoRoot)
    if (await FS.isFile(absolutePath)) {
      files.push({ path: FS.slashPath(path), source: await FS.readText(absolutePath) })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function isExecutableRepositoryPath(path: string): boolean {
  const segments = FS.slashPath(path).split('/')
  return EXECUTABLE_EXTENSIONS.some(extension => path.endsWith(extension))
    && !segments.some(segment => segment === '.artifacts' || segment === 'node_modules' || segment.startsWith('_gen_'))
}

async function walkedExecutablePaths(repoRoot: string): Promise<string[]> {
  const paths: string[] = []
  for (const root of ['Apps', 'packages']) {
    const absoluteRoot = FS.resolvePath(root, repoRoot)
    if (!await FS.isDirectory(absoluteRoot)) {
      continue
    }
    for await (
      const path of FS.walk(absoluteRoot, {
        excludeDirectory: name => name === '.artifacts' || name === 'node_modules' || name.startsWith('_gen_'),
        extensions: EXECUTABLE_EXTENSIONS,
      })
    ) {
      paths.push(FS.relativePath(repoRoot, path))
    }
  }
  return paths
}

const DEVELOPER_ENVIRONMENT_INDEX = 'Docs/Roadmap/Developer environment upgrades.md'
const DEVELOPER_ENVIRONMENT_ENTRIES = 'Docs/Roadmap/Developer environment upgrades'
const DEVELOPER_ENVIRONMENT_ARCHIVE_INDEX = 'Docs/Roadmap/Developer environment upgrades archive.md'
const DEVELOPER_ENVIRONMENT_ARCHIVE_ENTRIES = 'Docs/Roadmap/Developer environment upgrades/Archive'

async function readDeveloperEnvironmentLedgerIssues(repoRoot: string): Promise<string[]> {
  const entriesPath = FS.resolvePath(DEVELOPER_ENVIRONMENT_ENTRIES, repoRoot)
  if (!(await FS.isDirectory(entriesPath))) {
    return []
  }
  return developerEnvironmentLedgerIssues(
    await readLedgerSide(repoRoot, DEVELOPER_ENVIRONMENT_ENTRIES, DEVELOPER_ENVIRONMENT_INDEX),
    await readLedgerSide(repoRoot, DEVELOPER_ENVIRONMENT_ARCHIVE_ENTRIES, DEVELOPER_ENVIRONMENT_ARCHIVE_INDEX),
  )
}

/** A half that no entry has reached yet has no index file, which is an empty side rather than an error. */
async function readLedgerSide(repoRoot: string, entriesDirectory: string, indexPath: string): Promise<LedgerSide> {
  const entriesPath = FS.resolvePath(entriesDirectory, repoRoot)
  if (!(await FS.isDirectory(entriesPath))) {
    return { entries: [], index: '' }
  }
  const entries: LedgerEntry[] = []
  for (const name of await FS.listDir(entriesPath)) {
    if (!name.endsWith('.md')) {
      continue
    }
    const source = await FS.readText(FS.resolvePath(name, entriesPath))
    entries.push({
      heading: source.match(/^# (.+)$/m)?.[1]?.trim() ?? '',
      name,
      section: source.match(/^- \*\*Section:\*\* (.*)$/m)?.[1]?.trim() ?? '',
      status: source.match(/^- \*\*Status:\*\* (.*)$/m)?.[1]?.trim() ?? '',
      statusMultiline: /^- \*\*Status:\*\* [^\n]*\n[ \t]{2,}\S/m.test(source),
    })
  }
  const index = FS.resolvePath(indexPath, repoRoot)
  return { entries, index: (await FS.exists(index)) ? await FS.readText(index) : '' }
}

/** writeDeveloperEnvironmentLedgerIndexes regenerates both ledger index files from their entry files; the `_fix-ledger-index` gate runs this. */
export async function writeDeveloperEnvironmentLedgerIndexes(repoRoot = Repo.getRoot()): Promise<void> {
  const open = await readLedgerSide(repoRoot, DEVELOPER_ENVIRONMENT_ENTRIES, DEVELOPER_ENVIRONMENT_INDEX)
  const archived = await readLedgerSide(
    repoRoot,
    DEVELOPER_ENVIRONMENT_ARCHIVE_ENTRIES,
    DEVELOPER_ENVIRONMENT_ARCHIVE_INDEX,
  )
  const { archiveIndex, openIndex } = developerEnvironmentIndexes(open, archived)
  await FS.writeText(FS.resolvePath(DEVELOPER_ENVIRONMENT_INDEX, repoRoot), openIndex)
  await FS.writeText(FS.resolvePath(DEVELOPER_ENVIRONMENT_ARCHIVE_INDEX, repoRoot), archiveIndex)
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
  for await (
    const path of FS.walk(directoryPath, {
      excludeDirectory: name => name === '.tao' || name === 'node_modules',
      includeHidden: true,
    })
  ) {
    const relativePath = FS.relativePath(directoryPath, path)
    // walk yields directory symlinks as files; skip generated roots before attempting a read.
    if (!isWordFlowerParityFile({ path: relativePath, source: '' })) {
      continue
    }
    const bytes = await FS.readFile(path)
    files.push({
      bytes,
      path: relativePath,
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
