import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  canaryExitCode,
  evaluateCanary,
  formatCanaryReport,
  REQUIRED_CAPABILITIES,
  resolveCanaryTarget,
} from '../dev-src/studio/StudioCanary'
import { StudioCanaryCommand } from '../dev-src/studio/StudioCanaryCommand'
import { STUDIO_MANUAL_CHECKS, StudioManualChecks } from '../dev-src/studio/StudioManualChecks'
import {
  type ArtifactInventory,
  type ExternalGateResults,
  formatReleaseValidation,
  type PayloadInventory,
  readArtifactInventory,
  readPayloadInventory,
  releaseExitCode,
  releaseValidation,
} from '../dev-src/studio/StudioReleaseValidation'

const payload: PayloadInventory = {
  files: ['node', 'service.js', 'studio.js', 'lib/libnode.dylib'],
  nonPortableReferences: [],
}

const artifacts: ArtifactInventory = {
  names: ['stable-1.0.0-update.json', 'Tao Studio.dmg', 'stable-1.0.0.tar.zst', 'stable-1.0.0.patch'],
  releaseBaseUrl: 'https://releases.example.com/tao-studio',
  root: '/build/artifacts',
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
      await FS.writeText(FS.resolvePath('stable-1.0.0-update.json', root), '{}')
      await FS.writeText(FS.resolvePath('stable-1.0.0.tar.zst', root), 'archive')
      const inventory = await readArtifactInventory(root, 'https://releases.example.com/tao-studio')

      Expect(inventory.names).toEqual(['stable-1.0.0-update.json', 'stable-1.0.0.tar.zst'])
      Expect(inventory.root).toBe(root)
      // A name nobody produced cannot be claimed, because nothing accepts a claimed name.
      Expect(inventory.names).not.toContain('fictional-9.9.9-update.json')
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

  Test('inventories the packaged runtime and its native libraries', () => {
    Expect(check(releaseValidation(payload, artifacts, gates), 'packaged runtime')?.detail)
      .toBe('node plus 1 native library')
  })

  Test('fails an update manifest that is not published over HTTPS', () => {
    const insecure = releaseValidation(payload, { ...artifacts, releaseBaseUrl: 'http://releases.example.com' }, gates)

    Expect(check(insecure, 'update manifest')?.status).toBe('failed')
    Expect(check(insecure, 'update manifest')?.detail).not.toContain('http://releases.example.com')
  })

  Test('treats a missing differential patch as unverified, not a failure', () => {
    const firstRelease = releaseValidation(payload, {
      ...artifacts,
      names: artifacts.names.filter(name => !name.endsWith('.patch')),
    }, gates)

    Expect(check(firstRelease, 'differential update')?.status).toBe('unverified')
    Expect(check(firstRelease, 'differential update')?.remediation).toContain('first release')
    Expect(releaseExitCode(firstRelease, { allowUnverified: true })).toBe(0)
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

  Test('removes a prior native probe result before starting a new canary', async () => {
    const artifactRoot = await mkTestDir('tao-studio-canary-probe-')
    const stalePath = FS.resolvePath('electrobun/artifacts/runtime-result.json', artifactRoot)
    await FS.writeJson(stalePath, { capabilities: { websocket: { passed: true } }, passed: true })

    Expect(await StudioCanaryCommand.testing.freshProbeResultPath(artifactRoot)).toBe(stalePath)
    Expect(await FS.exists(stalePath)).toBe(false)
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
    Expect(resolveCanaryTarget({ projectRoot: defaultRoot }, repositoryRoot)).toEqual({
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
})

Describe('Studio native manual checks', () => {
  Test('launches a visible non-probe workflow and records every human result separately', async () => {
    const artifactRoot = await mkTestDir('tao-studio-manual-checks-')
    const launches: unknown[] = []
    const prompts: string[] = []
    const output: string[] = []
    const exitCode = await StudioManualChecks.run({ artifactRoot }, {
      askConfirm: async options => {
        prompts.push(options.message)
        return true
      },
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
    Expect(prompts).toEqual(STUDIO_MANUAL_CHECKS.map(check => `Passed: ${check}`))
    Expect(output.join('\n')).toContain('Tao Studio will open for these manual checks:')
    Expect(await FS.readJson(FS.resolvePath('manual-checks.json', artifactRoot))).toMatchObject({
      status: 'passed',
      version: 1,
    })
  })

  Test('refuses to enter a human workflow from a non-interactive gate', async () => {
    let launches = 0
    await Expect(StudioManualChecks.run({}, {
      askConfirm: async () => true,
      isInteractive: () => false,
      runStudio: async () => {
        launches += 1
        return 0
      },
      writeLine() {},
    })).rejects.toThrow('require an interactive terminal')
    Expect(launches).toBe(0)
  })

  Test('fails its separate report when a person rejects a manual result', async () => {
    const artifactRoot = await mkTestDir('tao-studio-manual-failure-')
    const exitCode = await StudioManualChecks.run({ artifactRoot }, {
      askConfirm: async options => !options.message.includes('Command-W'),
      isInteractive: () => true,
      runStudio: async () => 0,
      writeLine() {},
    })

    Expect(exitCode).toBe(1)
    Expect(await FS.readJson(FS.resolvePath('manual-checks.json', artifactRoot))).toMatchObject({
      checks: [{ status: 'passed' }, { status: 'failed' }, { status: 'passed' }],
      status: 'failed',
    })
  })
})
