import { Errors, FS, ProcessTree, Repo } from '@shared'
import { Expect, Test } from '@shared/test'

type Kind = 'descendants' | 'identities' | 'group' | 'live-group'
type Record = { pid: number; group: number; startedAt: string }

// Evaluate the production script itself with a local FFI fixture. Its private literal is the
// implementation both runtimes execute; no production export or process-wide override is needed.
const source = FS.readTextSync(Repo.resolvePath('packages/shared/shared-src/ProcessTreeDarwin.ts'))
const script = source.match(/const inspectScript = String\.raw`([\s\S]*?)`\n/)?.[1]
if (script === undefined) {
  Errors.throwUnexpected('Expected the fixed Darwin process inspection script.')
}
const execute = new Function('require', 'request', 'fail', 'process', 'Atomics', script) as (
  require: (name: string) => unknown,
  request: { kind: Kind; pids: number[] },
  fail: typeof Errors.throwHostEnvironment,
  process: { pid: number; kill: (pid: number, signal: number) => boolean },
  atomics: { wait: (array: Int32Array, index: number, value: number, timeout: number) => string },
) => Record[]
const helperFailure = source.match(/const helperFailScript = String\.raw`([\s\S]*?)`\n/)?.[1]
if (helperFailure === undefined) {
  Errors.throwUnexpected('Expected the fixed Darwin helper failure envelope.')
}

