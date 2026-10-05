import { HCI, Platform } from '@shared'
import { type CapabilityReport, readAgentCapabilities, requiredToLand } from './AgentCapabilities'

type RunCapabilitiesOptions = { hostPlatform?: string; json?: boolean }

function writeCapabilities(report: CapabilityReport, options: RunCapabilitiesOptions): void {
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
    return
  }
  const hostPlatform = options.hostPlatform ?? Platform.hostPlatform
  HCI.writeLine(`Agent host capabilities (${report.sandboxDetected ? 'sandbox detected' : 'no sandbox detected'}):`)
  for (const check of report.checks) {
    const landing = requiredToLand(check.name, hostPlatform) ? 'required to land' : 'not required to land'
    HCI.writeLine(`${check.status.toUpperCase().padEnd(11)} ${check.name}: ${check.detail}`)
    HCI.writeLine(`            ${check.command} (${landing} on ${hostPlatform})`)
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
