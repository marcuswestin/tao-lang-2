import { spawn as nodeSpawn } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import { createInterface as createNodeReadlineInterface } from 'node:readline/promises'
import { PassThrough, type Readable, Writable } from 'node:stream'
import * as nodeUrl from 'node:url'

export { createNodeReadlineInterface, nodeFs, nodeOs, nodePath, nodeSpawn, nodeUrl, PassThrough, Writable }
export type { Readable }
export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

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
