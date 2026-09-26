#!/usr/bin/env bun
import { Errors, FS, HCI, Platform } from '@shared'
import { accountPolicyFromJSON } from './AccountPolicy'
import { AccountServer } from './AccountServer'

/** startAccountServerFromArguments starts only from an explicit trusted policy file. */
export async function startAccountServerFromArguments(args: readonly string[]): Promise<AccountServer> {
  const values = new Map<string, string>()
  const allowedOrigins: string[] = []
  const names = ['--policy', '--database', '--port', '--resource', '--issuer', '--origin', '--ready-file']
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!
    const value = args[index + 1]
    if (!names.includes(name) || value === undefined || value.startsWith('--') || value.trim() === '') {
      Errors.throwUserInput(
        'Use --policy PATH [--database PATH] [--port PORT] [--resource NAME] [--issuer NAME] [--origin URL].',
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
  const server = await AccountServer.start({
    allowedOrigins,
    databasePath: FS.resolvePath(values.get('--database') ?? '.artifacts/auth-review/accounts.sqlite'),
    issuer: values.get('--issuer') ?? `tao-local:${resource}`,
    policy: accountPolicyFromJSON(await FS.readJson<unknown>(FS.resolvePath(policyPath))),
    port,
    resource,
  })
  const readyPath = values.get('--ready-file')
  try {
    if (readyPath !== undefined) {
      await FS.writeJson(FS.resolvePath(readyPath), { resource, url: server.url })
    }
    return server
  } catch (error) {
    await server.stop()
    throw error
  }
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
