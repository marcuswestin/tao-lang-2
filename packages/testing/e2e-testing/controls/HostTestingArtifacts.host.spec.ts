import { expect, test } from '@playwright/test'
import { FS } from '@shared'
import { HostTestingArtifacts } from '../HostTestingArtifacts'

const runIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

test('normal successful runs remove builds and retain bounded proof outputs', async () => {
  const root = await FS.mkTmpDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  const dependencies = { isAlive: () => false, now: () => new Date(now), pid: 123 }
  try {
    for (const runId of runIds) {
      await HostTestingArtifacts.begin(runId, 'browser', root, dependencies)
      await FS.writeText(FS.resolvePath(`${runId}/proof.log`, root), 'passed')
      await FS.writeText(FS.resolvePath(`${runId}/host-demo/build.bin`, root), 'large build')
      await FS.writeText(FS.resolvePath(`${runId}/web-demo/export.bin`, root), 'large export')
      await HostTestingArtifacts.finish(runId, 'passed', root, dependencies)
      await HostTestingArtifacts.prune(root, dependencies)
      now += 1_000
    }
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(false)
    expect(await FS.isDirectory(FS.resolvePath(runIds[1]!, root))).toBe(false)
    expect(await FS.isDirectory(FS.resolvePath(runIds[2]!, root))).toBe(true)
    expect(await FS.isFile(FS.resolvePath(`${runIds[2]}/proof.log`, root))).toBe(true)
    expect(await FS.isDirectory(FS.resolvePath(`${runIds[2]}/host-demo`, root))).toBe(false)
    expect(await FS.isDirectory(FS.resolvePath(`${runIds[2]}/web-demo`, root))).toBe(false)
    expect(await FS.isFile(FS.resolvePath(`receipts/${runIds[0]}.json`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('retains an explicitly prepared artifact through ordinary successful maintenance', async () => {
  const root = await FS.mkTmpDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  const dependencies = { isAlive: () => false, now: () => new Date(now), pid: 123 }
  try {
    await HostTestingArtifacts.begin(runIds[0]!, 'prepare', root, dependencies)
    await FS.writeText(FS.resolvePath(`${runIds[0]}/host-demo/build.bin`, root), 'requested output')
    await HostTestingArtifacts.finish(runIds[0]!, 'passed', root, dependencies)
    now += 1_000
    for (const runId of runIds.slice(1)) {
      await HostTestingArtifacts.begin(runId, 'check', root, dependencies)
      await HostTestingArtifacts.finish(runId, 'passed', root, dependencies)
      await HostTestingArtifacts.prune(root, dependencies)
      now += 1_000
    }
    expect(await FS.isFile(FS.resolvePath(`${runIds[0]}/host-demo/build.bin`, root))).toBe(true)
    expect(await FS.isDirectory(FS.resolvePath(runIds[1]!, root))).toBe(false)
    expect(await FS.isDirectory(FS.resolvePath(runIds[2]!, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('keeps only the two most recent failed runs for diagnosis', async () => {
  const root = await FS.mkTmpDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  const dependencies = { isAlive: () => false, now: () => new Date(now), pid: 123 }
  try {
    for (const runId of runIds) {
      await HostTestingArtifacts.begin(runId, 'native', root, dependencies)
      await FS.writeText(FS.resolvePath(`${runId}/failure.log`, root), 'failure evidence')
      await HostTestingArtifacts.finish(runId, 'failed', root, dependencies)
      await HostTestingArtifacts.prune(root, dependencies)
      now += 1_000
    }
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(false)
    expect(await FS.isFile(FS.resolvePath(`${runIds[1]}/failure.log`, root))).toBe(true)
    expect(await FS.isFile(FS.resolvePath(`${runIds[2]}/failure.log`, root))).toBe(true)
    expect(await FS.isFile(FS.resolvePath(`receipts/${runIds[0]}.json`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('keeps live work and reclaims an interrupted run only after owner death and grace', async () => {
  const root = await FS.mkTmpDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  let alive = true
  const dependencies = { isAlive: () => alive, now: () => new Date(now), pid: 123 }
  try {
    await HostTestingArtifacts.begin(runIds[0]!, 'ios', root, dependencies)
    await FS.writeText(FS.resolvePath(`${runIds[0]}/proof.log`, root), 'in progress')
    now += 8 * 24 * 60 * 60 * 1_000
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(true)

    alive = false
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(false)
    expect(await FS.isFile(FS.resolvePath(`receipts/${runIds[0]}.json`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('preserves legacy directories without ownership evidence', async () => {
  const root = await FS.mkTmpDir('tao-host-artifacts-')
  const dependencies = { isAlive: () => false, now: () => new Date('2026-09-23'), pid: 123 }
  try {
    await FS.mkdir(FS.resolvePath(runIds[0]!, root))
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})
