/** Detects the Bash commands that pull far more into an agent's context than the answer needs, for
 * the PreToolUse hook that runs beside every Bash tool call. Two shapes carry most of it: the shell
 * standing in for a file tool (`cat`, `sed -n`), and a Git command printing a whole patch. A week of
 * transcripts put those at 42% of every character this repository's agents read through Bash.
 *
 * `ShellHabits` warns; this refuses, and the difference is not a matter of taste. A warning travels
 * in `hookSpecificOutput.additionalContext`, which both harnesses place beside the tool result — so
 * a warning about an eight-thousand-character dump arrives underneath the dump, having prevented
 * nothing. Only a refusal keeps the output out, and it is corrected in the same turn.
 *
 * Every rule leaves its escape hatch in the command rather than in a setting: pipe it, redirect it,
 * or ask for the shape. Nothing here duplicates `ShellHabits`, which owns the `cd`/`export`/`VAR=`
 * prefix, recursive search, and exit status through a pipe. */

/** Flags that make a Git command report a summary instead of a full patch. */
const BOUNDED_GIT_FLAGS = new Set([
  '--stat',
  '--numstat',
  '--shortstat',
  '--name-only',
  '--name-status',
  '--compact-summary',
  '--oneline',
  '--no-patch',
  '-s',
  '-q',
  '--quiet',
])

export const SED_EDIT_REFUSAL =
  'Edit files with the Edit tool, not `sed -i` (AGENTS.md): an edit inside the worktree runs without '
  + 'review and arrives in the diff Ro reads.'

export const gitPatchRefusal = (subcommand: string): string =>
  `\`git ${subcommand}\` prints the whole patch into context. Ask for the shape first (\`--stat\`, `
  + '`--name-only`, `--oneline`), or send it to a file (`git … > "$TMPDIR/patch.diff"`) and read the '
  + 'part you need.'

export const shellReadRefusal = (command: string): string =>
  `Read files with the Read tool, not \`${command}\` (AGENTS.md): it takes an offset and a limit, it `
  + 'is cached across a session, and it does not pull the whole file into context.'

type Stage = {
  /** The stage's words, with quotes stripped, as the shell would pass them. */
  words: string[]
  /** True when the stage feeds a heredoc rather than reading a file. */
  heredoc: boolean
  /** True when the stage's standard output would reach the model rather than a file or another stage. */
  reachesContext: boolean
}

/**
 * splitStages walks the command once, tracking quotes so a `;` or `|` inside an argument does not
 * split it, and stops at the first heredoc operator because everything after it is data rather than
 * command text. It is not a shell parser: it answers only where a stage ends, whether the stage
 * redirects, and whether anything consumes its output.
 */
export function splitStages(command: string): Stage[] {
  const stages: Stage[] = []
  let words: string[] = []
  let word = ''
  let quote: string | undefined
  let redirected = false
  let heredoc = false

  const endWord = () => {
    if (word !== '') {
      words.push(word)
      word = ''
    }
  }
  const endStage = (feedsPipe: boolean) => {
    endWord()
    if (words.length > 0) {
      stages.push({ heredoc, reachesContext: !redirected && !feedsPipe, words })
    }
    words = []
    redirected = false
    heredoc = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? ''
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined
      } else {
        word += character
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '\\' && index + 1 < command.length) {
      word += command[index + 1] ?? ''
      index += 1
      continue
    }
    if (character === '<' && command[index + 1] === '<') {
      endStage(false)
      stages.push({ heredoc: true, reachesContext: false, words: ['<<'] })
      // Everything past a heredoc operator is the document, not another command.
      return markHeredoc(stages)
    }
    if (character === '>') {
      endWord()
      redirected = true
      continue
    }
    if (character === '|') {
      const feedsPipe = command[index + 1] !== '|'
      endStage(feedsPipe)
      if (!feedsPipe) {
        index += 1
      }
      continue
    }
    if (character === '&' && command[index + 1] === '&') {
      endStage(false)
      index += 1
      continue
    }
    if (character === ';' || character === '\n') {
      endStage(false)
      continue
    }
    if (character === ' ' || character === '\t') {
      endWord()
      continue
    }
    word += character
  }
  endStage(false)
  return stages
}

/** A heredoc marks the stage that opened it, which reads standard input rather than a file. */
function markHeredoc(stages: Stage[]): Stage[] {
  const opener = stages.length - 2
  const stage = stages[opener]
  if (stage !== undefined) {
    stages[opener] = { ...stage, heredoc: true }
  }
  return stages.slice(0, -1)
}

/** True when the word is an option rather than an operand. */
function isFlag(word: string): boolean {
  return word.startsWith('-') && word !== '-'
}

/**
 * shellReadDenial catches the shell standing in for a file tool. `sed -i` is included because it is
 * the same substitution in the other direction: an edit the harness cannot show Ro in a diff.
 */
function shellReadDenial(stage: Stage): string | undefined {
  const [command, ...rest] = stage.words
  const operands = rest.filter(word => !isFlag(word))
  if (command === 'sed' && rest.some(word => word.startsWith('-') && word.includes('i'))) {
    return SED_EDIT_REFUSAL
  }
  if (stage.heredoc || !stage.reachesContext || operands.length === 0) {
    return undefined
  }
  if (command === 'cat' || (command === 'sed' && rest.includes('-n'))) {
    return shellReadRefusal(command)
  }
  return undefined
}

/** gitDumpDenial catches a Git command whose whole patch would land in context unasked. */
function gitDumpDenial(stage: Stage): string | undefined {
  const [command, subcommand, ...rest] = stage.words
  if (command !== 'git' || subcommand === undefined || !stage.reachesContext) {
    return undefined
  }
  const dumpsPatch = subcommand === 'show' || subcommand === 'diff'
    || (subcommand === 'log' && rest.some(word => word === '-p' || word === '--patch'))
  if (!dumpsPatch || rest.some(word => BOUNDED_GIT_FLAGS.has(word))) {
    return undefined
  }
  return gitPatchRefusal(subcommand)
}

/**
 * outputDisciplineRefusal returns the reason a command is refused, or undefined to let it run. One
 * reason is returned rather than every applicable one: an agent fixes the command it was stopped on,
 * and a list invites it to argue with the rule instead.
 */
export function outputDisciplineRefusal(command: string): string | undefined {
  for (const stage of splitStages(command)) {
    const denial = shellReadDenial(stage) ?? gitDumpDenial(stage)
    if (denial !== undefined) {
      return denial
    }
  }
  return undefined
}
