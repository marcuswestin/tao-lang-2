/** Detects the shell habits this repository's commands depend on, for the PreToolUse hook that
 * runs beside every Bash tool call. The matching is deliberately cheap rather than a shell parser:
 * it strips quoted spans first, so text inside a commit message or an `echo` is never read as a
 * command, then looks only at the command word of each pipeline stage. */

/** Repository commands whose exit status is a verdict. A pipe replaces that status with the filter's. */
const REPOSITORY_COMMANDS = new Set(['./agent', 'just', './dev'])
/** The same, where the command word alone is too broad and a subcommand decides. */
const REPOSITORY_SUBCOMMANDS: Record<string, string> = { bun: 'test', bunx: 'tsc' }
/** Filters that swallow the status of whatever is piped into them. */
const OUTPUT_FILTERS = new Set(['tail', 'head', 'rg', 'grep', 'less', 'more', 'sort', 'uniq', 'wc'])
/** Words that precede the real command word rather than being one. */
const COMMAND_PREFIXES = new Set(['sudo', 'command', 'time', 'nice', 'env', 'exec', 'xargs', 'builtin', 'noglob'])

export const SEARCH_WARNING =
  "Recursive searches in this worktree use `rg`. `grep -r` and `find` descend the Git-ignored generated `_gen_*` trees, `.artifacts/`, `node_modules/`, and the linked worktrees, which `rg` skips; `rg --hidden --glob '!.git/**'` reaches tracked hidden configuration and `--no-ignore` reaches generated files."
export const PREFIX_WARNING =
  'A command beginning with `cd `, `export `, or a `VAR=value ` prefix falls outside its permission allow rule in this worktree and goes to permission review instead. Commands here run from the worktree root with paths relative to it.'
export const PIPE_WARNING =
  'A pipeline reports the exit status of its last stage, so a repository command piped into a filter reads as success when the command itself failed. Capturing first keeps the status: `cmd > out 2>&1; echo "EXIT=$?"`, then read the file.'

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/
const RECURSIVE_FLAG = /\s-[A-Za-z]*[rR]/
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

/** commandWord returns the command a pipeline stage runs, skipping grouping characters, leading
 * assignments, and the wrappers that precede a command rather than being one. */
function commandWord(stage: string): string {
  const words = stage.replace(/^[\s({!]+/, '').split(/\s+/).filter(word => word !== '')
  for (const word of words) {
    if (ASSIGNMENT_PREFIX.test(word) || COMMAND_PREFIXES.has(word)) {
      continue
    }
    return word
  }
  return ''
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

/** searchesATree reports whether a stage walks a directory tree looking for something. `find` is
 * a search unless it is being used to remove what it finds. */
function searchesATree(stage: string): boolean {
  const word = commandWord(stage)
  if (word === 'grep') {
    return RECURSIVE_FLAG.test(stage) || stage.includes(' --recursive')
  }
  return word === 'find' && !stage.includes(' -delete')
}

/** judgesAPipeStage reports whether a pipeline stage list runs a repository command through a
 * filter that swallows its exit status. */
function judgesAPipeStage(stages: readonly string[]): boolean {
  return stages.length > 1 && isRepositoryCommand(stages[0] ?? '')
    && stages.slice(1).some(stage => OUTPUT_FILTERS.has(commandWord(stage)))
}

/** shellHabitWarnings returns one warning per habit a Bash command shows. An empty array is the
 * usual case and the only path whose cost matters. */
export function shellHabitWarnings(command: string): string[] {
  const firstWord = command.trim().split(/\s+/)[0] ?? ''
  const prefix = firstWord === 'cd' || firstWord === 'export' || ASSIGNMENT_PREFIX.test(firstWord)

  const unquoted = stripQuotedSpans(command)
  const statements = shellStatements(unquoted).map(statement => statement.split('|'))
  const searches = statements.some(stages => stages.some(searchesATree))
  const judgesAPipe = !STATUS_IS_READ.test(unquoted) && statements.some(judgesAPipeStage)

  return [
    ...(prefix ? [PREFIX_WARNING] : []),
    ...(searches ? [SEARCH_WARNING] : []),
    ...(judgesAPipe ? [PIPE_WARNING] : []),
  ]
}
