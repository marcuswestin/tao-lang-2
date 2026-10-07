import { createRequire } from 'node:module'
import * as Errors from './core/Errors'
import * as Platform from './Platform'
import type { TrackedProcess } from './ProcessTree'

type DarwinProcess = TrackedProcess & { group: number }
type Inspection = 'descendants' | 'identities' | 'group' | 'live-group'

/**
 * One fixed libproc implementation serves both runtimes. Keep it as script text: serializing a
 * TypeScript function can capture compiler helpers after bundling, and a module path disappears
 * when this code is bundled into an extension. Only the JSON request crosses into the script.
 */
const inspectScript = String.raw`
const failInspection = (message, options = {}) => fail(message, {
  cause: options.cause,
  details: { ...options.details, inspection: request.kind,
    requestedPids: request.pids.slice(0, 64), requestedPidCount: request.pids.length },
});
const { dlopen, FFIType, ptr, read } = require('bun:ffi');
const library = dlopen('/usr/lib/libproc.dylib', {
  __error: { args: [], returns: FFIType.ptr },
  proc_listchildpids: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32,
  },
  proc_listpids: {
    args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.i32,
  },
  proc_pidinfo: {
    args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
});
try {
  const retryWait = new Int32Array(new SharedArrayBuffer(4));
  const identifiedZombies = new Map();
  const unreadableIdentity = (pid, details) => {
    try {
      process.kill(pid, 0);
    } catch (cause) {
      if (cause && cause.code === 'ESRCH') return undefined;
      failInspection('Could not determine whether macOS process ' + pid + ' exited after its identity became unreadable.', {
        cause, details: { ...details, probeStatus: 'uncertain',
          probeCode: cause && typeof cause.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(cause.code)
            ? cause.code : undefined,
          probeErrno: cause && Number.isSafeInteger(cause.errno) && Math.abs(cause.errno) <= 2147483647
            ? cause.errno : undefined },
      });
    }
    failInspection('Could not read the kernel identity of live macOS process ' + pid + '.', {
      details: { ...details, probeStatus: 'live' },
    });
  };
  const identity = (pid, parentPid, direct = false) => {
    const bytes = new Uint8Array(136);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // A direct query first excludes zombies, then checks their records before claiming absence.
    // Enumeration and identity queries are separate observations. Recheck an incomplete record
    // before declaring a live PID unreadable; persistent uncertainty still fails inspection.
    let returnedBytes;
    let nativeErrno;
    for (let attempt = 0; attempt < (direct ? 4 : 3); attempt++) {
      // Give an exit transition time to settle; immediate calls can repeat the same observation.
      // Only incomplete reads wait, at most 10 ms for enumeration or 15 ms for a direct query.
      if (attempt > 0) Atomics.wait(retryWait, 0, 0, 5);
      returnedBytes = library.symbols.proc_pidinfo(pid, 3, direct && attempt === 0 ? 0 : 1, ptr(bytes), bytes.byteLength);
      // libproc translates a failed syscall into zero bytes. Capture its thread-local errno
      // immediately, before another native call or the liveness probe can replace it.
      nativeErrno = returnedBytes === 0 ? read.i32(library.symbols.__error()) : undefined;
      if (returnedBytes >= bytes.byteLength && view.getUint32(12, true) === pid) break;
      // Retained exited PIDs are queried on every ownership poll. Do not synchronously wait
      // for their records to recover once ESRCH already proves absence. Every other observation
      // keeps the bounded retries, including zombies whose kill(0) still succeeds.
      if (direct && attempt === 0) {
        try { process.kill(pid, 0); } catch (cause) {
          if (cause && cause.code === 'ESRCH') return undefined;
        }
      }
    }
    const details = { routine: 'proc_pidinfo', pid, returnedBytes, expectedBytes: bytes.byteLength,
      ...(nativeErrno ? { nativeErrno } : {}) };
    if (returnedBytes < bytes.byteLength) {
      return unreadableIdentity(pid, { ...details, failureKind: 'identity-unreadable' });
    }
    if (view.getUint32(12, true) !== pid) {
      return unreadableIdentity(pid, { ...details, failureKind: 'identity-pid-mismatch' });
    }
    // proc_bsdinfo.pbi_status uses BSD SZOMB (5): execution ended, even if not yet reaped.
    const zombie = view.getUint32(4, true) === 5;
    if (direct && zombie) return undefined;
    if (request.kind === 'live-group' && zombie) {
      if (view.getUint32(100, true) !== request.pids[0]) {
        failInspection('macOS process ' + pid + ' changed process group during inspection.', {
          details: { failureKind: 'group-changed', routine: 'proc_pidinfo', pid },
        });
      }
      identifiedZombies.set(pid, String(view.getBigUint64(120, true)) + ':' + String(view.getBigUint64(128, true)));
      return undefined;
    }
    // A reparented zombie has finished execution. Retain its exact identity for enumeration,
    // without treating the kernel's reaping transition as a live ownership change.
    if (!zombie && parentPid !== undefined && view.getUint32(16, true) !== parentPid) {
      failInspection('macOS process ' + pid + ' changed parent during inspection.', {
        details: { ...details, failureKind: 'parent-changed', expectedParentPid: parentPid,
          actualParentPid: view.getUint32(16, true) },
      });
    }
    const decode = (offset, length) => new TextDecoder()
      .decode(bytes.subarray(offset, offset + length)).replace(/\0.*$/, '');
    return {
      command: decode(64, 32) || decode(48, 16),
      pid,
      group: view.getUint32(100, true),
      startedAt: String(view.getBigUint64(120, true)) + ':' + String(view.getBigUint64(128, true)),
    };
  };
  const enumeratedIdentity = (pid, parentPid) => identity(pid, parentPid);
  if (request.kind === 'identities') {
    return request.pids.map(pid => identity(pid, undefined, true)).filter(value => value !== undefined);
  }
  if (request.kind === 'group' || request.kind === 'live-group') {
    const listGroup = () => {
      let pids = new Int32Array(4096);
      let bytes;
      for (;;) {
        bytes = library.symbols.proc_listpids(2, request.pids[0], ptr(pids), pids.byteLength);
        if (bytes < 0) failInspection('libproc could not inspect process group ' + request.pids[0], {
          details: { failureKind: 'group-enumeration', routine: 'proc_listpids',
            pid: request.pids[0], returnedBytes: bytes },
        });
        if (bytes < pids.byteLength) break;
        pids = new Int32Array(pids.length * 2);
      }
      const listed = [...pids.subarray(0, bytes / 4)].filter(pid => pid > 0);
      return { listed, bytes };
    };
    const requireGroupAbsence = (bytes) => {
      const details = { failureKind: 'group-enumeration', routine: 'proc_listpids',
        pid: request.pids[0], returnedBytes: bytes };
      try { process.kill(-request.pids[0], 0); } catch (cause) {
        if (cause && cause.code === 'ESRCH') return [];
        failInspection('Could not determine whether macOS process group ' + request.pids[0] + ' exited after inconclusive native enumeration.', {
          cause, details: { ...details, probeStatus: 'uncertain',
            probeCode: cause && typeof cause.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(cause.code)
              ? cause.code : undefined,
            probeErrno: cause && Number.isSafeInteger(cause.errno) && Math.abs(cause.errno) <= 2147483647
              ? cause.errno : undefined },
        });
      }
      failInspection('macOS process group ' + request.pids[0] + ' remained signalable after inconclusive native enumeration.', {
        details: { ...details, probeStatus: 'live' },
      });
    };
    const readMembers = listed => listed.map(pid => {
      const value = enumeratedIdentity(pid);
      if (value !== undefined && value.group !== request.pids[0]) {
        failInspection('macOS process ' + pid + ' changed process group during inspection.', {
          details: { failureKind: 'group-changed', routine: 'proc_pidinfo', pid },
        });
      }
      return value;
    }).filter(value => value !== undefined);
    const first = listGroup();
    if (request.kind === 'live-group' && first.listed.length === 0) return requireGroupAbsence(first.bytes);
    const members = readMembers(first.listed);
    if (request.kind !== 'live-group' || members.length > 0) return members;
    // A listed parent can fork and exit before its identity read. Refresh the list after every
    // first member has finished execution, then require matching full zombie identities.
    // Any newly live member keeps the group alive; empty or changed observations need ESRCH.
    const firstZombies = new Map(identifiedZombies);
    const second = listGroup();
    identifiedZombies.clear();
    const laterMembers = readMembers(second.listed);
    if (laterMembers.length > 0) return laterMembers;
    if (second.listed.length > 0 && second.listed.every(pid =>
      firstZombies.has(pid) && firstZombies.get(pid) === identifiedZombies.get(pid))) return [];
    return requireGroupAbsence(second.bytes);
  }
  const descendants = [];
  const visited = new Set([...request.pids, process.pid]);
  const visit = (pid, depth) => {
    let children = new Int32Array(4096);
    let count;
    for (;;) {
      count = library.symbols.proc_listchildpids(pid, ptr(children), children.byteLength);
      if (count < 0) failInspection('libproc could not inspect child processes for PID ' + pid, {
        details: { failureKind: 'child-enumeration', routine: 'proc_listchildpids', pid, returnedCount: count },
      });
      if (count < children.length) break;
      children = new Int32Array(children.length * 2);
    }
    for (const childPid of children.subarray(0, count)) {
      if (!Number.isSafeInteger(childPid) || childPid <= 1 || visited.has(childPid)) continue;
      visited.add(childPid);
      const child = enumeratedIdentity(childPid, pid);
      if (child === undefined) continue;
      visit(childPid, depth + 1);
      descendants.push({ process: child, depth });
    }
  };
  visit(request.pids[0], 1);
  return descendants.sort((left, right) => right.depth - left.depth).map(entry => entry.process);
} finally {
  library.close();
}
`

