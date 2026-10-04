import { AsyncLocalStorage } from 'node:async_hooks'
import {
  type ChildProcess,
  spawn as spawnProcess,
  type SpawnOptions as NodeSpawnOptions,
  spawnSync as spawnProcessSync,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process'
import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { availableParallelism, constants, getPriority, loadavg, setPriority } from 'node:os'
import { Readable, Writable } from 'node:stream'
import { asError, throwHostEnvironment, throwUnexpected } from './core/Errors'

export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

/** createAsyncContext keeps task-owned state separate across concurrent asynchronous work. */
export function createAsyncContext<Value>(): {
  current: () => Value | undefined
  run: <Result>(value: Value, work: () => Result) => Result
} {
  const storage = new AsyncLocalStorage<Value>()
  return {
    current: () => storage.getStore(),
    run: (value, work) => storage.run(value, work),
  }
}

/** cpuCount returns the number of CPUs available to this process. */
export function cpuCount(): number {
  return Math.max(1, availableParallelism())
}

/**
 * loadAverage returns the one-minute run-queue length this machine is carrying. Compared against
 * `cpuCount` it is the one reading that notices work this process did not start — another
 * worktree's test lane, a Metro bundler, an Xcode build.
 */
export function loadAverage(): number {
  return loadavg()[0] ?? 0
}

/** processPriority returns this process's OS scheduling priority (larger values mean less priority). */
export function processPriority(): number {
  return getPriority()
}

/**
 * lowerProcessPriority lets interactive work take precedence over this process and its future
 * children. Call only at a dedicated command boundary: restoring priority can require privileges.
 * Preserve an already lower priority, including when a nested command applies the policy again.
 */
export function lowerProcessPriority(): void {
  try {
    if (getPriority() < constants.priority.PRIORITY_BELOW_NORMAL) {
      setPriority(constants.priority.PRIORITY_BELOW_NORMAL)
    }
  } catch (cause) {
    throwHostEnvironment('Could not lower command scheduling priority.', { cause })
  }
}

/** processIsAlive reports whether a process id still exists, without signalling it. */
export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists and belongs to somebody else; only ESRCH means it is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** signalProcess signals one PID or Unix process group without requiring a kill executable. */
export function signalProcess(pid: number, signal: ProcessSignal | 0): boolean {
  if (!Number.isSafeInteger(pid) || Math.abs(pid) <= 1 || Math.abs(pid) > 2_147_483_647) {
    throwUnexpected('Expected a process ID or process group ID greater than one.')
  }
  if (hostPlatform !== 'darwin' && hostPlatform !== 'linux') {
    throwHostEnvironment(`Process signalling is not implemented on ${hostPlatform}.`)
  }
  try {
    process.kill(pid, signal)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throwHostEnvironment(`Could not send ${signal} to process ${pid}.`, { cause })
  }
}

/** randomUUID returns a fresh random identifier, for temporary names and tokens that must not collide. */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

/** hostPlatform is the OS on which the CLI process runs. */
export const hostPlatform = process.platform

/** hostArch is the CPU architecture the CLI process runs on, as Node names it: `arm64`, `x64`. */
export const hostArch = process.arch

/** runtimeBunVersion identifies runtime-specific host workarounds without probing the CLI path. */
export const runtimeBunVersion = process.versions.bun

/**
 * sha256Hex reduces content to a hexadecimal digest, in one call for a single value or, for content
 * that arrives in pieces, over ordered parts fed to the same digest. It is the digest seam
 * `repo-lint`'s node-import rule names: a build stamp comparing what it read last time against what
 * it reads now goes through here rather than importing `node:crypto` and taking an allowlist entry.
 */
export function sha256Hex(content: string | Uint8Array | readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256')
  for (const part of Array.isArray(content) ? content : [content]) {
    hash.update(part)
  }
  return hash.digest('hex')
}

/** sha256Base64Url reduces content to a base64url digest, for identities that end up in a URL or a filename. */
export function sha256Base64Url(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('base64url')
}

/**
 * secretsEqual reports whether two secrets are equal, comparing their digests in constant time so
 * neither a length nor an early mismatch leaks through response timing.
 */
export function secretsEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest())
}

/** signES256 signs data with an EC private key using the ES256 (SHA-256, IEEE P1363) scheme a JWT expects. */
export function signES256(privateKeyPem: string, data: Uint8Array): Buffer {
  return sign('sha256', data, { dsaEncoding: 'ieee-p1363', key: createPrivateKey(privateKeyPem) })
}

/*
 * The two helpers below delegate to Bun because nothing else in the tree implements them, and only
 * the dev tooling that runs under Bun calls them. The extension bundle carries them unused, so
 * neither may run at module evaluation.
 */

/** semverSatisfies reports whether a version is inside a semver range. */
export function semverSatisfies(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range)
}

/** parseToml parses TOML text into plain data. */
export function parseToml(text: string): unknown {
  return Bun.TOML.parse(text)
}

