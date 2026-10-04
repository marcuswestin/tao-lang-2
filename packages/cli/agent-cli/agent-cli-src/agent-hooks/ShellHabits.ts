/** Detects the shell habits this repository's commands depend on, for the PreToolUse hook that
 * runs beside every Bash tool call. The matching is deliberately cheap rather than a shell parser:
 * it strips quoted spans first, so text inside a commit message or an `echo` is never read as a
 * command, then looks only at the command word of each pipeline stage.
 *
 * What is left here warns. Every habit whose cost cannot be undone by being told about it afterwards
 * belongs in `OutputDiscipline`, which refuses: recursive `grep`/`find`, a gate judged through a
 * pipe, and the rest. This module keeps the two habits a warning still serves — a prefix that sends
 * a command to permission review, and a pipe over a command whose output is the product rather than
 * a verdict. */

/** Repository commands whose exit status is a verdict. A pipe replaces that status with the filter's. */
const REPOSITORY_COMMANDS = new Set(['./agent', 'just', './dev'])
/** The same, where the command word alone is too broad and a subcommand decides. */
const REPOSITORY_SUBCOMMANDS: Record<string, string> = { bun: 'test', bunx: 'tsc' }
/** Filters that swallow the status of whatever is piped into them. */
export const OUTPUT_FILTERS = new Set(['tail', 'head', 'rg', 'grep', 'less', 'more', 'sort', 'uniq', 'wc'])
/** Words that precede the real command word rather than being one. */
const COMMAND_PREFIXES = new Set(['sudo', 'command', 'time', 'nice', 'env', 'exec', 'xargs', 'builtin', 'noglob'])

/**
 * `./agent` and `just` subcommands whose exit status is the whole point of running them, beyond the
 * `verify*` and `test*` families matched by prefix. Everything else `./agent help` lists — `board`,
 * `doctor`, `delegation-report`, `model-audit`, `report-test-stats`, `simplify-audit`, `capabilities`
 * — is a report whose output is the product, where filtering is ordinary work and the status is
 * incidental. That split is why the pipe rule denies in one place and warns in the other.
 */
const GATE_SUBCOMMANDS = new Set(['check', 'finalize', 'fix', 'fmt', 'fmt-file', 'setup'])

export const PREFIX_WARNING =
  'A command beginning with `cd `, `export `, or a `VAR=value ` prefix falls outside its permission allow rule in this worktree and goes to permission review instead. Commands here run from the worktree root with paths relative to it.'
export const PIPE_WARNING =
  'A pipeline reports the exit status of its last stage, so a repository command piped into a filter reads as success when the command itself failed. Capturing first keeps the status: `cmd > out 2>&1; echo "EXIT=$?"`, then read the file.'

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/
const STATUS_IS_READ = /pipefail|PIPESTATUS|pipestatus/

/** stripQuotedSpans removes double- then single-quoted spans, so quoted text is never read as a command. */
function stripQuotedSpans(command: string): string {
  return command.replace(/"[^"]*"/g, ' ').replace(/'[^']*'/g, ' ')
}

/** shellStatements splits a command into statements. A command substitution becomes a statement of its
 * own, because a gate judged through a pipe inside one is the same mistake with the same cost. */
function shellStatements(command: string): string[] {
  return command
    .replaceAll('$(', '\n')
    .replaceAll('`', '\n')
    .replaceAll('||', '\n')
    .replaceAll('&&', '\n')
    .replaceAll(';', '\n')
    .split('\n')
}

/** meaningfulWords returns a stage's words with grouping characters, leading assignments, and the
 * wrappers that precede a command rather than being one removed. */
function meaningfulWords(stage: string): string[] {
  const words = stage.replace(/^[\s({!]+/, '').split(/\s+/).filter(word => word !== '')
  const start = words.findIndex(word => !ASSIGNMENT_PREFIX.test(word) && !COMMAND_PREFIXES.has(word))
  return start === -1 ? [] : words.slice(start)
}

/** commandWord returns the command a pipeline stage runs. */
function commandWord(stage: string): string {
  return meaningfulWords(stage)[0] ?? ''
}

/**
 * isGateInvocation reports whether a command word and its first operand name a run whose exit status
 * is a verdict. `OutputDiscipline` shares this so that one command is never both denied there and
 * warned about here, which would put two voices beside the same refusal.
 */
export function isGateInvocation(command: string, subcommand: string | undefined): boolean {
  if (command === 'bun') {
    return subcommand === 'test'
  }
  if (command === 'bunx') {
    return subcommand === 'tsc'
  }
  if ((command !== './agent' && command !== 'just') || subcommand === undefined) {
    return false
  }
  return GATE_SUBCOMMANDS.has(subcommand) || subcommand.startsWith('verify') || subcommand.startsWith('test')
}

/** isRepositoryCommand reports whether a stage runs a command whose exit status this repository
 * reads as a verdict. */
function isRepositoryCommand(stage: string): boolean {
  const word = commandWord(stage)
  if (REPOSITORY_COMMANDS.has(word)) {
    return true
  }
  const subcommand = REPOSITORY_SUBCOMMANDS[word]
  return subcommand !== undefined && ` ${stage} `.includes(` ${subcommand} `)
}

/** isGateStage reports whether a stage runs one of the gates `OutputDiscipline` refuses to see piped. */
function isGateStage(stage: string): boolean {
  const words = meaningfulWords(stage)
  return isGateInvocation(words[0] ?? '', words.slice(1).find(word => !word.startsWith('-')))
}

/** judgesAPipeStage reports whether a pipeline stage list runs a repository command through a
 * filter that swallows its exit status. A gate is left out: it is refused rather than warned about. */
function judgesAPipeStage(stages: readonly string[]): boolean {
  const first = stages[0] ?? ''
  return stages.length > 1 && isRepositoryCommand(first) && !isGateStage(first)
    && stages.slice(1).some(stage => OUTPUT_FILTERS.has(commandWord(stage)))
}

/** shellHabitWarnings returns one warning per habit a Bash command shows. An empty array is the
 * usual case and the only path whose cost matters. */
export function shellHabitWarnings(command: string): string[] {
  const firstWord = command.trim().split(/\s+/)[0] ?? ''
  const prefix = firstWord === 'cd' || firstWord === 'export' || ASSIGNMENT_PREFIX.test(firstWord)

  const unquoted = stripQuotedSpans(command)
  const statements = shellStatements(unquoted).map(statement => statement.split('|'))
  const judgesAPipe = !STATUS_IS_READ.test(unquoted) && statements.some(judgesAPipeStage)

  return [
    ...(prefix ? [PREFIX_WARNING] : []),
    ...(judgesAPipe ? [PIPE_WARNING] : []),
  ]
}
