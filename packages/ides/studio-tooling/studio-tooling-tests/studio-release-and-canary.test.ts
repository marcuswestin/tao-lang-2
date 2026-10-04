import { Errors, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test } from '@shared/test'
import { GateCatalog } from '@verification/GateCatalog'
import { MachineLanes } from '@verification/MachineLanes'
import {
  canaryExitCode,
  evaluateCanary,
  formatCanaryReport,
  REQUIRED_CAPABILITIES,
  resolveCanaryTarget,
} from '../studio-tooling-src/StudioCanary'
import { StudioCanaryCommand } from '../studio-tooling-src/StudioCanaryCommand'
import type { StudioDevOptions } from '../studio-tooling-src/StudioDev'
import { STUDIO_MANUAL_CHECKS, StudioManualChecks } from '../studio-tooling-src/StudioManualChecks'
import {
  type ArtifactInventory,
  type ExternalGateResults,
  formatReleaseValidation,
  type PayloadInventory,
  readArtifactInventory,
  readPayloadInventory,
  releaseExitCode,
  releaseValidation,
} from '../studio-tooling-src/StudioReleaseValidation'

const payload: PayloadInventory = {
  files: ['node', 'service.js', 'studio.js', 'lib/libnode.dylib'],
  nonPortableReferences: [],
}

const artifacts: ArtifactInventory = {
  names: [
    'stable-macos-arm64-update.json',
    'Tao Studio.dmg',
    'stable-macos-arm64-TaoStudio.app.tar.zst',
    'stable-macos-arm64.patch',
  ],
  releaseBaseUrl: 'https://releases.example.com/tao-studio',
  root: '/build/artifacts',
  updateManifest: {
    schemaVersion: 1,
    identifier: 'com.devtao.studio',
    channel: 'stable',
    version: '1.0.0',
    hash: 'abc123',
    platform: 'macos',
    arch: 'arm64',
    artifact: { file: 'stable-macos-arm64-TaoStudio.app.tar.zst' },
  },
}

const gates: ExternalGateResults = { deepSigned: true, diskImageValid: true, notarized: true }

function check(validation: ReturnType<typeof releaseValidation>, name: string) {
  return validation.checks.find(candidate => candidate.name === name)
}

