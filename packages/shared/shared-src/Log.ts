import { runtimeConsole } from './Runtime'

type LogTransport = {
  debug: (message: string, ...details: unknown[]) => void
  info: (message: string, ...details: unknown[]) => void
  warn: (message: string, ...details: unknown[]) => void
  error: (message: string, ...details: unknown[]) => void
  success: (message: string, ...details: unknown[]) => void
  user: (message: string, ...details: unknown[]) => void
}

const defaultTransport: LogTransport = {
  debug: runtimeConsole.debug,
  info: runtimeConsole.info,
  warn: runtimeConsole.warn,
  error: runtimeConsole.error,
  success: runtimeConsole.info,
  user: runtimeConsole.info,
}

let activeTransport = defaultTransport

export function setTransport(nextTransport: Partial<LogTransport>): void {
  activeTransport = { ...defaultTransport, ...nextTransport }
}

export function debug(message: string, ...details: unknown[]): void {
  activeTransport.debug(message, ...details)
}

export function info(message: string, ...details: unknown[]): void {
  activeTransport.info(message, ...details)
}

export function warn(message: string, ...details: unknown[]): void {
  activeTransport.warn(message, ...details)
}

export function error(message: string, ...details: unknown[]): void {
  activeTransport.error(message, ...details.map(formatDetail))
}

export function success(message: string, ...details: unknown[]): void {
  activeTransport.success(message, ...details)
}

export function user(message: string, ...details: unknown[]): void {
  activeTransport.user(message, ...details)
}

const Log = {
  setTransport,
  debug,
  info,
  warn,
  error,
  success,
  user,
}

export default Log

function formatDetail(detail: unknown): unknown {
  return detail instanceof Error ? detail.stack ?? detail.toString() : detail
}
