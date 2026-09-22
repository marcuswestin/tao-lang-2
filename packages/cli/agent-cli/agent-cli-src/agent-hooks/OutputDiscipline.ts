/** Detects the Bash commands that go wrong in ways a warning cannot undo, for the PreToolUse hook
 * that runs beside every Bash tool call. Two families sit here. One pulls far more into an agent's
 * context than the answer needs: the shell standing in for a file tool (`cat`, `sed -n`), a Git
 * command printing a whole patch, a recursive `grep` over a tree that is 67 times the size of its
 * source. A week of transcripts put the first two at 42% of every character this repository's agents
 * read through Bash. The other family produces a plausible wrong answer rather than a large one:
 * `rg -r`, a gate judged through a pipe, `bun test` on a relative path.
 *
 * `ShellHabits` warns; this refuses, and the difference is not a matter of taste. A warning travels
 * in `hookSpecificOutput.additionalContext`, which both harnesses place beside the tool result — so
 * a warning about an eight-thousand-character dump arrives underneath the dump, having prevented
 * nothing, and a warning that an exit status was swallowed arrives beside the falsely green result.
 * Only a refusal keeps either out, and it is corrected in the same turn.
 *
 * Every rule leaves its escape hatch in the command rather than in a setting: pipe it, redirect it,
 * spell the long flag, or ask for the shape. `# hook-ok: <reason>` is the last resort for work a
 * rule wrongly catches; `HookOverrides` records each use so the rules can be tuned against what
 * actually misfires rather than against argument. */

import { EXPOSED_RECIPES } from '../AgentCommands'
import { isGateInvocation, OUTPUT_FILTERS } from './ShellHabits'

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

/** A command that reads a pipeline's real exit status rather than its last stage's. */
const STATUS_IS_READ = /pipefail|PIPESTATUS|pipestatus/

/** Directory prefixes holding the repository's reviewed content. A write here belongs in the diff. */
const REVIEWED_TREES = ['packages/', 'Apps/', 'Docs/', 'agents/', '.rulesync/']
/** Path prefixes that are scratch by construction, where shell writes and wide searches are ordinary. */
const SCRATCH_PREFIXES = ['/tmp', '/private/tmp', '/var/folders', '$TMPDIR', '${TMPDIR', '.artifacts']

const SED_EDIT_REFUSAL =
  'Edit files with the Edit tool, not `sed -i` (AGENTS.md): an edit inside the worktree runs without '
  + 'review and arrives in the diff the Developer reads.'

const RECURSIVE_SEARCH_REFUSAL =
  'This worktree holds about 1,800 tracked files and over 120,000 in total — `node_modules`, the '
  + 'generated toolchain, and `.artifacts/` logs and transcripts. A recursive `grep` or `find` reads '
  + 'all of it: the same search costs 22KB through a tool that honours `.gitignore` and 29MB through '
  + '`grep -r`, and what it finds in generated output cannot be told from source. Use a search that '
  + 'skips ignored trees, bound this one with `-maxdepth`, or point it at `.artifacts/` or `$TMPDIR`.'

const RIPGREP_REPLACE_REFUSAL =
  "`-r` is ripgrep's `--replace`, not grep's recursion: it prints each match with the matched text "
  + 'replaced and exits 0, so the output looks like a result and is not one. Drop it — ripgrep '
  + 'recurses by default — or write `--replace` in full if a replacement is what you meant.'

const RIPGREP_FOLLOW_REFUSAL =
  "`-L` is ripgrep's `--follow` (symlinks), not grep's `--files-without-match`: it returns matches "
  + 'where you expected a list of files that matched nothing. Write `--files-without-match`, or '
  + '`--follow` in full if following symlinks is what you meant.'

const gatePipeRefusal = (gate: string): string =>
  `A pipeline reports its last stage's status, so \`${gate}\` piped into a filter reads as success `
  + "when the gate failed. `./agent` already bounds a gate's output and writes the full run to "
  + '`.artifacts/logs/agent/<command>/latest.log`, so there is nothing left to filter for. Run it '
  + 'plain, or capture it: `cmd > out 2>&1; echo "EXIT=$?"`.'

const justRecipeRefusal = (recipe: string, agentCommand: string): string =>
  `\`just ${recipe}\` is reachable through \`./agent ${agentCommand}\`, which captures the run, bounds `
  + 'its output, names the failing tests instead of a raw dump, and logs the full output at '
  + `\`.artifacts/logs/agent/${agentCommand}/latest.log\`. Run that instead.`

const BUN_TEST_REFUSAL = 'A bare `bun test` on a relative path silently corrupts its own run (AGENTS.md). Use `./agent '
  + 'test-file <path>` for one file or directory, or pass `--cwd` when the target is another worktree.'

