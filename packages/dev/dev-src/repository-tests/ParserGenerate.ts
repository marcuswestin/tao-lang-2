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
const ACCEPTED_DIAGNOSTICS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^parser-grammar\/imports\.langium:\d+:\d+ - This rule is declared but never referenced\.$/,
    reason: 'PackageMemberReference is called by ViewDeclaration and TypeDeclaration in other grammar files',
  },
  {
    pattern: /^parser-grammar\/actions\.langium:\d+:\d+ - This rule is declared but never referenced\.$/,
    reason: 'CommandDeclaration is called by AppBlockDiagnosticStatement in blocks.langium',
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
export function reviewParserGenerateOutput(output: string): ParserGenerateReview {
  const accepted: string[] = []
  const unexpected: string[] = []
  for (const line of output.split(/\r?\n/).map(entry => entry.trim())) {
    if (!DIAGNOSTIC_PATTERN.test(line)) {
      continue
    }
    ;(ACCEPTED_DIAGNOSTICS.some(entry => entry.pattern.test(line)) ? accepted : unexpected).push(line)
  }
  return { accepted, unexpected }
}

/** acceptedDiagnosticReasons explains, for the terminal, why each accepted diagnostic is kept. */
export function acceptedDiagnosticReasons(): readonly string[] {
  return ACCEPTED_DIAGNOSTICS.map(entry => entry.reason)
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

  const review = reviewParserGenerateOutput(output)
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

if (import.meta.main) {
  Platform.runtimeProcess.setExitCode(await runParserGenerate())
}
