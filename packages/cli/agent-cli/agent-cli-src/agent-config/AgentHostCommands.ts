import { Assert, FS, Text } from '@shared'
import { type AgentCommand, JUST_COMMANDS } from '../AgentCommands'

const SOURCE = '.rulesync/permissions.jsonc'
const CLAUDE_SETTINGS = '.claude/settings.json'

type HostCommandSource = { agentHostCommands?: unknown }

/** One canonical list feeds both harnesses; the wrapper itself only forwards argv. */
export function agentHostCommands(source: HostCommandSource): AgentCommand[] {
  const names = source.agentHostCommands
  Assert(Array.isArray(names), 'agentHostCommands to be an array')
  const seen = new Set<string>()
  return names.map((name: unknown) => {
    Assert(
      typeof name === 'string' && JUST_COMMANDS.includes(name as AgentCommand) && !seen.has(name),
      `agentHostCommands entry '${String(name)}' to name one unique ./agent command`,
    )
    seen.add(name)
    return name as AgentCommand
  })
}

function hostShapes(commands: readonly AgentCommand[]): string[] {
  return commands.flatMap(command => [
    `./agent unsandboxed ${command}`,
    `./agent unsandboxed ${command} *`,
  ])
}

/** Add exact Claude Bash approvals and sandbox exclusions after rulesync renders its settings. */
export function renderClaudeHostSettings(content: string, commands: readonly AgentCommand[]): string {
  const settings = JSON.parse(content) as {
    permissions: { allow: string[] }
    sandbox: { excludedCommands: string[] }
  }
  const hostRule = /^Bash\(\.\/agent unsandboxed(?: |\))/u
  settings.permissions.allow = settings.permissions.allow.filter(rule => !hostRule.test(rule))
  settings.sandbox.excludedCommands = settings.sandbox.excludedCommands.filter(
    rule => !rule.startsWith('./agent unsandboxed'),
  )
  const shapes = hostShapes(commands)
  settings.permissions.allow.push(...shapes.map(shape => `Bash(${shape})`))
  settings.sandbox.excludedCommands.push(...shapes)
  return `${JSON.stringify(settings, null, 2)}\n`
}

export async function generateClaudeHostSettings(root: string, writeText = FS.writeText): Promise<void> {
  const path = FS.resolvePath(CLAUDE_SETTINGS, root)
  if (!await FS.isFile(path)) {
    return
  }
  const source = JSON.parse(Text.stripJsonc(await FS.readText(FS.resolvePath(SOURCE, root)))) as HostCommandSource
  const commands = agentHostCommands(source)
  const current = await FS.readText(path)
  const next = renderClaudeHostSettings(current, commands)
  if (next !== current) {
    await writeText(path, next)
  }
}
