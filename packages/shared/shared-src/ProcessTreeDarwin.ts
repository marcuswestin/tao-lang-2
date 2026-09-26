import { createRequire } from 'node:module'
import * as Errors from './core/Errors'
import * as Platform from './Platform'
import type { TrackedProcess } from './ProcessTree'

type DarwinProcess = TrackedProcess & { group: number }
type Inspection = 'descendants' | 'identities'

/**
 * One fixed libproc implementation serves both runtimes. Keep it as script text: serializing a
 * TypeScript function can capture compiler helpers after bundling, and a module path disappears
 * when this code is bundled into an extension. Only the JSON request crosses into the script.
 */
const inspectScript = String.raw`
const { dlopen, FFIType, ptr } = require('bun:ffi');
const library = dlopen('/usr/lib/libproc.dylib', {
  proc_listchildpids: {
    args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32,
  },
  proc_pidinfo: {
    args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32,
  },
});
try {
  const identity = pid => {
    const bytes = new Uint8Array(136);
    if (library.symbols.proc_pidinfo(pid, 3, 0, ptr(bytes), bytes.byteLength) < bytes.byteLength) {
      return undefined;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(12, true) !== pid) return undefined;
    const decode = (offset, length) => new TextDecoder()
      .decode(bytes.subarray(offset, offset + length)).replace(/\0.*$/, '');
    return {
      command: decode(64, 32) || decode(48, 16),
      pid,
      group: view.getUint32(100, true),
      startedAt: String(view.getBigUint64(120, true)) + ':' + String(view.getBigUint64(128, true)),
    };
  };
  if (request.kind === 'identities') {
    return request.pids.map(identity).filter(value => value !== undefined);
  }
  const descendants = [];
  const visited = new Set([...request.pids, process.pid]);
  const visit = (pid, depth) => {
    let children = new Int32Array(4096);
    let count;
    for (;;) {
      count = library.symbols.proc_listchildpids(pid, ptr(children), children.byteLength);
      if (count < 0) fail('libproc could not inspect child processes for PID ' + pid);
      if (count < children.length) break;
      children = new Int32Array(children.length * 2);
    }
    for (const childPid of children.subarray(0, count)) {
      if (!Number.isSafeInteger(childPid) || childPid <= 1 || visited.has(childPid)) continue;
      visited.add(childPid);
      const child = identity(childPid);
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

let inspectInBun:
  | ((
    require: NodeRequire,
    request: { kind: Inspection; pids: readonly number[] },
    fail: (message: string) => never,
  ) => unknown)
  | undefined

/** inspectDarwinProcesses preserves exact kernel identities even when the owner runs under Node. */
export function inspectDarwinProcesses(kind: Inspection, pids: readonly number[]): DarwinProcess[] {
  if (
    pids.some(pid => !Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647)
    || (kind === 'descendants' && pids.length !== 1)
  ) {
    Errors.throwUnexpected('Expected valid process IDs for process inspection.')
  }
  if (pids.length === 0) {
    return []
  }
  let value: unknown
  try {
    const request = { kind, pids }
    if (Platform.runtimeBunVersion !== undefined) {
      inspectInBun ??= new Function('require', 'request', 'fail', inspectScript) as NonNullable<typeof inspectInBun>
      value = inspectInBun(createRequire('/'), request, Errors.throwHostEnvironment)
    } else {
      const result = Platform.spawnSync('bun', {
        args: [
          '--eval',
          `console.log(JSON.stringify((function(require, request, fail) {${inspectScript}\n})(require, JSON.parse(process.argv[1]), message => { console.error(message); process.exit(1); })));`,
          JSON.stringify(request),
        ],
        timeout: 10_000,
        maxBuffer: 16 * 1024 * 1024,
      })
      if (result.error !== undefined || result.status !== 0) {
        Errors.throwHostEnvironment('Could not inspect macOS processes using the Bun helper.', {
          cause: result.error,
          details: { status: result.status, signal: result.signal, stderr: String(result.stderr) },
        })
      }
      value = JSON.parse(String(result.stdout))
    }
  } catch (cause) {
    Errors.throwHostEnvironment('Could not read macOS process identities.', { cause })
  }
  if (!Array.isArray(value) || !value.every(isDarwinProcess)) {
    Errors.throwHostEnvironment('The macOS process inspector returned an invalid response.')
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
