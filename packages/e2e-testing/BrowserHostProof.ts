import { CLI, Errors, FS, HCI } from '@shared'
import type { HostBuild } from './app-build/HostBuild'
import {
  recordedApplicationFaultBrowserCommand,
  writeInconclusiveApplicationFaultVerdict,
} from './ApplicationFaultReceipts'
import { recordedCommand } from './CommandReceipts'
import type { BrowserHostTestingRequest, HostTestingContext } from './HostTestingRequest'
import { startStaticHostServer } from './StaticHostServer'

/** Runs the isolated prepare/export/browser pipeline selected by one browser-build request. */
export async function runBrowserHostProof(
  request: BrowserHostTestingRequest,
  context: HostTestingContext,
): Promise<void> {
  let build: HostBuild
  try {
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, context.artifactRoot)
    const { prepareHostApp } = await import('./app-build/HostBuild')
    build = await prepareHostApp({
      artifactRoot: context.artifactRoot,
      ...(request.fault === undefined ? {} : { fault: request.fault }),
      runId: context.runId,
      seed: request.seed,
      subject: request.subject,
    })
  } catch (error) {
    if (request.fault !== undefined && request.mode === 'browser') {
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
    HCI.writeLine(`PREPARED ${build.root}; no host behavior has been tested.`)
    return
  }

  const { exportHostWeb } = await import('./app-build/HostBuild')
  const exported = await exportHostWeb(build, { artifactRoot: context.artifactRoot })
  await FS.writeJson(FS.resolvePath('web-export.json', context.artifactRoot), exported.receipt)
  await FS.writeText(
    FS.resolvePath('web-export.log', context.artifactRoot),
    exported.receipt.stdout + exported.receipt.stderr,
  )
  if (exported.receipt.exitCode !== 0 || exported.receipt.error !== undefined || exported.receipt.signal !== null) {
    if (request.fault !== undefined && request.mode === 'browser') {
      await writeInconclusiveApplicationFaultVerdict(
        context.artifactRoot,
        request.fault,
        'The isolated application did not export a browser bundle.',
      )
    }
    Errors.throwUserInput(`Web export failed; see ${context.artifactRoot}/web-export.log`)
  }
  if (request.mode === 'export') {
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
  if (request.fault === undefined || request.mode !== 'browser') {
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
