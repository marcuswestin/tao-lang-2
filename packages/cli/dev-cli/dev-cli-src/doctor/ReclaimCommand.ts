import { Errors, HCI } from '@shared'
import { execute, formatReclaimReport, formatWorktreeStatus, reclaim } from './Reclaim'

/** RunReclaimOptions selects the output shape and whether anything is removed. */
type RunReclaimOptions = {
  execute?: boolean
  json?: boolean
}

/**
 * `reclaim` reports by default and removes only when asked, because the report is the part that is
 * always safe to run and the part an agent should reach for. It exits nonzero only when it could not
 * gather a report at all, or when a removal it attempted failed — a worktree it declined to remove
 * because the machine went busy underneath it is a success, not an error.
 */
async function runReclaim(options: RunReclaimOptions = {}): Promise<number> {
  try {
    const report = await reclaim()
    const removals = options.execute === true ? await execute(report) : undefined
    const finished = removals === undefined ? report : { ...report, removals }
    HCI.writeLine(options.json === true ? JSON.stringify(finished, null, 2) : formatReclaimReport(finished))
    return removals?.some(removal => removal.outcome === 'failed') === true ? 1 : 0
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    return 1
  }
}

/** ReclaimCommand is the `./dev reclaim` entry point. */
export const ReclaimCommand = {
  run: runReclaim,
  async status(): Promise<number> {
    try {
      HCI.writeLine(formatWorktreeStatus(await reclaim()))
      return 0
    } catch (error) {
      HCI.writeErrorLine(Errors.formatForUser(error))
      return 1
    }
  },
}