// The helper reports only fields produced by the fixed inspector, never its argv or arbitrary stderr.
const helperFailScript = String.raw`(message, options) => {
  console.error(JSON.stringify({ darwinInspectionFailure: 1, details: options && options.details || {} }));
  process.exit(1);
}`

function inspectionFailureFields(value: unknown): Errors.ErrorDetails {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const fields = value as Errors.ErrorDetails
  const result: Errors.ErrorDetails = {}
  if (
    [
      'identity-unreadable',
      'identity-pid-mismatch',
      'group-enumeration',
      'child-enumeration',
      'group-changed',
      'parent-changed',
      'helper-exit',
      'helper-spawn',
    ].includes(String(fields['failureKind']))
  ) {
    result['failureKind'] = fields['failureKind']
  }
  if (['proc_pidinfo', 'proc_listpids', 'proc_listchildpids'].includes(String(fields['routine']))) {
    result['routine'] = fields['routine']
  }
  for (
    const key of [
      'pid',
      'returnedCount',
      'returnedBytes',
      'expectedBytes',
      'probeErrno',
      'nativeErrno',
      'helperStatus',
      'expectedParentPid',
      'actualParentPid',
    ]
  ) {
    const entry = fields[key]
    if (typeof entry === 'number' && Number.isSafeInteger(entry) && Math.abs(entry) <= 2_147_483_647) {
      result[key] = entry
    }
  }
  if (['live', 'uncertain'].includes(String(fields['probeStatus']))) {
    result['probeStatus'] = fields['probeStatus']
  }
  if (typeof fields['probeCode'] === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/u.test(fields['probeCode'])) {
    result['probeCode'] = fields['probeCode']
  }
  if (typeof fields['helperSignal'] === 'string' && /^SIG[A-Z0-9]{1,16}$/u.test(fields['helperSignal'])) {
    result['helperSignal'] = fields['helperSignal']
  }
  return result
}

