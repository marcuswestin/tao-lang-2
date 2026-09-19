import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/**
 * Knip finds exported symbols nothing imports. Three of this repository's own conventions are
 * invisible to it, and each one turns live code into a false report:
 *
 *  - A `.tao` source binds TypeScript exports by name (`action SyncDraft(…) from ./Actions.ts`).
 *    Knip reads no `.tao` file, so every bound export looks like an orphan.
 *  - `packages/shared` and friends publish a module as a namespace object (`import * as FS` then
 *    `export { FS }`). Knip resolves the namespace import but not the member access consumers
 *    perform through the re-export, so it reports every member the owning package never calls.
 *  - `@ast-utils` republishes types through a declaration-merged namespace of `import('./M').Name`
 *    queries, which knip does not read as imports at all.
 *
 * All three are answered by restoring the missing edge rather than by muting a rule: a `.tao`
 * binding is matched against the exact file and symbol it names, a facade member is kept only when
 * a module that really binds the facade name writes `Facade.member`, and a type query is read as
 * the import it is. Scoping that member match to importers matters: an unrelated `Errors` or `Text`
 * of a module's own would otherwise vouch for every same-named member of the facade. A
 * same-named export in a different file stays reported — which is the whole point, since the dead
 * `CreateFile` this repository removed lived one file away from the live `CreateFile` a `.tao` view
 * binds.
 *
 * What is configuration rather than analysis lives in `config/knip.json`: which directories are
 * workspaces, and which files are entry points. Entry points are the modules something outside the
 * import graph starts — a test file, a spawned process, or a bundle's `entrypoints`
 * (`StudioPackagedService.ts`, `StudioPackagedService.ts`, `TaoStudioBrowser.tsx`). Their own exports
 * are the surface they exist to publish, so knip does not report them.
 *
 * Findings fail this check. An export nothing imports is dead weight, and a report nobody has to
 * act on is how it accumulates; the remedy is almost always to drop the `export` keyword from a
 * symbol whose own module is its only user, which the typechecker proves right or wrong at once.
 *
 * What may survive is an export something outside the TypeScript import graph really reaches: a
 * consumer of `@tao/runtime`, of the published `tao` CLI, or of `@tao/*`, or a module loaded as
 * text rather than imported. Each of those is recorded in the declaring package, in a file named
 * for the one reason its exports are there — `packages/tao-cli/cli-src/subprocess-test-api.ts` is
 * the only such record today — which `config/knip.json` declares an entry point by path so the
 * record does not itself read as dead. That is knip's own documented answer — re-export from an
 * entry file — rather than the per-symbol `@public` JSDoc tag knip also offers and its own guide
 * discourages. One file per reason, not one per package: a second reason earns a second named file,
 * so no record decays into a list of exports nobody can account for. A record is a claim that
 * something uses the symbol, and is deleted when that stops being true.
 *
 * The other failure is the check going stale: a `.tao` binding form this scanner cannot read, or
 * one naming a file or symbol that is not there. Either means the filter is now hiding real
 * findings, and that must never pass silently.
 */

/** Where the repository's TypeScript lives, matching the workspaces `config/knip.json` declares. */
const PROJECT_ROOTS = ['Apps', 'packages']

/** The `.tao` source extensions, including the Revolution tranches that carry future syntax. */
const TAO_EXTENSIONS = ['.tao', '.tao-next', '.tao-revolution']

/** Directories that hold no authored source; `_gen_*` is knip's ignore and dprint's too. */
const EXCLUDED_DIRECTORIES = (name: string) => name === 'node_modules' || name.startsWith('_gen_')

/** The issue lists knip's JSON reporter uses for unused exported symbols. */
const KNIP_EXPORT_KEYS = ['enumMembers', 'exports', 'nsExports', 'nsTypes', 'types'] as const

/**
 * A relative module path, as the `USE_IMPORT_PATH` terminal in `parser-grammar/terminals.langium`
 * spells its `./…` and `../…` alternatives. The package alternatives of that terminal are Tao
 * packages rather than TypeScript modules and are deliberately not matched.
 */
const TAO_RELATIVE_PATH = String.raw`\.{1,2}/[\w.\-@/]*`

/** `<expression> from <path>` and every declaration form that ends in it. */
const TAO_FROM_BINDING = new RegExp(String.raw`\bfrom\s+(${TAO_RELATIVE_PATH})`, 'g')

