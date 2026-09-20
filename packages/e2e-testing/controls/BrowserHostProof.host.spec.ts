import { expect, test } from '@playwright/test'
import { Errors, FS, Json } from '@shared'
import type { HostBuild } from '../app-build/HostBuild'
import { runBrowserHostProof } from '../BrowserHostProof'
import type { BrowserHostTestingRequest, HostTestingContext } from '../HostTestingRequest'

test('writes an inconclusive fault verdict for prepare and export after valid provenance', async ({}, testInfo) => {
  const prepared = await runFaultMode('prepare', testInfo.outputPath('prepare'))
  const exported = await runFaultMode('export', testInfo.outputPath('export'))

  expect(prepared.verdict).toMatchObject({
    fault: 'clockwork-countdown-frozen',
    provenance: provenance(),
    reason: 'The isolated application prepared, but no browser fault detection ran.',
    status: 'inconclusive',
  })
  expect(prepared.exportCalls).toBe(0)
  expect(exported.verdict).toMatchObject({
    fault: 'clockwork-countdown-frozen',
    provenance: provenance(),
    reason: 'The isolated application exported a browser bundle, but no browser fault detection ran.',
    status: 'inconclusive',
  })
  expect(exported.exportCalls).toBe(1)
})

test('writes an inconclusive fault verdict when preparation or export fails', async ({}, testInfo) => {
  const preparation = await runFaultMode('prepare', testInfo.outputPath('preparation-failure'), {
    prepareHostApp: async () => Errors.throwUnexpected('preparation failed'),
  })
  const exporting = await runFaultMode('export', testInfo.outputPath('export-failure'), {
    exportHostWeb: async () => ({
      receipt: { exitCode: 1, signal: null, stderr: 'export failed', stdout: '' },
      root: 'unused',
    }),
  })
  const exportCrash = await runFaultMode('export', testInfo.outputPath('export-crash'), {
    exportHostWeb: async () => Errors.throwUnexpected('export crashed'),
  })

  expect(preparation.error).toBeDefined()
  expect(preparation.verdict).toEqual({
    fault: 'clockwork-countdown-frozen',
    reason: 'The isolated application did not prepare.',
    status: 'inconclusive',
  })
  expect(exporting.error).toBeDefined()
  expect(exporting.verdict).toMatchObject({
    fault: 'clockwork-countdown-frozen',
    provenance: provenance(),
    reason: 'The isolated application did not export a browser bundle.',
    status: 'inconclusive',
  })
  expect(exportCrash.error).toBeDefined()
  expect(exportCrash.verdict).toMatchObject({
    fault: 'clockwork-countdown-frozen',
    provenance: provenance(),
    reason: 'The isolated application did not export a browser bundle.',
    status: 'inconclusive',
  })
})

test('rejects invalid provenance before prepare or export can claim a fault verdict', async ({}, testInfo) => {
  const result = await runFaultMode('export', testInfo.outputPath('invalid-provenance'), {
    prepareHostApp: async options => ({
      ...build(options),
      fault: { ...provenance(), kind: 'hnreader-reading-history-no-write' },
    }),
  })

  expect(result.error).toBeDefined()
  expect(result.exportCalls).toBe(0)
  expect(result.verdict).toEqual({
    fault: 'clockwork-countdown-frozen',
    provenance: { ...provenance(), kind: 'hnreader-reading-history-no-write' },
    reason: 'The isolated build recorded a different fault kind.',
    status: 'inconclusive',
  })
})

async function runFaultMode(
  mode: 'export' | 'prepare',
  artifactRoot: string,
  overrides: Partial<NonNullable<Parameters<typeof runBrowserHostProof>[2]>> = {},
): Promise<Readonly<{ error: unknown; exportCalls: number; verdict: unknown }>> {
  await FS.mkdir(artifactRoot)
  let exportCalls = 0
  const dependencies: NonNullable<Parameters<typeof runBrowserHostProof>[2]> = {
    exportHostWeb: async () => {
      exportCalls += 1
      return { receipt: { exitCode: 0, signal: null, stderr: '', stdout: '' }, root: 'web-root' }
    },
    prepareHostApp: async options => build(options),
    recordedCommand: async () => {},
    ...overrides,
  }
  const request: BrowserHostTestingRequest = {
    browserChannel: 'chrome',
    fault: 'clockwork-countdown-frozen',
    kind: 'browser',
    mode,
    seed: 12345,
    subject: 'clockwork',
  }
  const context: HostTestingContext = {
    artifactRoot,
    environment: {},
    playwright: 'unused',
    runId: 'fault-proof',
  }
  let error: unknown
  try {
    await runBrowserHostProof(request, context, dependencies)
  } catch (caught) {
    error = caught
  }
  return {
    error,
    exportCalls,
    verdict: Json.tryParse(await FS.readText(FS.resolvePath('application-fault.json', artifactRoot))),
  }
}

function build(options: Readonly<{ artifactRoot: string }>): HostBuild {
  return {
    appId: 'dev.tao.faultproof',
    compiledArtifactDigest: '2'.repeat(64),
    entrySourceDigest: '3'.repeat(64),
    fault: provenance(),
    root: FS.resolvePath('host', options.artifactRoot),
  }
}

function provenance(): NonNullable<HostBuild['fault']> {
  return {
    expectedVisibleAssertion: 'Countdown: 0:09',
    kind: 'clockwork-countdown-frozen',
    originalDigest: '0'.repeat(64),
    replacementDigest: '1'.repeat(64),
    targetPath: '_gen_tao-app/App.tsx',
  }
}
