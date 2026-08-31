import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  canaryExitCode,
  evaluateCanary,
  formatCanaryReport,
  MANUAL_CHECKS,
  REQUIRED_CAPABILITIES,
} from '../dev-src/studio/StudioCanary'
import {
  type ArtifactInventory,
  type ExternalGateResults,
  formatReleaseValidation,
  type PayloadInventory,
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

  Test('never reports an unrunnable external gate as passed', () => {
    const validation = releaseValidation(payload, artifacts, {})

    Expect(validation.status).toBe('unverified')
    Expect(check(validation, 'notarization')?.status).toBe('unverified')
    Expect(check(validation, 'notarization')?.remediation).toContain('xcrun stapler validate')
    Expect(formatReleaseValidation(validation)).toContain('UNVERIFIED gates were not checked here')
    // Unverified is not a failure either: it must not block a build on a machine without Xcode.
    Expect(releaseExitCode(validation)).toBe(0)
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
    Expect(releaseExitCode(firstRelease)).toBe(0)
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
    manualChecks: [],
    passed: true,
  }

  Test('passes when every capability reported and nothing survived shutdown', () => {
    const report = evaluateCanary({ probe: passingProbe, survivingPids: [] })

    Expect(report.status).toBe('passed')
    Expect(report.missingCapabilities).toEqual([])
    Expect(report.manualChecks).toEqual([...MANUAL_CHECKS])
    Expect(canaryExitCode(report)).toBe(0)
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
        manualChecks: [],
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

  Test('names the checks no in-process probe can drive', () => {
    Expect(MANUAL_CHECKS.some(check => check.includes('directory picker'))).toBe(true)
    Expect(MANUAL_CHECKS.some(check => check.includes('Command-W'))).toBe(true)
    Expect(MANUAL_CHECKS.some(check => check.includes('quits'))).toBe(true)
  })
})
