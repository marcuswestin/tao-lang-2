import { CommandExecutionError } from './Errors'
import { nodeSpawn, type ProcessEnv, type ProcessSignal, runtimeProcess } from './Platform'

/** CommandSpec describes a process invocation for shared CLI helpers. */
export type CommandSpec = {
  command: string
  args?: readonly string[]
  cwd?: string
  env?: ProcessEnv
  stdin?: string | Uint8Array
  stdio?: 'pipe' | 'inherit'
}

/** CommandResult records a completed process invocation. */
export type CommandResult = {
  command: string
  args: string[]
  cwd?: string
  exitCode: number | null
  signal: ProcessSignal | null
  stdout: string
  stderr: string
  error?: Error
}

/** run starts a command and returns its captured completion result. */
export async function run(spec: CommandSpec): Promise<CommandResult> {
  const args = [...(spec.args ?? [])]
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const child = nodeSpawn(spec.command, args, {
    cwd: spec.cwd,
    env: { ...runtimeProcess.env, ...spec.env },
    stdio: [
      spec.stdin === undefined ? 'ignore' : 'pipe',
      spec.stdio === 'inherit' ? 'inherit' : 'pipe',
      spec.stdio === 'inherit' ? 'inherit' : 'pipe',
    ],
  })

  child.stdout?.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)))
  child.stderr?.on('data', chunk => stderrChunks.push(Buffer.from(chunk)))

  if (spec.stdin !== undefined) {
    child.stdin?.end(spec.stdin)
  }

  return new Promise(resolve => {
    let spawnError: Error | undefined

    child.on('error', error => {
      spawnError = error
    })
    child.on('close', (exitCode, signal) => {
      resolve({
        command: spec.command,
        args,
        cwd: spec.cwd,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        error: spawnError,
      })
    })
  })
}

/** mustRun runs a command and throws when it does not exit successfully. */
export async function mustRun(spec: CommandSpec): Promise<CommandResult> {
  const result = await run(spec)

  if (result.error || result.exitCode !== 0) {
    throw new CommandExecutionError(result)
  }
  return result
}

/** formatCommand formats a command for logs and error messages. */
export function formatCommand(spec: CommandSpec): string {
  return [spec.command, ...(spec.args ?? [])].map(formatCommandPart).join(' ')
}

function formatCommandPart(value: string): string {
  return /^[\w./:=@+-]+$/.test(value) ? value : JSON.stringify(value)
}
