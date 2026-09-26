import { FS, Json, Repo, Text } from '@shared'
import { generate } from 'rulesync'
import { agentHostCommands } from './HostCommandPolicy'

export { agentHostCommands } from './HostCommandPolicy'

const SOURCE = '.rulesync/permissions.jsonc'
const CLAUDE_SETTINGS = '.claude/settings.json'

/**
 * What rulesync renders afresh rather than merging from the `claudecode` block: a whole setting, or
 * the keys within one, as in `permissions`, whose rule lists it renders and whose other keys it merges
 * from `claudecode.permissions`. Rulesync also merges old rules for tools the source no longer
 * names; the pristine render below replaces those lists after pruning.
 */
type Rendered = { readonly [key: string]: true | Rendered }

const RULESYNC_RENDERED: Rendered = {
  $schema: true,
  hooks: true,
  permissions: { allow: true, ask: true, deny: true },
}

type HostCommandSource = { agentHostCommands?: unknown; claudecode?: unknown }
type PermissionLists = { allow?: string[]; ask?: string[]; deny?: string[] }
const PERMISSION_LIST_KEYS = new Set(['allow', 'ask', 'deny'])

function hostShapes(prefixes: readonly (readonly string[])[]): string[] {
  // A harness rule stops at the first operation name. The editable wrapper checks any subcommand
  // and forwarded argv before dispatch; the remaining host-side gap is tracked in the DEVENV backlog.
  const operations = [...new Set(prefixes.map(prefix => prefix[0]))]
  return operations.flatMap(operation => [
    `./agent unsandboxed ${operation}`,
    `./agent unsandboxed ${operation} *`,
  ])
}

/** Rulesync renders these lists without inherited rules only when the output directory is empty. */
async function pristinePermissionLists(root: string): Promise<PermissionLists> {
  const scratch = await Repo.mkScratchDir('tao-agent-permissions-', root)
  try {
    await generate({
      configPath: '.rulesync/rulesync.jsonc',
      features: ['permissions'],
      inputRoot: root,
      outputRoots: [scratch],
      silent: true,
      targets: ['claudecode'],
    })
    const settings = JSON.parse(await FS.readText(FS.resolvePath(CLAUDE_SETTINGS, scratch))) as {
      permissions?: PermissionLists
    }
    return settings.permissions ?? {}
  } finally {
    await FS.remove(scratch)
  }
}

/**
 * rulesync deep-merges the source's `claudecode` block into the settings already on disk, so an
 * object key deleted from the source lives on in the generated file, where the freshness gate —
 * which regenerates over the committed copy — cannot see it. Arrays and values are rendered afresh;
 * only a key the source no longer has needs dropping. A record the source does not hold as one is
 * pruned against nothing, keeping only what rulesync renders within it.
 */
function withoutRemovedKeys(
  rendered: Record<string, unknown>,
  source: Record<string, unknown>,
  renders: Rendered = {},
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rendered).flatMap(([key, value]) => {
      const rendersKey = Object.hasOwn(renders, key) ? renders[key] : undefined
      if (rendersKey === true) {
        return [[key, value]]
      }
      if (rendersKey === undefined && !Object.hasOwn(source, key)) {
        return []
      }
      const sourceValue = source[key]
      return [[
        key,
        Json.isRecord(value)
          ? withoutRemovedKeys(value, Json.isRecord(sourceValue) ? sourceValue : {}, rendersKey)
          : value,
      ]]
    }),
  )
}

/**
 * Finish the settings rulesync renders: drop what the `claudecode` source block no longer has, when
 * given it, then add one Claude Bash approval and sandbox exclusion per first operation name.
 */
export function renderClaudeHostSettings(
  content: string,
  prefixes: readonly (readonly string[])[],
  claudecode?: Record<string, unknown>,
  pristineLists?: PermissionLists,
): string {
  const parsed = JSON.parse(content) as Record<string, unknown>
  const settings = (claudecode === undefined ? parsed : withoutRemovedKeys(parsed, claudecode, RULESYNC_RENDERED)) as {
    permissions?: PermissionLists & Record<string, unknown>
    sandbox?: { excludedCommands?: string[] }
  }
  if (pristineLists !== undefined) {
    settings.permissions = {
      ...Object.fromEntries(
        Object.entries(settings.permissions ?? {}).filter(([key]) => !PERMISSION_LIST_KEYS.has(key)),
      ),
      ...pristineLists,
    }
  }
  const hostRule = /^Bash\(\.\/agent unsandboxed(?: |\))/u
  const shapes = hostShapes(prefixes)
  settings.permissions = {
    ...settings.permissions,
    allow: [
      ...(settings.permissions?.allow ?? []).filter(rule => !hostRule.test(rule)),
      ...shapes.map(shape => `Bash(${shape})`),
    ],
  }
  settings.sandbox = { ...settings.sandbox, excludedCommands: shapes }
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
    await pristinePermissionLists(root),
  )
  if (next !== current) {
    await writeText(path, next)
  }
}
