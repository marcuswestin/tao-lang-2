import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { describeChromeStall } from '../studio-tooling-src/ChromeStartupStall'

/** A proc_pid_stat(5) line with the fields the report reads: state, ppid, utime, stime and threads. */
function stat(pid: number, comm: string, state: string, ppid: number, cpuTicks: number, threads: number): string {
  const fields = [state, ppid, pid, pid, 0, -1, 0, 0, 0, 0, 0, cpuTicks, 0, 0, 0, 20, 0, threads, 0, 1]
  return `${pid} (${comm}) ${fields.join(' ')}\n`
}

async function writeProc(procRoot: string, path: string, text: string): Promise<void> {
  await FS.writeText(FS.resolvePath(path, procRoot), text)
}

Describe('Chrome startup stall snapshot', () => {
  Test('names pressure, the busiest process and the Chrome tree states from procfs', async () => {
    const procRoot = await mkTestDir('tao-chrome-stall-proc-')
    const profile = await mkTestDir('tao-chrome-stall-profile-')
    await writeProc(procRoot, 'loadavg', '9.20 6.10 3.00 5/400 4000\n')
    await writeProc(procRoot, 'pressure/cpu', 'some avg10=82.00 avg60=40.00 avg300=10.00 total=1\n')
    await writeProc(procRoot, 'pressure/io', 'some avg10=1.00 avg60=1.00 avg300=1.00 total=2\nfull avg10=0.00\n')
    await writeProc(procRoot, '100/stat', stat(100, 'chrome', 'S', 1, 5, 3))
    await writeProc(procRoot, '100/wchan', 'do_epoll_wait\n')
    await writeProc(procRoot, '100/task/100/stat', stat(100, 'chrome', 'S', 1, 5, 3))
    await writeProc(procRoot, '100/task/100/wchan', 'do_epoll_wait\n')
    await writeProc(procRoot, '100/task/101/stat', stat(101, 'ThreadPool', 'D', 1, 1, 3))
    await writeProc(procRoot, '100/task/101/wchan', 'io_schedule\n')
    await writeProc(procRoot, '101/stat', stat(101, 'chrome (zygote)', 'R', 100, 2, 1))
    await writeProc(procRoot, '101/wchan', '0\n')
    await writeProc(procRoot, '200/stat', stat(200, 'bun', 'R', 1, 9_000, 8))
    await writeProc(procRoot, '200/wchan', '0\n')
    await writeProc(procRoot, 'self/ignored', 'not a pid directory')
    await FS.writeText(FS.resolvePath('Local State', profile), '{}')

    const report = describeChromeStall(100, profile, procRoot)

    Expect(report).toContain('load: 9.20 6.10 3.00 5/400 4000')
    Expect(report).toContain('pressure cpu: some avg10=82.00')
    Expect(report).toContain('pressure io: some avg10=1.00 avg60=1.00 avg300=1.00 total=2 | full avg10=0.00')
    Expect(report).toContain('pressure memory: unavailable (ENOENT)')
    Expect(report).toContain('machine: 3 processes, 2 runnable, 0 in uninterruptible wait')
    Expect(report).toContain('busiest: 200 bun R 9000 ticks;')
    Expect(report).toContain('100<1 chrome S threads=3 wchan=do_epoll_wait')
    Expect(report).toContain('101<100 chrome (zygote) R threads=1 wchan=0')
    Expect(report).not.toContain('200<')
    Expect(report).toContain('chrome main threads of 100: S:do_epoll_wait x1, D:io_schedule x1')
    Expect(report).toContain('profile entries: Local State')
  })

  Test('reports an absent Chrome and an unreadable procfs without throwing', async () => {
    const procRoot = await mkTestDir('tao-chrome-stall-empty-')
    const missingProfile = FS.resolvePath('missing-profile', procRoot)

    const report = describeChromeStall(4_242, missingProfile, FS.resolvePath('absent', procRoot))

    Expect(report).toContain('load: unavailable (ENOENT)')
    Expect(report).toContain('machine: unavailable (ENOENT)')
    Expect(report).toContain('chrome tree of 4242: no process found')
    Expect(report).toContain('profile entries: unavailable (ENOENT)')
  })
})
