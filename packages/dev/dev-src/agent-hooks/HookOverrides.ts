/**
 * Records every `# hook-ok:` override, so the refusal rules can be tuned against what actually
 * misfires rather than against argument. A denial that an agent has to talk its way past is a
 * denial nobody can measure; a denial it can pass by writing down why leaves a list Ro can read.
 *
 * Nothing here may fail a tool call. A hook that threw because a log directory was missing would
 * turn its own bookkeeping into a broken Bash tool, so every failure is swallowed deliberately.
 */

import { FS } from '@shared'

/** The log every worktree appends to, beside the lane logs Ro already reads. */
export const OVERRIDE_LOG = '.artifacts/logs/hook-overrides.jsonl'

export type HookOverride = {
  /** The command the agent ran anyway. */
  command: string
  /** The refusal the rules would have returned. */
  refusal: string
  /** The justification the agent attached. */
  reason: string
  /** When it happened, as an ISO instant. */
  at: string
}

/** overrideLine renders one record as the JSONL line the log stores. */
function overrideLine(override: HookOverride): string {
  return `${JSON.stringify(override)}\n`
}

/**
 * recordOverride appends one record to the log under `root`, and reports whether it landed. A false
 * is not an error to surface: the override itself still stands, and only the bookkeeping was lost.
 */
export async function recordOverride(root: string, override: HookOverride): Promise<boolean> {
  let handle
  try {
    handle = await FS.openAppend(FS.resolvePath(OVERRIDE_LOG, root))
    await handle.writeFile(overrideLine(override))
    return true
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}