function fixture(options: {
  unreadable?: boolean
  zombie?: boolean
  returnedPid?: number
  returnedParentPid?: number
  unreadableReads?: number
  unreadableUntilYield?: boolean
  nativeErrno?: number
  shortReturnedBytes?: number
  shortPid?: number
  shortStatus?: number
  tableRecord?: boolean
  tableReturnedBytes?: number
  tablePid?: number
  group?: number
  probe?: 'live' | 'EPERM' | 'EIO' | 'ESRCH' | 'uncoded' | 'undefined'
  probeErrno?: number
  childFailurePid?: number
  groupFailure?: boolean
  groupEmpty?: boolean
  laterGroup?: number[]
  unreadablePid?: number
  laterZombieIdentity?: boolean
  groupStillLive?: boolean
} = {}) {
  const probes: Array<{ pid: number; signal: number }> = []
  const failure = options.probe === 'undefined' ? undefined : Object.assign(
    Errors.asError('Injected Darwin kernel probe failure'),
    options.probe === 'uncoded' ? {} : { code: options.probe, errno: options.probeErrno },
  )
  let closes = 0
  let expectedArg = 0
  let identityReads = 0
  let waitedMs = 0
  let groupReads = 0
  const symbols = {
    __error: () => 1,
    sysctl: (
      mib: Int32Array,
      length: number,
      bytes: Uint8Array,
      size: BigUint64Array,
      newValue: unknown,
      newSize: number,
    ) => {
      Expect([...mib]).toEqual([1, 14, 1, 701])
      Expect(length).toBe(4)
      Expect(bytes.byteLength).toBe(648)
      Expect(newValue).toBe(null)
      Expect(newSize).toBe(0)
      size[0] = BigInt(options.tableReturnedBytes ?? (options.tableRecord ? 648 : 0))
      if (!options.tableRecord) {
        return -1
      }
      const view = new DataView(bytes.buffer)
      view.setBigUint64(0, options.laterZombieIdentity && groupReads > 1 ? 999n : 123n, true)
      view.setUint32(8, 456, true)
      view.setUint32(12, 0xdeadbeef, true) // timeval padding is not part of microseconds.
      view.setUint8(36, options.zombie ? 5 : 2)
      view.setUint32(40, options.tablePid ?? 701, true)
      view.setUint32(560, options.returnedParentPid ?? 700, true)
      view.setUint32(564, options.group ?? 700, true)
      return 0
    },
    proc_listpids: (_kind: number, group: number, pids: Int32Array) => {
      groupReads++
      Expect(group).toBe(700)
      if (options.groupFailure) {
        return -1
      }
      if (options.groupEmpty) {
        return 0
      }
      if (groupReads > 1 && options.laterGroup !== undefined) {
        pids.set(options.laterGroup)
        return options.laterGroup.length * 4
      }
      pids[0] = 701
      return 4
    },
    proc_listchildpids: (pid: number, children: Int32Array) => {
      if (pid === options.childFailurePid) {
        return -1
      }
      if (pid !== 700) {
        return 0
      }
      children[0] = 701
      return 1
    },
    proc_pidinfo: (pid: number, kind: number, arg: number, bytes: Uint8Array) => {
      Expect([701, 702].includes(pid)).toBe(true)
      if (kind === 13) {
        Expect(arg).toBe(1)
        Expect(bytes.byteLength).toBe(64)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        view.setUint32(0, options.shortPid ?? pid, true)
        view.setUint32(12, options.shortStatus ?? 2, true)
        return options.shortReturnedBytes ?? bytes.byteLength
      }
      identityReads++
      Expect(kind).toBe(3)
      Expect(arg).toBe(expectedArg === 0 && identityReads > 1 ? 1 : expectedArg)
      if (
        options.unreadable === true || pid === options.unreadablePid
        || identityReads <= (options.unreadableReads ?? 0)
        || options.unreadableUntilYield === true && waitedMs === 0
        || options.zombie === true && arg === 0
      ) {
        return 0
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      view.setUint32(4, options.zombie === true ? 5 : 2, true)
      view.setUint32(12, options.returnedPid ?? pid, true)
      view.setUint32(16, options.returnedParentPid ?? 700, true)
      view.setUint32(100, options.group ?? 700, true)
      view.setBigUint64(120, options.laterZombieIdentity && groupReads > 1 ? 999n : 123n, true)
      view.setBigUint64(128, 456n, true)
      return bytes.byteLength
    },
  }
  return {
    inspect: (kind: Kind, fail = Errors.throwHostEnvironment) => {
      expectedArg = kind === 'identities' ? 0 : 1
      return execute(
        name => {
          Expect(name).toBe('bun:ffi')
          return {
            dlopen: () => ({ symbols, close: () => closes++ }),
            FFIType: { i32: 'i32', ptr: 'ptr', u32: 'u32', u64: 'u64' },
            ptr: (bytes: Uint8Array | Int32Array) => bytes,
            read: { i32: () => options.nativeErrno ?? 0 },
          }
        },
        { kind, pids: [kind === 'identities' ? 701 : 700] },
        fail,
        {
          pid: 999,
          kill: (pid, signal) => {
            probes.push({ pid, signal })
            if (options.probe === 'live' || pid < 0 && options.groupStillLive === true) {
              return true
            }
            throw failure
          },
        },
        {
          wait: (_array, _index, _value, timeout) => {
            waitedMs += timeout
            return 'timed-out'
          },
        },
      )
    },
    probes,
    failure,
    closes: () => closes,
    identityReads: () => identityReads,
    waitedMs: () => waitedMs,
    groupReads: () => groupReads,
  }
}

Test('Darwin group joins omit only fully identified zombies even when kill(0) succeeds', () => {
  for (const zombie of [false, true]) {
    const host = fixture({ zombie, probe: 'live' })
    const alive = ProcessTree.isGroupAlive(700, () => true, {
      platform: 'darwin',
      darwinGroupIsAlive: () => host.inspect('live-group').length > 0,
    })
    Expect(alive).toBe(!zombie)
    Expect(host.identityReads()).toBe(zombie ? 2 : 1)
    Expect(host.groupReads()).toBe(zombie ? 2 : 1)
    Expect(host.closes()).toBe(1)
  }
})

for (const kind of ['identities', 'descendants', 'group', 'live-group'] as const) {
  Test(`Darwin ${kind} retains the same exact identity when a privileged helper denies full BSD info`, () => {
    const ordinary = fixture({ probe: 'live' }).inspect(kind)
    const privileged = fixture({ unreadable: true, nativeErrno: 1, tableRecord: true, probe: 'live' })
    Expect(privileged.inspect(kind)).toEqual(ordinary)
    Expect(privileged.closes()).toBe(1)
  })
}

Test('Darwin privileged helper inspection rejects a reused PID instead of claiming its identity', () => {
  const host = fixture({ unreadable: true, nativeErrno: 1, tableRecord: true, tablePid: 702, probe: 'live' })
  Expect(() => host.inspect('descendants')).toThrow(Errors.HostEnvironmentError)
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
})

for (const tableReturnedBytes of [0, 644, 652]) {
  Test(
    `Darwin privileged helper inspection rejects an incomplete or changed process-table ABI: ${tableReturnedBytes}`,
    () => {
      const host = fixture({ unreadable: true, nativeErrno: 1, tableRecord: true, tableReturnedBytes, probe: 'live' })
      Expect(() => host.inspect('descendants')).toThrow(Errors.HostEnvironmentError)
    },
  )
}

Test('Darwin privileged helper inspection preserves parent and process-group ownership checks', () => {
  const denied = { unreadable: true, nativeErrno: 1, tableRecord: true, probe: 'live' } as const
  Expect(() => fixture({ ...denied, returnedParentPid: 1 }).inspect('descendants')).toThrow('changed parent')
  Expect(() => fixture({ ...denied, group: 800 }).inspect('group')).toThrow('changed process group')
})

Test('Darwin privileged zombie group joins require matching exact identities across both snapshots', () => {
  const denied = { unreadable: true, nativeErrno: 1, tableRecord: true, zombie: true, probe: 'live' } as const
  Expect(fixture(denied).inspect('live-group')).toEqual([])
  Expect(() => fixture({ ...denied, laterZombieIdentity: true }).inspect('live-group')).toThrow('remained signalable')
  Expect(fixture(denied).inspect('identities')).toEqual([])
})

Test('Darwin group joins discover a child forked after its listed parent exited', () => {
  const host = fixture({ unreadablePid: 701, probe: 'ESRCH', laterGroup: [702] })
  Expect(host.inspect('live-group').map(record => record.pid)).toEqual([702])
  Expect(host.groupReads()).toBe(2)
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
  Expect(host.closes()).toBe(1)
})

Test('Darwin group joins refuse two missing identity snapshots while the group remains signalable', () => {
  const host = fixture({ unreadable: true, probe: 'ESRCH', groupStillLive: true })
  Expect(() => host.inspect('live-group')).toThrow('remained signalable')
  Expect(host.groupReads()).toBe(2)
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }, { pid: 701, signal: 0 }, { pid: -700, signal: 0 }])
  Expect(host.closes()).toBe(1)
})

