import { CLI, FS, HCI, Platform, Repo } from '@shared'

/**
 * Langium's generator prints diagnostics that nothing reads, so a new one is indistinguishable
 * from the two the repository already carries. This runs the generator unchanged and turns that
 * around: the known diagnostics are named and allowed, and any other one fails the step.
 *
 * Suppression is per diagnostic and documented, never a switch that turns the generator's own
 * checks off — a genuinely dead rule must still be reported the first time it appears.
 */

/**
 * Diagnostics Langium reports that are not true. Langium's reachability check walks from each
 * grammar file's own entry rule, so a rule declared in one imported file and called only from
 * another is reported as unreferenced even though the parser uses it.
 */
const ACCEPTED_DIAGNOSTICS: readonly { file: string; reason: string; rule: string }[] = [
  {
    file: 'parser-grammar/imports.langium',
    reason: 'called by ViewDeclaration and TypeDeclaration in other grammar files',
    rule: 'PackageMemberReference',
  },
  {
    file: 'parser-grammar/actions.langium',
    reason: 'called by AppBlockDiagnosticStatement in blocks.langium',
    rule: 'CommandDeclaration',
  },
]

/** A diagnostic line, as Langium prints it: `<file>:<line>:<column> - <message>`. */
const DIAGNOSTIC_PATTERN = /^\S+\.langium:\d+:\d+ - .+$/

/** ParserGenerateReview separates the diagnostics that were expected from the ones that were not. */
export type ParserGenerateReview = {
  accepted: readonly string[]
  unexpected: readonly string[]
}

/** reviewParserGenerateOutput classifies every diagnostic the generator printed. */
export function reviewParserGenerateOutput(
  output: string,
  grammarSources: Record<string, string> = {},
): ParserGenerateReview {
  const accepted: string[] = []
  const unexpected: string[] = []
  for (const line of output.split(/\r?\n/).map(entry => entry.trim())) {
    if (!DIAGNOSTIC_PATTERN.test(line)) {
      continue
    }
    ;(isAcceptedDiagnostic(line, grammarSources) ? accepted : unexpected).push(line)
  }
  return { accepted, unexpected }
}

/**
 * A diagnostic is accepted only when it names the exact rule that was documented, which means
 * resolving the reported line back to the rule declared there. Matching on the file alone would
 * make every future dead rule in these two files invisible — the opposite of the intent.
 */
function isAcceptedDiagnostic(line: string, grammarSources: Record<string, string>): boolean {
  const parsed = /^(\S+\.langium):(\d+):\d+ - (.+)$/.exec(line)
  if (parsed === null) {
    return false
  }
  const [, file, lineNumber, message] = parsed
  return ACCEPTED_DIAGNOSTICS.some(entry =>
    entry.file === file
    && message === 'This rule is declared but never referenced.'
    && declaredRuleAt(grammarSources[file], Number(lineNumber)) === entry.rule
  )
}

/** declaredRuleAt reads the rule name a grammar line declares, which is the text before its colon. */
export function declaredRuleAt(source: string | undefined, lineNumber: number): string | undefined {
  const line = source?.split(/\r?\n/)[lineNumber - 1]
  return /^([A-Za-z_][\w]*)\s*(returns\s+\w+\s*)?:/.exec(line ?? '')?.[1]
}

/** acceptedDiagnosticReasons explains, for the terminal, why each accepted diagnostic is kept. */
export function acceptedDiagnosticReasons(): readonly string[] {
  return ACCEPTED_DIAGNOSTICS.map(entry => `${entry.rule} is ${entry.reason}`)
}

/** runParserGenerate regenerates the parser and fails on any diagnostic that is not documented. */
export async function runParserGenerate(repositoryRoot = Repo.getRoot()): Promise<number> {
  const parserRoot = FS.resolvePath('packages/parser', repositoryRoot)
  const node = FS.resolvePath('.devenv/profile/bin/node', repositoryRoot)
  const result = await CLI.run(await FS.isFile(node) ? node : 'node', {
    args: ['node_modules/langium-cli/bin/langium.js', 'generate'],
    cwd: parserRoot,
    stdio: 'pipe',
  })
  const output = `${result.stdout}${result.stderr}`
  HCI.write(output)
  if (result.error !== undefined || result.exitCode !== 0) {
    return result.exitCode ?? 1
  }

  const review = reviewParserGenerateOutput(output, await readGrammarSources(parserRoot))
  for (const diagnostic of review.unexpected) {
    HCI.writeErrorLine(`parser generate: ${diagnostic}`)
  }
  if (review.unexpected.length > 0) {
    HCI.writeErrorLine(
      'Fix the rule, or document the diagnostic in '
        + 'packages/dev/dev-src/repository-tests/ParserGenerate.ts if the generator is wrong about it.',
    )
    return 1
  }
  return 0
}

/** readGrammarSources loads the grammar files a diagnostic can name, keyed as Langium reports them. */
async function readGrammarSources(parserRoot: string): Promise<Record<string, string>> {
  const sources: Record<string, string> = {}
  for (const entry of ACCEPTED_DIAGNOSTICS) {
    const path = FS.resolvePath(entry.file, parserRoot)
    if (await FS.isFile(path)) {
      sources[entry.file] = await FS.readText(path)
    }
  }
  return sources
}

if (import.meta.main) {
  Platform.runtimeProcess.setExitCode(await runParserGenerate())
}
