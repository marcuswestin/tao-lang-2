import {
  type ChildProcess,
  spawn as spawnProcess,
  type SpawnOptions as NodeSpawnOptions,
  spawnSync as spawnProcessSync,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process'

export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

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

/** setStdinRawMode toggles raw stdin mode when the process has an interactive TTY. */
export function setStdinRawMode(rawMode: boolean): boolean {
  const stdin = process.stdin
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return false
  }
  stdin.setRawMode(rawMode)
  return true
}

/** runtimeConsole exposes console output through the shared runtime boundary. */
export const runtimeConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
}

/** runtimeProcess exposes process state and streams through the shared runtime boundary. */
export const runtimeProcess = {
  argv: process.argv,
  chdir: process.chdir.bind(process),
  cwd: process.cwd.bind(process),
  env: process.env,
  execPath: process.execPath,
  exit: process.exit.bind(process),
  setExitCode(exitCode: number) {
    process.exitCode = exitCode
  },
  stderr: process.stderr,
  stdin: process.stdin,
  stdout: process.stdout,
}