Test('Darwin group joins require matching zombie identities in the second group snapshot', () => {
  const host = fixture({ zombie: true, probe: 'live', laterZombieIdentity: true })
  Expect(() => host.inspect('live-group')).toThrow('remained signalable')
  Expect(host.probes).toEqual([{ pid: -700, signal: 0 }])
  Expect(host.closes()).toBe(1)
})

Test('Darwin group joins refuse a zombie record belonging to a different group', () => {
  const host = fixture({ zombie: true, group: 800, probe: 'live' })
  Expect(() => host.inspect('live-group')).toThrow('changed process group')
  Expect(host.closes()).toBe(1)
})

Test('Darwin group joins refuse a second empty list while the group remains signalable', () => {
  const host = fixture({ zombie: true, probe: 'live', laterGroup: [] })
  Expect(() => host.inspect('live-group')).toThrow('remained signalable')
  Expect(host.groupReads()).toBe(2)
  Expect(host.closes()).toBe(1)
})

Test('Darwin group joins refuse unreadable members instead of relying on kill(0)', () => {
  const host = fixture({ unreadable: true, probe: 'live' })
  Expect(() =>
    ProcessTree.isGroupAlive(700, () => true, {
      platform: 'darwin',
      darwinGroupIsAlive: () => host.inspect('live-group').length > 0,
    })
  ).toThrow('kernel identity of live macOS process')
  Expect(host.closes()).toBe(1)
})

for (const probe of ['live', 'EPERM', 'EIO', 'ESRCH'] as const) {
  Test(`Darwin group joins resolve empty native enumeration only when its probe is ESRCH: ${probe}`, () => {
    const host = fixture({ groupEmpty: true, probe })
    const join = () =>
      ProcessTree.isGroupAlive(700, () => true, {
        platform: 'darwin',
        darwinGroupIsAlive: () => host.inspect('live-group').length > 0,
      })
    if (probe === 'ESRCH') {
      Expect(join()).toBe(false)
    } else {
      let caught: unknown
      try {
        join()
      } catch (cause) {
        caught = cause
      }
      Expect(caught).toBeInstanceOf(Errors.HostEnvironmentError)
      const error = caught as Errors.HostEnvironmentError
      Expect(error.details?.['failureKind']).toBe('group-enumeration')
      Expect(error.details?.['returnedBytes']).toBe(0)
      Expect(error.details?.['probeStatus']).toBe(probe === 'live' ? 'live' : 'uncertain')
      if (probe !== 'live') {
        Expect(error.cause).toBe(host.failure)
        Expect(error.details?.['probeCode']).toBe(probe)
      }
    }
    Expect(host.probes).toEqual([{ pid: -700, signal: 0 }])
    Expect(host.identityReads()).toBe(0)
    Expect(host.closes()).toBe(1)
  })
}

