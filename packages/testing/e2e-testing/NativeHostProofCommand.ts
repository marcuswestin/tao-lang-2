import { Errors, HCI } from '@shared'
import type { PrepareHostAppOptions } from './app-build/HostBuild'
import { runAppiumNativeHostProofCommand } from './AppiumNativeHostProofCommand'
import { recordedCommand } from './CommandReceipts'
import type { HostTestingContext, NativeHostTestingRequest } from './HostTestingRequest'
import { runPhysicalIosInstall } from './native/PhysicalIosInstall'

/** Orchestrates an Appium simulator journey or a physical iOS Release-install milestone. */
export async function runNativeHostProofCommand(
  request: NativeHostTestingRequest,
  context: HostTestingContext,
): Promise<void> {
  const fault = 'fault' in request ? request.fault : undefined
  const build = async (input: PrepareHostAppOptions) => {
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, context.artifactRoot)
    const { prepareHostApp } = await import('./app-build/HostBuild')
    const prepared = await prepareHostApp({
      ...input,
      ...(fault === undefined ? {} : { fault }),
    })
    if (fault === undefined) {
      return prepared
    }
    const { validateApplicationFaultProvenance } = await import('./app-build/FaultVerdict')
    const provenance = validateApplicationFaultProvenance(fault, prepared.fault)
    if (provenance.status === 'invalid') {
      Errors.throwUnexpected(
        `Application fault '${fault}' has invalid build provenance: ${provenance.reason}`,
      )
    }
    return prepared
  }
  if (request.mode !== 'device') {
    return await runAppiumNativeHostProofCommand(request, context, build)
  }
  const receipt = await runPhysicalIosInstall({
    artifactRoot: context.artifactRoot,
    build,
    device: request.device,
    runId: context.runId,
    seed: request.seed,
    subject: request.subject,
  })
  HCI.writeLine(`${receipt.status.toUpperCase()} physical iOS install: ${receipt.artifacts.receipt}`)
  if (receipt.status !== 'installed') {
    Errors.throwHostEnvironment(receipt.failure?.message ?? 'The physical iOS install did not complete.')
  }
}
