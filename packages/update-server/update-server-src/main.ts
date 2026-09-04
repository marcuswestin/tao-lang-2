#!/usr/bin/env bun
import { Errors, HCI, Platform } from '@shared'
import { createHash, timingSafeEqual } from 'node:crypto'
import { startBunUpdateServer } from './update-server'
import { createUpdateService } from './update-service'
import { FilesystemUpdateStore } from './update-store'

if (import.meta.main) {
  startFromEnvironment()
}

function startFromEnvironment(): void {
  const environment = Platform.runtimeProcess.env
  const token = requiredEnvironment(environment, 'TAO_UPDATE_ADMIN_TOKEN')
  const publicBaseUrl = requiredEnvironment(environment, 'TAO_UPDATE_PUBLIC_URL')
  const storageRoot = requiredEnvironment(environment, 'TAO_UPDATE_STORAGE')
  const port = parsePort(environment['PORT'] ?? '8787')
  const service = createUpdateService({
    authorize: candidate => tokensEqual(candidate, token),
    publicBaseUrl,
    store: new FilesystemUpdateStore(storageRoot),
  })
  const server = startBunUpdateServer({
    hostname: environment['HOST'] ?? '127.0.0.1',
    port,
    service,
  })
  HCI.writeLine(`Tao update server listening on ${server.url.origin}.`)
}

function requiredEnvironment(environment: Platform.ProcessEnv, name: string): string {
  const value = environment[name]?.trim() ?? ''
  if (value.length === 0) {
    Errors.throwUserInput(`Set ${name} before starting the Tao update server.`)
  }
  return value
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    Errors.throwUserInput(`Update server port '${value}' must be an integer from 1 through 65535.`)
  }
  return port
}

function tokensEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}
