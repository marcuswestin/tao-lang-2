import { JUST_COMMANDS } from '../AgentCommands'

type HostCommandSource = { agentHostCommands?: unknown }

/** The canonical host list consists of literal argv prefixes, not shell command strings. */
export function agentHostCommands(source: HostCommandSource): string[][] {
  const entries = source.agentHostCommands
  if (!Array.isArray(entries)) {
    throw new TypeError('agentHostCommands in .rulesync/permissions.jsonc must be an array of command prefixes.')
  }
  const seen = new Set<string>()
  return entries.map((entry: unknown) => {
    if (typeof entry !== 'string' || !/^[^\s*?\[\]]+(?: [^\s*?\[\]]+)*$/u.test(entry) || seen.has(entry)) {
      throw new TypeError(`Invalid or duplicate agentHostCommands prefix: ${String(entry)}`)
    }
    seen.add(entry)
    return entry.split(' ')
  })
}

/** Match whole argv tokens so a prefix such as `land` cannot admit `land-unlock`. */
export function hostCommandKind(
  argv: readonly string[],
  prefixes: readonly (readonly string[])[],
): 'agent' | 'external' | undefined {
  const matched = prefixes.some(prefix =>
    prefix.length <= argv.length && prefix.every((token, index) => token === argv[index])
  )
  if (!matched) {
    return undefined
  }
  return JUST_COMMANDS.includes(argv[0] as (typeof JUST_COMMANDS)[number]) ? 'agent' : 'external'
}
