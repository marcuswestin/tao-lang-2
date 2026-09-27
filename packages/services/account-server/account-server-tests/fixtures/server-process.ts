import { Assert, FS, Platform } from '@shared'
import { AccountServer, type AccountServerOptions } from '../../account-server-src/AccountServer'
import { publishAccountServerReadiness } from '../../account-server-src/AccountServerReadiness'

const [, , configuration, ready] = Platform.runtimeProcess.argv
Assert.defined(configuration, 'server process configuration path')
Assert.defined(ready, 'server process readiness path')
const server = await AccountServer.start(await FS.readJson<AccountServerOptions>(configuration))
try {
  await publishAccountServerReadiness(ready, { url: server.url })
} catch (error) {
  await server.stop()
  throw error
}