Test('Darwin descendant enumeration retains a reparented zombie without accepting a live orphan', () => {
  const host = fixture({ zombie: true, returnedParentPid: 1 })
  Expect(host.inspect('descendants')).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
  Expect(() => fixture({ returnedParentPid: 1 }).inspect('descendants')).toThrow('changed parent')
  Expect(host.closes()).toBe(1)
})

for (const kind of ['group', 'descendants'] as const) {
  Test(`Darwin ${kind} retains a zombie's exact kernel identity until reaping`, () => {
    const host = fixture({ zombie: true, probe: 'live' })
    Expect(host.inspect(kind)).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
    Expect(host.probes).toEqual([])
    Expect(host.closes()).toBe(1)
  })

  Test(`Darwin ${kind} preserves an enumerated kernel identity without probing`, () => {
    const host = fixture()
    const result = host.inspect(kind)
    Expect(result.map(({ pid, group, startedAt }) => ({ pid, group, startedAt }))).toEqual([
      { pid: 701, group: 700, startedAt: '123:456' },
    ])
    Expect(host.probes).toEqual([])
    Expect(host.closes()).toBe(1)
  })

  Test(`Darwin ${kind} omits an unreadable enumerated PID only after ESRCH proves exit`, () => {
    const host = fixture({ unreadable: true, probe: 'ESRCH' })
    Expect(host.inspect(kind)).toEqual([])
    Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
    Expect(host.closes()).toBe(1)
    Expect(host.identityReads()).toBe(3)
  })

  Test(`Darwin ${kind} resolves a temporarily unreadable identity within its fixed retry budget`, () => {
    const host = fixture({ unreadableReads: 2, probe: 'live' })
    Expect(host.inspect(kind)).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
    Expect(host.identityReads()).toBe(3)
    Expect(host.probes).toEqual([])
    Expect(host.closes()).toBe(1)
  })

  Test(`Darwin ${kind} yields before rechecking an exit transition`, () => {
    const host = fixture({ unreadableUntilYield: true, probe: 'live' })
    Expect(host.inspect(kind)).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
    Expect(host.probes).toEqual([])
    Expect(host.waitedMs()).toBe(5)
  })

  for (const probe of ['live', 'EPERM', 'EIO', 'uncoded', 'undefined'] as const) {
    Test(`Darwin ${kind} refuses an unreadable enumerated PID when its probe is ${probe}`, () => {
      const host = fixture({ unreadable: true, probe })
      let caught: unknown
      try {
        host.inspect(kind)
      } catch (cause) {
        caught = cause
      }
      Expect(caught).toBeInstanceOf(Errors.HostEnvironmentError)
      if (probe !== 'live') {
        Expect((caught as Errors.HostEnvironmentError).cause).toBe(host.failure)
        Expect((caught as Errors.HostEnvironmentError).details?.['pid']).toBe(701)
      }
      Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
      Expect(host.closes()).toBe(1)
      Expect(host.identityReads()).toBe(3)
      Expect(host.waitedMs()).toBe(10)
    })
  }

  Test(`Darwin ${kind} rejects an identity whose kernel PID no longer matches the enumerated PID`, () => {
    const host = fixture({ returnedPid: 702, probe: 'live' })
    Expect(() => host.inspect(kind)).toThrow(Errors.HostEnvironmentError)
    Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
    Expect(host.closes()).toBe(1)
  })
}

