import { CLI, Errors, FS, HCI, Json, Platform, Repo } from '@shared'

type HostTestingOptions = { app: string; device?: string; seed: string; fault?: boolean; browserChannel?: string }
type HostApplicationFault = 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write'

/** Explicit entry point; the prototype is never discovered by an existing test lane. */
export async function runHostTesting(mode: string, options: HostTestingOptions): Promise<void> {
  const seed = Number(options.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    Errors.throwUserInput('--seed must be an unsigned 32-bit integer.')
  }
  if (options.app !== 'hnreader' && options.app !== 'clockwork') {
    Errors.throwUserInput('--app must be hnreader or clockwork.')
  }
  const runId = Platform.randomUUID()
  const fault = options.fault === true ? applicationFaultFor(options.app) : undefined
  const artifactRoot = Repo.resolvePath(`.artifacts/host-testing/${runId}`)
  await FS.mkdir(artifactRoot)
  const environment = {
    ...Platform.runtimeProcess.env,
    TAO_HOST_TEST_ARTIFACTS: artifactRoot,
    TAO_HOST_TEST_APP: options.app,
    TAO_HOST_TEST_SEED: String(seed),
    TAO_HOST_TEST_RUN_ID: runId,
    TAO_HOST_TEST_BROWSER_CHANNEL: options.browserChannel ?? 'chrome',
  }
  HCI.writeLine(`Host-testing artifacts: ${artifactRoot}`)
  const playwright = Repo.resolvePath('packages/dev/node_modules/@playwright/test/cli.js')
  if (mode === 'format') {
    await recordedCommand('format', 'dprint', {
      args: [
        'fmt',
        '--incremental=false',
        'packages/dev/host-testing/**',
        'packages/runtime/TaoRuntime-src/host-testing/**',
        'packages/dev/dev-src/dev.ts',
        'packages/runtime/TaoRuntime-src/core/**',
        'packages/icloud-native/plugins/with-tao-icloud.cjs',
        'packages/icloud-native/README.md',
        'packages/runtime/package.json',
        'packages/tsconfig.base.json',
        'packages/runtime-toolchain/metro.config.cjs',
        'packages/shared/shared-src/core/shared-core.ts',
        'packages/shared/shared-src/shared.ts',
        'packages/dev/dev-src/agent-dev.ts',
        'packages/dev/package.json',
        'packages/dev/tsconfig.json',
        'config/knip.json',
        'Roadmap.md',
        'Docs/Roadmap/Real-host testing prototype.md',
        'Docs/Roadmap/Real-host testing handoff.md',
        'Docs/Roadmap/Developer environment upgrades/DEVENV-040-bun-dependency-recovery-conflicts-with-protected-package-fix.md',
      ],
    }, artifactRoot)
    return
  }
  if (mode === 'setup') {
    await CLI.mustRun('node', { args: [playwright, 'install', 'chromium'], stdio: 'stream' })
    return
  }
  if (mode === 'typecheck') {
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, artifactRoot)
    await recordedCommand('typecheck', 'bun', {
      args: ['node_modules/typescript-native/bin/tsc', '--project', 'packages/dev/host-testing/tsconfig.json'],
    }, artifactRoot)
    return
  }
  if (mode === 'check') {
    if (fault !== undefined) {
      Errors.throwUserInput('--fault changes an isolated compiled app; use prepare, export, browser, ios, or device.')
    }
    await recordedCommand('controls', 'node', {
      args: [
        playwright,
        'test',
        '--config',
        'packages/dev/host-testing/playwright.config.ts',
        '--project',
        'controls',
      ],
      env: environment,
      stdio: 'stream',
      processPolicy: 'test',
      timeoutMs: 120_000,
    }, artifactRoot)
    return
  }
  if (mode === 'lint') {
    const { lintHostTestSources } = await import('./enforcement/EffectBoundaryLint')
    const paths = [
      'packages/dev/host-testing/HostTestingCommand.ts',
      'packages/dev/host-testing/playwright.config.ts',
      'packages/dev/host-testing/app-build/HostBuild.ts',
      'packages/dev/host-testing/app-build/FaultVerdict.ts',
      'packages/dev/host-testing/app-build/FaultVerdict.host.spec.ts',
      'packages/dev/host-testing/browser/hnreader.host.spec.ts',
      'packages/dev/host-testing/browser/clockwork.host.spec.ts',
      'packages/dev/host-testing/environment/clockwork.host.spec.ts',
      'packages/dev/host-testing/environment/clockwork-browser.host.spec.ts',
      'packages/dev/host-testing/enforcement/EffectBoundaryLint.ts',
      'packages/dev/host-testing/enforcement/EffectBoundaryLint.host.spec.ts',
      'packages/dev/host-testing/native/NativeHostProof.ts',
      'packages/dev/host-testing/native/cloudkit-config.host.spec.ts',
      'packages/dev/host-testing/fixtures/Clockwork/Clockwork.ts',
      'packages/runtime/TaoRuntime-src/host-testing/HostTestEnvironment.ts',
      'packages/runtime/TaoRuntime-src/host-testing/NativeHostTestControl.ts',
      'packages/runtime/TaoRuntime-src/host-testing/RuntimeHostTestControl.ts',
      'packages/runtime/TaoRuntime-src/host-testing/index.ts',
      'packages/runtime/TaoRuntime-src/core/Effects.ts',
      'packages/runtime/TaoRuntime-src/core/RuntimeCore.ts',
    ]
    const issues = await lintHostTestSources(Repo.getRoot(), { files: paths })
    await FS.writeJson(FS.resolvePath('effect-boundary.json', artifactRoot), { paths, issues })
    if (issues.length > 0) {
      Errors.throwUserInput(`Effect boundary failed; see ${artifactRoot}/effect-boundary.json`)
    }
    HCI.writeLine(`PASS effect boundary for ${paths.length} explicitly registered files.`)
    return
  }
  if (!['prepare', 'export', 'browser', 'ios', 'device'].includes(mode)) {
    Errors.throwUserInput(`Unknown host-testing mode '${mode}'.`)
  }
  const { prepareHostApp, exportHostWeb } = await import('./app-build/HostBuild')
  const prepare = async (input: Parameters<typeof prepareHostApp>[0]) => {
    await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, artifactRoot)
    return await prepareHostApp({ ...input, ...(fault === undefined ? {} : { fault }) })
  }
  if (mode === 'ios' || mode === 'device') {
    if (options.device === undefined) {
      Errors.throwUserInput('Native proofs require --device with an explicit target identifier.')
    }
    const { runNativeHostProof } = await import('./native/NativeHostProof')
    const nativePrepare = fault === undefined
      ? prepare
      : async (input: Parameters<typeof prepare>[0]) => {
        const build = await prepare(input)
        const { validateApplicationFaultProvenance } = await import('./app-build/FaultVerdict')
        const provenance = validateApplicationFaultProvenance(fault, build.fault)
        if (provenance.status === 'invalid') {
          Errors.throwUnexpected(`Application fault '${fault}' has invalid build provenance: ${provenance.reason}`)
        }
        return build
      }
    const receipt = await runNativeHostProof({
      artifactRoot,
      runId,
      seed,
      subject: options.app,
      build: nativePrepare,
      device: { target: mode === 'ios' ? 'simulator' : 'device', id: options.device },
    })
    HCI.writeLine(`${receipt.status.toUpperCase()} native proof: ${receipt.artifacts.receipt}`)
    if (fault !== undefined) {
      await recordedApplicationFaultNativeReceipt(artifactRoot, fault, receipt)
    }
    if (receipt.status !== 'passed') {
      Errors.throwHostEnvironment(receipt.failure?.message ?? 'The native proof did not pass.')
    }
    return
  }
  let build: Awaited<ReturnType<typeof prepare>>
  try {
    build = await prepare({ artifactRoot, runId, seed, subject: options.app })
  } catch (error) {
    if (fault !== undefined && mode === 'browser') {
      await writeInconclusiveApplicationFaultVerdict(artifactRoot, fault, 'The isolated application did not prepare.')
    }
    throw error
  }
  await FS.writeJson(FS.resolvePath('build.json', artifactRoot), build)
  let faultProvenance: unknown
  if (fault !== undefined && mode === 'browser') {
    const { validateApplicationFaultProvenance } = await import('./app-build/FaultVerdict')
    const provenance = validateApplicationFaultProvenance(fault, build.fault)
    if (provenance.status === 'invalid') {
      await writeInconclusiveApplicationFaultVerdict(artifactRoot, fault, provenance.reason, build.fault)
      Errors.throwUnexpected(`Application fault '${fault}' has invalid build provenance: ${provenance.reason}`)
    }
    faultProvenance = provenance.provenance
  }
  if (mode === 'prepare') {
    HCI.writeLine(`PREPARED ${build.root}; no host behavior has been tested.`)
    return
  }
  const exported = await exportHostWeb(build, { artifactRoot })
  await FS.writeJson(FS.resolvePath('web-export.json', artifactRoot), exported.receipt)
  await FS.writeText(FS.resolvePath('web-export.log', artifactRoot), exported.receipt.stdout + exported.receipt.stderr)
  if (exported.receipt.exitCode !== 0 || exported.receipt.error !== undefined || exported.receipt.signal !== null) {
    if (fault !== undefined && mode === 'browser') {
      await writeInconclusiveApplicationFaultVerdict(
        artifactRoot,
        fault,
        'The isolated application did not export a browser bundle.',
      )
    }
    Errors.throwUserInput(`Web export failed; see ${artifactRoot}/web-export.log`)
  }
  if (mode === 'export') {
    HCI.writeLine(`EXPORTED ${exported.root}; no host behavior has been tested.`)
    return
  }
  let server: ReturnType<typeof startHostServer>
  try {
    server = startHostServer(exported.root)
  } catch (error) {
    if (fault !== undefined) {
      await writeInconclusiveApplicationFaultVerdict(artifactRoot, fault, 'The browser host server did not launch.')
    }
    throw error
  }
  try {
    const browserCommand = {
      args: [playwright, 'test', '--config', 'packages/dev/host-testing/playwright.config.ts', '--project', 'browser'],
      env: { ...environment, TAO_HOST_TEST_URL: server.url },
      stdio: 'stream',
      processPolicy: 'test',
      timeoutMs: 180_000,
    } as const satisfies CLI.CommandSpec
    if (fault === undefined) {
      await recordedCommand('browser', 'node', browserCommand, artifactRoot)
    } else {
      await recordedApplicationFaultBrowserCommand(browserCommand, artifactRoot, fault, faultProvenance)
    }
  } finally {
    await server.stop()
  }
}

