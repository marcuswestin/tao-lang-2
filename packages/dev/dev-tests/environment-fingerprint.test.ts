import { CLI, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import {
  type EnvironmentFingerprint,
  environmentFingerprint,
  environmentFingerprintOf,
  type FingerprintFacts,
  formatFingerprint,
  safeToken,
  toolVersion,
} from '../dev-src/doctor/EnvironmentFingerprint'
import { RepositoryDoctorCommand } from '../dev-src/doctor/RepositoryDoctorCommand'

/**
 * The shape every value in a fingerprint must already have: a version, a hash, or a bare word.
 * Pinned here as a literal rather than imported, so the test states the contract independently of
 * the implementation that has to meet it.
 */
const PASTEABLE_VALUE = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/

/** Where the personal data would be if a probe's output ever reached the fingerprint unfiltered. */
const HOSTILE_PROBE_OUTPUT = '/Users/someone/code/tao (someone@example.test) on someones-laptop.local'

function facts(overrides: Partial<FingerprintFacts> = {}): FingerprintFacts {
  return {
    architecture: 'arm64',
    devenvProfilePath: '/nix/store/a8pzgf27p2j0pnj12ihr8n0p4mlggm7k-devenv-profile',
    gitCommit: '3e1ae411dff6f0d38d12772ae5bb48e6e27f9494',
    gitDescribe: '3e1ae411',
    gitModified: false,
    kernelName: 'Darwin',
    kernelVersion: '27.0.0',
    lockDigests: [{ digest: '0d1e5c012a150aae689c8331ba6a3f838b95e9b3', name: 'bun.lock' }],
    osBuild: '26A428',
    osName: 'macOS',
    osVersion: '27.0',
    toolVersions: [{ name: 'bun', versionLine: '1.3.13' }],
    xcodeVersionOutput: 'Xcode 27.0\nBuild version 27A266a',
    ...overrides,
  }
}

function component(fingerprint: EnvironmentFingerprint, name: string) {
  return fingerprint.toolchain.find(candidate => candidate.name === name)
}

/** Every string anywhere in the fingerprint, which is the surface a paste actually exposes. */
function pastedStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(pastedStrings)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(pastedStrings)
  }
  return []
}

/** Splits a pasteable value into the words a machine or account name would appear as. */
function words(value: string): string[] {
  return value.split(/[._+-]/).filter(word => word.length > 0)
}