const BUN_INSTALL_REFUSAL =
  '`bun install` skips repository adapter generation. Run `./agent setup` for routine installs. '
  + 'Ask the Developer before adding or updating packages, then edit the manifest and run `./agent setup --refresh-lockfile`.'

const GIT_ADD_WIDE_REFUSAL =
  'Stage exact reviewed paths — `git add -- <path>…` — never `.`, `-A`, or `-u` (AGENTS.md). The Developer and '
  + "this session's own subagents write this worktree while you work, and generators drop untracked "
  + 'files into it, so a wide add sweeps work you did not make into your commit.'

const GIT_STASH_REFUSAL =
  'The stash stack is shared with every other worktree on this machine, so a bare `git stash` or '
  + "`git stash pop` can take another session's work. Prefer a temporary WIP commit; if you must "
  + 'stash, use `git stash push -u -m "<tag>"` and restore with `git stash apply <sha>`.'

const treeWriteRefusal = (target: string): string =>
  `Write \`${target}\` with the Write or Edit tool, not a shell redirect: an edit inside the worktree `
  + 'runs without review and arrives in the diff the Developer reads. A scratch file belongs in `$TMPDIR` or '
  + '`.artifacts/`, where a redirect is fine.'

const gitPatchRefusal = (subcommand: string): string =>
  `\`git ${subcommand}\` prints the whole patch into context. Ask for the shape first (\`--stat\`, `
  + '`--name-only`, `--oneline`), or send it to a file (`git … > "$TMPDIR/patch.diff"`) and read the '
  + 'part you need.'

const shellReadRefusal = (command: string): string =>
  `Read files with the Read tool, not \`${command}\` (AGENTS.md): it takes an offset and a limit, it `
  + 'is cached across a session, and it does not pull the whole file into context.'

type Stage = {
  /** The stage's words, with quotes stripped, as the shell would pass them. */
  words: string[]
  /** True when the stage feeds a heredoc rather than reading a file. */
  heredoc: boolean
  /** True when the stage's standard output would reach the model rather than a file or another stage. */
  reachesContext: boolean
  /** True when the stage's standard output is piped into the stage after it. */
  feedsPipe: boolean
  /** The paths the stage redirects its output to, in the order they appear. */
  redirectTargets: string[]
}

/**
 * splitStages walks the command once, tracking quotes so a `;` or `|` inside an argument does not
 * split it, and stops at the first heredoc operator because everything after it is data rather than
 * command text. It is not a shell parser: it answers only where a stage ends, what it redirects to,
 * and whether anything consumes its output.
 */