Describe('Studio release validation', () => {
  Test('passes a build whose every gate was actually checked', () => {
    const validation = releaseValidation(payload, artifacts, gates)

    Expect(validation.status).toBe('passed')
    Expect(validation.version).toBe(1)
    Expect(releaseExitCode(validation)).toBe(0)
  })

  Test('refuses to call a build publishable when a gate could not be checked', () => {
    const validation = releaseValidation(payload, artifacts, {})

    Expect(validation.status).toBe('unverified')
    Expect(check(validation, 'notarization')?.status).toBe('unverified')
    Expect(check(validation, 'notarization')?.remediation).toContain('xcrun stapler validate')
    Expect(formatReleaseValidation(validation)).toContain('not publishable from here')
    // A gate nobody ran is not a gate that passed, so the default is to fail.
    Expect(releaseExitCode(validation)).toBe(1)
    Expect(releaseExitCode(validation, { allowUnverified: true })).toBe(0)
  })

  Test('reads the artifact names from disk rather than from the caller', async () => {
    const root = await mkTestDir('tao-release-artifacts-')
    try {
      await FS.writeJson(FS.resolvePath('stable-macos-arm64-update.json', root), artifacts.updateManifest)
      await FS.writeText(FS.resolvePath('stable-macos-arm64-TaoStudio.app.tar.zst', root), 'archive')
      const inventory = await readArtifactInventory(root, 'https://releases.example.com/tao-studio')

      Expect(inventory.names).toEqual([
        'stable-macos-arm64-TaoStudio.app.tar.zst',
        'stable-macos-arm64-update.json',
      ])
      Expect(inventory.root).toBe(root)
      Expect(inventory.updateManifest).toEqual(artifacts.updateManifest)
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails a payload that depends on the machine that built it', () => {
    const validation = releaseValidation(
      {
        ...payload,
        nonPortableReferences: [{
          file: 'service.js',
          reason: 'runs bunx, which the installing machine is not required to have',
        }],
      },
      artifacts,
      gates,
    )

    Expect(validation.status).toBe('failed')
    Expect(check(validation, 'standalone payload')?.detail).toContain('bunx')
    Expect(releaseExitCode(validation)).toBe(1)
  })

  Test('fails a payload with no packaged Node runtime', () => {
    const validation = releaseValidation({ files: ['service.js'], nonPortableReferences: [] }, artifacts, gates)

    Expect(check(validation, 'packaged runtime')?.status).toBe('failed')
    Expect(validation.status).toBe('failed')
  })

  Test('fails an update manifest without a configured HTTPS release host', () => {
    const insecure = releaseValidation(payload, { ...artifacts, releaseBaseUrl: 'http://releases.example.com' }, gates)

    Expect(check(insecure, 'update manifest')?.status).toBe('failed')
    Expect(check(insecure, 'update manifest')?.detail).not.toContain('http://releases.example.com')
  })

  Test('rejects malformed or disconnected update metadata despite a matching file name', async () => {
    const malformedRoot = await mkTestDir('tao-release-malformed-manifest-')
    try {
      await FS.writeText(FS.resolvePath('stable-macos-arm64-update.json', malformedRoot), '{')
      const malformed = await readArtifactInventory(malformedRoot, artifacts.releaseBaseUrl)
      Expect(check(releaseValidation(payload, malformed, gates), 'update manifest')?.status).toBe('failed')
    } finally {
      await FS.remove(malformedRoot)
    }

    const disconnected = releaseValidation(payload, {
      ...artifacts,
      names: artifacts.names.filter(name => !name.endsWith('.tar.zst')),
    }, gates)
    Expect(check(disconnected, 'update manifest')?.status).toBe('failed')
    Expect(check(disconnected, 'update manifest')?.detail).toContain('matching local macOS update archive')
  })

  Test('treats a missing differential patch as unverified, not a failure', () => {
    const missingPatch = releaseValidation(payload, {
      ...artifacts,
      names: artifacts.names.filter(name => !name.endsWith('.patch')),
    }, gates)

    Expect(check(missingPatch, 'differential update')?.status).toBe('unverified')
    Expect(releaseExitCode(missingPatch)).toBe(1)

    const confirmedFirstRelease = releaseValidation(payload, {
      ...artifacts,
      firstRelease: true,
      names: artifacts.names.filter(name => !name.endsWith('.patch')),
    }, gates)
    Expect(check(confirmedFirstRelease, 'differential update')?.status).toBe('passed')
    Expect(releaseExitCode(confirmedFirstRelease)).toBe(0)
  })

  Test('reads a staged payload and reports what it references', async () => {
    const root = await mkTestDir('tao-release-payload-')
    try {
      await FS.writeText(FS.resolvePath('service.js', root), 'const run = () => start("./node")\n')
      await FS.writeText(FS.resolvePath('node', root), 'binary')
      const inventory = await readPayloadInventory(root)

      Expect(inventory.files).toEqual(['node', 'service.js'])
      Expect(inventory.nonPortableReferences.map(reference => reference.file)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('names the file that pins a payload to this checkout', async () => {
    const root = await mkTestDir('tao-release-payload-pinned-')
    try {
      await FS.writeText(FS.resolvePath('service.js', root), 'spawn("/w/.devenv/profile/bin/node")\n')
      const inventory = await readPayloadInventory(root)

      Expect(inventory.nonPortableReferences).toEqual([
        { file: 'service.js', reason: "points at this checkout's devenv profile" },
      ])
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('Studio native canary', () => {
  const passingProbe = {
    capabilities: Object.fromEntries(REQUIRED_CAPABILITIES.map(name => [name, { passed: true }])),
    passed: true,
  }

  Test('runs its automatic native probe hidden so completion never waits for a person', () => {
    Expect(StudioCanaryCommand.testing.canaryStudioDevOptions({
      appName: 'HNReader',
      artifactRoot: '/tmp/canary',
      hutchPath: '/tmp/hutch',
      projectRoot: '/repo/Apps/HNReader',
    })).toMatchObject({
      browser: true,
      native: true,
      nativeProbe: true,
      nativeShowWindow: false,
    })
  })

  Test('classifies an unexpected startup failure as failed rather than blocked', () => {
    const disposition = StudioCanaryCommand.testing.canaryLaunchDisposition({
      exitCode: 1,
      failure: new Errors.UnexpectedBehaviorError('The native completion invariant failed.'),
    })
    const report = evaluateCanary({ ...disposition, exitCode: 1 })

    Expect(report.status).toBe('failed')
    Expect(report.failureReason).toContain('unexpected behavior')
    Expect(report.blockedReason).toBeUndefined()
    Expect(formatCanaryReport(report)).toContain('FAIL      launch:')
  })

  Test('writes a classified report when Studio startup and its cleanup both fail', async () => {
    const artifactRoot = await mkTestDir('tao-studio-canary-startup-failure-')
    const registryRoot = FS.resolvePath('registry', artifactRoot)
    const startupFailure = new Errors.HostEnvironmentError('The device trust store is read-only.')
    try {
      const exitCode = await StudioCanaryCommand.testing.runStudioCanary({
        artifactRoot,
        projectRoot: '/tmp/project',
      }, {
        blockedReason: async () => undefined,
        readLaunches: async () => [],
        readProbeResult: async () => undefined,
        registryRoot,
        runStudioDev: async options => {
          options.onFailure?.(startupFailure)
          Errors.throwHostEnvironment('Studio cleanup failed.')
        },
        survivingOwnedPids: async () => [],
      })

      Expect(exitCode).toBe(1)
      const invocationRoot = await onlyCanaryInvocationRoot(artifactRoot)
      Expect(await FS.readJson(FS.resolvePath('canary.json', invocationRoot))).toMatchObject({
        blockedReason: 'Studio failed before the native probe reported (host environment): '
          + 'The device trust store is read-only.',
        exitCode: 1,
        status: 'blocked',
      })
      const after = await MachineLanes.tryAcquireResource({ name: GateCatalog.GUI_RESOURCE, registryRoot })
      Expect(after).toBeDefined()
      await after?.release()
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('serializes standalone probes and isolates their reports by invocation', async () => {
    const artifactRoot = await mkTestDir('tao-studio-canary-overlap-')
    const firstStarted = Deferred()
    const release = Deferred()
    const nativeRoots: string[] = []
    let starts = 0
    let runs: Promise<number>[] = []
    const dependencies = {
      blockedReason: async () => undefined,
      registryRoot: FS.resolvePath('registry', artifactRoot),
      readLaunches: async () => [],
      readProbeResult: async (path: string) => await FS.readJson<typeof passingProbe>(path),
      runStudioDev: async (options: StudioDevOptions) => {
        const nativeRoot = options.nativeArtifactRoot!
        nativeRoots.push(nativeRoot)
        options.onLaunch?.(`launch-${starts}`)
        starts += 1
        if (starts === 1) {
          firstStarted.resolve()
        }
        await release.promise
        await FS.writeJson(FS.resolvePath('artifacts/runtime-result.json', nativeRoot), passingProbe)
        return 0
      },
      survivingOwnedPids: async () => [],
    }
    try {
      runs = [
        StudioCanaryCommand.testing.runStudioCanary({ artifactRoot, projectRoot: '/tmp/one' }, dependencies),
        StudioCanaryCommand.testing.runStudioCanary({ artifactRoot, projectRoot: '/tmp/two' }, dependencies),
      ]
      await firstStarted.promise
      Expect(starts).toBe(1)
      const blocked = await MachineLanes.tryAcquireResource({
        name: GateCatalog.GUI_RESOURCE,
        registryRoot: dependencies.registryRoot,
      })
      Expect(blocked).toBeUndefined()
      release.resolve()
      Expect(await Promise.all(runs)).toEqual([0, 0])
      Expect(new Set(nativeRoots).size).toBe(2)

      const invocationNames = await FS.listDir(FS.resolvePath('invocations', artifactRoot))
      Expect(invocationNames).toHaveLength(2)
      for (const name of invocationNames) {
        Expect(await FS.readJson(FS.resolvePath(`invocations/${name}/canary.json`, artifactRoot))).toMatchObject({
          status: 'passed',
        })
        Expect(await FS.exists(FS.resolvePath(`invocations/${name}/electrobun`, artifactRoot))).toBe(false)
      }
    } finally {
      release.resolve()
      await Promise.allSettled(runs)
      await FS.remove(artifactRoot)
    }
  })

  Test('binds survivor inspection to the launch id reported by this invocation', () => {
    const selected = StudioCanaryCommand.testing.findCanaryLaunch('mine', [
      { manifest: { launchId: 'concurrent' } },
      { manifest: { launchId: 'mine' } },
    ])
    Expect(selected?.manifest.launchId).toBe('mine')
  })

  Test('removes a prior native probe result before starting a new canary', async () => {
    const artifactRoot = await mkTestDir('tao-studio-canary-probe-')
    try {
      const stalePath = FS.resolvePath('electrobun/artifacts/runtime-result.json', artifactRoot)
      await FS.writeJson(stalePath, { capabilities: { websocket: { passed: true } }, passed: true })

      Expect(await StudioCanaryCommand.testing.freshProbeResultPath(artifactRoot)).toBe(stalePath)
      Expect(await FS.exists(stalePath)).toBe(false)
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('does not mistake the finalized in-process canary owner for a shutdown survivor', () => {
    const currentPid = 4242

    Expect(StudioCanaryCommand.testing.canarySurvivingPids(
      { ownerPid: currentPid, state: 'stopped' },
      [currentPid, 5252],
      currentPid,
    )).toEqual([5252])
  })

  Test('still reports owners that have not finalized or belong to another process', () => {
    const currentPid = 4242

    Expect(StudioCanaryCommand.testing.canarySurvivingPids(
      { ownerPid: currentPid, state: 'ready' },
      [currentPid],
      currentPid,
    )).toEqual([currentPid])
    Expect(StudioCanaryCommand.testing.canarySurvivingPids(
      { ownerPid: 5252, state: 'stopped' },
      [5252],
      currentPid,
    )).toEqual([5252])
  })

  Test('passes when every capability reported, nothing survived, and the launch exited cleanly', () => {
    const report = evaluateCanary({ exitCode: 0, probe: passingProbe, survivingPids: [] })

    Expect(report.status).toBe('passed')
    Expect(report.version).toBe(2)
    Expect(report.missingCapabilities).toEqual([])
    Expect(report).not.toHaveProperty('manualChecks')
    Expect(formatCanaryReport(report)).not.toContain('check by hand')
    Expect(canaryExitCode(report)).toBe(0)
  })

  Test('fails a launch that exited nonzero even when the probe passed', () => {
    const report = evaluateCanary({ exitCode: 1, probe: passingProbe, survivingPids: [] })

    Expect(report.status).toBe('failed')
    Expect(formatCanaryReport(report)).toContain('FAIL      exit: the launch exited 1')
    Expect(canaryExitCode(report)).toBe(1)
  })

  Test('fails when a process the launch owned is still running', () => {
    const report = evaluateCanary({ probe: passingProbe, survivingPids: [4242] })

    Expect(report.status).toBe('failed')
    Expect(formatCanaryReport(report)).toContain('FAIL      shutdown: 4242 still running')
    Expect(canaryExitCode(report)).toBe(1)
  })

  Test('fails, rather than passing quietly, when a capability was never reported', () => {
    const report = evaluateCanary({
      probe: {
        capabilities: { 'multi-window': { passed: true } },
        passed: true,
      },
    })

    Expect(report.status).toBe('failed')
    Expect(report.missingCapabilities).toContain('websocket')
    Expect(formatCanaryReport(report)).toContain('MISSING   websocket')
  })

  Test('reports a host that cannot run the native shell as blocked, never as passed', () => {
    const report = evaluateCanary({ blockedReason: 'Hutch is not installed' })

    Expect(report.status).toBe('blocked')
    Expect(canaryExitCode(report)).toBe(1)
    Expect(formatCanaryReport(report)).toContain('BLOCKED   Hutch is not installed')
  })

  Test('selects HNReader when the default project is used, even if only --project was set', () => {
    const repositoryRoot = '/repo'
    const defaultRoot = FS.resolvePath('Apps/HNReader', repositoryRoot)

    Expect(resolveCanaryTarget({}, repositoryRoot)).toEqual({
      appName: 'HNReader',
      projectRoot: defaultRoot,
    })
    Expect(resolveCanaryTarget({ projectRoot: 'Apps/HNReader' }, repositoryRoot)).toEqual({
      appName: 'HNReader',
      projectRoot: defaultRoot,
    })
  })

  Test('does not invent an app name for a non-default multi-app project', () => {
    const repositoryRoot = '/repo'
    Expect(resolveCanaryTarget({ projectRoot: 'Apps/Other' }, repositoryRoot)).toEqual({
      appName: undefined,
      projectRoot: FS.resolvePath('Apps/Other', repositoryRoot),
    })
    Expect(resolveCanaryTarget({ appName: 'Chosen', projectRoot: 'Apps/Other' }, repositoryRoot)).toEqual({
      appName: 'Chosen',
      projectRoot: FS.resolvePath('Apps/Other', repositoryRoot),
    })
  })
  Test('sweeps an earlier invocation that never reported and the build of one that passed', async () => {
    const artifactBase = await mkTestDir('tao-studio-canary-sweep-')
    try {
      const invocations = FS.resolvePath('invocations', artifactBase)
      const stale = Date.now() - 4 * 60 * 60 * 1000

      // Killed before it reported: evidence of nothing, so the whole invocation goes.
      await FS.writeText(FS.resolvePath('unreported/electrobun/app', invocations), 'build')
      // Reported passed, then killed before it pruned its own build.
      await FS.writeJson(FS.resolvePath('passed/canary.json', invocations), { status: 'passed' })
      await FS.writeText(FS.resolvePath('passed/electrobun/app', invocations), 'build')
      // Failed: its build is the evidence the run exists to produce, so it stays.
      await FS.writeJson(FS.resolvePath('failed/canary.json', invocations), { status: 'failed' })
      await FS.writeText(FS.resolvePath('failed/electrobun/app', invocations), 'build')
      // Untouched because it is this run, and untouched because it is too recent to be finished.
      await FS.writeText(FS.resolvePath('current/electrobun/app', invocations), 'build')
      await FS.writeText(FS.resolvePath('running/electrobun/app', invocations), 'build')
      for (const name of ['unreported', 'passed', 'failed']) {
        await FS.setModifiedTimeMs(FS.resolvePath(name, invocations), stale)
      }

      await StudioCanaryCommand.testing.sweepEarlierCanaryInvocations(artifactBase, 'current')

      Expect(await FS.exists(FS.resolvePath('unreported', invocations))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('passed/electrobun', invocations))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('passed/canary.json', invocations))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('failed/electrobun/app', invocations))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('current/electrobun/app', invocations))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('running/electrobun/app', invocations))).toBe(true)
    } finally {
      await FS.remove(artifactBase)
    }
  })
})

async function onlyCanaryInvocationRoot(artifactRoot: string): Promise<string> {
  const names = await FS.listDir(FS.resolvePath('invocations', artifactRoot))
  Expect(names).toHaveLength(1)
  return FS.resolvePath(`invocations/${names[0]!}`, artifactRoot)
}

Describe('Studio native manual checks', () => {
  Test('launches a visible non-probe workflow and names every check the person is to judge', async () => {
    const artifactRoot = await mkTestDir('tao-studio-manual-checks-')
    try {
      const launches: unknown[] = []
      const output: string[] = []
      const exitCode = await StudioManualChecks.run({ artifactRoot }, {
        isInteractive: () => true,
        runStudio: async options => {
          launches.push(options)
          return 0
        },
        writeLine: line => output.push(line),
      })

      Expect(exitCode).toBe(0)
      Expect(launches).toHaveLength(1)
      Expect(launches[0]).toMatchObject({ browser: true, native: true })
      Expect(launches[0]).not.toHaveProperty('nativeProbe')
      Expect(output.join('\n')).toContain('Tao Studio will open for these manual checks:')
      for (const check of STUDIO_MANUAL_CHECKS) {
        Expect(output.join('\n')).toContain(check)
      }
      Expect(await FS.readJson(FS.resolvePath('manual-checks.json', artifactRoot))).toMatchObject({
        checks: STUDIO_MANUAL_CHECKS,
        status: 'launched',
        version: 2,
      })
    } finally {
      await FS.remove(artifactRoot)
    }
  })

  Test('refuses to enter a human workflow from a non-interactive gate', async () => {
    let launches = 0
    await Expect(StudioManualChecks.run({}, {
      isInteractive: () => false,
      runStudio: async () => {
        launches += 1
        return 0
      },
      writeLine() {},
    })).rejects.toThrow('require an interactive terminal')
    Expect(launches).toBe(0)
  })

  // The only way out of this workflow is Ctrl-C, because the dev server outlives the last window.
  // `StudioDev` turns that signal into exit 130, which this workflow once read as a failed launch —
  // so completing every check by hand still ended `verify-repo` in a failure. The interrupt is the
  // expected ending until the run can detect that ending for itself.
  Test('ends successfully when the person interrupts the launch, recording what it was', async () => {
    const artifactRoot = await mkTestDir('tao-studio-manual-interrupt-')
    try {
      const output: string[] = []
      const exitCode = await StudioManualChecks.run({ artifactRoot }, {
        isInteractive: () => true,
        runStudio: async () => 130,
        writeLine: line => output.push(line),
      })

      Expect(exitCode).toBe(0)
      Expect(output.join('\n')).toContain('press Ctrl-C')
      Expect(await FS.readJson(FS.resolvePath('manual-checks.json', artifactRoot))).toMatchObject({
        launchExitCode: 130,
        status: 'launched',
      })
    } finally {
      await FS.remove(artifactRoot)
    }
  })
})
