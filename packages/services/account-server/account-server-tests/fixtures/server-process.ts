import { Assert, FS, Platform } from '@shared'
import { AccountServer, type AccountServerOptions } from '../../account-server-src/AccountServer'

const [, , configuration, ready] = Platform.runtimeProcess.argv
Assert.defined(configuration, 'server process configuration path')
Assert.defined(ready, 'server process readiness path')
const server = await AccountServer.start(await FS.readJson<AccountServerOptions>(configuration))
await FS.writeJson(ready, { url: server.url })
