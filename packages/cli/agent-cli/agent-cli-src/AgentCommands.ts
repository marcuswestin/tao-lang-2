/**
 * The one table of Just recipes `./agent` exposes: `agent-dev.ts` registers each name below, and
 * `OutputDiscipline` reads it to redirect raw `just <recipe>` calls. Named host tool operations
 * have separate implementations in HostCommandTargets and permission in agentHostCommands.
 */

export const JUST_COMMANDS = [
  'admission-experiment',
  'bench',
  'board',
  'capabilities',
  'check',
  'dead-exports',
  'delegation-report',
  'doctor',
  'finalize',
  'fix',
  // The one recovery for a gate the sandbox denied: each harness write-protects its own skills,
  // hooks, and settings against shell commands, so formatting and regeneration need a command the
  // policy excludes. An agent has to be able to reach it by the name the failure prints.
  'fix-agent-config',
  'fmt',
  'ide-extension-package',
  'land',
  // The landing lock is the turn-taking primitive every broad lane and the landing itself go
  // through, so an agent has to be able to claim and return it by the same spelling it reads in
  // AGENTS.md rather than dropping to `just`.
  'land-lock',
  'land-unlock',
  // Whether a branch landed is a fact in the repository, not an inference from a command's output:
  // a wrapper that was stopped, a task marked failed by the shell it piped into, or a summary read
  // mid-write all look like failure. An agent that guesses re-lands work already on `main`.
  'landed',
  'ledger-index',
  'native-module-check',
  // Pushes the branch, opens or reuses its pull request, and stays attached to stream its checks —
  // the one command both the Developer and an agent run to get GitHub's own CI signal without a
  // second spelling.
  'open-pr',
  'parser-gen',
  'reclaim',
  // One report rather than two: flakes and slowest read the same ledger and are consulted together.
  'report-test-stats',
  'setup',
  'simplify-audit',
  // The browser and native UI lanes are final validation like any other gate, and AGENTS.md
  // requires them before a branch that touches Studio is called ready. They stayed reachable only
  // as `just` recipes, which left the one instruction an agent follows split across two spellings.
  'studio-proof-real-app',
  'studio-smoke',
  'test',
  'test-all',
  'test-changed',
  'test-file',
  'test-host',
  'test-retry',
  'typecheck',
  // Each verification scope is its own name rather than a flag on one name, so an agent reaches it
  // the same way a developer does: by completing a prefix, not by recalling which flag it took.
  'verify',
  'verify-changed',
  'verify-full',
  'verify-full-sandbox',
] as const

export type AgentCommand = (typeof JUST_COMMANDS)[number]

/** The Just recipe a command runs, where that differs from the command's own name. Absent here
 * means the recipe is spelled exactly like the command. */
const COMMAND_RECIPES: Partial<Record<AgentCommand, string>> = {
  'ledger-index': '_fix-ledger-index',
  'parser-gen': '_parser-gen',
  setup: '_setup',
  typecheck: '_typecheck',
}

/** recipeFor returns the Just recipe a command runs. */
export function recipeFor(command: AgentCommand): string {
  return COMMAND_RECIPES[command] ?? command
}

/**
 * EXPOSED_RECIPES maps a Just recipe name to the `./agent` command that already wraps it, for
 * `OutputDiscipline` to redirect a raw `just <recipe>` call to. `land-unlock` keeps its own `ask`
 * permission rule for `--force`.
 */
export const EXPOSED_RECIPES: ReadonlyMap<string, AgentCommand> = new Map(
  JUST_COMMANDS.filter(command => command !== 'land-unlock')
    .map(command => [recipeFor(command), command]),
)