/** `action Name(…) = inject "<path>"`: the Revolution binding, which names a default export. */
const TAO_INJECT_BINDING = new RegExp(String.raw`=\s*inject\s+"(${TAO_RELATIVE_PATH})"`)

/**
 * Clauses the grammar allows between a foreign declaration's head and its `from`. Stripping them
 * leaves the head ending in its parameter list, so one backward scan reads the export name out of
 * every binding form: `runs latest` and `fails <case> "<sentence>"` (actions.langium), `responds`
 * and `accepts [content] [slots …]` (views.langium).
 *
 * `returns <type>` is the one entry no grammar rule produces yet. `TAO_EXTENSIONS` deliberately
 * includes the `.tao-revolution` spec tiers, which are written to
 * `Docs/Roadmap/Tao Revolution/Decisions.md` §2 rather than to today's grammar and give a foreign
 * action a return type; stripping the clause keeps this check reading those tiers instead of
 * reporting every one of their bindings as a form it cannot read.
 */
const TAO_BINDING_TAILS = [
  /\s+runs\s+latest$/,
  /\s+fails\s+[A-Za-z_]\w*\s+"(?:[^"\\]|\\.)*"$/,
  /\s+responds\s+[A-Za-z_]\w*$/,
  /\s+accepts(?:\s+[A-Za-z_]\w*)?(?:\s+slots\s+@[\w.\-@/]+(?:\s*,\s*@[\w.\-@/]+)*)?$/,
  /\s+returns\s+[A-Za-z_]\w*$/,
]

/**
 * How many earlier lines a wrapped foreign declaration head may span before `from`. Only a line that
 * strips to nothing continues the search, so the practical span is the declaration's clause count.
 */
const TAO_WRAPPED_HEAD_LIMIT = 4

/** `import * as <Alias> from '<relative path>'`, the first half of a namespace facade. */
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+(\w+)\s+from\s+'(\.{1,2}\/[^']*)'/g

/**
 * `import … from '…'` and `export … from '…'`: every statement that binds a name a module got from
 * somewhere else. dprint starts each one on its own line, so anchoring to a line keeps the capture
 * inside one statement even though this repository writes no semicolons.
 */
const MODULE_BINDING_STATEMENT = /^[ \t]*(?:import|export)\s+([^;]*?)\s+from\s+['"][^'"]+['"]/gm

/** `* as Local` and `Exported as Local`: the clause forms whose local name is not the written one. */
const RENAMED_BINDING = /(?:^|\s)(?:\*|[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/

/** `Name` and `type Name`: the clause forms bound under the name they are written as. */
const DIRECT_BINDING = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)\s*$/

/** `<Bound>.<Facade>.`: a facade reached through a namespace import of the package that publishes it. */
const NESTED_FACADE_REFERENCE = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\./g

/**
 * `import('<relative path>').Name`, the type query a declaration-merged namespace uses to republish
 * a type — `ASTUtils` in `@ast-utils` is built entirely out of them. Knip resolves import statements
 * but not this form, so the types it republishes look like orphans; reading it here adds the edge
 * back rather than muting the rule for the package.
 */
const TYPE_IMPORT_REFERENCE = /import\(\s*'(\.{1,2}\/[^']*)'\s*\)\.(\w+)/g

/** UnusedExport is one exported symbol knip found no importer for. */
export type UnusedExport = {
  file: string
  line: number
  name: string
}

/** SourceFile is one repository file the scanners read, addressed the way knip reports it. */
export type SourceFile = {
  path: string
  source: string
}

/** TaoForeignBinding is one `.tao` reach into TypeScript: the module it names and the export in it. */
export type TaoForeignBinding = {
  line: number
  name: string
  path: string
}

/** TaoBindingScan separates the bindings one `.tao` source declares from the ones it garbles. */
export type TaoBindingScan = {
  bindings: readonly TaoForeignBinding[]
  unreadable: readonly number[]
}

