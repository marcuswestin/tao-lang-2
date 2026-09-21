import { CLI, Errors, FS, HCI } from '@shared'

/** Runs one maintenance or proof subprocess and persists the complete command receipt. */
export async function recordedCommand(
  name: string,
  command: string,
  spec: CLI.CommandSpec,
  artifacts: string,
): Promise<void> {
  const result = await CLI.run(command, { processPolicy: 'test', timeoutMs: 180_000, ...spec })
  const log = FS.resolvePath(`${name}.log`, artifacts)
  await FS.writeText(log, result.stdout + result.stderr)
  await FS.writeJson(FS.resolvePath(`${name}.json`, artifacts), {
    args: spec.args,
    command,
    error: result.error === undefined ? undefined : Errors.asError(result.error).message,
    exitCode: result.exitCode,
    signal: result.signal,
  })
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    HCI.writeLine((result.stdout + result.stderr).split('\n').slice(0, 16).join('\n'))
    Errors.throwUserInput(`${name} did not pass; full output: ${log}`)
  }
  HCI.writeLine(`PASS ${name}: ${log}`)
}