for (const kind of ['identities', 'descendants', 'group'] as const) {
  Test(`Darwin ${kind} omits a denied full record only when a matching short record proves zombie status`, () => {
    const host = fixture({ unreadable: true, nativeErrno: 1, shortStatus: 5, probe: 'live' })
    Expect(host.inspect(kind)).toEqual([])
    // The short record proves execution ended; it never becomes an owned signal target.
    Expect(host.probes).toEqual(kind === 'identities' ? [{ pid: 701, signal: 0 }] : [])
    Expect(host.closes()).toBe(1)
  })
}

for (
  const observation of [
    { shortStatus: 2 },
    { shortStatus: 5, shortPid: 702 },
    { shortStatus: 5, shortReturnedBytes: 60 },
    { shortStatus: 5, shortReturnedBytes: 0 },
    { shortStatus: 5, nativeErrno: 13 },
  ] as const
) {
  Test(`Darwin refuses a denied identity with inconclusive short observation ${JSON.stringify(observation)}`, () => {
    const host = fixture({ unreadable: true, nativeErrno: 1, probe: 'live', ...observation })
    Expect(() => host.inspect('descendants')).toThrow(Errors.HostEnvironmentError)
    Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
    Expect(host.closes()).toBe(1)
  })
}

Test('Darwin group joins reject a short zombie record without exact identity proof', () => {
  const host = fixture({ unreadable: true, nativeErrno: 1, shortStatus: 5, probe: 'live' })
  Expect(() => host.inspect('live-group')).toThrow(Errors.HostEnvironmentError)
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
  Expect(host.closes()).toBe(1)
})

Test('Darwin group inspection refuses a member that moved to another group during inspection', () => {
  const host = fixture({ group: 800 })
  Expect(() => host.inspect('group')).toThrow('changed process group during inspection')
  Expect(host.probes).toEqual([])
  Expect(host.closes()).toBe(1)
})

Test('Darwin descendant inspection refuses a changed parent after resolving a transient read failure', () => {
  const host = fixture({ unreadableReads: 1, returnedParentPid: 800 })
  Expect(() => host.inspect('descendants')).toThrow('changed parent during inspection')
  Expect(host.identityReads()).toBe(2)
  Expect(host.probes).toEqual([])
  Expect(host.closes()).toBe(1)
})

Test('Darwin direct identity queries retain process-exit semantics for zombies', () => {
  const host = fixture({ zombie: true, probe: 'live' })
  Expect(host.inspect('identities')).toEqual([])
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
  Expect(host.closes()).toBe(1)
  Expect(host.identityReads()).toBe(2)
})

Test('Darwin direct identity queries recover a live exact identity after an unreadable primary record', () => {
  const host = fixture({ unreadableReads: 1, probe: 'live' })
  Expect(host.inspect('identities')).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
  Expect(host.identityReads()).toBe(2)
  Expect(host.closes()).toBe(1)
})

for (const options of [{ unreadable: true }, { returnedPid: 702 }] as const) {
  Test(
    `Darwin direct identity queries omit absent ${
      'unreadable' in options ? 'records' : 'PID mismatches'
    } without waiting`,
    () => {
      const host = fixture({ ...options, probe: 'ESRCH' })
      Expect(host.inspect('identities')).toEqual([])
      Expect(host.identityReads()).toBe(1)
      Expect(host.waitedMs()).toBe(0)
      Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
      Expect(host.closes()).toBe(1)
    },
  )
}

for (const options of [{ unreadable: true }, { returnedPid: 702 }] as const) {
  for (const probe of ['live', 'EPERM', 'EIO'] as const) {
    Test(
      `Darwin identities refuses unreadable ${
        'unreadable' in options ? 'records' : 'PID mismatches'
      } when its probe is ${probe}`,
      () => {
        const host = fixture({ ...options, probe })
        Expect(() => host.inspect('identities')).toThrow(Errors.HostEnvironmentError)
        Expect(host.identityReads()).toBe(4)
        Expect(host.waitedMs()).toBe(15)
        Expect(host.probes).toEqual([{ pid: 701, signal: 0 }, { pid: 701, signal: 0 }])
        Expect(host.closes()).toBe(1)
      },
    )
  }
}

