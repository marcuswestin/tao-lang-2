import { runtimeConsole } from './Platform'

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

/** setTransport replaces selected log transport methods. */
export function setTransport(nextTransport: Partial<LogTransport>): void {
  activeTransport = { ...defaultTransport, ...nextTransport }
}

/** debug writes a debug-level message. */
export function debug(message: string, ...details: unknown[]): void {
  activeTransport.debug(message, ...details)
}

/** info writes an informational message. */
export function info(message: string, ...details: unknown[]): void {
  activeTransport.info(message, ...details)
}

/** warn writes a warning message. */
export function warn(message: string, ...details: unknown[]): void {
  activeTransport.warn(message, ...details)
}

/** error writes an error message. */
export function error(message: string, ...details: unknown[]): void {
  activeTransport.error(message, ...details.map(formatDetail))
}

/** success writes a successful operation message. */
export function success(message: string, ...details: unknown[]): void {
  activeTransport.success(message, ...details)
}

/** user writes a message intended directly for the terminal user. */
export function user(message: string, ...details: unknown[]): void {
  activeTransport.user(message, ...details)
}

function formatDetail(detail: unknown): unknown {
  return detail instanceof Error ? detail.stack ?? detail.toString() : detail
}
