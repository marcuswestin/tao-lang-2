import { CLI, FS, HCI, Platform, Repo } from '@shared'
import { readDelegationIssues } from '../delegation/DelegationProfiles'

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
  'packages/dev/studio-smoke/studio-real-app.test.ts',
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
 * A raw `Error` handed to a promise rejection reaches a reader exactly as a thrown one does. Each
 * exemption names one exact `path:line`, so an emitted script or a test probe cannot grant the rest
 * of its file permission to add more unclassified errors.
 */
const RAW_ERROR_ALLOWLIST = [
  // Emitted browser and Electrobun bodies, where no Tao module loads.
  'packages/dev/dev-src/studio/StudioCdp.ts:232',
  'packages/dev/dev-src/studio/StudioCdp.ts:283',
  'packages/dev/dev-src/studio/StudioCdp.ts:293',
  'packages/dev/dev-src/studio/StudioCdp.ts:330',
  'packages/dev/dev-src/studio/StudioCdp.ts:362',
  'packages/dev/dev-src/studio/StudioCdp.ts:522',
  'packages/dev/dev-src/studio/StudioCdp.ts:550',
  'packages/dev/dev-src/studio/StudioCdp.ts:719',
  'packages/dev/dev-src/studio/StudioCdp.ts:869',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:112',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:391',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:523',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:542',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:582',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:729',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:736',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:742',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:763',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:766',
  'packages/dev/studio-smoke/studio-real-app.test.ts:128',
  'packages/dev/studio-smoke/studio-real-app.test.ts:264',
  'packages/dev/studio-smoke/studio-real-app.test.ts:292',
  'packages/dev/studio-smoke/studio-real-app.test.ts:299',
  'packages/dev/studio-smoke/studio-real-app.test.ts:367',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:186',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:623',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:625',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:885',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:890',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:895',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:920',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:1159',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:1178',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:1287',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:1329',
  'packages/dev/studio-smoke/studio-simulated-user.test.ts:1355',
  'packages/runtime/TR-tests/TR-studio-preview.test.ts:56',
  'packages/runtime/TR-tests/TR-studio-preview.test.ts:78',
  'packages/runtime/TR-tests/TR-studio-preview.test.ts:355',
  'packages/studio/studio-src/StudioWelcome.ts:83',
  'packages/studio/studio-tests/studio-client.test.ts:626',
  'packages/studio/studio-tests/studio-client.test.ts:2996',
  // Expo config plugins execute as standalone CommonJS host scripts.
  'packages/icloud-native/plugins/with-tao-icloud.cjs:31',
  'packages/runtime-toolchain/plugins/with-ios-fmt-compat.cjs:14',
  // The shared leaf builds the Web-standard cancellation error itself.
  'packages/shared/shared-src/core/Errors.ts:160',
  // Tests hand raw unknown failures to production boundaries to prove their classification.
  'packages/dev/dev-tests/agent-config-generation.test.ts:44',
  'packages/dev/dev-tests/agent-config-generation.test.ts:84',
  'packages/dev/dev-tests/agent-config-generation.test.ts:107',
  'packages/dev/dev-tests/claude-profiles-generation.test.ts:87',
  'packages/dev/dev-tests/codex-config-generation.test.ts:211',
  'packages/dev/dev-tests/expo-dev-loop.test.ts:344',
  'packages/dev/dev-tests/studio-companion-device.test.ts:560',
  'packages/runtime-toolchain/runtime-toolchain-tests/studio-device-host-e2e.jest-test.tsx:232',
  'packages/runtime/TR-tests/TR-async.test.ts:43',
  'packages/runtime/TR-tests/TR-async.test.ts:57',
  'packages/runtime/TR-tests/TR-data.test.ts:387',
  'packages/runtime/TR-tests/TR-data.test.ts:616',
  'packages/runtime/TR-tests/TR-data.test.ts:963',
  'packages/runtime/TR-tests/TR-data.test.ts:981',
  'packages/runtime/TR-tests/TR-error-containment.test.ts:40',
  'packages/runtime/TR-tests/TR-error-containment.test.ts:46',
  'packages/runtime/TR-tests/TR-error-containment.test.ts:67',
  'packages/runtime/TR-tests/TR-error-containment.test.ts:69',
  'packages/runtime/TR-tests/TR-studio-device-client.test.ts:489',
  'packages/runtime/TR-tests/TR-studio-device-client.test.ts:510',
  'packages/runtime/TR-tests/TR-studio-device-client.test.ts:511',
  'packages/shared/shared-tests/test-helpers.test.ts:45',
  'packages/stdlib/stdlib-tests/data-providers.test.ts:86',
  'packages/studio/studio-tests/studio-server-datasource.test.ts:204',
]

const RAW_ERROR_DETAIL = 'constructs a raw `Error`; where an error object must exist rather than be thrown,'
  + ' build `new Errors.UserInputError(...)`, `new Errors.UnexpectedBehaviorError(...)`, or'
  + ' `new Errors.HostEnvironmentError(...)`, wrap an unknown with `Errors.asError(...)`, or cancel with `Errors.abortError(...)`.'

