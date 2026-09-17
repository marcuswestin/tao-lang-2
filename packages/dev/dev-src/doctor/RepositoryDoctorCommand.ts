import { HCI, Switch } from '@shared'
import { environmentFingerprintOf, formatFingerprint } from './EnvironmentFingerprint'
import {
  type CheckStatus,
  type DoctorReport,
  doctorReport,
  formatCheck,
  readDoctorFacts,
} from './RepositoryDoctor'

/** RunDoctorOptions selects the output shape; the diagnosis itself never differs. */
type RunDoctorOptions = {
  fingerprint?: boolean
  json?: boolean
}

/** The command a report asks somebody to run, quoted wherever this command points at the fingerprint. */
const FINGERPRINT_COMMAND = './agent doctor --fingerprint'

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
  // Shown before the verdict rather than after it, because somebody who is about to file a report
  // is reading this screen for what to paste, and a person who is not simply reads on.
  HCI.writeLine(`Environment, safe to paste into a report (${FINGERPRINT_COMMAND} prints it as JSON):`)
  for (const line of formatFingerprint(report.fingerprint)) {
    HCI.writeLine(`      ${line}`)
  }
  HCI.writeLine('')
  HCI.writeLine(Switch(report.status, {
    fail: () => 'doctor: this checkout cannot run Tao commands until the FAIL lines are resolved.',
    pass: () => 'doctor: this checkout is ready.',
    warn: () => 'doctor: this checkout is usable; the WARN lines are optional or informational.',
  }))
}

/**
 * The fingerprint alone, and always exit 0. Somebody runs this to collect an attachment for a
 * report, not to be told a verdict: a nonzero exit would read as "this command failed" at exactly
 * the moment we are asking them to trust us with something. It also skips the rest of the doctor,
 * which probes ports and writes into `.artifacts` to test that it can.
 */
async function writeFingerprint(): Promise<number> {
  HCI.writeLine(JSON.stringify(await environmentFingerprintOf(), null, 2))
  return 0
}

async function runRepositoryDoctor(options: RunDoctorOptions = {}): Promise<number> {
  if (options.fingerprint === true) {
    return await writeFingerprint()
  }
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
