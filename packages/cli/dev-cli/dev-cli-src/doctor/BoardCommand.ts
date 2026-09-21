import { Errors, HCI } from '@shared'
import { board, formatBoardReport } from './Board'

/** RunBoardOptions selects the output shape; the report gathered is never different. */
type RunBoardOptions = {
  json?: boolean
}

/**
 * `board` never fails on the state it finds — a dirty worktree, an unreadable one, a missing
 * finalize record are all ordinary facts it reports rather than errors. It exits nonzero only when
 * it could not gather a report at all, such as `git worktree list` itself failing.
 */
async function runBoard(options: RunBoardOptions = {}): Promise<number> {
  try {
    const report = await board()
    HCI.writeLine(options.json === true ? JSON.stringify(report, null, 2) : formatBoardReport(report))
    return 0
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    return 1
  }
}

/** BoardCommand is the `./dev board` entry point. */
export const BoardCommand = {
  run: runBoard,
}
