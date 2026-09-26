import { Assert, CLI, Errors, FS, Platform, Repo } from '@shared'
import { until } from '@shared/test'
import type { AccountServerOptions } from '../../account-server-src/AccountServer'

/** Launch the real command parser and retain the owned process handle for crash/lock assertions. */
export async function startInstantCli(options: AccountServerOptions, root: string) {
  Assert.defined(options.instant, 'Instant CLI deployment configuration')
  const policy = FS.resolvePath('TaoDataPolicy.json', root)
  const credentials = FS.resolvePath('instant.json', root)
  const ready = FS.resolvePath('ready.json', root)
  await FS.writeJson(policy, options.policy)
  await FS.writeJson(credentials, options.instant, { mode: 0o600 })
  let output = ''
  const child = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      'run',
      Repo.resolvePath('packages/services/account-server/account-server-src/serve.ts'),
      '--policy',
      policy,
      '--database',
      options.databasePath,
      '--issuer',
      options.issuer,
      '--resource',
      options.resource,
      '--instant-config',
      credentials,
      '--port',
      '0',
      '--ready-file',
      ready,
    ],
    onOutput: (_stream, chunk) => {
      output += chunk.toString()
    },
    processPolicy: 'server',
    stdio: 'pipe',
  })
  let closed = false
  async function stop(crash = false) {
    if (closed) {
      return
    }
    closed = true
    child.kill(crash ? 'SIGKILL' : 'SIGTERM')
    await child.waitForClose()
    await child.closeOutput()
    child.dispose()
  }
  try {
    await until(async () => {
      if (child.exitCode !== null || child.error !== undefined) {
        Errors.throwHostEnvironment(`Instant CLI fixture exited: ${output}`)
      }
      return await FS.isFile(ready)
    }, { description: 'Instant CLI fixture readiness' })
    const { url } = await FS.readJson<{ url: string }>(ready)
    return { url, stop, crash: () => stop(true) }
  } catch (error) {
    await stop()
    throw error
  }
}