/*
 * Platform-wrapper conventions. Code reaches the host through the shared `CLI`, `FS`, `HCI`,
 * `Platform`, and `Time` wrappers rather than `node:` modules, the global console, the process
 * object, or Bun's convenience APIs. `packages/shared` is the wrappers themselves and
 * `packages/runtime` imports nothing from `@shared`, so both are outside these rules rather than
 * allowlisted. Each list is a ratchet like the raw-throw list: it names every file that still
 * reaches past a wrapper today, and an entry goes stale — and must be deleted — when its file is
 * swept.
 *
 * An entry that survives a sweep is one of two things, and says which: emitted text — a script body
 * rendered into a string, a bundler `define` key, a test asserting on generated source, a jest test
 * silencing the global it captures — or a seam no wrapper covers yet. `node:crypto` hashing and
 * signing, `node:net` sockets, and the stream classes a test constructs are the open seams; a new
 * use of one goes behind `Platform` rather than onto the list. A type-only `node:` import names a
 * shape, not a behavior, and is outside the import rule.
 */
const PLATFORM_WRAPPER_HOMES = ['packages/shared/', 'packages/runtime/']

const NODE_IMPORT_ALLOWLIST = [
  // `node:crypto` hashing, until a `Platform` digest seam exists.
  'packages/dev/dev-src/dev-data/DevDataBootstrap.ts:1',
  'packages/dev/dev-src/repository-tests/GreenTree.ts:2',
  'packages/dev/dev-src/repository-tests/ParserGenerate.ts:2',
  'packages/dev/dev-src/repository-tests/TestLedger.ts:2',
  'packages/dev/dev-src/studio/StudioCdp.ts:2',
  'packages/dev/dev-src/studio/StudioCdp.ts:3',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:697',
  'packages/dev/dev-src/studio/StudioElectrobun.ts:699',
  'packages/dev/dev-src/studio/StudioNative.ts:4',
  'packages/dev/dev-src/studio/StudioNative.ts:5',
  'packages/dev/dev-src/studio/StudioReview.ts:2',
  'packages/dev/dev-tests/studio-review.test.ts:3',
  'packages/tao-cli/cli-src/ship-executor.ts:3',
  'packages/tao-cli/cli-src/ship-model.ts:2',
  'packages/update-server/update-server-src/main.ts:3',
  'packages/update-server/update-server-src/update-service.ts:2',
  'packages/update-server/update-server-tests/update-server.test.ts:3',
  // `node:crypto` key signing for App Store Connect.
  'packages/tao-cli/cli-src/app-store-connect-auth.ts:2',
  'packages/tao-cli/cli-tests/app-store-connect-auth.test.ts:3',
  // `node:net` port probes and socket connections.
  'packages/dev/dev-src/expo-dev-loop/expo-runner/Ports.ts:2',
  'packages/dev/dev-tests/expo-dev-loop.test.ts:3',
  'packages/generation/generation-live/apple-foundation-models.live.ts:3',
  'packages/generation/generation-live/apple-foundation-models.live.ts:4',
  // Test fixtures that emit or describe direct Node imports without executing them in Tao code.
  'packages/dev/dev-tests/repo-lint.test.ts:468',
  'packages/dev/dev-tests/repo-lint.test.ts:469',
  'packages/dev/dev-tests/work-graph.test.ts:314',
  'packages/dev/dev-tests/work-graph.test.ts:315',
  // Stream classes a test constructs to stand in for a terminal.
  'packages/tao-cli/cli-tests/compile-command.test.ts:3',
  'packages/tao-cli/cli-tests/create-command.test.ts:4',
  'packages/tao-cli/cli-tests/dev-command.test.ts:3',
  'packages/tao-cli/cli-tests/test-cli-files.ts:3',
  // Studio's `node:fs` reads close with its own sweep onto `FS`.
  'packages/studio/studio-src/StudioClientAssets.ts:3',
  'packages/studio/studio-src/device/StudioDeviceTrustStore.ts:5',
  // Node-loaded configuration and Expo config plugins cannot use the ESM shared wrappers.
  'packages/runtime-toolchain/app-config.cjs:1',
  'packages/runtime-toolchain/app-config.cjs:2',
  'packages/runtime-toolchain/metro.config.cjs:2',
  'packages/runtime-toolchain/metro.config.cjs:3',
  'packages/runtime-toolchain/plugins/with-ios-fmt-compat.cjs:1',
  'packages/runtime-toolchain/plugins/with-ios-fmt-compat.cjs:2',
  // A test proves the packaged CommonJS entry can resolve its generated dependency.
  'packages/icloud-native/icloud-native-tests/icloud-native.test.ts:210',
]