/** SpawnOptions declares options for starting a child process. */
export type SpawnOptions = Omit<NodeSpawnOptions, 'env'> & {
  args?: readonly string[]
  env?: ProcessEnv
}

/** SpawnSyncOptions declares options for running a child process synchronously. */
export type SpawnSyncOptions = Omit<NodeSpawnSyncOptions, 'encoding' | 'env'> & {
  args?: readonly string[]
  env?: ProcessEnv
}

type SpawnedChild = EventEmitter & {
  pid?: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  stdin: Writable | null
  stdout: Readable | null
  stderr: Readable | null
  stdio: (Readable | Writable | null | undefined)[]
  channel?: ChildProcess['channel']
  kill: (signal?: NodeJS.Signals) => boolean
  unref: () => void
}

type StandardStdio = 'pipe' | 'ignore' | 'inherit'

/** spawn starts a child process, retaining piped output until its consumers attach. */
export function spawn(command: string, options: SpawnOptions = {}): SpawnedChild {
  const stdio = bufferedStdio(options)
  if (runtimeBunVersion !== undefined && stdio !== undefined) {
    return spawnBuffered(command, options, stdio)
  }
  const { args = [], env, ...spawnOptions } = options
  return spawnProcess(command, [...args], {
    ...spawnOptions,
    env: env === undefined ? undefined : { ...process.env, ...env },
  })
}

function bufferedStdio(options: SpawnOptions): [StandardStdio, StandardStdio, StandardStdio] | undefined {
  // Preserve Node's option validation and auxiliary descriptor/IPC contracts for uncommon calls.
  if (
    Object.entries(options).some(([key, value]) =>
      value !== undefined && !['args', 'cwd', 'detached', 'env', 'stdio'].includes(key)
    )
  ) {
    return undefined
  }
  if (options.cwd !== undefined && typeof options.cwd !== 'string') {
    return undefined
  }
  const stdio = options.stdio ?? 'pipe'
  const descriptors = typeof stdio === 'string' ? [stdio, stdio, stdio] : [...stdio]
  if (descriptors.length > 3) {
    return undefined
  }
  const standard = [0, 1, 2].map(index => descriptors[index] ?? 'pipe')
  if (!standard.every(descriptor => ['pipe', 'ignore', 'inherit'].includes(descriptor as string))) {
    return undefined
  }
  return standard as [StandardStdio, StandardStdio, StandardStdio]
}

function spawnBuffered(
  command: string,
  options: SpawnOptions,
  stdio: [StandardStdio, StandardStdio, StandardStdio],
): SpawnedChild {
  // Bun's Node adapter can re-enter its exit handler during spawn and auto-drain pipes before
  // returning the child. Native streams retain those bytes without an exit-triggered resume.
  let subprocess: Bun.Subprocess | undefined
  const child: SpawnedChild = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdin: null as Writable | null,
    stdout: null as Readable | null,
    stderr: null as Readable | null,
    stdio: [null, null, null] as SpawnedChild['stdio'],
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (subprocess === undefined || child.exitCode !== null || child.signalCode !== null) {
        return false
      }
      subprocess.kill(signal)
      return true
    },
    unref() {
      subprocess?.unref()
    },
  })
  try {
    subprocess = Bun.spawn([command, ...(options.args ?? [])], {
      cwd: options.cwd as string | undefined,
      detached: options.detached,
      // Native Bun's omitted env uses its startup snapshot, not later process.env changes.
      env: { ...process.env, ...options.env },
      stdin: stdio[0],
      stdout: stdio[1],
      stderr: stdio[2],
    })
  } catch (error) {
    const failure = asError(error)
    const code = (failure as NodeJS.ErrnoException).code
    if (!['ENOENT', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE'].includes(code ?? '')) {
      throw error
    }
    process.nextTick(() => {
      child.emit('error', failure)
      child.emit('close', -1, null)
    })
    return child
  }
  const native = subprocess
  child.pid = native.pid
  if (stdio[0] === 'pipe') {
    const sink = native.stdin as Bun.FileSink
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        try {
          // A write the pipe cannot take at once returns a pending promise, which rejects with EPIPE
          // when the child closes its stdin first; it must reach the callback, not go unhandled.
          Promise.resolve(sink.write(chunk))
            .then(() => sink.flush())
            .then(() => callback(), error => callback(asError(error)))
        } catch (error) {
          callback(asError(error))
        }
      },
      final(callback) {
        try {
          Promise.resolve(sink.end()).then(() => callback(), error => callback(asError(error)))
        } catch (error) {
          callback(asError(error))
        }
      },
      destroy(error, callback) {
        try {
          Promise.resolve(sink.end()).then(() => callback(error), failure => callback(error ?? asError(failure)))
        } catch (failure) {
          callback(error ?? asError(failure))
        }
      },
    })
  }
  if (stdio[1] === 'pipe') {
    child.stdout = Readable.fromWeb(native.stdout as unknown as Parameters<typeof Readable.fromWeb>[0])
  }
  if (stdio[2] === 'pipe') {
    child.stderr = Readable.fromWeb(native.stderr as unknown as Parameters<typeof Readable.fromWeb>[0])
  }
  child.stdio = [child.stdin, child.stdout, child.stderr]
  let exited = false
  let closed = false
  const complete = () => {
    if (!closed && exited && [child.stdout, child.stderr].every(stream => stream === null || stream.closed)) {
      closed = true
      child.emit('close', child.exitCode, child.signalCode)
    }
  }
  child.stdout?.once('close', complete)
  child.stderr?.once('close', complete)
  void native.exited.then(() => {
    exited = true
    child.exitCode = native.exitCode
    child.signalCode = native.signalCode
    child.stdin?.destroy()
    child.emit('exit', child.exitCode, child.signalCode)
    complete()
  })
  return child
}

