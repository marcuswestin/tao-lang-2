import { spawn as nodeSpawn } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import { createInterface as createNodeReadlineInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import * as nodeUrl from 'node:url'

export { createNodeReadlineInterface, nodeFs, nodeOs, nodePath, nodeSpawn, nodeUrl }
export type { Readable, Writable }
export type ProcessEnv = NodeJS.ProcessEnv
export type ProcessSignal = NodeJS.Signals

export const runtimeConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
}

export const runtimeProcess = {
  env: process.env,
  execPath: process.execPath,
  stdin: process.stdin,
  stdout: process.stdout,
}
