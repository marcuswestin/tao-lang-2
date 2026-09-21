import { FS, Platform, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { listLaunches } from '../studio-tooling-src/StudioLifecycle'
import { startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

/**
 * The launch contract, proven through the command a person actually runs rather than through the
 * seams underneath it: `./dev studio` starts, advertises a session that answers, records what it
 * owns, and gives all of it back. Every other Studio test builds a session in-process and so
 * cannot see the CLI, the readiness payload, or the manifest.
 *
 * Slow by nature — it starts Metro — so it lives in the opt-in smoke lane rather than in `verify`.
 */

/**
 * Ownership is established from the process table and from port listeners, and an agent's Bash
 * sandbox refuses both for a process it did not start. Rather than fail on a host that was never
 * going to answer, the run says why it could not check and stops there.
 */
async function ownershipIsCheckable(): Promise<boolean> {
  const probe = await Bun.spawn(['/bin/kill', '-0', String(Platform.runtimeProcess.pid)], {
    stderr: 'pipe',
    stdout: 'ignore',
  }).exited.then(code => code === 0).catch(() => false)
  return probe
}

Test('./dev studio reports a usable session, records what it owns, and gives it all back', async () => {
  if (!await ownershipIsCheckable()) {
    Platform.runtimeConsole.warn(
      'Skipped: this host will not report on its own processes, so launch ownership cannot be '
        + 'confirmed here. Run this lane from an ordinary shell.',
    )
    return
  }

  const repositoryRoot = Repo.getRoot()
  const launch = await startStudioSmokeLaunch({
    appName: 'HNReader',
    projectRoot: FS.resolvePath('Apps/HNReader', repositoryRoot),
    repositoryRoot,
  })

  try {
    const readiness = launch.readiness
    Expect(readiness.version).toBe(1)
    Expect(readiness.mode).toBe('browser')
    Expect(readiness.appName).toBe('HNReader')
    // The advertised page is the session page, never the server root.
    Expect(readiness.sessionUrl.startsWith(`${readiness.studioUrl}/sessions/`)).toBe(true)
    Expect(readiness.sessionUrl).toContain(readiness.sessionId)

    // Readiness is a claim about the page: it must already answer by the time it is printed.
    Expect((await fetch(readiness.sessionUrl)).ok).toBe(true)
    Expect(await FS.isFile(readiness.manifestPath)).toBe(true)
    Expect(await FS.isFile(readiness.lifecycleLogPath)).toBe(true)

    const listed = await listLaunches({ repositoryRoot })
    const row = listed.launches.find(candidate => candidate.launchId === readiness.launchId)
    Expect(row?.status).toBe('live')
    Expect(row?.state).toBe('ready')
    Expect(row?.ownedPids.length).toBeGreaterThan(0)
    Expect(row?.ports.owned).toContain(
      new URL(readiness.studioUrl).port === '' ? 0 : Number(new URL(readiness.studioUrl).port),
    )
  } finally {
    await launch.stop()
  }

  // Nothing owned survives, and the record is gone because there is nothing left to record.
  const remaining = await listLaunches({ repositoryRoot })
  Expect(remaining.launches.map(row => row.launchId)).not.toContain(launch.readiness.launchId)
  await Expect(fetch(launch.readiness.sessionUrl)).rejects.toThrow()
}, 300_000)
