import {
  type ChildProcess,
  spawn as spawnProcess,
  type SpawnOptions as NodeSpawnOptions,
  spawnSync as spawnProcessSync,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process'
import { availableParallelism } from 'node:os'
import type { Readable } from 'node:stream'
import { throwUnexpected } from './core/Errors'

export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

/** cpuCount returns the number of CPUs available to this process. */
export function cpuCount(): number {
  return Math.max(1, availableParallelism())
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
