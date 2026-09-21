import { CLI, Platform, Repo } from '@shared'
import { registerAgentHelpCommand } from './cli/agent-help'
import { runWithCommands } from './cli/run-with-commands'

const JUST_COMMANDS = [
  'bench',
  'board',
  'capabilities',
  'check',
  'delegation-report',
  'doctor',
  'finalize',
  'fix',
  // The one recovery for a gate the sandbox denied: each harness write-protects its own skills,
  // hooks, and settings against shell commands, so formatting and regeneration need a command the
  // policy excludes. An agent has to be able to reach it by the name the failure prints.
  'fix-agent-config',
  'fmt',
  // The landing lock is the turn-taking primitive every broad lane and the landing itself go
  // through, so an agent has to be able to claim and return it by the same spelling it reads in
  // AGENTS.md rather than dropping to `just`.
  'land-lock',
  'land-unlock',
  // Whether a branch landed is a fact in the repository, not an inference from a command's output:
  // a wrapper that was stopped, a task marked failed by the shell it piped into, or a summary read
  // mid-write all look like failure. An agent that guesses re-lands work already on `main`.
  'landed',
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
  // Each verification scope is its own name rather than a flag on one name, so an agent reaches it
  // the same way a developer does: by completing a prefix, not by recalling which flag it took.
  'verify',
  'verify-changed',
  'verify-full',
  'verify-full-sandbox',
] as const

/** Agent-facing CLI entrypoint: expose only the repository workflows intended for `./agent`. */
await runWithCommands(commands => {
  commands
    .name('agent')
    .helpOption(false)
    .helpCommand(false)
    .enablePositionalOptions()

  registerAgentHelpCommand(commands, JUST_COMMANDS)
  for (const command of JUST_COMMANDS) {
    commands
      .command(`${command} [args...]`)
      .allowUnknownOption(true)
      .helpOption(false)
      .passThroughOptions()
      .action(async (args: string[] = []) => {
        const result = await CLI.run('just', {
          args: [command === 'setup' ? '_setup' : command, ...args],
          cwd: Repo.getRoot(),
          stdio: 'inherit',
        })
        Platform.runtimeProcess.setExitCode(result.error === undefined ? result.exitCode ?? 1 : 1)
      })
  }
})
