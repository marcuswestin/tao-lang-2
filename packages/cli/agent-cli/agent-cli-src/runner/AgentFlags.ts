/**
 * The front door's own flags, uniform across every `./agent` command and never forwarded to the
 * child: `--verbose`, `--json`, and `--max-lines <n>`. Everything else in the argument list —
 * `--no-cache`, a test target, `setup --refresh-lockfile` — passes through untouched and in order.
 */

/** AgentFlags is an argument list split into the front door's own flags and the rest. */
export type AgentFlags = {
  json: boolean
  /** Overrides the output policy's line budget for this run only; undefined defers to the policy. */
  maxLines: number | undefined
  rest: string[]
  verbose: boolean
}

/**
 * parseAgentFlags finds `--verbose`, `--json`, and `--max-lines` wherever they appear in the
 * argument list, in either `--max-lines 40` or `--max-lines=40` form, and returns the remaining
 * arguments in their original order for the child command. Under CI (`CI=true`, which every hosted
 * runner sets) a run is verbose by default: its log file is gone with the machine, so the output has
 * to be in the job's own log.
 */
export function parseAgentFlags(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): AgentFlags {
  let json = false
  let verbose = env['CI'] === 'true'
  let maxLines: number | undefined
  const rest: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '--json') {
      json = true
    } else if (arg === '--verbose') {
      verbose = true
    } else if (arg === '--max-lines') {
      maxLines = parsedMaxLines(args[index + 1]) ?? maxLines
      index += 1
    } else if (arg.startsWith('--max-lines=')) {
      maxLines = parsedMaxLines(arg.slice('--max-lines='.length)) ?? maxLines
    } else {
      rest.push(arg)
    }
  }

  return { json, maxLines, rest, verbose }
}

function parsedMaxLines(value: string | undefined): number | undefined {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
