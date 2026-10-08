import { FS, HCI, Platform, ProcessTree, Repo } from '@shared'
import { type TrackedProcess } from '@shared/ProcessTree'
import { Expect, Test } from '@shared/test'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'

/** Real Chrome lifecycle acceptance; run explicitly through the owned headless Studio smoke lane. */
Test('repeated browser shutdown joins owned Chrome without the forked-child shutdown assertion', async () => {
  const artifactRoot = FS.resolvePath(
    `.artifacts/tests/studio-smoke/chrome-shutdown-${Platform.randomUUID()}`,
    Repo.getRoot(),
  )
  const reports = FS.resolvePath('Library/Logs/DiagnosticReports', FS.homeDir())
  const reportNames = async () =>
    Platform.hostPlatform === 'darwin' && await FS.isDirectory(reports)
      ? (await FS.listDir(reports)).filter(name => /^(Google Chrome|chrome_crashpad_handler).*\.ips$/u.test(name))
      : []
  const before = new Set(await reportNames())
  const seenJournals = new Set<string>()
  const startedAt = Date.now()
  const processes: TrackedProcess[] = []
  for (let cycle = 0; cycle < 40; cycle++) {
    const browser = await StudioCdp.launchChrome({ artifactRoot })
    try {
      await browser.goto('data:text/html,<div id="ready">owned shutdown probe</div>')
      await browser.waitFor('document.querySelector("#ready")?.textContent === "owned shutdown probe"')
    } finally {
      await browser.close()
    }
    const journals = await FS.listDir(FS.resolvePath('chrome-shutdown', artifactRoot))
    Expect(journals).toHaveLength(cycle + 1)
    const records = await Promise.all(
      journals.filter(name => !seenJournals.has(name)).map(name =>
        FS.readJson<{
          events: { phase: string }[]
          process: TrackedProcess
          profile: string
          output: string
        }>(FS.resolvePath(`chrome-shutdown/${name}`, artifactRoot))
      ),
    )
    Expect(records).toHaveLength(1)
    journals.forEach(name => seenJournals.add(name))
    for (const record of records) {
      Expect(record.events.map(event => event.phase)).toContain('browser-close-requested')
      Expect(record.events.map(event => event.phase)).toContain('joined')
      Expect(record.output).not.toContain('Check failed: g_pipe_pid == getpid()')
      Expect(await FS.isDirectory(record.profile)).toBe(false)
      const current = ProcessTree.identities([record.process.pid]).get(record.process.pid)
      Expect(ProcessTree.sameProcess(current, record.process)).toBe(false)
    }
    processes.push(...records.map(record => record.process))
    if ((cycle + 1) % 10 === 0) {
      HCI.writeLine(`Chrome graceful shutdown: ${cycle + 1}/40 owned cycles complete.`)
    }
  }
  // Only attribute a new report to this run when its process PID belongs to a captured launch.
  // A matching stderr assertion fails independently, even if macOS has not written its report yet.
  const newReports = (await reportNames()).filter(name => !before.has(name))
  const ownedReports: string[] = []
  for (const name of newReports) {
    const text = await FS.readText(FS.resolvePath(name, reports))
    const parent = /"parentPid"\s*:\s*(\d+)/u.exec(text)?.[1]
    const pid = /"pid"\s*:\s*(\d+)/u.exec(text)?.[1]
    const capture = /"captureTime"\s*:\s*"([^"]+)"/u.exec(text)?.[1]
    const capturedAt = capture === undefined ? NaN : Date.parse(capture)
    if (
      capturedAt >= startedAt && capturedAt <= Date.now()
      && processes.some(process => process.pid === Number(parent) || process.pid === Number(pid))
    ) {
      ownedReports.push(name)
    }
  }
  await FS.writeJson(FS.resolvePath('acceptance.json', artifactRoot), {
    cycles: 40,
    processes,
    newReports,
    ownedReports,
  })
  HCI.writeLine(`Chrome shutdown evidence: ${artifactRoot}`)
  Expect(ownedReports).toEqual([])
})