function helperFailureFields(stderr: unknown): Errors.ErrorDetails {
  const text = String(stderr)
  if (text.length > 8192) {
    return {}
  }
  try {
    const value: unknown = JSON.parse(text)
    if (
      typeof value !== 'object' || value === null || !('darwinInspectionFailure' in value)
      || value.darwinInspectionFailure !== 1 || !('details' in value)
    ) {
      return {}
    }
    return inspectionFailureFields(value.details)
  } catch {
    return {}
  }
}

let inspectInBun:
  | ((
    require: NodeRequire,
    request: { kind: Inspection; pids: readonly number[] },
    fail: typeof Errors.throwHostEnvironment,
  ) => unknown)
  | undefined

/** inspectDarwinProcesses preserves exact kernel identities even when the owner runs under Node. */
export function inspectDarwinProcesses(kind: Inspection, pids: readonly number[]): DarwinProcess[] {
  if (
    pids.some(pid => !Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647)
    || (kind !== 'identities' && pids.length !== 1)
  ) {
    Errors.throwUnexpected('Expected valid process IDs for process inspection.')
  }
  if (pids.length === 0) {
    return []
  }
  let value: unknown
  const backend = Platform.runtimeBunVersion === undefined ? 'bun-helper' : 'in-process-bun'
  const context = { inspection: kind, requestedPids: pids.slice(0, 64), requestedPidCount: pids.length, backend }
  try {
    const request = { kind, pids }
    if (Platform.runtimeBunVersion !== undefined) {
      inspectInBun ??= new Function('require', 'request', 'fail', inspectScript) as NonNullable<typeof inspectInBun>
      value = inspectInBun(createRequire('/'), request, Errors.throwHostEnvironment)
    } else {
      const result = Platform.spawnSync('bun', {
        args: [
          '--eval',
          `console.log(JSON.stringify((function(require, request, fail) {${inspectScript}\n})(require, JSON.parse(process.argv[1]), ${helperFailScript})));`,
          JSON.stringify(request),
        ],
        timeout: 10_000,
        maxBuffer: 16 * 1024 * 1024,
      })
      if (result.error !== undefined || result.status !== 0) {
        Errors.throwHostEnvironment('Could not inspect macOS processes using the Bun helper.', {
          cause: result.error,
          details: {
            failureKind: result.error === undefined ? 'helper-exit' : 'helper-spawn',
            ...helperFailureFields(result.stderr),
            ...inspectionFailureFields({ helperStatus: result.status, helperSignal: result.signal }),
          },
        })
      }
      value = JSON.parse(String(result.stdout))
    }
  } catch (cause) {
    Errors.throwHostEnvironment('Could not read macOS process identities.', {
      cause,
      details: {
        darwinInspection: {
          ...context,
          failureKind: 'backend-exception',
          ...inspectionFailureFields(cause instanceof Errors.HostEnvironmentError ? cause.details : undefined),
        },
      },
    })
  }
  if (!Array.isArray(value) || !value.every(isDarwinProcess)) {
    Errors.throwHostEnvironment('The macOS process inspector returned an invalid response.', {
      details: { darwinInspection: { ...context, failureKind: 'invalid-response' } },
    })
  }
  return value
}

function isDarwinProcess(value: unknown): value is DarwinProcess {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Partial<DarwinProcess>
  return Number.isSafeInteger(entry.pid) && (entry.pid ?? 0) > 0
    && Number.isSafeInteger(entry.group) && (entry.group ?? -1) >= 0
    && typeof entry.command === 'string'
    && typeof entry.startedAt === 'string' && /^\d+:\d+$/.test(entry.startedAt)
}
