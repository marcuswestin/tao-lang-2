import Compiler from '@compiler'
import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { accountPolicyFromJSON } from '../account-server-src/AccountPolicy'
import { AccountServer } from '../account-server-src/AccountServer'
import { runAuthReviewJourney } from './fixtures/auth-review-journey'

Describe('Auth Review with the local authority', () => {
  Test('runs the Tao review app against real password verification and durable account data', async () => {
    const root = await mkTestDir('tao-auth-review-http-', { location: 'host' })
    const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
    const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewLocal' })
    const metadata = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
    Expect(metadata).toBeDefined()
    const server = await AccountServer.start({
      databasePath: FS.resolvePath('accounts.sqlite', root),
      issuer: 'tao-local:auth-review',
      policy: accountPolicyFromJSON(JSON.parse(metadata!.code)),
      port: 0,
      resource: 'auth-review',
    })
    try {
      await runAuthReviewJourney(root, source, server)
    } finally {
      await server.stop()
      await FS.remove(root)
    }
  }, 120_000)
})
