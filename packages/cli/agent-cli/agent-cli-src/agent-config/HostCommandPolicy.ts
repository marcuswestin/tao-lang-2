import { JUST_COMMANDS } from '../AgentCommands'
import { hostCommandTarget } from './HostCommandTargets'

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
    const prefix = entry.split(' ')
    if (
      !(prefix.length === 1 && JUST_COMMANDS.includes(prefix[0] as (typeof JUST_COMMANDS)[number]))
      && hostCommandTarget(prefix) === undefined
    ) {
      throw new TypeError(`agentHostCommands prefix has no named implementation: ${entry}`)
    }
    return prefix
  })
}

/** Match whole argv tokens so a prefix such as `land` cannot admit `land-unlock`. */
export function hostCommandKind(
  argv: readonly string[],
  prefixes: readonly (readonly string[])[],
): 'agent' | 'named' | undefined {
  const match = hostCommandPrefix(argv, prefixes)
  if (match === undefined) {
    return undefined
  }
  return hostCommandTarget(match) === undefined && match.length === 1
      && JUST_COMMANDS.includes(match[0] as (typeof JUST_COMMANDS)[number])
    ? 'agent'
    : 'named'
}

/** Resolve the longest listed whole-token prefix before a named implementation runs. */
export function hostCommandPrefix(
  argv: readonly string[],
  prefixes: readonly (readonly string[])[],
): readonly string[] | undefined {
  return prefixes
    .filter(prefix => prefix.length <= argv.length && prefix.every((token, index) => token === argv[index]))
    .sort((a, b) => b.length - a.length)[0]
}