Describe('environment fingerprint', () => {
  Test('reports the host, the commit, and the toolchain a reproduction needs', () => {
    const fingerprint = environmentFingerprint(facts())

    Expect(fingerprint.os).toEqual({ build: '26A428', name: 'macOS', version: '27.0' })
    Expect(fingerprint.kernel).toEqual({ name: 'Darwin', version: '27.0.0' })
    Expect(fingerprint.architecture).toBe('arm64')
    Expect(fingerprint.tao).toEqual({ commit: '3e1ae411dff6', describe: '3e1ae411', modified: false })
    Expect(fingerprint.xcode).toEqual({ build: '27A266a', version: '27.0' })
    Expect(component(fingerprint, 'bun')).toEqual({ name: 'bun', present: true, version: '1.3.13' })
    Expect(component(fingerprint, 'bun.lock')?.hash).toBe('0d1e5c012a150aae689c8331ba6a3f838b95e9b3')
    Expect(component(fingerprint, 'devenv-profile')?.hash).toBe('a8pzgf27p2j0pnj12ihr8n0p4mlggm7k')
  })

  Test('keeps an absent tool as a row, because its absence is the answer to a whole class of reports', () => {
    const fingerprint = environmentFingerprint(facts({
      toolVersions: [{ name: 'bun', versionLine: '1.3.13' }, { name: 'watchman' }],
    }))

    Expect(component(fingerprint, 'watchman')).toEqual({ name: 'watchman', present: false, version: undefined })
  })

  Test('omits Xcode entirely on a machine that has none', () => {
    Expect(environmentFingerprint(facts({ xcodeVersionOutput: undefined })).xcode).toBe(undefined)
  })

  Test('accepts a version, a hash, or a bare word, and nothing that could hide anything else', () => {
    for (const accepted of ['macOS', 'Darwin', 'arm64', '27.0', '26A428', '2026.01.19.00', 'v0.1.0-3-gabc1234']) {
      Expect(safeToken(accepted)).toBe(accepted)
    }
    // Every shape a person, a machine, or a location could arrive in is refused outright rather
    // than edited down, because an edit has to anticipate the thing it is removing.
    for (
      const refused of [
        '/Users/someone',
        '~/code/tao',
        'someone@example.test',
        'someones-laptop.local:8081',
        'C:\\Users\\someone',
        'macOS 27.0',
        'feat/someones-branch',
        '-rf',
        '',
        undefined,
      ]
    ) {
      Expect(safeToken(refused)).toBe(undefined)
    }
    Expect(safeToken('  arm64  ')).toBe('arm64')
  })

  Test('reads the version out of whatever decoration a tool prints around it', () => {
    Expect(toolVersion('git version 2.53.0')).toBe('2.53.0')
    Expect(toolVersion('dprint 0.54.0')).toBe('0.54.0')
    Expect(toolVersion('v24.14.1')).toBe('24.14.1')
    Expect(toolVersion('2026.01.19.00')).toBe('2026.01.19.00')
    // A version printed next to the path it was installed at keeps the version and loses the path.
    Expect(toolVersion('bun 1.3.13 (/Users/someone/.bun/bin/bun)')).toBe('1.3.13')
    Expect(toolVersion(undefined)).toBe(undefined)
  })

  Test('drops every value a probe printed that is not already safe to paste', () => {
    const fingerprint = environmentFingerprint({
      architecture: HOSTILE_PROBE_OUTPUT,
      devenvProfilePath: '/Users/someone/code/tao/.devenv/profile',
      gitCommit: HOSTILE_PROBE_OUTPUT,
      gitDescribe: HOSTILE_PROBE_OUTPUT,
      gitModified: true,
      kernelName: HOSTILE_PROBE_OUTPUT,
      kernelVersion: HOSTILE_PROBE_OUTPUT,
      lockDigests: [{ digest: HOSTILE_PROBE_OUTPUT, name: 'bun.lock' }],
      osBuild: HOSTILE_PROBE_OUTPUT,
      osName: HOSTILE_PROBE_OUTPUT,
      osVersion: HOSTILE_PROBE_OUTPUT,
      toolVersions: [{ name: 'bun', versionLine: `1.3.13 from ${HOSTILE_PROBE_OUTPUT}` }],
      xcodeVersionOutput: HOSTILE_PROBE_OUTPUT,
    })

    Expect(JSON.stringify(fingerprint)).not.toContain('someone')
    Expect(JSON.stringify(fingerprint)).not.toContain('Users')
    Expect(pastedStrings(fingerprint).filter(value => !PASTEABLE_VALUE.test(value))).toEqual([])
    // A symlink that has not been resolved into the Nix store is a path under somebody's home, so
    // the profile is reported as present with no hash rather than with the path it resolved to.
    Expect(component(fingerprint, 'devenv-profile')).toEqual({
      hash: undefined,
      name: 'devenv-profile',
      present: true,
    })
    // Dropping the unsafe half must not drop the version that shared the line with it.
    Expect(component(fingerprint, 'bun')?.version).toBe('1.3.13')
    Expect(fingerprint.tao).toEqual({ commit: undefined, describe: undefined, modified: true })
  })

  Test('carries nothing off this machine that names the person or the machine', async () => {
    const fingerprint = await environmentFingerprintOf()
    const values = pastedStrings(fingerprint)
    const hostname = (await CLI.run('hostname')).stdout.trim()
    // The fingerprint's own component names are fixed literals, so an account that happens to be
    // called `git` collides with one without anything having leaked.
    const ownNames = new Set(fingerprint.toolchain.flatMap(candidate => words(candidate.name)))
    const identities = [
      Platform.runtimeProcess.env['USER'],
      Platform.runtimeProcess.env['LOGNAME'],
      ...hostname.split('.'),
    ].filter((identity): identity is string => identity !== undefined && identity.length > 0 && !ownNames.has(identity))
    const locations = [Platform.runtimeProcess.env['HOME'], Repo.getRoot()]
      .filter((location): location is string => location !== undefined && location.length > 0)

    // Guard against proving this of an empty fingerprint: a real host answers with a real toolchain.
    Expect(component(fingerprint, 'bun')?.version).toBeDefined()
    Expect(fingerprint.tao.commit).toBeDefined()
    Expect(values.length).toBeGreaterThan(10)

    Expect(values.filter(value => !PASTEABLE_VALUE.test(value))).toEqual([])
    Expect(values.filter(value => locations.some(location => value.includes(location)))).toEqual([])
    Expect(values.filter(value => words(value).some(word => identities.includes(word)))).toEqual([])
  })

  Test('prints the fingerprint alone, and succeeds, when it is asked for as an attachment', async () => {
    const printed = await withCapturedOutput(async () => await RepositoryDoctorCommand.run({ fingerprint: true }))

    // Somebody running this is collecting an attachment for a report, not asking for a verdict.
    Expect(printed.result).toBe(0)
    const fingerprint = JSON.parse(printed.stdout) as EnvironmentFingerprint
    Expect(fingerprint.version).toBe(1)
    Expect(fingerprint.architecture).toBeDefined()
    // The rest of the doctor's report names this checkout, so none of it may ride along.
    Expect(printed.stdout).not.toContain('repositoryRoot')
    Expect(printed.stdout).not.toContain('checks')
  })

  Test('renders the same facts as the two lines the terminal shows', () => {
    const lines = formatFingerprint(environmentFingerprint(facts({ gitModified: true })))

    Expect(lines[0]).toBe('macOS 27.0 (26A428) · Darwin 27.0.0 · arm64')
    Expect(lines[1]).toBe('Tao 3e1ae411dff6 (modified) · bun 1.3.13 · Xcode 27.0')
  })
})
