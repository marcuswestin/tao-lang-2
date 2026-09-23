import { FS, Text } from '@shared'
import { agentHostCommands } from './HostCommandPolicy'

export { agentHostCommands } from './HostCommandPolicy'

const SOURCE = '.rulesync/permissions.jsonc'
const CLAUDE_SETTINGS = '.claude/settings.json'

type HostCommandSource = { agentHostCommands?: unknown }

function hostShapes(prefixes: readonly (readonly string[])[]): string[] {
  return prefixes.flatMap(prefix => [
    `./agent unsandboxed ${prefix.join(' ')}`,
    `./agent unsandboxed ${prefix.join(' ')} *`,
  ])
}

/** Add exact Claude Bash approvals and sandbox exclusions after rulesync renders its settings. */
export function renderClaudeHostSettings(content: string, prefixes: readonly (readonly string[])[]): string {
  const settings = JSON.parse(content) as {
    permissions: { allow: string[] }
    sandbox: { excludedCommands: string[] }
  }
  const hostRule = /^Bash\(\.\/agent unsandboxed(?: |\))/u
  settings.permissions.allow = settings.permissions.allow.filter(rule => !hostRule.test(rule))
  const shapes = hostShapes(prefixes)
  settings.permissions.allow.push(...shapes.map(shape => `Bash(${shape})`))
  settings.sandbox.excludedCommands = shapes
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
