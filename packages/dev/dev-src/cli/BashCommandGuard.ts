/**
 * BashCommandGuard decides whether a Bash tool call should be refused before it runs. It backs the
 * PreToolUse hook in `.rulesync/hooks.jsonc`, and it holds two rules that root `AGENTS.md` had
 * written in prose and that a week of transcripts showed agents still breaking:
 *
 * - A command that starts with `cd`, `export`, or an assignment leaves its permission allow rule and
 *   waits for review, which costs the session a round trip through Ro for nothing.
 * - A command whose whole output reaches the model's context when a bounded tool would do. Shell
 *   file reads (`cat`, `sed -n`) and unbounded history dumps (`git show`, `git diff`, `git log -p`)
 *   were 42% of every character this repository's agents pulled through Bash in one week; `Read`
 *   takes a range and a redirect into `$TMPDIR` costs nothing until something reads it back.
 *
 * Both rules leave an escape hatch in the command itself rather than in a setting, because a rule an
 * agent can satisfy by rewriting the command teaches the habit, and one it can only satisfy by
 * asking does not. The rules themselves import nothing, so the hook on the path of every Bash call
 * costs one Bun start and the shared output seam, measured together at about 20ms.
 */
import { HCI } from '@shared'

/** The prefixes that take a command out of its permission allow rule. */
const PREFIX_RULE = 'Run from the worktree root with relative paths (AGENTS.md). A `cd`, `export`, or assignment '
  + 'prefix takes this command out of its allow rule and into permission review. Use a relative '
  + "path, `git -C <path>`, or `sh -c 'cd <path> && …'` when another tree really is the subject."

/** Flags that make a Git command report a summary instead of a full patch. */
const BOUNDED_GIT_FLAGS = [
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
]

type Stage = {
  /** The stage's words, with quotes stripped, as the shell would pass them. */
  words: string[]
  /** True when the stage feeds a heredoc rather than reading a file. */
  heredoc: boolean
  /** True when the stage's standard output would reach the model instead of a file or another stage. */
  reachesContext: boolean
}

/**
 * splitStages walks the command once, tracking quotes so a `;` or `|` inside an argument does not
 * split it, and stops at the first heredoc operator because everything after it is data rather than
 * command text. It is not a shell parser: it answers only where one stage ends, whether the stage
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

/** True when a `cd`, `export`, or `NAME=value` prefix opens the command. */
function hasReviewPrefix(stages: readonly Stage[]): boolean {
  const first = stages[0]?.words[0]
  if (first === undefined) {
    return false
  }
  return first === 'cd' || first === 'export' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(first)
}

/**
 * shellReadDenial catches the shell standing in for a file tool. `sed -i` is included because it is
 * the same substitution in the other direction: an edit the harness cannot show Ro in a diff.
 */
function shellReadDenial(stage: Stage): string | undefined {
  const [command, ...rest] = stage.words
  const operands = rest.filter(word => !isFlag(word))
  if (command === 'sed' && rest.some(word => word.startsWith('-') && word.includes('i'))) {
    return 'Edit files with the Edit tool, not `sed -i` (AGENTS.md): an edit inside the worktree runs '
      + 'without review and arrives in the diff Ro reads.'
  }
  if (stage.heredoc || !stage.reachesContext || operands.length === 0) {
    return undefined
  }
  if (command === 'cat' || (command === 'sed' && rest.includes('-n'))) {
    return `Read files with the Read tool, not \`${command}\` (AGENTS.md): it takes an offset and a `
      + 'limit, it is cached across a session, and it does not pull the whole file into context.'
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
  if (!dumpsPatch || rest.some(word => BOUNDED_GIT_FLAGS.includes(word))) {
    return undefined
  }
  return `\`git ${subcommand}\` prints the whole patch into context. Ask for the shape first `
    + '(`--stat`, `--name-only`, `--oneline`), or send it to a file '
    + '(`git … > "$TMPDIR/patch.diff"`) and read the part you need.'
}

/**
 * bashGuardDenial returns the reason a command is refused, or undefined to let it run. One reason is
 * returned rather than every applicable one: an agent fixes the command it was stopped on, and a
 * list invites it to argue with the rule instead.
 */
export function bashGuardDenial(command: string): string | undefined {
  const stages = splitStages(command)
  if (stages.length === 0) {
    return undefined
  }
  if (hasReviewPrefix(stages)) {
    return PREFIX_RULE
  }
  for (const stage of stages) {
    const denial = shellReadDenial(stage) ?? gitDumpDenial(stage)
    if (denial !== undefined) {
      return denial
    }
  }
  return undefined
}

/**
 * guardResponse renders the one shape both harnesses document for a PreToolUse decision, and an
 * empty string for anything it does not recognise. A hook that cannot read its payload must be
 * silent rather than cautious: the payload it failed to parse might not be a Bash call at all, and a
 * guess would refuse work no rule here covers.
 */
export function guardResponse(payload: string): string {
  let event: { tool_input?: { command?: unknown }; tool_name?: unknown }
  try {
    event = JSON.parse(payload) as typeof event
  } catch {
    return ''
  }
  const command = event.tool_input?.command
  if (event.tool_name !== 'Bash' || typeof command !== 'string') {
    return ''
  }
  const denial = bashGuardDenial(command)
  if (denial === undefined) {
    return ''
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denial,
    },
  })
}

if (import.meta.main) {
  const response = guardResponse(await Bun.stdin.text())
  if (response !== '') {
    HCI.writeLine(response)
  }
}
