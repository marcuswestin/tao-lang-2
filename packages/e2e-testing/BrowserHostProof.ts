import { CLI, Errors, FS, HCI } from '@shared'
import type { exportHostWeb, HostBuild, prepareHostApp } from './app-build/HostBuild'
import {
  recordedApplicationFaultBrowserCommand,
  writeInconclusiveApplicationFaultVerdict,
} from './ApplicationFaultReceipts'
import { recordedCommand } from './CommandReceipts'
import type { BrowserHostTestingRequest, HostTestingContext } from './HostTestingRequest'
import { startStaticHostServer } from './StaticHostServer'

type BrowserHostProofDependencies = Readonly<{
  exportHostWeb: typeof exportHostWeb
  prepareHostApp: typeof prepareHostApp
  recordedCommand: typeof recordedCommand
}>

const defaultDependencies: BrowserHostProofDependencies = {
  exportHostWeb: async (...args) => (await import('./app-build/HostBuild')).exportHostWeb(...args),
  prepareHostApp: async (...args) => (await import('./app-build/HostBuild')).prepareHostApp(...args),
  recordedCommand,
}

/** Runs the isolated prepare/export/browser pipeline selected by one browser-build request. */
export async function runBrowserHostProof(
  request: BrowserHostTestingRequest,
  context: HostTestingContext,
  dependencies: BrowserHostProofDependencies = defaultDependencies,
): Promise<void> {
  let build: HostBuild
  try {
    await dependencies.recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, context.artifactRoot)
    build = await dependencies.prepareHostApp({
      artifactRoot: context.artifactRoot,
      ...(request.fault === undefined ? {} : { fault: request.fault }),
      runId: context.runId,
      seed: request.seed,
      subject: request.subject,
    })
  } catch (error) {
    if (request.fault !== undefined) {
      await writeInconclusiveApplicationFaultVerdict(
        context.artifactRoot,
        request.fault,
        'The isolated application did not prepare.',
      )
    }
    throw error
  }
  await FS.writeJson(FS.resolvePath('build.json', context.artifactRoot), build)
  const faultProvenance = await validatedBrowserFaultProvenance(request, context, build)
  if (request.mode === 'prepare') {
    await writePreparationOrExportFaultVerdict(
      request,
      context,
      faultProvenance,
      'The isolated application prepared, but no browser fault detection ran.',
    )
    HCI.writeLine(`PREPARED ${build.root}; no host behavior has been tested.`)
    return
  }

  let exported: Awaited<ReturnType<typeof dependencies.exportHostWeb>>
  try {
    exported = await dependencies.exportHostWeb(build, { artifactRoot: context.artifactRoot })
    await FS.writeJson(FS.resolvePath('web-export.json', context.artifactRoot), exported.receipt)
    await FS.writeText(
      FS.resolvePath('web-export.log', context.artifactRoot),
      exported.receipt.stdout + exported.receipt.stderr,
    )
  } catch (error) {
    await writePreparationOrExportFaultVerdict(
      request,
      context,
      faultProvenance,
      'The isolated application did not export a browser bundle.',
    )
    throw error
  }
  if (exported.receipt.exitCode !== 0 || exported.receipt.error !== undefined || exported.receipt.signal !== null) {
    await writePreparationOrExportFaultVerdict(
      request,
      context,
      faultProvenance,
      'The isolated application did not export a browser bundle.',
    )
    Errors.throwUserInput(`Web export failed; see ${context.artifactRoot}/web-export.log`)
  }
  if (request.mode === 'export') {
    await writePreparationOrExportFaultVerdict(
      request,
      context,
      faultProvenance,
      'The isolated application exported a browser bundle, but no browser fault detection ran.',
    )
    HCI.writeLine(`EXPORTED ${exported.root}; no host behavior has been tested.`)
    return
  }
  await runExportedBrowserProof(request, context, exported.root, faultProvenance)
}

async function validatedBrowserFaultProvenance(
  request: BrowserHostTestingRequest,
  context: HostTestingContext,
  build: HostBuild,
): Promise<unknown> {
  if (request.fault === undefined) {
    return undefined
  }
  const { validateApplicationFaultProvenance } = await import('./app-build/FaultVerdict')
  const provenance = validateApplicationFaultProvenance(request.fault, build.fault)
  if (provenance.status === 'invalid') {
    await writeInconclusiveApplicationFaultVerdict(
      context.artifactRoot,
      request.fault,
      provenance.reason,
      build.fault,
    )
    Errors.throwUnexpected(
      `Application fault '${request.fault}' has invalid build provenance: ${provenance.reason}`,
    )
  }
  return provenance.provenance
}

async function runExportedBrowserProof(
  request: BrowserHostTestingRequest,
  context: HostTestingContext,
  root: string,
  faultProvenance: unknown,
): Promise<void> {
  let server: ReturnType<typeof startStaticHostServer>
  try {
    server = startStaticHostServer(root)
  } catch (error) {
    if (request.fault !== undefined) {
      await writeInconclusiveApplicationFaultVerdict(
        context.artifactRoot,
        request.fault,
        'The browser host server did not launch.',
        faultProvenance,
      )
    }
    throw error
  }
  try {
    const browserCommand = {
      args: [
        context.playwright,
        'test',
        '--config',
        'packages/e2e-testing/playwright.config.ts',
        '--project',
        'browser',
      ],
      env: { ...context.environment, TAO_HOST_TEST_URL: server.url },
      processPolicy: 'test',
      stdio: 'stream',
      timeoutMs: 180_000,
    } as const satisfies CLI.CommandSpec
    if (request.fault === undefined) {
      await recordedCommand('browser', 'node', browserCommand, context.artifactRoot)
    } else {
      await recordedApplicationFaultBrowserCommand(
        browserCommand,
        context.artifactRoot,
        request.fault,
        faultProvenance,
      )
    }
  } finally {
    await server.stop()
  }
}

async function writePreparationOrExportFaultVerdict(
  request: BrowserHostTestingRequest,
  context: HostTestingContext,
  provenance: unknown,
  reason: string,
): Promise<void> {
  if (request.fault !== undefined) {
    await writeInconclusiveApplicationFaultVerdict(context.artifactRoot, request.fault, reason, provenance)
  }
}
