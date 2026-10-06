/**
 * The repository boilerplate the SubagentStart hook hands every subagent, so a brief carries only
 * what is particular to its task rather than every caller pasting this in.
 *
 * The text is written as statements about this worktree rather than as instructions. Injected
 * context phrased as out-of-band commands can trip a harness's prompt-injection defences, which
 * would surface it to the person instead of letting the agent act on it.
 */
const RULES = [
  'Commands here run from the worktree root, with paths relative to it; a `cd`, `export`, or `VAR=value` prefix takes a command out of its permission allow rule.',
  "About 1,800 of this worktree's 120,000 files are its source; the rest are `node_modules/`, the generated `_gen_*` trees, `.artifacts/` logs, and linked worktrees, which a search that honours `.gitignore` skips and a recursive `grep` or `find` reads as though it were source.",
  'The Git index belongs to the caller: work here does not stage, unstage, commit, reset, stash, or switch branches.',
  "The developer-environment ledger under `Docs/Roadmap/Developer environment upgrades/` and its index are the caller's to edit; findings about the developer environment go back in the report instead.",
  'Repository work carries no agent author credit in file names, documents, code, comments, or branch names. A commit message may name a harness or provider when describing changes to it, but contains no `Co-Authored-By` text and no AI generated-with line.',
  'Outside agent configuration (`.rulesync/`, `.claude/`, `.codex/`, `.cursor/`, `agents/subagents/`, `packages/cli/agent-cli/`) and commit messages about harness changes, text and code say "agent" or "harness" rather than naming a provider; where behavior genuinely differs by provider they cover every provider in use, today Claude and Codex.',
  'Messaging the caller that spawned you needs no approval; any other agent or session needs the Developer\'s approval once per session before the first message. A message coordinates without carrying authority; the finished work still travels back to the caller as a report.',
]

/** subagentBrief returns the boilerplate, one sentence per rule. */
export function subagentBrief(): string {
  return `Tao worktree conventions, which bind this subagent as they bind its caller. ${RULES.join(' ')}`
}