/** unusedExportsOf reads knip's JSON report into one flat list, sorted for a stable report. */
export function unusedExportsOf(report: unknown): UnusedExport[] {
  const issues = (report as { issues?: unknown })?.issues
  if (!Array.isArray(issues)) {
    Errors.throwHostEnvironment('knip produced no JSON report to read.')
  }
  const unused: UnusedExport[] = []
  for (const issue of issues as readonly Record<string, unknown>[]) {
    const file = typeof issue['file'] === 'string' ? issue['file'] : undefined
    if (file === undefined) {
      continue
    }
    for (const key of KNIP_EXPORT_KEYS) {
      for (const entry of Array.isArray(issue[key]) ? issue[key] as readonly Record<string, unknown>[] : []) {
        if (typeof entry['name'] === 'string') {
          unused.push({ file, line: typeof entry['line'] === 'number' ? entry['line'] : 0, name: entry['name'] })
        }
      }
    }
  }
  return unused.sort(compareUnusedExports)
}

/**
 * taoForeignBindings reads every TypeScript export one `.tao` source binds. The grammar has four
 * such forms plus the Revolution `inject` form, and all five put the export name immediately left
 * of the module path once the declaration tails are stripped:
 *
 *  - `ForeignActionImplementation` (actions.langium): `action Name(…) [runs latest] [fails …]* from <path>`
 *  - `ForeignViewImplementation` (views.langium): `view Name(…) [responds T] [accepts …] from <path>`
 *  - `ConfigurationImplementation` (configuration.langium): `nav|provider ExportName from <path>`
 *  - `FromExpression` (expressions.langium): `Name(…) from <path>` or `Name from <path>`, whose
 *    export is the call's function or the reference's target — the compiler's `bridgeExportName`
 *  - `action Name(…) = inject "<path>"`, the Revolution form, which binds the module's default
 *
 * `use … from <path>` (imports.langium) names a Tao package rather than a module and is skipped,
 * as is anything inside a ```ts injection, whose body the compiler emits as its own module.
 */
