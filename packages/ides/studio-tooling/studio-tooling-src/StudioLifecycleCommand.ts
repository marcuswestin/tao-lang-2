import { Errors, HCI } from '@shared'
import { exitCodeFor, formatCheck } from '@verification/RepositoryDoctor'
import { studioDoctorReport } from './StudioDoctor'
import {
  formatLaunchListing,
  formatStopReport,
  listLaunches,
  stopExitCode,
  stopLaunches,
} from './StudioLifecycle'

/** The `./dev studio-ps`, `studio-stop`, and `studio-doctor` entry points, thin over the lifecycle module. */

type JsonOption = { json?: boolean }

async function runStudioPs(options: JsonOption = {}): Promise<number> {
  const listing = await listLaunches()
  HCI.writeLine(options.json === true ? JSON.stringify(listing, null, 2) : formatLaunchListing(listing))
  return 0
}

async function runStudioStop(options: JsonOption & { all?: boolean; launch?: string } = {}): Promise<number> {
  try {
    const report = await stopLaunches({ all: options.all, launchId: options.launch })
    HCI.writeLine(options.json === true ? JSON.stringify(report, null, 2) : formatStopReport(report))
    return stopExitCode(report)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    return 1
  }
}

async function runStudioDoctor(options: JsonOption = {}): Promise<number> {
  const report = await studioDoctorReport()
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
    return exitCodeFor(report.status)
  }
  for (const check of report.checks) {
    HCI.writeLine(formatCheck(check))
  }
  HCI.writeLine('')
  HCI.writeLine(
    report.status === 'fail'
      ? 'studio doctor: Tao Studio cannot start until the FAIL lines are resolved.'
      : 'studio doctor: Tao Studio can start; the WARN lines are optional or informational.',
  )
  return exitCodeFor(report.status)
}

/** StudioLifecycleCommand groups the Studio lifecycle subcommands. */
export const StudioLifecycleCommand = {
  doctor: runStudioDoctor,
  ps: runStudioPs,
  stop: runStudioStop,
}
