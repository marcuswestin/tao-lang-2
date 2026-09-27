#!/usr/bin/env bun
import { Errors, FS, HCI, Platform } from '@shared'
import { accountPolicyFromJSON } from './AccountPolicy'
import { AccountServer, type AccountServerOptions } from './AccountServer'
import { publishAccountServerReadiness } from './AccountServerReadiness'
import { type ClerkAccountOptions, validateClerkAccountOptions } from './ClerkAccountIdentity'

/** startAccountServerFromArguments starts only from an explicit trusted policy file. */
export async function startAccountServerFromArguments(args: readonly string[]): Promise<AccountServer> {
  const values = new Map<string, string>()
  const allowedOrigins: string[] = []
  const names = [
    '--policy',
    '--database',
    '--port',
    '--host',
    '--resource',
    '--issuer',
    '--origin',
    '--ready-file',
    '--instant-config',
    '--clerk-config',
  ]
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!
    const value = args[index + 1]
    if (!names.includes(name) || value === undefined || value.startsWith('--') || value.trim() === '') {
      Errors.throwUserInput(
        'Use --policy PATH [--database PATH] [--host HOST] [--port PORT] [--resource NAME] [--issuer NAME] [--origin URL] [--instant-config PATH] [--clerk-config PATH].',
      )
    }
    if (name === '--origin') {
      allowedOrigins.push(new URL(value).origin)
    } else {
      if (values.has(name)) {
        Errors.throwUserInput(`Account server option '${name}' was repeated.`)
      }
      values.set(name, value)
    }
  }
  const policyPath = values.get('--policy')
  if (policyPath === undefined) {
    Errors.throwUserInput('Pass --policy with the compiler-emitted TaoDataPolicy.json path.')
  }
  const port = Number(values.get('--port') ?? '4738')
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    Errors.throwUserInput('Account server port must be an integer from 0 through 65535.')
  }
  const resource = values.get('--resource') ?? 'auth-review'
  const instantPath = values.get('--instant-config')
  const instant = instantPath === undefined ? undefined : await readInstantConfiguration(instantPath)
  const clerkPath = values.get('--clerk-config')
  const clerk = clerkPath === undefined ? undefined : await readClerkConfiguration(clerkPath)
  const server = await AccountServer.start({
    allowedOrigins,
    databasePath: FS.resolvePath(values.get('--database') ?? '.artifacts/auth-review/accounts.sqlite'),
    host: values.get('--host') ?? '127.0.0.1',
    issuer: values.get('--issuer') ?? `tao-local:${resource}`,
    ...(instant === undefined ? {} : { instant }),
    ...(clerk === undefined ? {} : { clerk }),
    policy: accountPolicyFromJSON(await FS.readJson<unknown>(FS.resolvePath(policyPath))),
    port,
    resource,
  })
  const readyPath = values.get('--ready-file')
  try {
    if (readyPath !== undefined) {
      await publishAccountServerReadiness(FS.resolvePath(readyPath), { resource, url: server.url })
    }
    return server
  } catch (error) {
    await server.stop()
    throw error
  }
}

async function readClerkConfiguration(path: string): Promise<ClerkAccountOptions> {
  let value: unknown
  try {
    value = await FS.readJson<unknown>(FS.resolvePath(path))
  } catch {
    Errors.throwUserInput(
      'Unable to read the Clerk configuration file. Provide a JSON file with issuer, jwtKey, and authorizedParties.',
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    Errors.throwUserInput(
      'Clerk configuration must contain issuer, jwtKey, and authorizedParties, with optional audience and allowMissingAuthorizedPartyWithoutOrigin.',
    )
  }
  const configuration = value as Record<string, unknown>
  const required = ['issuer', 'jwtKey', 'authorizedParties']
  if (
    required.some(key => !Object.hasOwn(configuration, key))
    || Object.keys(configuration).some(key =>
      ![...required, 'audience', 'allowMissingAuthorizedPartyWithoutOrigin'].includes(key)
    )
  ) {
    Errors.throwUserInput(
      'Clerk configuration must contain only issuer, jwtKey, authorizedParties, and optional audience and allowMissingAuthorizedPartyWithoutOrigin.',
    )
  }
  const options = configuration as ClerkAccountOptions
  validateClerkAccountOptions(options)
  return options
}

async function readInstantConfiguration(path: string): Promise<NonNullable<AccountServerOptions['instant']>> {
  let value: unknown
  try {
    value = await FS.readJson<unknown>(FS.resolvePath(path))
  } catch {
    Errors.throwUserInput(
      'Unable to read the Instant configuration file. Provide a JSON file with apiURI, appId, and adminToken.',
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    Errors.throwUserInput('Instant configuration must contain apiURI, appId, and adminToken.')
  }
  const configuration = value as Record<string, unknown>
  const keys = ['apiURI', 'appId', 'adminToken']
  if (
    Object.keys(configuration).length !== keys.length
    || keys.some(key => typeof configuration[key] !== 'string' || (configuration[key] as string).trim() === '')
  ) {
    Errors.throwUserInput('Instant configuration must contain only nonempty apiURI, appId, and adminToken strings.')
  }
  return configuration as NonNullable<AccountServerOptions['instant']>
}

if (import.meta.main) {
  try {
    const server = await startAccountServerFromArguments(Platform.runtimeProcess.argv.slice(2))
    const stop = (): void => {
      void server.stop().then(() => Platform.runtimeProcess.exit(0)).catch(error => {
        HCI.writeLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      })
    }
    Platform.onProcessSignal('SIGINT', stop)
    Platform.onProcessSignal('SIGTERM', stop)
    HCI.writeLine(`Tao account reference server listening on ${server.url}.`)
  } catch (error) {
    HCI.writeLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}
