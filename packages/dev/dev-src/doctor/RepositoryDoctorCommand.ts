import { HCI, Switch } from '@shared'
import {
  type CheckStatus,
  type DoctorReport,
  doctorReport,
  formatCheck,
  readDoctorFacts,
} from './RepositoryDoctor'

/** RunDoctorOptions selects the output shape; the diagnosis itself never differs. */
type RunDoctorOptions = {
  json?: boolean
}

/**
 * A warning is a fact about the machine, not a failure of the command, so only `fail` exits
 * nonzero. That keeps `doctor` usable as a gate without making optional tooling block work.
 */
function exitCodeFor(status: CheckStatus): number {
  return status === 'fail' ? 1 : 0
}

/** writeReport prints a gathered report in whichever shape the caller asked for. */
function writeReport(report: DoctorReport, options: RunDoctorOptions): void {
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
    return
  }
  for (const check of report.checks) {
    Switch(check.status, {
      fail: () => HCI.writeErrorLine(formatCheck(check)),
      pass: () => HCI.writeLine(formatCheck(check)),
      warn: () => HCI.writeLine(formatCheck(check)),
    })
  }
  HCI.writeLine('')
  HCI.writeLine(Switch(report.status, {
    fail: () => 'doctor: this checkout cannot run Tao commands until the FAIL lines are resolved.',
    pass: () => 'doctor: this checkout is ready.',
    warn: () => 'doctor: this checkout is usable; the WARN lines are optional or informational.',
  }))
}

async function runRepositoryDoctor(options: RunDoctorOptions = {}): Promise<number> {
  const report = doctorReport(await readDoctorFacts())
  writeReport(report, options)
  return exitCodeFor(report.status)
}

/** RepositoryDoctorCommand is the `./dev doctor` entry point. */
export const RepositoryDoctorCommand = {
  exitCodeFor,
  run: runRepositoryDoctor,
  writeReport,
}
