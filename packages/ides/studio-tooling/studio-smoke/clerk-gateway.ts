import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time } from '@shared'
import type { ClerkInstantFixture } from './clerk-instant'
import { clerkChildEnvironment } from './clerk-testing-token'

/** Native acceptance admits only requests without browser Origin; browser acceptance pins its origin. */
export async function startClerkGateway(
  root: string,
  policy: string,
  configuration: { issuer: string; jwtKey: string },
  origin: string | undefined,
  instant: ClerkInstantFixture | undefined,
) {
  const policyPath = FS.resolvePath('TaoDataPolicy.json', root)
  const clerkPath = FS.resolvePath('clerk-public-trust.json', root)
  const readyPath = FS.resolvePath('gateway-ready.json', root)
  await FS.writeText(policyPath, policy)
  await FS.writeJson(clerkPath, {
    issuer: configuration.issuer,
    jwtKey: configuration.jwtKey,
    authorizedParties: [origin ?? configuration.issuer],
    ...(origin === undefined ? { allowMissingAuthorizedPartyWithoutOrigin: true } : {}),
  })
  const instantPath = FS.resolvePath('instant-private.json', root)
  if (instant !== undefined) {
    await FS.writeJson(instantPath, instant.instant, { mode: 0o600 })
  }
  const command = CLI.start(Repo.resolvePath('agent'), {
    args: [
      'auth-review-server',
      '--policy',
      policyPath,
      '--clerk-config',
      clerkPath,
      ...(instant === undefined ? [] : ['--instant-config', instantPath]),
      '--database',
      FS.resolvePath('accounts.sqlite', root),
      '--port',
      '0',
      '--resource',
      'auth-review',
      '--issuer',
      'tao-local:clerk-live',
      ...(origin === undefined ? [] : ['--origin', origin]),
      '--ready-file',
      readyPath,
    ],
    cwd: Repo.getRoot(),
    detached: true,
    stdio: 'pipe',
    env: clerkChildEnvironment(Platform.runtimeProcess.env),
  })
  const stop = async () => {
    await ProcessTree.stopTree(command.pid)
    await command.waitForClose()
    await command.closeOutput()
    command.dispose()
  }
  try {
    const ready = await Time.pollUntil(async () => {
      if (command.exitCode !== null || command.signalCode !== null || command.error !== undefined) {
        Errors.throwHostEnvironment('The Clerk account gateway exited before reporting readiness.')
      }
      if (!await FS.isFile(readyPath)) {
        return undefined
      }
      return await FS.readJson<{ resource: string; url: string }>(readyPath)
    }, { timeoutMs: 60_000, intervalMs: 100 })
    if (!ready || ready.resource !== 'auth-review' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.url)) {
      Errors.throwHostEnvironment('The Clerk account gateway did not report its localhost URL.')
    }
    return { url: ready.url, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
