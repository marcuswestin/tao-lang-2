import { CLI, Errors, FS, HCI, Json } from '@shared'
import type { HostApplicationFault } from './app-build/HostBuild'

export async function recordedApplicationFaultNativeReceipt(
  artifacts: string,
  fault: HostApplicationFault,
  receipt: Readonly<{ artifacts: { maestroJunit: string; receipt: string }; preparation?: { fault?: unknown } }>,
): Promise<void> {
  const { classifyNativeApplicationFault } = await import('./app-build/FaultVerdict')
  const evidence = {
    commands: await readNativeJourneyCommands(artifacts, fault),
    junit: await readOptionalText(receipt.artifacts.maestroJunit),
    receipt: await readOptionalJson(receipt.artifacts.receipt),
  }
  const verdict = classifyNativeApplicationFault(fault, evidence)
  await FS.writeJson(FS.resolvePath('application-fault.json', artifacts), {
    ...verdict,
    ...(receipt.preparation?.fault === undefined ? {} : { provenance: receipt.preparation.fault }),
  })
  if (verdict.status === 'detected') {
    HCI.writeLine(`DETECTED application fault '${fault}': ${verdict.reason}`)
    Errors.throwUserInput(
      `Application fault '${fault}' was detected; this intentionally red run wrote ${artifacts}/application-fault.json`,
    )
  }
  if (verdict.status === 'escaped') {
    Errors.throwUnexpected(
      `Application fault '${fault}' escaped the healthy native assertions; see ${artifacts}/application-fault.json`,
    )
  }
  Errors.throwUnexpected(
    `Application fault '${fault}' was inconclusive: ${verdict.reason} See ${artifacts}/application-fault.json`,
  )
}

export async function recordedApplicationFaultBrowserCommand(
  spec: CLI.CommandSpec,
  artifacts: string,
  fault: HostApplicationFault,
  provenance: unknown,
): Promise<void> {
  const result = await CLI.run('node', { processPolicy: 'test', timeoutMs: 180_000, ...spec })
  await FS.writeText(FS.resolvePath('browser.log', artifacts), result.stdout + result.stderr)
  await FS.writeJson(FS.resolvePath('browser.json', artifacts), {
    args: spec.args,
    command: 'node',
    error: result.error === undefined ? undefined : Errors.asError(result.error).message,
    exitCode: result.exitCode,
    signal: result.signal,
  })
  const { classifyApplicationFault } = await import('./app-build/FaultVerdict')
  const report = await readOptionalJson(FS.resolvePath('playwright.json', artifacts))
  const verdict = result.error === undefined && result.signal === null
    ? classifyApplicationFault(fault, report)
    : { fault, reason: 'Playwright did not terminate normally.', status: 'inconclusive' as const }
  await FS.writeJson(FS.resolvePath('application-fault.json', artifacts), { ...verdict, provenance })
  if (verdict.status === 'detected') {
    HCI.writeLine(`DETECTED application fault '${fault}': ${verdict.reason}`)
    Errors.throwUserInput(
      `Application fault '${fault}' was detected; this intentionally red run wrote ${artifacts}/application-fault.json`,
    )
  }
  if (verdict.status === 'escaped') {
    Errors.throwUnexpected(
      `Application fault '${fault}' escaped the healthy browser assertions; see ${artifacts}/application-fault.json`,
    )
  }
  Errors.throwUnexpected(
    `Application fault '${fault}' was inconclusive: ${verdict.reason} See ${artifacts}/application-fault.json`,
  )
}

export async function writeInconclusiveApplicationFaultVerdict(
  artifacts: string,
  fault: HostApplicationFault,
  reason: string,
  provenance?: unknown,
): Promise<void> {
  await FS.writeJson(FS.resolvePath('application-fault.json', artifacts), {
    fault,
    ...(provenance === undefined ? {} : { provenance }),
    reason,
    status: 'inconclusive',
  })
}

async function readNativeJourneyCommands(artifacts: string, fault: HostApplicationFault): Promise<unknown> {
  const subject = fault === 'clockwork-countdown-frozen' ? 'clockwork' : 'hnreader'
  const root = FS.resolvePath('native/journey-artifacts', artifacts)
  const candidates: string[] = []
  for (const run of await FS.listDir(root).catch((): string[] => [])) {
    const commands = FS.resolvePath(`${run}/${subject}/commands.json`, root)
    if (await FS.isFile(commands)) {
      candidates.push(commands)
    }
  }
  return candidates.length === 1 ? await readOptionalJson(candidates[0]!) : undefined
}

async function readOptionalText(path: string): Promise<string | undefined> {
  return await FS.readText(path).catch((): undefined => undefined)
}

async function readOptionalJson(path: string): Promise<unknown> {
  const text = await readOptionalText(path)
  return text === undefined ? undefined : Json.tryParse(text)
}
