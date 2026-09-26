import { Assert, FS, Platform } from '@shared'
import { AccountServer, type AccountServerOptions } from '../../account-server-src/AccountServer'

const [, , configuration, ready] = Platform.runtimeProcess.argv
Assert.defined(configuration, 'server process configuration path')
Assert.defined(ready, 'server process readiness path')
const server = await AccountServer.start(await FS.readJson<AccountServerOptions>(configuration))
// The parent treats file existence as readiness, so publish only the complete JSON document.
const temporary = `${ready}.${Platform.randomUUID()}.tmp`
try {
  await FS.writeJson(temporary, { url: server.url })
  await FS.move(temporary, ready)
} finally {
  await FS.remove(temporary)
}