async function recordedApplicationFaultNativeReceipt(
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

async function recordedApplicationFaultBrowserCommand(
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
  const reportPath = FS.resolvePath('playwright.json', artifacts)
  let report: unknown
  try {
    report = Json.tryParse(await FS.readText(reportPath))
  } catch {
    report = undefined
  }
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

async function writeInconclusiveApplicationFaultVerdict(
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

function applicationFaultFor(app: string): HostApplicationFault {
  return app === 'clockwork' ? 'clockwork-countdown-frozen' : 'hnreader-reading-history-no-write'
}

async function recordedCommand(name: string, command: string, spec: CLI.CommandSpec, artifacts: string): Promise<void> {
  const result = await CLI.run(command, { processPolicy: 'test', timeoutMs: 180_000, ...spec })
  const log = FS.resolvePath(`${name}.log`, artifacts)
  await FS.writeText(log, result.stdout + result.stderr)
  await FS.writeJson(FS.resolvePath(`${name}.json`, artifacts), {
    command,
    args: spec.args,
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error === undefined ? undefined : Errors.asError(result.error).message,
  })
  if (result.exitCode !== 0 || result.error !== undefined || result.signal !== null) {
    HCI.writeLine((result.stdout + result.stderr).split('\n').slice(0, 16).join('\n'))
    Errors.throwUserInput(`${name} did not pass; full output: ${log}`)
  }
  HCI.writeLine(`PASS ${name}: ${log}`)
}

function startHostServer(root: string): { url: string; stop: () => Promise<void> } {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      let path: string
      try {
        const pathname = decodeURIComponent(new URL(request.url).pathname)
        path = FS.resolvePath(pathname === '/' ? 'index.html' : `.${pathname}`, root)
      } catch {
        return new Response('Bad path', { status: 400 })
      }
      if (!FS.pathIsWithin(path, root)) {
        return new Response('Not found', { status: 404 })
      }
      const file = Bun.file(path)
      if (!await file.exists()) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(file, { headers: { 'Cache-Control': 'no-store' } })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true)
    },
  }
}
