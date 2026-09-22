import {
  type ChildProcess,
  spawn as spawnProcess,
  type SpawnOptions as NodeSpawnOptions,
  spawnSync as spawnProcessSync,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process'
import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto'
import { availableParallelism, loadavg } from 'node:os'
import type { Readable } from 'node:stream'
import { throwUnexpected } from './core/Errors'

export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

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

/** randomUUID returns a fresh random identifier, for temporary names and tokens that must not collide. */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

/** hostPlatform is the OS on which the CLI process runs. */
export const hostPlatform = process.platform

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

/** spawn starts a child process. */
export function spawn(command: string, options: SpawnOptions = {}): ChildProcess {
  const { args = [], env, ...spawnOptions } = options
  return spawnProcess(command, [...args], {
    ...spawnOptions,
    env: env === undefined ? undefined : { ...process.env, ...env },
  })
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
