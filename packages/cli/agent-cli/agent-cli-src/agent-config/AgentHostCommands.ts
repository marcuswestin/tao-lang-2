import { FS, Json, Text } from '@shared'
import { agentHostCommands } from './HostCommandPolicy'

export { agentHostCommands } from './HostCommandPolicy'

const SOURCE = '.rulesync/permissions.jsonc'
const CLAUDE_SETTINGS = '.claude/settings.json'

/** The top-level settings rulesync renders afresh, rather than merging from the `claudecode` block. */
const RULESYNC_RENDERED = new Set(['$schema', 'hooks', 'permissions'])

type HostCommandSource = { agentHostCommands?: unknown; claudecode?: unknown }

function hostShapes(prefixes: readonly (readonly string[])[]): string[] {
  return prefixes.flatMap(prefix => [
    `./agent unsandboxed ${prefix.join(' ')}`,
    `./agent unsandboxed ${prefix.join(' ')} *`,
  ])
}

/**
 * rulesync deep-merges the source's `claudecode` block into the settings already on disk, so an
 * object key deleted from the source lives on in the generated file, where the freshness gate —
 * which regenerates over the committed copy — cannot see it. Arrays and values are rendered afresh;
 * only a key the source no longer has needs dropping.
 */
function withoutRemovedKeys(
  rendered: Record<string, unknown>,
  source: Record<string, unknown>,
  rendersItself: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rendered).flatMap(([key, value]) => {
      if (rendersItself.has(key)) {
        return [[key, value]]
      }
      if (!Object.hasOwn(source, key)) {
        return []
      }
      const sourceValue = source[key]
      return [[
        key,
        Json.isRecord(value) && Json.isRecord(sourceValue) ? withoutRemovedKeys(value, sourceValue) : value,
      ]]
    }),
  )
}

/**
 * Finish the settings rulesync renders: drop what the `claudecode` source block no longer has, when
 * given it, then add exact Claude Bash approvals and sandbox exclusions for the host commands.
 */
export function renderClaudeHostSettings(
  content: string,
  prefixes: readonly (readonly string[])[],
  claudecode?: Record<string, unknown>,
): string {
  const parsed = JSON.parse(content) as Record<string, unknown>
  const settings = (claudecode === undefined ? parsed : withoutRemovedKeys(parsed, claudecode, RULESYNC_RENDERED)) as {
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
  const next = renderClaudeHostSettings(
    current,
    commands,
    Json.isRecord(source.claudecode) ? source.claudecode : undefined,
  )
  if (next !== current) {
    await writeText(path, next)
  }
}
