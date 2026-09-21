import { HCI } from '@shared'
import { type CapabilityReport, readAgentCapabilities } from './AgentCapabilities'

type RunCapabilitiesOptions = { json?: boolean }

function writeCapabilities(report: CapabilityReport, options: RunCapabilitiesOptions): void {
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
    return
  }
  HCI.writeLine(`Agent host capabilities (${report.sandboxDetected ? 'sandbox detected' : 'no sandbox detected'}):`)
  for (const check of report.checks) {
    HCI.writeLine(`${check.status.toUpperCase().padEnd(11)} ${check.name}: ${check.detail}`)
    HCI.writeLine(`            ${check.command}`)
    if (check.remediation !== undefined && check.status !== 'available') {
      HCI.writeLine(`            ${check.remediation}`)
    }
  }
}

async function run(options: RunCapabilitiesOptions = {}): Promise<number> {
  writeCapabilities(await readAgentCapabilities(), options)
  return 0
}

export const AgentCapabilitiesCommand = { run, write: writeCapabilities }
