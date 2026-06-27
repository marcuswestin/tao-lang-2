import type { Command } from '@commander-js/extra-typings'
import { CLI, HCI, Platform, Repo, Text } from '@shared'

/** AgentHelpOptions declares the command names printed by agent help. */
type AgentHelpOptions = {
  allowlistedCommands: readonly string[]
}

/** registerAgentHelpCommand registers `./agent help`. */
export function registerAgentHelpCommand(commands: Command, opts: AgentHelpOptions): void {
  commands.action(async () => {
    Platform.runtimeProcess.setExitCode(await printAgentHelp(opts.allowlistedCommands))
  })
  commands
    .command('help')
    .description('Print available recipes and allowlisted commands.')
    .action(async () => {
      Platform.runtimeProcess.setExitCode(await printAgentHelp(opts.allowlistedCommands))
    })
}

async function printAgentHelp(allowlistedCommands: readonly string[]): Promise<number> {
  const repoRoot = Repo.getRoot()
  const justList = await CLI.run('just', {
    args: ['--justfile', Repo.resolvePath('Justfile'), '--list'],
    cwd: repoRoot,
  })

  if (justList.exitCode !== 0) {
    HCI.write(justList.stdout)
    HCI.writeError(justList.stderr)
    return justList.exitCode ?? 1
  }

  HCI.write(formatAgentHelpText(justList.stdout.trimEnd(), allowlistedCommands))
  return 0
}

/** formatAgentHelpText renders the `./agent help` output. */
export function formatAgentHelpText(justList: string, allowlistedCommands: readonly string[]): string {
  const lines = [`
Usage:
  ./agent help
  ./agent test [pattern]
  ./agent just <recipe> [args...]
  ./agent ai-usage [--provider <name>] [--source <source>] [--json]
  ./agent audit-instructions [--strict] [--json]
  ./agent merge-feature-preflight [--json]
  ./agent review <command> [options]
  ./agent <allowlisted-command> [args...]

Behavior:
  - just recipes run from the repo root.
  - successful quiet just recipes print one concise summary line.
  - failed quiet just recipes save full logs under .artifacts/logs/agent.
  - review orchestration writes artifacts under .artifacts/skills.
  - shell commands run from the directory where ./agent was invoked.
  - use shell cd or tool workdir before invoking ./agent when you need another cwd.

Examples:
  ./agent test
  ./agent just verify
  ./agent just test
  ./agent ai-usage --provider all --json
  ./agent audit-instructions
  ./agent merge-feature-preflight
  ./agent review new --stringent --slug my-review
  ./agent review plan --run .artifacts/skills/subagents-review/<run> --profile standard
  ./agent review usage --run .artifacts/skills/subagents-review/<run>
  ./agent review smoke-providers --provider codex-spark,codexbar
  ./agent codexbar usage --provider all --source oauth --format json --pretty
  ./agent cursor agent --print --mode=plan --sandbox enabled --trust --output-format stream-json --stream-partial-output --model composer-2.5 "Review this read-only."
  ./agent gemini --skip-trust --approval-mode plan --model gemini-3.1-pro-preview --output-format stream-json --prompt "Review this read-only."
  ./agent codex exec -C . --sandbox read-only --ephemeral -m gpt-5.3-codex-spark --json --output-last-message /tmp/final.txt -
  ./agent rg -n 'pattern' packages

Just recipes:
${Text.indentLines(justList, 2)}

Allowlisted commands:
`]
  for (const command of allowlistedCommands) {
    lines.push(`    ${command}`)
  }
  return `${lines.join('\n')}\n`
}