// Completion owns its event sources until the output is drained or the caller disposes them.
const pendingChildCompletions = new Set<() => void>()

/**
 * Observes process exit together with closed output pipes. Bun can omit the aggregate child
 * `close` event even after exit and both pipe closes; joining those facts preserves its semantics.
 * The native close event remains the completion path for spawn failures, which have no exit event.
 */
export function onChildProcessClose(
  child: SpawnedChild,
  listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
): () => void {
  const streams = [child.stdout, child.stderr].filter(stream => stream !== null)
  // Auxiliary descriptors and IPC retain their native close contract. The fallback covers only
  // the standard output pipes whose complete lifecycle this observer can verify.
  const standardPipesOnly = child.stdio.length <= 3 && child.channel === undefined
  let exited = child.exitCode !== null || child.signalCode !== null
  let exitCode = child.exitCode
  let signal = child.signalCode
  let finished = false
  const release = () => {
    pendingChildCompletions.delete(check)
    child.off('exit', onExit)
    child.off('close', complete)
    for (const stream of streams) {
      stream.off('close', check)
    }
  }
  const complete = (code: number | null, exitSignal: NodeJS.Signals | null) => {
    if (finished) {
      return
    }
    finished = true
    release()
    listener(code, exitSignal)
  }
  const check = () => {
    if (standardPipesOnly && exited && streams.every(stream => stream.closed)) {
      complete(exitCode, signal)
    }
  }
  const onExit = (code: number | null, exitSignal: NodeJS.Signals | null) => {
    exited = true
    exitCode = code
    signal = exitSignal
    check()
  }
  pendingChildCompletions.add(check)
  child.once('exit', onExit)
  child.once('close', complete)
  for (const stream of streams) {
    stream.once('close', check)
  }
  check()
  return release
}

/** spawnSync runs a child process synchronously. */
export function spawnSync(command: string, options: SpawnSyncOptions = {}): SpawnSyncReturns<Buffer> {
  const { args = [], env, ...spawnOptions } = options
  return spawnProcessSync(command, [...args], {
    ...spawnOptions,
    encoding: 'buffer',
    env: env === undefined ? undefined : { ...process.env, ...env },
  })
}

/** onProcessSignal registers a process signal listener and returns an unsubscribe function. */
export function onProcessSignal(signal: ProcessSignal, listener: () => void): () => void {
  process.on(signal, listener)
  return () => process.off(signal, listener)
}

/** onProcessExit registers synchronous cleanup for resources a normal process exit must retire. */
export function onProcessExit(listener: () => void): void {
  process.once('exit', listener)
}

/** readStdinText resolves the full text piped to this process on stdin, or '' when stdin is a live terminal. */
export async function readStdinText(): Promise<string> {
  return process.stdin.isTTY ? '' : await Bun.stdin.text()
}

/**
 * setInputRawMode toggles raw mode on an input stream, reporting whether it applied. A stream that is
 * not an interactive TTY has no raw mode to enter, so it reads as ordinary line-buffered input.
 */
export function setInputRawMode(input: Readable, rawMode: boolean): boolean {
  const terminal = input as Readable & { isTTY?: boolean; setRawMode?: (rawMode: boolean) => void }
  if (terminal.isTTY !== true || typeof terminal.setRawMode !== 'function') {
    return false
  }
  terminal.setRawMode(rawMode)
  return true
}

/** runtimeConsole exposes low-level console output through the shared runtime boundary; use HCI for user-facing output. */
export const runtimeConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
}

/** runtimeProcess exposes low-level process state and streams through the shared runtime boundary; use HCI for user-facing I/O. */
export const runtimeProcess = {
  argv: process.argv,
  chdir: process.chdir.bind(process),
  cwd: process.cwd.bind(process),
  env: process.env,
  execPath: process.execPath,
  /** The current process id, for recording which process owns a resource. */
  get pid(): number {
    return process.pid
  },
  exit(exitCode?: number | string | null): never {
    process.exit(exitCode)
    throwUnexpected(`process.exit(${exitCode ?? 0}) returned unexpectedly.`)
  },
  setExitCode(exitCode: number) {
    process.exitCode = exitCode
  },
  stderr: process.stderr,
  stdin: process.stdin,
  stdout: process.stdout,
}