export function taoForeignBindings(source: string): TaoBindingScan {
  const bindings: TaoForeignBinding[] = []
  const unreadable: number[] = []
  let injecting = false
  const rawLines = maskTaoComments(source).split('\n')
  const codeLines = rawLines.map(maskTaoStrings)
  rawLines.forEach((rawLine, index) => {
    const code = codeLines[index]!
    const fences = (code.match(/```/g) ?? []).length
    const insideInjection = injecting
    if (fences % 2 === 1) {
      injecting = !injecting
    }
    if (insideInjection || injecting) {
      return
    }
    const line = rawLine
    const injected = TAO_INJECT_BINDING.exec(line)
    if (injected !== null && code[injected.index] === '=') {
      bindings.push({ line: index + 1, name: 'default', path: injected[1]! })
      return
    }
    if (/^\s*use\b/.test(line)) {
      return
    }
    for (const match of code.matchAll(TAO_FROM_BINDING)) {
      const head = code.slice(0, match.index)
      const name = boundExportName(head) ?? wrappedExportName(codeLines, index, head)
      if (name === undefined) {
        unreadable.push(index + 1)
        continue
      }
      bindings.push({ line: index + 1, name, path: match[1]! })
    }
  })
  return { bindings, unreadable }
}

/**
 * wrappedExportName reads the export name of a foreign declaration whose head wraps before its
 * `from`, which is how `Decisions.md` §15 writes one carrying several `fails` clauses:
 *
 * ```tao
 * action Publish(Value text)
 *    fails Offline "Publishing is unavailable."
 *    from ./Api.ts
 * ```
 *
 * It joins earlier lines one at a time, nearest first, and stops at the first that reads. Joining is
 * attempted only when `from` opens its own line, so a line carrying its own head text is never
 * completed from its neighbour, and a blank line ends the search because no declaration spans one.
 */
function wrappedExportName(codeLines: string[], index: number, head: string): string | undefined {
  if (head.trim() !== '') {
    return undefined
  }
  let joined = head
  for (let earlier = index - 1; earlier >= 0 && index - earlier <= TAO_WRAPPED_HEAD_LIMIT; earlier--) {
    const line = codeLines[earlier]!
    if (line.trim() === '') {
      return undefined
    }
    joined = `${line} ${joined}`
    const name = boundExportName(joined, 'parameter list required')
    if (name !== undefined) {
      return name
    }
  }
  return undefined
}

/** maskTaoComments preserves lines and strings while hiding both Tao comment forms from the binding scan. */
function maskTaoComments(source: string): string {
  let output = ''
  let inBlockComment = false
  let inString = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    const next = source[index + 1]
    if (character === '\n') {
      output += character
      continue
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        output += '  '
        index += 1
        inBlockComment = false
      } else {
        output += ' '
      }
      continue
    }
    if (inString) {
      output += character
      if (character === '\\' && next !== undefined) {
        output += next
        index += 1
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      output += character
    } else if (character === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index)
      const end = lineEnd === -1 ? source.length : lineEnd
      output += ' '.repeat(end - index)
      index = end - 1
    } else if (character === '/' && next === '*') {
      output += '  '
      index += 1
      inBlockComment = true
    } else {
      output += character
    }
  }
  return output
}

/** maskTaoStrings keeps character offsets stable while hiding prose that only resembles a binding. */
function maskTaoStrings(line: string): string {
  let output = ''
  let inString = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (!inString) {
      inString = character === '"'
      output += character
      continue
    }
    output += character === '"' ? '"' : ' '
    if (character === '\\' && line[index + 1] !== undefined) {
      output += ' '
      index += 1
    } else if (character === '"') {
      inString = false
    }
  }
  return output
}

/**
 * boundExportName reads the export name out of the text left of a `from`. After the declaration
 * tails are stripped the name is the identifier before the path, skipping one balanced parameter
 * or argument list — the same shape whether the binding is a declaration or a bridged expression.
 *
 * `'parameter list required'` refuses a head that does not end in one. A same-line read accepts
 * either shape, because `nav Export from ./X.ts` legitimately has no list. A wrapped read must not:
 * it walks backwards past lines it could not strip, so without the requirement an unstripped clause
 * or an unrelated neighbouring line donates its last identifier — `fails Offline InviteUsed` binds
 * the phrase, `runs single` binds `single`, and `let Other = Thing` binds `Thing`. Every declaration
 * form whose head can wrap has clauses between its parameter list and its `from`, so requiring the
 * list costs nothing and keeps a misread binding an `unreadable` one, which is the case the report
 * calls serious.
 */
function boundExportName(head: string, shape?: 'parameter list required'): string | undefined {
  let text = head.trimEnd()
  for (let stripped = true; stripped;) {
    stripped = false
    for (const tail of TAO_BINDING_TAILS) {
      const shorter = text.replace(tail, '')
      if (shorter !== text) {
        text = shorter
        stripped = true
      }
    }
  }
  if (!text.endsWith(')')) {
    return shape === 'parameter list required' ? undefined : /([A-Za-z_]\w*)$/.exec(text)?.[1]
  }
  text = text.slice(0, openingParenthesisIndex(text)).trimEnd()
  return /([A-Za-z_]\w*)$/.exec(text)?.[1]
}

/** openingParenthesisIndex returns where the parenthesis group a text ends with was opened. */
function openingParenthesisIndex(text: string): number {
  let depth = 0
  for (let index = text.length - 1; index >= 0; index--) {
    const character = text[index]
    if (character === ')') {
      depth++
    } else if (character === '(') {
      depth--
      if (depth === 0) {
        return index
      }
    }
  }
  return 0
}

/**
 * namespaceFacadeAliases maps each module published as a namespace object to the names it is
 * published under. A facade is `import * as <Alias> from './Module'` in a file that then re-exports
 * `<Alias>`, which is how `@shared` publishes `FS`, `HCI`, and the rest.
 */
export function namespaceFacadeAliases(files: readonly SourceFile[]): Map<string, Set<string>> {
  const known = new Set(files.map(file => file.path))
  const aliases = new Map<string, Set<string>>()
  for (const file of files) {
    for (const match of file.source.matchAll(NAMESPACE_IMPORT)) {
      const alias = match[1]!
      if (!new RegExp(String.raw`export\s*\{[^}]*\b${alias}\b[^}]*\}`, 's').test(file.source)) {
        continue
      }
      const target = resolveModulePath(file.path, match[2]!, known)
      if (target === undefined) {
        continue
      }
      aliases.set(target, (aliases.get(target) ?? new Set<string>()).add(alias))
    }
  }
  return aliases
}

/** resolveModulePath resolves a relative import specifier against the files that were scanned. */
function resolveModulePath(fromPath: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  const target = FS.slashPath(FS.joinPath(`${FS.dirname(fromPath)}/${specifier}`))
  return ['', '.ts', '.tsx', '/index.ts'].map(suffix => `${target}${suffix}`).find(path => known.has(path))
}

/**
 * moduleBoundNames returns the local names a module binds from other modules, so `Alias.member` can
 * be read as a reach through `Alias` rather than as a member of whatever else that name might be.
 */
export function moduleBoundNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const statement of source.matchAll(MODULE_BINDING_STATEMENT)) {
    for (const segment of statement[1]!.replace(/[{}]/g, ',').split(',')) {
      const binding = RENAMED_BINDING.exec(segment) ?? DIRECT_BINDING.exec(segment)
      if (binding !== null && binding[1] !== 'type') {
        names.add(binding[1]!)
      }
    }
  }
  return names
}

/**
 * facadeNamesIn returns the facade names one module is in a position to write. A module holds a
 * facade either by binding its name (`import { FS } from '@shared'`) or by binding the package that
 * publishes it and reaching through that (`import * as Shared` then `Shared.FS.readText`).
 */
function facadeNamesIn(source: string): Set<string> {
  const bound = moduleBoundNames(source)
  const names = new Set(bound)
  for (const match of source.matchAll(NESTED_FACADE_REFERENCE)) {
    if (bound.has(match[1]!)) {
      names.add(match[2]!)
    }
  }
  return names
}

/**
 * maskTypeScriptProse blanks comment bodies and single- and double-quoted string bodies, keeping
 * every other character and every offset where it was. Template literals are deliberately untouched:
 * their `${…}` holes hold real code, and blanking them would turn a live reference into a dead one.
 */
export function maskTypeScriptProse(source: string): string {
  let output = ''
  let index = 0
  let quote: string | undefined
  let blockComment = false
  while (index < source.length) {
    const character = source[index]!
    const next = source[index + 1]
    if (blockComment) {
      if (character === '*' && next === '/') {
        output += '  '
        index += 2
        blockComment = false
        continue
      }
      output += character === '\n' ? character : ' '
      index += 1
      continue
    }
    if (quote !== undefined) {
      if (character === '\\') {
        output += '  '
        index += 2
        continue
      }
      if (character === quote) {
        output += character
        quote = undefined
        index += 1
        continue
      }
      // An unterminated quote ends at the line break, exactly as the language says it does.
      if (character === '\n') {
        output += character
        quote = undefined
        index += 1
        continue
      }
      output += ' '
      index += 1
      continue
    }
    if (character === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index)
      const end = lineEnd === -1 ? source.length : lineEnd
      output += ' '.repeat(end - index)
      index = end
      continue
    }
    if (character === '/' && next === '*') {
      output += '  '
      index += 2
      blockComment = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      output += character
      index += 1
      continue
    }
    output += character
    index += 1
  }
  return output
}

/**
 * facadeReachedMembers returns the `<file>#<member>` keys a facade module publishes and some other
 * module really reaches. A file counts only when it holds the facade name — imported, re-exported,
 * or reached through a bound namespace. Without that, an unrelated local `FS` — a parameter, a
 * const, a class — silently kept every `FS.*` member alive, which is a missed finding rather than a
 * visible one.
 *
 * Inside a file that does hold the name, the reference is read textually out of code alone:
 * comments and quoted strings are masked first, so a member named only in prose or in a message no
 * longer keeps itself out of the report. Template literals are left intact, because `${Alias.member}`
 * is a real reference and masking it would call live code dead.
 *
 * One approximation is left in on purpose: a reference in a scope where the imported name is
 * shadowed by a local one still counts. Over-matching there costs a missed finding, which is the
 * direction to err in when the alternative is proposing the removal of live code.
 */
export function facadeReachedMembers(
  files: readonly SourceFile[],
  aliases: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const heldNames = new Map(files.map(file => [file.path, facadeNamesIn(file.source)]))
  const code = new Map(files.map(file => [file.path, maskTypeScriptProse(file.source)]))
  const reached = new Set<string>()
  for (const [path, moduleAliases] of aliases) {
    for (const alias of moduleAliases) {
      const reference = new RegExp(String.raw`\b${alias}\.(\w+)\b`, 'g')
      for (const file of files) {
        if (file.path === path || !heldNames.get(file.path)?.has(alias)) {
          continue
        }
        for (const match of (code.get(file.path) ?? file.source).matchAll(reference)) {
          reached.add(`${path}#${match[1]!}`)
        }
      }
    }
  }
  return reached
}

/** typeImportedMembers returns the `<file>#<name>` keys an `import('…').Name` type query reaches. */
export function typeImportedMembers(files: readonly SourceFile[]): Set<string> {
  const known = new Set(files.map(file => file.path))
  const reached = new Set<string>()
  for (const file of files) {
    for (const match of file.source.matchAll(TYPE_IMPORT_REFERENCE)) {
      const target = resolveModulePath(file.path, match[1]!, known)
      if (target !== undefined) {
        reached.add(`${target}#${match[2]!}`)
      }
    }
  }
  return reached
}

/** DeadExportReview is one run's outcome: what to report, what was explained, and what went stale. */
export type DeadExportReview = {
  facadeReached: number
  reported: readonly UnusedExport[]
  staleness: readonly string[]
  taoBound: number
  typeImported: number
}

/** reviewUnusedExports removes the exports this repository's own conventions account for. */
export function reviewUnusedExports(
  unused: readonly UnusedExport[],
  boundKeys: ReadonlySet<string>,
  reachedKeys: ReadonlySet<string>,
  typeImportedKeys: ReadonlySet<string>,
  staleness: readonly string[] = [],
): DeadExportReview {
  const reported: UnusedExport[] = []
  let facadeReached = 0
  let taoBound = 0
  let typeImported = 0
  for (const entry of unused) {
    const key = `${entry.file}#${entry.name}`
    if (boundKeys.has(key)) {
      taoBound++
    } else if (reachedKeys.has(key)) {
      facadeReached++
    } else if (typeImportedKeys.has(key)) {
      typeImported++
    } else {
      reported.push(entry)
    }
  }
  return { facadeReached, reported, staleness: [...staleness].sort(), taoBound, typeImported }
}

/** DeadExportsOptions lets a test substitute knip; the workflow always runs the installed one. */
export type DeadExportsOptions = {
  readKnipReport?: (repositoryRoot: string) => Promise<unknown>
  repositoryRoot?: string
}

/** runDeadExports fails on every unused export the repository's own bindings do not explain. */
export async function runDeadExports(options: DeadExportsOptions = {}): Promise<number> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const readKnipReport = options.readKnipReport ?? runKnip
  const unused = unusedExportsOf(await readKnipReport(repositoryRoot))
  const taoFiles = await readSourceFiles(repositoryRoot, TAO_EXTENSIONS)
  const typescriptFiles = await readSourceFiles(repositoryRoot, ['.ts', '.tsx'])
  const bound = resolveTaoBindings(taoFiles, typescriptFiles)
  const review = reviewUnusedExports(
    unused,
    bound.keys,
    facadeReachedMembers(typescriptFiles, namespaceFacadeAliases(typescriptFiles)),
    typeImportedMembers(typescriptFiles),
    bound.staleness,
  )

  for (const entry of review.reported) {
    HCI.writeErrorLine(`dead exports: ${entry.file}:${entry.line} ${entry.name} is exported but never imported.`)
  }
  HCI.writeLine(
    `dead exports: ${review.reported.length} unused, `
      + `${review.taoBound} bound from .tao sources, `
      + `${review.facadeReached} reached through a namespace facade, `
      + `${review.typeImported} republished by an import-type query.`,
  )
  if (review.reported.length > 0) {
    HCI.writeErrorLine(
      'Remove each symbol, or drop its `export` where its own module is the only user. An export '
        + 'something outside the TypeScript import graph really reaches is re-exported instead from '
        + 'a file in the declaring package named for which consumer reaches it, added to that '
        + "package's entry points in config/knip.json.",
    )
  }

  for (const issue of review.staleness) {
    HCI.writeErrorLine(`dead exports: ${issue}`)
  }
  if (review.staleness.length > 0) {
    HCI.writeErrorLine(
      'The .tao binding scanner in packages/dev/dev-src/repository-tests/DeadExports.ts no longer '
        + 'reads these bindings, so it is hiding real findings. Teach it the form, or fix the binding.',
    )
  }
  return review.reported.length > 0 || review.staleness.length > 0 ? 1 : 0
}

/**
 * resolveTaoBindings turns each `.tao` binding into the `<file>#<export>` key knip reports under,
 * and reports the drift that would make the filter wrong. A binding the scanner cannot read at all
 * is the serious one: its export stays in the report as a false positive. A binding naming a symbol
 * its module does not declare means the scanner read the wrong word, and whatever it did match is
 * no longer trustworthy. An unresolved module is only drift in a `.tao` source; the `.tao-next` and
 * `.tao-revolution` tranches describe sidecars that graduate with the syntax and need not exist.
 */
export function resolveTaoBindings(
  taoFiles: readonly SourceFile[],
  typescriptFiles: readonly SourceFile[],
): { keys: Set<string>; staleness: string[] } {
  const sources = new Map(typescriptFiles.map(file => [file.path, file.source]))
  const keys = new Set<string>()
  const staleness: string[] = []
  for (const file of taoFiles) {
    const scan = taoForeignBindings(file.source)
    for (const line of scan.unreadable) {
      staleness.push(`${file.path}:${line} binds a TypeScript module in a form this check cannot read.`)
    }
    for (const binding of scan.bindings) {
      const target = FS.slashPath(FS.joinPath(`${FS.dirname(file.path)}/${binding.path}`))
      const source = sources.get(target)
      if (source === undefined) {
        if (file.path.endsWith('.tao')) {
          staleness.push(`${file.path}:${binding.line} binds ${binding.path}, which is not a scanned module.`)
        }
      } else if (!new RegExp(String.raw`\b${binding.name}\b`).test(source)) {
        staleness.push(`${file.path}:${binding.line} binds ${binding.name}, which ${target} does not declare.`)
      } else {
        keys.add(`${target}#${binding.name}`)
        // An entry may publish the name from a sibling module (`export { Name } from './part'`); the
        // `.tao` source binds the entry, but the export knip sees as orphaned is the sibling's.
        for (const origin of reexportOrigins(target, binding.name, sources)) {
          keys.add(`${origin}#${binding.name}`)
        }
      }
    }
  }
  return { keys, staleness }
}

/** reexportOrigins follows `export { … Name … } from './module'` chains from `path` to where `Name` is declared. */
function reexportOrigins(path: string, name: string, sources: ReadonlyMap<string, string>): string[] {
  const origins: string[] = []
  const known = new Set(sources.keys())
  const seen = new Set<string>([path])
  let current: string | undefined = path
  while (current !== undefined) {
    const source = sources.get(current) ?? ''
    let next: string | undefined
    for (const match of source.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const names = match[1]!.split(',').map(entry => entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1))
      if (names.includes(name)) {
        next = resolveModulePath(current, match[2]!, known)
        break
      }
    }
    if (next === undefined || seen.has(next)) {
      break
    }
    seen.add(next)
    origins.push(next)
    current = next
  }
  return origins
}

/** runKnip runs the installed knip and parses its JSON report; a findings run exits non-zero. */
async function runKnip(repositoryRoot: string): Promise<unknown> {
  const node = FS.resolvePath('.devenv/profile/bin/node', repositoryRoot)
  const result = await CLI.run(await FS.isFile(node) ? node : 'node', {
    args: [
      'node_modules/knip/bin/knip.js',
      '--config',
      'config/knip.json',
      '--no-progress',
      '--reporter',
      'json',
    ],
    cwd: repositoryRoot,
    stdio: 'pipe',
  })
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    Errors.throwHostEnvironment(`knip produced no JSON report:\n${result.stderr || result.stdout}`, { cause: error })
  }
}

/** readSourceFiles reads the authored files under the roots config/knip.json declares as workspaces. */
async function readSourceFiles(repositoryRoot: string, extensions: readonly string[]): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  for (const root of PROJECT_ROOTS) {
    const rootPath = FS.resolvePath(root, repositoryRoot)
    if (!await FS.isDirectory(rootPath)) {
      continue
    }
    for await (const path of FS.walk(rootPath, { excludeDirectory: EXCLUDED_DIRECTORIES, extensions })) {
      files.push({ path: FS.relativePath(repositoryRoot, path), source: await FS.readText(path) })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function compareUnusedExports(left: UnusedExport, right: UnusedExport): number {
  return left.file.localeCompare(right.file) || left.line - right.line || left.name.localeCompare(right.name)
}

if (import.meta.main) {
  Platform.runtimeProcess.setExitCode(await runDeadExports())
}