for (
  const scenario of [
    {
      name: 'root child enumeration',
      kind: 'descendants',
      options: { childFailurePid: 700 },
      expected: { failureKind: 'child-enumeration', routine: 'proc_listchildpids', pid: 700, returnedCount: -1 },
    },
    {
      name: 'captured descendant child enumeration',
      kind: 'descendants',
      options: { childFailurePid: 701 },
      expected: { failureKind: 'child-enumeration', routine: 'proc_listchildpids', pid: 701, returnedCount: -1 },
    },
    {
      name: 'group enumeration',
      kind: 'group',
      options: { groupFailure: true },
      expected: { failureKind: 'group-enumeration', routine: 'proc_listpids', pid: 700, returnedBytes: -1 },
    },
    {
      name: 'changed descendant parent',
      kind: 'descendants',
      options: { unreadableReads: 1, returnedParentPid: 800 },
      expected: {
        failureKind: 'parent-changed',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 136,
        expectedBytes: 136,
        expectedParentPid: 700,
        actualParentPid: 800,
      },
    },
    {
      name: 'live unreadable direct identity',
      kind: 'identities',
      options: { unreadable: true, probe: 'live' },
      expected: {
        failureKind: 'identity-unreadable',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 0,
        expectedBytes: 136,
        probeStatus: 'live',
      },
    },
    {
      name: 'live unreadable descendant',
      kind: 'descendants',
      options: { unreadable: true, probe: 'live', nativeErrno: 13 },
      expected: {
        failureKind: 'identity-unreadable',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 0,
        expectedBytes: 136,
        probeStatus: 'live',
        nativeErrno: 13,
      },
    },
    {
      name: 'denied full identity with live short record',
      kind: 'descendants',
      options: { unreadable: true, probe: 'live', nativeErrno: 1, shortStatus: 2 },
      expected: {
        failureKind: 'identity-unreadable',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 0,
        expectedBytes: 136,
        probeStatus: 'live',
        nativeErrno: 1,
        shortReturnedBytes: 64,
        shortPid: 701,
        shortStatus: 2,
        shortUid: 0,
        tableResult: -1,
        tableReturnedBytes: 0,
        tableErrno: 1,
      },
    },
    {
      name: 'EPERM liveness probe',
      kind: 'descendants',
      options: { unreadable: true, probe: 'EPERM', probeErrno: -1 },
      expected: {
        failureKind: 'identity-unreadable',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 0,
        expectedBytes: 136,
        probeStatus: 'uncertain',
        probeCode: 'EPERM',
        probeErrno: -1,
      },
    },
    {
      name: 'EIO liveness probe',
      kind: 'descendants',
      options: { unreadable: true, probe: 'EIO', probeErrno: -5 },
      expected: {
        failureKind: 'identity-unreadable',
        routine: 'proc_pidinfo',
        pid: 701,
        returnedBytes: 0,
        expectedBytes: 136,
        probeStatus: 'uncertain',
        probeCode: 'EIO',
        probeErrno: -5,
      },
    },
  ] as const
) {
  Test(`Darwin ${scenario.name} preserves the same bounded failure envelope in process and in the fixed helper`, () => {
    const local = fixture(scenario.options)
    let failure: unknown
    try {
      local.inspect(scenario.kind)
    } catch (error) {
      failure = error
    }
    if (!(failure instanceof Errors.HostEnvironmentError)) {
      Errors.throwUnexpected('Expected the original Darwin inspection failure.')
    }
    Expect(failure.details).toEqual({
      ...scenario.expected,
      inspection: scenario.kind,
      requestedPids: [scenario.kind === 'identities' ? 701 : 700],
      requestedPidCount: 1,
    })
    if ('probeErrno' in scenario.options) {
      Expect(failure.cause).toBe(local.failure)
    }
    const messages: string[] = []
    const helperExit = new Errors.HostEnvironmentError('Source-only helper exit')
    const fail = new Function('console', 'process', `return (${helperFailure});`)(
      { error: (value: string) => messages.push(value) },
      {
        exit: (code: number) => {
          Expect(code).toBe(1)
          throw helperExit
        },
      },
    ) as typeof Errors.throwHostEnvironment
    Expect(() => fixture(scenario.options).inspect(scenario.kind, fail)).toThrow(helperExit)
    Expect(messages).toHaveLength(1)
    Expect(JSON.parse(messages[0]!)).toEqual({ darwinInspectionFailure: 1, details: failure.details })
    Expect(messages[0]).not.toContain('Source-only helper exit')
    Expect(local.closes()).toBe(1)
  })
}
