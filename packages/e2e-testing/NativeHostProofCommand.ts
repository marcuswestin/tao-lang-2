import { Errors, HCI } from '@shared'
import type { PrepareHostAppOptions } from './app-build/HostBuild'
import { runAppiumNativeHostProofCommand } from './AppiumNativeHostProofCommand'
import { recordedApplicationFaultNativeReceipt } from './ApplicationFaultReceipts'
import { recordedCommand } from './CommandReceipts'
import type { HostTestingContext, NativeHostTestingRequest } from './HostTestingRequest'
import { runNativeHostProof } from './native/NativeHostProof'

/** Orchestrates preparation and proof for one explicit simulator or physical-device target. */
export async function runNativeHostProofCommand(
  request: NativeHostTestingRequest,
  context: HostTestingContext,
): Promise<void> {
  const build = async (input: PrepareHostAppOptions) => {
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, context.artifactRoot)
    const { prepareHostApp } = await import('./app-build/HostBuild')
    const prepared = await prepareHostApp({
      ...input,
      ...(request.fault === undefined ? {} : { fault: request.fault }),
    })
    if (request.fault === undefined) {
      return prepared
    }
    const { validateApplicationFaultProvenance } = await import('./app-build/FaultVerdict')
    const provenance = validateApplicationFaultProvenance(request.fault, prepared.fault)
    if (provenance.status === 'invalid') {
      Errors.throwUnexpected(
        `Application fault '${request.fault}' has invalid build provenance: ${provenance.reason}`,
      )
    }
    return prepared
  }
  if (request.mode === 'android' || request.mode === 'ios') {
    return await runAppiumNativeHostProofCommand(request, context, build)
  }
  const receipt = await runNativeHostProof({
    artifactRoot: context.artifactRoot,
    build,
    device: { id: request.device, target: 'device' },
    runId: context.runId,
    seed: request.seed,
    subject: request.subject,
  })
  HCI.writeLine(`${receipt.status.toUpperCase()} native proof: ${receipt.artifacts.receipt}`)
  if (request.fault !== undefined) {
    await recordedApplicationFaultNativeReceipt(context.artifactRoot, request.fault, receipt)
  }
  if (receipt.status !== 'passed') {
    Errors.throwHostEnvironment(receipt.failure?.message ?? 'The native proof did not pass.')
  }
}
