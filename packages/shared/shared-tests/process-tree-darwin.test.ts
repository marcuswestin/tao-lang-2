import { Errors, FS, Repo } from '@shared'
import { Expect, Test } from '@shared/test'

type Kind = 'descendants' | 'identities' | 'group'
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
  group?: number
  probe?: 'live' | 'EPERM' | 'EIO' | 'ESRCH' | 'uncoded' | 'undefined'
  probeErrno?: number
  childFailurePid?: number
  groupFailure?: boolean
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
  const symbols = {
    proc_listpids: (_kind: number, group: number, pids: Int32Array) => {
      Expect(group).toBe(700)
      if (options.groupFailure) {
        return -1
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
      identityReads++
      Expect(pid).toBe(701)
      Expect(kind).toBe(3)
      Expect(arg).toBe(expectedArg === 0 && identityReads > 1 ? 1 : expectedArg)
      if (
        options.unreadable === true || identityReads <= (options.unreadableReads ?? 0)
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
      view.setBigUint64(120, 123n, true)
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
          }
        },
        { kind, pids: [kind === 'identities' ? 701 : 700] },
        fail,
        {
          pid: 999,
          kill: (pid, signal) => {
            probes.push({ pid, signal })
            if (options.probe === 'live') {
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
  }
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
  Expect(host.probes).toEqual([])
  Expect(host.closes()).toBe(1)
  Expect(host.identityReads()).toBe(2)
})

Test('Darwin direct identity queries recover a live exact identity after an unreadable primary record', () => {
  const host = fixture({ unreadableReads: 1, probe: 'live' })
  Expect(host.inspect('identities')).toEqual([{ pid: 701, group: 700, startedAt: '123:456', command: '' }])
  Expect(host.probes).toEqual([])
  Expect(host.identityReads()).toBe(2)
  Expect(host.closes()).toBe(1)
})

Test('Darwin direct identity queries confirm absent unreadable records with ESRCH', () => {
  const host = fixture({ unreadable: true, probe: 'ESRCH' })
  Expect(host.inspect('identities')).toEqual([])
  Expect(host.identityReads()).toBe(4)
  Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
  Expect(host.closes()).toBe(1)
})

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
        Expect(host.probes).toEqual([{ pid: 701, signal: 0 }])
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