const CONSOLE_CALL_ALLOWLIST = [
  // Browser code, where `HCI` has no stream to write to.
  'packages/code-editor/code-editor-src/CodeEditor.tsx',
  'packages/studio/studio-src/TaoStudioProductHost.tsx',
  'packages/studio/studio-src/product-host/StudioEditorSurface.tsx',
  // Device-side stdlib provider running inside the app, where `HCI` has no terminal either.
  'packages/stdlib/@tao/data/providers/icloud/ICloud.ts',
  // Emitted text: the Electrobun main, a `bun -e` body, and bundles a test writes to disk.
  'packages/dev/dev-src/studio/StudioElectrobun.ts',
  'packages/dev/dev-src/studio/StudioWatchHealth.ts',
  'packages/runtime-toolchain/runtime-toolchain-tests/release-bundle-proof.test.ts',
  'packages/update-server/update-server-tests/update-server.test.ts',
  // Tests that capture or silence the global a library writes through.
  'packages/runtime-toolchain/runtime-toolchain-tests/runtime-containment.jest-test.tsx',
  'packages/runtime-toolchain/runtime-toolchain-tests/studio-device-host-e2e.jest-test.tsx',
  'packages/tao-cli/cli-tests/completion-command.test.ts',
]

const PROCESS_ACCESS_ALLOWLIST = [
  // Emitted text: the Electrobun main, a bundler `define` key, child scripts a test renders, and
  // tests asserting on generated source.
  'packages/dev/dev-src/studio/StudioElectrobun.ts',
  'packages/dev/dev-src/studio/StudioNative.ts',
  'packages/dev/dev-tests/machine-lanes.test.ts',
  'packages/dev/dev-tests/native-host-lease.test.ts',
  'packages/dev/dev-tests/studio-electrobun.test.ts',
  'packages/dev/dev-tests/studio-port-lease.test.ts',
  'packages/dev/dev-tests/test-ledger.test.ts',
  'packages/runtime-toolchain/runtime-toolchain-tests/injections-e2e.jest-test.tsx',
  'packages/runtime-toolchain/runtime-toolchain-tests/runtime.test.ts',
  'packages/tao-cli/cli-tests/test-command-cli.test.ts',
  // Studio's environment reads close with its own sweep onto `Platform.runtimeProcess`.
  'packages/studio/studio-src/agent-chat/AgentChatProvider.ts',
  'packages/studio/studio-src/agent-chat/AgentChatServer.ts',
  'packages/studio/studio-tests/studio-agent-chat-server.test.ts',
]

/** The Electrobun main is emitted text that runs where no Tao module is loaded. */
const BUN_CONVENIENCE_ALLOWLIST = [
  'packages/dev/dev-src/studio/StudioElectrobun.ts',
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
const DEV_LAZY_IMPORT_DIRECTORIES = ['studio', 'expo-dev-loop']
/** Matches static imports and re-exports, wrapped or not, and never the `import(...)` call form. */
const STATIC_MODULE_PATTERN = /^(?:import\b(?!\s*\()|export\b)[^'"]*['"]([^'"]+)['"]/gm

/** devLazyStudioImportIssues reports static Studio or Expo imports in the `./dev` entry. */
export function devLazyStudioImportIssues(
  files: readonly SourceFile[],
  entryPath: string = DEV_ENTRY_PATH,
): string[] {
  const byPath = new Map(files.map(file => [file.path, file]))
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
      const forbidden = specifier === '@studio'
        || ['./studio', './expo-dev-loop'].some(prefix =>
          current.path === entryPath && (specifier === prefix || specifier.startsWith(`${prefix}/`))
        )
        || target !== undefined
          && DEV_LAZY_IMPORT_DIRECTORIES.some(directory => target.startsWith(`packages/dev/dev-src/${directory}/`))
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
  if (!specifier.startsWith('.')) {
    return undefined
  }
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
  const base = parts.join('/')
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

function conventionSiteIssues(
  files: readonly SourceFile[],
  matches: readonly ConventionMatch[],
  allowlist: readonly string[],
  staleDetail: string,
): string[] {
  const allowed = new Set(allowlist)
  const scanned = new Set(files.map(file => file.path))
  const matchSites = new Set(matches.map(match => `${match.path}:${match.line}`))
  return [
    ...matches.filter(match => !allowed.has(`${match.path}:${match.line}`)).map(issueLine),
    ...allowlist
      .filter(site => {
        const separator = site.lastIndexOf(':')
        const path = separator < 0 ? site : site.slice(0, separator)
        return scanned.has(path) && !matchSites.has(site)
      })
      .map(site => `${site} ${staleDetail}`),
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
  issues.push(...await readDelegationIssues(repoRoot))

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

  const executableFiles = await readExecutableFiles(repoRoot)
  const packageFiles = executableFiles.filter(file =>
    file.path.startsWith('packages/') && (file.path.endsWith('.ts') || file.path.endsWith('.tsx'))
  )
  issues.push(...duplicateDescribeTitleIssues(packageFiles.filter(file => file.path.endsWith('.test.ts'))))
  for (const [name, rule] of Object.entries(CONVENTION_RULES)) {
    const files = name === 'rawError' || name === 'nodeImport' ? executableFiles : packageFiles
    issues.push(...conventionRuleIssues(rule, files))
  }
  issues.push(...langiumImportIssues(packageFiles))
  issues.push(...crossPackageSourceImportIssues(packageFiles))
  issues.push(...devLazyStudioImportIssues(packageFiles))
  return issues
}

const EXECUTABLE_EXTENSIONS = ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']

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
