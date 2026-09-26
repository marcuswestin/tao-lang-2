import { expect, test } from '@playwright/test'
import { FS, Repo } from '@shared'
import { HostTestingArtifacts } from '../HostTestingArtifacts'

const runIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

test('normal successful runs remove builds and retain bounded proof outputs', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
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
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
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
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
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
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
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
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  const dependencies = { isAlive: () => false, now: () => new Date('2026-09-23'), pid: 123 }
  try {
    await FS.mkdir(FS.resolvePath(runIds[0]!, root))
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(runIds[0]!, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('reclaims an interrupted allocation using its independent receipt', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  const dependencies = { isAlive: () => false, now: () => new Date(now), pid: 123 }
  try {
    const runId = runIds[0]!
    await HostTestingArtifacts.begin(runId, 'browser', root, dependencies)
    await FS.writeText(FS.resolvePath(`${runId}/host-demo/build.bin`, root), 'interrupted build')
    await FS.remove(FS.resolvePath(`${runId}/run.json`, root))
    now += 8 * 24 * 60 * 60 * 1_000
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(runId, root))).toBe(false)
    expect(await FS.isFile(FS.resolvePath(`receipts/${runId}.json`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('uses the newer sidecar when completion was interrupted before the local receipt update', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  const dependencies = { isAlive: () => true, now: () => new Date(now), pid: 123 }
  try {
    const first = runIds[0]!
    await HostTestingArtifacts.begin(first, 'check', root, dependencies)
    const runningReceipt = await FS.readJson(FS.resolvePath(`${first}/run.json`, root))
    await HostTestingArtifacts.finish(first, 'passed', root, dependencies)
    await FS.writeJson(FS.resolvePath(`${first}/run.json`, root), runningReceipt)
    now += 1_000
    await HostTestingArtifacts.begin(runIds[1]!, 'check', root, dependencies)
    await HostTestingArtifacts.finish(runIds[1]!, 'passed', root, dependencies)
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isDirectory(FS.resolvePath(first, root))).toBe(false)
  } finally {
    await FS.remove(root)
  }
})

test('compacts an oversized failed build before retaining its proof, screenshot, browser trace and logs', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  const dependencies = { isAlive: () => false, now: () => new Date('2026-09-23T12:00:00.000Z'), pid: 123 }
  const runId = runIds[0]!
  const runRoot = FS.resolvePath(runId, root)
  try {
    await HostTestingArtifacts.begin(runId, 'ios', root, dependencies)
    const evidence = [
      'appium/screenshots/journey-failed.png',
      'appium-ios/proof.receipt.json',
      'appium/server.log',
      'appium/session.receipt.json',
      'results/trace.zip',
      'build.json',
      'host-build.log',
    ]
    const generated = [
      'host-native-navigation-run/native-build/ios/build.bin',
      'web-native-navigation/export.bin',
      'appium-home/node_modules/package.bin',
      'appium/xcode/device/build.bin',
    ]
    for (const path of evidence) {
      await FS.writeText(FS.resolvePath(path, runRoot), `evidence: ${path}`)
    }
    for (const path of generated) {
      await FS.writeText(FS.resolvePath(path, runRoot), 'disposable generated bytes')
    }
    await HostTestingArtifacts.finish(runId, 'failed', root, dependencies)
    // Pruning uses the measured size persisted by finish. Reproduce a real native build's
    // oversized cached receipt without allocating gigabytes merely to test retention policy.
    const sidecar = FS.resolvePath(`receipts/${runId}.json`, root)
    const measured = await FS.readJson(sidecar) as Record<string, unknown>
    await FS.writeJson(sidecar, { ...measured, sizeBytes: 40 * 1024 * 1024 * 1024 })
    await HostTestingArtifacts.prune(root, dependencies)
    for (const path of evidence) {
      expect(await FS.readText(FS.resolvePath(path, runRoot))).toBe(`evidence: ${path}`)
    }
    for (const path of generated) {
      expect(await FS.exists(FS.resolvePath(path, runRoot))).toBe(false)
    }
    const retained = await FS.readJson(sidecar) as { sizeBytes: number; status: string }
    expect(retained.status).toBe('failed')
    expect(retained.sizeBytes).toBeGreaterThan(0)
    expect(retained.sizeBytes).toBeLessThan(4 * 1024 * 1024 * 1024)
    expect(await FS.readJson(FS.resolvePath('run.json', runRoot))).toEqual(retained)
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.isFile(FS.resolvePath('appium/screenshots/journey-failed.png', runRoot))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('oversized running, recent interrupted, and unmarked roots never enter build compaction', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  let now = Date.parse('2026-09-23T12:00:00.000Z')
  let alive = true
  const dependencies = { isAlive: () => alive, now: () => new Date(now), pid: 123 }
  try {
    const live = runIds[0]!
    const recent = runIds[1]!
    const unknown = runIds[2]!
    for (const runId of [live, recent]) {
      await HostTestingArtifacts.begin(runId, 'ios', root, dependencies)
      const sidecar = FS.resolvePath(`receipts/${runId}.json`, root)
      await FS.writeJson(sidecar, { ...await FS.readJson(sidecar) as object, sizeBytes: 40 * 1024 * 1024 * 1024 })
    }
    for (const runId of runIds) {
      await FS.writeText(FS.resolvePath(`${runId}/host-native-navigation/build.bin`, root), 'must remain')
    }
    now += 24 * 60 * 60 * 1_000
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.readText(FS.resolvePath(`${live}/host-native-navigation/build.bin`, root))).toBe('must remain')
    // The second root now represents a just-interrupted owner: within grace, even when dead.
    alive = false
    await HostTestingArtifacts.begin(recent, 'ios', root, dependencies)
    const sidecar = FS.resolvePath(`receipts/${recent}.json`, root)
    await FS.writeJson(sidecar, { ...await FS.readJson(sidecar) as object, sizeBytes: 40 * 1024 * 1024 * 1024 })
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.readText(FS.resolvePath(`${recent}/host-native-navigation/build.bin`, root))).toBe('must remain')
    expect(await FS.readText(FS.resolvePath(`${unknown}/host-native-navigation/build.bin`, root))).toBe('must remain')
  } finally {
    await FS.remove(root)
  }
})

test('failure compaction never follows a substituted appium directory into another owner', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifacts-')
  const dependencies = { isAlive: () => false, now: () => new Date('2026-09-23T12:00:00.000Z'), pid: 123 }
  const runId = runIds[0]!
  try {
    await HostTestingArtifacts.begin(runId, 'ios', root, dependencies)
    const other = FS.resolvePath('another-owner', root)
    await FS.writeText(FS.resolvePath('xcode/build.bin', other), 'not owned by this run')
    await FS.symlink(other, FS.resolvePath(`${runId}/appium`, root))
    await HostTestingArtifacts.finish(runId, 'failed', root, dependencies)
    const sidecar = FS.resolvePath(`receipts/${runId}.json`, root)
    await FS.writeJson(sidecar, { ...await FS.readJson(sidecar) as object, sizeBytes: 40 * 1024 * 1024 * 1024 })
    await HostTestingArtifacts.prune(root, dependencies)
    expect(await FS.readText(FS.resolvePath('xcode/build.bin', other))).toBe('not owned by this run')
    expect(await FS.isSymbolicLink(FS.resolvePath(`${runId}/appium`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})

test('the production retention clock writes calendar timestamps comparable across processes', async () => {
  const root = await Repo.mkScratchDir('tao-host-artifact-production-clock-')
  const runId = runIds[0]!
  try {
    const probe = FS.resolvePath('wall-clock-probe', root)
    await FS.writeText(probe, 'filesystem calendar time is independent of the retention clock')
    const before = await FS.modifiedTimeMs(probe)
    await HostTestingArtifacts.begin(runId, 'ios', root)
    await HostTestingArtifacts.finish(runId, 'failed', root)
    const sidecar = FS.resolvePath(`receipts/${runId}.json`, root)
    const receipt = await FS.readJson(sidecar) as { startedAt: string; finishedAt: string }
    const after = await FS.modifiedTimeMs(sidecar)
    for (const timestamp of [receipt.startedAt, receipt.finishedAt]) {
      expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before - 1_000)
      // budget-ok: compares epoch timestamps to independent filesystem calendar time, not execution speed.
      expect(Date.parse(timestamp)).toBeLessThanOrEqual(after + 1_000)
    }
    await HostTestingArtifacts.prune(root)
    expect(await FS.isFile(FS.resolvePath(`${runId}/run.json`, root))).toBe(true)
  } finally {
    await FS.remove(root)
  }
})
