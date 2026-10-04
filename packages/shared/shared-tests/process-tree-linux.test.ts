import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import * as FS from '../shared-src/FS'
import { ProcessTree } from '../shared-src/ProcessTree'
import { createLinuxProcessInspector } from '../shared-src/ProcessTreeLinux'

// Literal stat fields 3..22 pin the kernel layout independently of the parser's indexes.
const STAT = 'S 11 42 42 0 -1 4194304 10 0 0 0 1 2 0 0 20 0 1 0 98765432101234567 4096 1\n'

Describe('Linux process inspection', () => {
  Test('reads parent, group and exact kernel ticks despite whitespace and parentheses in comm', async () => {
    const root = await mkTestDir('linux-proc')
    await FS.writeText(FS.resolvePath('123/stat', root), `123 (worker (x)\n )) ${STAT}`)
    await FS.writeText(FS.resolvePath('456/stat', root), `456 (other) ${STAT}`)
    await FS.writeText(FS.resolvePath('version', root), 'not a process')
    const inspector = createLinuxProcessInspector(root)

    Expect(inspector.identity(123)).toEqual({
      command: 'worker (x)\n )',
      pid: 123,
      ppid: 11,
      group: 42,
      startedAt: '98765432101234567',
    })
    Expect(inspector.table().map(entry => entry.pid)).toEqual([123, 456])
  })

  Test('one tick of PID reuse prevents a signal while exec preserves the owned identity', async () => {
    const root = await mkTestDir('linux-proc-reuse')
    const path = FS.resolvePath('123/stat', root)
    await FS.writeText(path, `123 (shell) ${STAT}`)
    const inspector = createLinuxProcessInspector(root)
    const original = inspector.identity(123)!
    const signalled: number[][] = []
    const seams = {
      identities: () => {
        const current = inspector.identity(123)
        return new Map(current === undefined ? [] : [[123, current]])
      },
      signal: (pids: readonly number[]) => signalled.push([...pids]),
    }
    await FS.writeText(path, `123 (sleep) ${STAT}`)
    ProcessTree.signalTracked([original], 'SIGTERM', seams)
    Expect(signalled).toEqual([[123]])

    await FS.writeText(path, `123 (foreign) ${STAT.replace('98765432101234567', '98765432101234568')}`)
    ProcessTree.signalTracked([original], 'SIGKILL', seams)
    Expect(signalled).toEqual([[123]])
    Expect(ProcessTree.sameProcess(inspector.identity(123), original)).toBe(false)
  })

  Test('walks only the owned tree deepest first and recognizes surviving group members', async () => {
    const root = await mkTestDir('linux-proc-tree')
    await FS.writeText(FS.resolvePath('42/stat', root), `42 (root) ${STAT}`)
    await FS.writeText(FS.resolvePath('123/stat', root), `123 (child) ${STAT.replace('S 11', 'S 42')}`)
    await FS.writeText(FS.resolvePath('456/stat', root), `456 (grandchild) ${STAT.replace('S 11', 'S 123')}`)
    await FS.writeText(FS.resolvePath('789/stat', root), `789 (foreign) ${STAT.replace('S 11 42', 'S 11 789')}`)
    const inspector = createLinuxProcessInspector(root)

    Expect(inspector.descendants(42).map(entry => entry.pid)).toEqual([456, 123])
    Expect(inspector.groupIsAlive(42)).toBe(true)
    await FS.remove(FS.resolvePath('42', root))
    await FS.writeText(FS.resolvePath('123/stat', root), `123 (child) Z${STAT.slice(1)}`)
    Expect(inspector.groupIsAlive(42)).toBe(true)
    await FS.writeText(FS.resolvePath('456/stat', root), `456 (grandchild) Z${STAT.slice(1)}`)
    Expect(inspector.groupIsAlive(42)).toBe(false)
    Expect(inspector.groupIsAlive(789)).toBe(true)
  })

  Test('zombie and dead processes stop being live identities even while proc entries remain', async () => {
    const root = await mkTestDir('linux-proc-zombie')
    const path = FS.resolvePath('123/stat', root)
    await FS.writeText(path, `123 (worker) ${STAT}`)
    const inspector = createLinuxProcessInspector(root)
    const original = inspector.identity(123)!
    Expect(inspector.table()).toHaveLength(1)
    for (const state of ['Z', 'X', 'x']) {
      await FS.writeText(path, `123 (worker) ${state}${STAT.slice(1)}`)
      Expect(FS.existsSync(path)).toBe(true)
      Expect(inspector.identity(123)).toBeUndefined()
      Expect(inspector.table()).toEqual([])
      Expect(ProcessTree.sameProcess(inspector.identity(123), original)).toBe(false)
    }
  })

  Test('Linux group liveness dispatches to the proc table even when the kernel probe sees a zombie group', async () => {
    const root = await mkTestDir('linux-group-liveness')
    const path = FS.resolvePath('123/stat', root)
    const inspector = createLinuxProcessInspector(root)
    const seams = { platform: 'linux' as const, linuxGroupIsAlive: inspector.groupIsAlive }
    let kernelProbes = 0
    const zombieKernelProbe = () => {
      kernelProbes += 1
      return true
    }
    await FS.writeText(path, `123 (worker) ${STAT}`)
    Expect(ProcessTree.isGroupAlive(42, zombieKernelProbe, seams)).toBe(true)
    await FS.writeText(path, `123 (worker) Z${STAT.slice(1)}`)
    Expect(FS.existsSync(path)).toBe(true)
    Expect(ProcessTree.isGroupAlive(42, zombieKernelProbe, seams)).toBe(false)
    await FS.writeText(path, 'malformed stat')
    Expect(() => ProcessTree.isGroupAlive(42, zombieKernelProbe, seams)).toThrow(/malformed \/proc stat/u)
    Expect(kernelProbes).toBe(0)
    const unreadable = createLinuxProcessInspector('/fixture/proc', {
      listDirSync: () => {
        throw { code: 'EACCES' }
      },
      readTextSync: () => '',
    })
    Expect(() =>
      ProcessTree.isGroupAlive(42, zombieKernelProbe, {
        platform: 'linux',
        linuxGroupIsAlive: unreadable.groupIsAlive,
      })
    ).toThrow(/Could not list Linux processes/u)
    Expect(kernelProbes).toBe(0)
  })

  Test('a zombie leader stays owned and signalable until its remaining worker exits', async () => {
    const root = await mkTestDir('linux-proc-thread-exit')
    const path = FS.resolvePath('123/stat', root)
    await FS.writeText(path, `123 (worker) ${STAT}`)
    const inspector = createLinuxProcessInspector(root)
    const original = inspector.identity(123)!
    // Field20 is 2: the exited group leader and its still-running worker. The leader's
    // state alone cannot prove that the worker released its inherited output pipes.
    await FS.writeText(
      path,
      '123 (worker) Z 11 42 42 0 -1 4194304 10 0 0 0 1 2 0 0 20 0 2 0 98765432101234567 4096 1\n',
    )
    Expect(inspector.identity(123)).toEqual(original)
    Expect(inspector.descendants(11).map(entry => entry.pid)).toEqual([123])
    Expect(inspector.groupIsAlive(42)).toBe(true)
    const signalled: number[][] = []
    const seams = {
      identities: () => {
        const current = inspector.identity(123)
        return new Map(current === undefined ? [] : [[123, current]])
      },
      signal: (pids: readonly number[]) => signalled.push([...pids]),
    }
    ProcessTree.signalTracked([original], 'SIGKILL', seams)
    Expect(signalled).toEqual([[123]])

    await FS.writeText(path, `123 (worker) Z${STAT.slice(1)}`)
    Expect(FS.existsSync(path)).toBe(true)
    Expect(inspector.identity(123)).toBeUndefined()
    Expect(inspector.groupIsAlive(42)).toBe(false)
    ProcessTree.signalTracked([original], 'SIGKILL', seams)
    Expect(signalled).toEqual([[123]])
  })

  Test('an exit between enumeration and stat read is absent; inspection failures are not', () => {
    for (const code of ['ENOENT', 'ESRCH']) {
      const inspector = createLinuxProcessInspector('/fixture/proc', {
        listDirSync: () => ['123'],
        readTextSync: () => {
          throw { code }
        },
      })
      Expect(inspector.table()).toEqual([])
    }
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
      const inspector = createLinuxProcessInspector('/fixture/proc', {
        listDirSync: () => ['123'],
        readTextSync: () => {
          throw { code }
        },
      })
      Expect(() => inspector.identity(123)).toThrow(/Could not read Linux process 123/u)
      Expect(() => inspector.table()).toThrow(/Could not read Linux process 123/u)
    }
    const missingProc = createLinuxProcessInspector('/fixture/proc', {
      listDirSync: () => {
        throw { code: 'ENOENT' }
      },
      readTextSync: () => '',
    })
    Expect(() => missingProc.table()).toThrow(/Could not list Linux processes/u)
  })

  Test('a successful stat read can report the exact kernel exit sentinel with a stale live state', () => {
    for (const state of ['R', 'S', 'Z', 'X']) {
      const inspector = createLinuxProcessInspector('/fixture/proc', {
        listDirSync: () => ['123'],
        readTextSync: () =>
          `123 (exiting) ${state} 0 -1 -1 0 -1 4194304 10 0 0 0 1 2 0 0 20 0 0 0 98765432101234567 4096 1\n`,
      })
      Expect(inspector.identity(123)).toBeUndefined()
      Expect(inspector.table()).toEqual([])
    }
  })

  Test('refuses malformed identity, group, parent, state or start fields instead of claiming exit', () => {
    for (
      const stat of [
        '',
        `124 (wrong pid) ${STAT}`,
        `123 worker ${STAT}`,
        '123 (short) S 11 42',
        `123 (worker) ${STAT.replace('S 11', '? 11')}`,
        `123 (worker) ${STAT.replace('S 11', 'S -11')}`,
        `123 (worker) ${STAT.replace('S 11 42', 'S 11 NaN')}`,
        `123 (worker) ${STAT.replace('98765432101234567', 'not-ticks')}`,
        `123 (worker) ${STAT.replace('20 0 1 0', '20 0 -1 0')}`,
        `123 (worker) ${STAT.replace('20 0 1 0', '20 0 not-threads 0')}`,
        // A negative group is legal only with the kernel's exact parent/thread exit sentinel.
        `123 (worker) ${STAT.replace('S 11 42', 'S 0 -1')}`,
        `123 (worker) ${STAT.replace('S 11 42', 'S 11 -1').replace('20 0 1 0', '20 0 0 0')}`,
        `123 (worker) ${STAT.replace('S 11 42', 'S 0 -2').replace('20 0 1 0', '20 0 0 0')}`,
      ]
    ) {
      const inspector = createLinuxProcessInspector('/fixture/proc', {
        listDirSync: () => ['123'],
        readTextSync: () => stat,
      })
      Expect(() => inspector.identity(123)).toThrow(/malformed \/proc stat data/u)
    }
  })

  Test('invalid PIDs never become filesystem paths', () => {
    const inspector = createLinuxProcessInspector('/fixture/proc', {
      listDirSync: () => [],
      readTextSync: () => {
        throw { code: 'UNEXPECTED_READ' }
      },
    })
    for (const pid of [0, -1, 1.5, NaN, 2_147_483_648]) {
      Expect(() => inspector.identity(pid)).toThrow(/Expected valid process IDs/u)
    }
  })
})
