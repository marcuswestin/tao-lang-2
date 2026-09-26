import { ModelAuditCommand } from '@agent-cli/delegation/ModelAuditCommand'
import { HCI, Switch } from '@shared'
import {
  type EnvironmentFingerprint,
  environmentFingerprintOf,
  formatFingerprint,
} from '@verification/EnvironmentFingerprint'
import {
  type DoctorReport,
  doctorReport,
  exitCodeFor,
  formatCheck,
  readDoctorFacts,
  worstStatus,
} from '@verification/RepositoryDoctor'

/** RunDoctorOptions selects the output shape; the diagnosis itself never differs. */
type RunDoctorOptions = {
  fingerprint?: boolean
  json?: boolean
}

/** The command a report asks somebody to run, quoted wherever this command points at the fingerprint. */
const FINGERPRINT_COMMAND = './agent doctor --fingerprint'

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
 * the moment we are asking them to trust us with something.
 *
 * Printing is separate from gathering so a caller can do the slow half — a dozen processes asked
 * about themselves — before it takes anything this narrow, which is what keeps the test of this
 * function off the process-wide output-capture queue.
 */
function writeFingerprint(fingerprint: EnvironmentFingerprint): number {
  HCI.writeLine(JSON.stringify(fingerprint, null, 2))
  return 0
}

async function runRepositoryDoctor(options: RunDoctorOptions = {}): Promise<number> {
  if (options.fingerprint === true) {
    // Also skips the rest of the doctor, which probes ports and writes into `.artifacts` to test
    // that it can; a fingerprint needs none of that.
    return writeFingerprint(await environmentFingerprintOf())
  }
  const base = doctorReport(await readDoctorFacts())
  const modelFindings = await ModelAuditCommand.briefFindings(base.repositoryRoot).catch(() => [])
  const checks = [
    ...base.checks,
    ...modelFindings.map(detail => ({ detail, name: 'agent model routing', status: 'warn' as const })),
  ]
  const report: DoctorReport = { ...base, checks, status: worstStatus(checks) }
  writeReport(report, options)
  return exitCodeFor(report.status)
}

/** RepositoryDoctorCommand is the `./dev doctor` entry point. */
export const RepositoryDoctorCommand = {
  exitCodeFor,
  run: runRepositoryDoctor,
  writeFingerprint,
  writeReport,
}
