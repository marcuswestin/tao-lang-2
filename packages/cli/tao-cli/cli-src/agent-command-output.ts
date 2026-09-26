import { HCI, Platform } from '@shared'
import type { runAppAgentCommand } from './agents-command'

type CommandMetadata = {
  id: string
  name: string
  title: string
  description?: string
  enabled?: boolean
  parameters: { name: string; type: string; required: boolean }[]
}

/** Both clients share readable discovery output and the explicit machine-readable envelope. */
export function printAgentCommands(result: Awaited<ReturnType<typeof runAppAgentCommand>>, json = false): void {
  Platform.runtimeProcess.setExitCode(result.ok ? 0 : 1)
  if (json) {
    HCI.writeLine(JSON.stringify(result))
    return
  }
  if (!result.ok) {
    HCI.writeErrorLine(`${result.error.code}: ${result.error.message}`)
    return
  }
  const commands = result.result as CommandMetadata[]
  if (commands.length === 0) {
    HCI.writeLine('No commands exposed.')
    return
  }
  const lines = [`Available commands (${commands.length})`, '']
  for (const command of commands) {
    const parameters = command.parameters.map(parameter =>
      `${parameter.name}${parameter.required ? '' : '?'}: ${parameter.type}`
    ).join(', ')
    lines.push(`${command.name}(${parameters})`)
    if (command.title && command.title !== command.name) {
      lines.push(`  ${command.title}`)
    }
    if (command.description) {
      lines.push(`  ${command.description}`)
    }
    lines.push(`  ID: ${command.id}`)
    lines.push(
      `  Enabled: ${command.enabled === undefined ? 'evaluated when run' : command.enabled ? 'yes' : 'no'}`,
      '',
    )
  }
  lines.push('? marks an optional argument. Pass arguments with --args as a JSON object.')
  HCI.writeLine(lines.join('\n'))
}