export function splitStages(command: string): Stage[] {
  const stages: Stage[] = []
  let words: string[] = []
  let redirectTargets: string[] = []
  let word = ''
  let quote: string | undefined
  let redirected = false
  let awaitingTarget = false
  let heredoc = false

  const endWord = () => {
    if (word === '') {
      return
    }
    // A redirect's target is the word after `>`; `2>&1` duplicates a descriptor rather than naming a file.
    if (awaitingTarget && !word.startsWith('&')) {
      redirectTargets.push(word)
    }
    awaitingTarget = false
    words.push(word)
    word = ''
  }
  const endStage = (feedsPipe: boolean) => {
    endWord()
    if (words.length > 0) {
      stages.push({ feedsPipe, heredoc, reachesContext: !redirected && !feedsPipe, redirectTargets, words })
    }
    words = []
    redirectTargets = []
    redirected = false
    awaitingTarget = false
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
      stages.push({ feedsPipe: false, heredoc: true, reachesContext: false, redirectTargets: [], words: ['<<'] })
      // Everything past a heredoc operator is the document, not another command.
      return markHeredoc(stages)
    }
    if (character === '>') {
      endWord()
      redirected = true
      awaitingTarget = true
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

/** operandsOf returns a stage's arguments with its command word and its flags removed. */
function operandsOf(stage: Stage): string[] {
  return stage.words.slice(1).filter(word => !isFlag(word))
}

/** isScratchPath reports whether a path is scratch by construction rather than reviewed content. */
function isScratchPath(path: string): boolean {
  const plain = path.replace(/^["']|["']$/g, '').replace(/^\.\//, '')
  return SCRATCH_PREFIXES.some(prefix => plain.startsWith(prefix))
}

/** isReviewedPath reports whether a path names content that belongs in the diff the Developer reads. */
function isReviewedPath(path: string): boolean {
  const plain = path.replace(/^["']|["']$/g, '').replace(/^\.\//, '')
  return !isScratchPath(plain) && REVIEWED_TREES.some(tree => plain.startsWith(tree))
}

/**
 * hookOverrideReason returns the justification an agent attached to a command it believes a rule
 * wrongly catches. The marker is deliberately visible in the command rather than hidden in a
 * setting, so the override is in front of the Developer in the transcript as well as in the log.
 */
export function hookOverrideReason(command: string): string | undefined {
  const reason = command.match(/#\s*hook-ok:\s*(\S.*?)\s*$/m)?.[1]
  return reason === undefined || reason === '' ? undefined : reason
}

/**
 * shellReadDenial catches the shell standing in for a file tool. `sed -i` is included because it is
 * the same substitution in the other direction: an edit the harness cannot show the Developer in a diff.
 */
function shellReadDenial(stage: Stage): string | undefined {
  const [command, ...rest] = stage.words
  if (command === 'sed' && rest.some(word => word.startsWith('-') && word.includes('i'))) {
    return SED_EDIT_REFUSAL
  }
  if (stage.heredoc || !stage.reachesContext || operandsOf(stage).length === 0) {
    return undefined
  }
  if (command === 'cat' || (command === 'sed' && rest.includes('-n'))) {
    return shellReadRefusal(command)
  }
  return undefined
}

/**
 * searchDenial catches the two searches that mislead. A recursive `grep` or `find` reads the ignored
 * trees; `rg -r` and `rg -L` are ripgrep flags that a grep habit spells by accident, and both print
 * a plausible result rather than an error. A bounded or scratch-rooted search is neither.
 */
function searchDenial(stage: Stage): string | undefined {
  const [command, ...rest] = stage.words
  if (command === 'rg') {
    // Only the bundled short forms; `--replace` and `--follow` spelled out are deliberate.
    const short = rest.filter(word => /^-[A-Za-z]+$/.test(word)).join('')
    if (short.includes('r')) {
      return RIPGREP_REPLACE_REFUSAL
    }
    if (short.includes('L')) {
      return RIPGREP_FOLLOW_REFUSAL
    }
    return undefined
  }
  if (rest.some(word => word === '-maxdepth' || word === '-delete') || operandsOf(stage).some(isScratchPath)) {
    return undefined
  }
  if (command === 'grep' && rest.some(word => word === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(word))) {
    return RECURSIVE_SEARCH_REFUSAL
  }
  return command === 'find' ? RECURSIVE_SEARCH_REFUSAL : undefined
}

/**
 * gatePipeDenial catches a gate whose verdict a later stage would replace with its own. A command
 * that reads the real status back — `set -o pipefail`, `PIPESTATUS` — has already solved this, and
 * the refusal names that path, so it cannot also refuse it.
 */
function gatePipeDenial(stage: Stage, next: Stage | undefined): string | undefined {
  const [command, ...rest] = stage.words
  const subcommand = rest.find(word => !isFlag(word))
  if (
    next === undefined || !stage.feedsPipe || command === undefined
    || !isGateInvocation(command, subcommand)
    || !OUTPUT_FILTERS.has(next.words[0] ?? '')
  ) {
    return undefined
  }
  return gatePipeRefusal(subcommand === undefined ? command : `${command} ${subcommand}`)
}

/** Words that run their own program rather than being one, the same set `ShellHabits`'s
 * `COMMAND_PREFIXES` warns about (`command`, `exec`) plus `time` and `nohup`, which take no options
 * of their own, and `nice` and `env`, which do. */
const SIMPLE_COMMAND_WRAPPERS = new Set(['command', 'exec', 'nohup', 'time'])
/** `nice`'s own flag that takes a separate value argument, in short and long form. */
const NICE_ADJUSTMENT_FLAG = /^(-n|--adjustment)$/
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * commandAfterWrappers strips the leading words that run their own program rather than being one —
 * `time`, `command`, `exec`, `nohup` outright, `nice` past its own scheduling flag, and `env` past
 * its flags and leading `VAR=value` assignments — so a wrapped `just` invocation is still found
 * underneath them.
 */
function commandAfterWrappers(words: readonly string[]): string[] {
  let rest = [...words]
  while (rest.length > 0) {
    const word = rest[0]!
    if (SIMPLE_COMMAND_WRAPPERS.has(word)) {
      rest = rest.slice(1)
      continue
    }
    if (word === 'nice') {
      rest = rest.slice(1)
      while (rest.length > 0 && isFlag(rest[0]!)) {
        const flag = rest[0]!
        rest = rest.slice(1)
        if (NICE_ADJUSTMENT_FLAG.test(flag) && rest.length > 0) {
          rest = rest.slice(1)
        }
      }
      continue
    }
    if (word === 'env') {
      rest = rest.slice(1)
      while (rest.length > 0 && (isFlag(rest[0]!) || ENVIRONMENT_ASSIGNMENT.test(rest[0]!))) {
        rest = rest.slice(1)
      }
      continue
    }
    break
  }
  return rest
}

/** Just's own flags that take a value, in the short and long spellings this repository's recipes use. */
const JUST_VALUE_FLAGS = new Set(['-f', '--justfile', '-d', '--working-directory'])

/** firstJustOperand returns the first word after `just` that names a recipe rather than an option,
 * skipping a value flag's operand in both its `--flag value` and `--flag=value` forms. */
function firstJustOperand(words: readonly string[]): string | undefined {
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (JUST_VALUE_FLAGS.has(word)) {
      index += 2
      continue
    }
    if (isFlag(word)) {
      index += 1
      continue
    }
    return word
  }
  return undefined
}

/**
 * justRecipeDenial catches a raw `just <recipe>` call for a recipe `./agent` already wraps, seeing
 * through the wrappers a command line can put in front of `just` and the flags it can put in front
 * of the recipe name. `gatePipeDenial` is checked first by the caller, so a piped gate keeps its own
 * more specific refusal rather than being told twice to use the front door.
 */
function justRecipeDenial(stage: Stage): string | undefined {
  const [command, ...rest] = commandAfterWrappers(stage.words)
  if (command === './dev' && (rest[0] === 'land' || rest[0] === 'merge-with-main')) {
    return 'Use `./agent land` for an authorized landing; direct `./dev` landing bypasses the agent entry point.'
  }
  if (command !== 'just') {
    return undefined
  }
  const recipe = firstJustOperand(rest)
  if (recipe === undefined) {
    return undefined
  }
  if (recipe === 'my-land' || recipe === 'merge-with-main') {
    return 'Use `./agent land` for an authorized landing; direct landing recipes bypass the agent entry point.'
  }
  const agentCommand = EXPOSED_RECIPES.get(recipe)
  return agentCommand === undefined ? undefined : justRecipeRefusal(recipe, agentCommand)
}

/** bunDenial catches the two Bun invocations this repository routes through `./agent` instead. */
function bunDenial(stage: Stage): string | undefined {
  const [command, ...rest] = stage.words
  if (command !== 'bun') {
    return undefined
  }
  const subcommand = rest.find(word => !isFlag(word))
  if (subcommand === 'install' || subcommand === 'i') {
    return BUN_INSTALL_REFUSAL
  }
  if (subcommand !== 'test' || rest.includes('--cwd')) {
    return undefined
  }
  const targets = rest.filter(word => word !== 'test' && !isFlag(word))
  return targets.some(target => !target.startsWith('/')) ? BUN_TEST_REFUSAL : undefined
}

/**
 * gitIndexDenial catches the index operations AGENTS.md forbids. Both are destructive to work this
 * agent did not make: a wide add commits it, and a bare stash pop moves it out of another worktree.
 */
function gitIndexDenial(stage: Stage): string | undefined {
  const [command, subcommand, ...rest] = stage.words
  if (command !== 'git' || subcommand === undefined) {
    return undefined
  }
  if (subcommand === 'add') {
    const wide = rest.some(word =>
      word === '.' || word === '..' || word === '-A' || word === '--all' || word === '-u' || word === '--update'
      || word.endsWith('/')
    )
    return wide ? GIT_ADD_WIDE_REFUSAL : undefined
  }
  if (subcommand !== 'stash') {
    return undefined
  }
  const operation = rest.find(word => !isFlag(word))
  if (operation === undefined || operation === 'pop') {
    return GIT_STASH_REFUSAL
  }
  const named = rest.some(word => word === '-m' || word === '--message')
  return operation === 'push' && !named ? GIT_STASH_REFUSAL : undefined
}

/**
 * treeWriteDenial catches a shell redirect that writes reviewed content. Agents did this about 58
 * times across a week of transcripts — source files under `packages/`, and throwaway probes dropped
 * into test directories where they then ran. Scratch targets are untouched, and a heredoc feeding a
 * command rather than a file redirects nowhere and never matches.
 */
function treeWriteDenial(stage: Stage): string | undefined {
  const target = stage.redirectTargets.find(isReviewedPath)
  return target === undefined ? undefined : treeWriteRefusal(target)
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
  return hookOverrideReason(command) === undefined ? refusalIgnoringOverride(command) : undefined
}

/**
 * refusalIgnoringOverride is the rules alone, without the escape hatch. The entry needs both
 * answers to tell an override apart from a command no rule covers: only the first is worth logging.
 */
export function refusalIgnoringOverride(command: string): string | undefined {
  const stages = splitStages(command)
  const statusIsRead = STATUS_IS_READ.test(command)
  for (const [index, stage] of stages.entries()) {
    const piped = statusIsRead ? undefined : gatePipeDenial(stage, stages[index + 1])
    const denial = shellReadDenial(stage) ?? searchDenial(stage) ?? piped ?? justRecipeDenial(stage)
      ?? bunDenial(stage) ?? gitIndexDenial(stage) ?? treeWriteDenial(stage) ?? gitDumpDenial(stage)
    if (denial !== undefined) {
      return denial
    }
  }
  return undefined
}
