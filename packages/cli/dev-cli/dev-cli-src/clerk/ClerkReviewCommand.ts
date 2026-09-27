import type { AccountServerOptions } from '@account-server'
import { CLI, Errors, FS, HCI, Json, Platform, Repo, SecretsFile } from '@shared'
import type { StudioDevOptions } from '@studio-tooling/StudioDev'

type ReviewOptions = { host?: string; instantUrl?: string; browser?: boolean; device?: string }
type ReviewEnvironment = {
  secrets: typeof SecretsFile.readDecryptedSecrets
  host: () => Promise<string>
  startInstant: () => Promise<void>
  createInstant: (url: string) => Promise<unknown>
  compilePolicy: (source: string) => Promise<AccountServerOptions['policy']>
  gateway: (options: AccountServerOptions) => Promise<{ url: string; stop: () => Promise<void> }>
  loadStudio: () => Promise<(options: StudioDevOptions) => Promise<number>>
  project: () => Promise<string>
  writeOwnership: (path: string, ownership: Record<string, unknown>) => Promise<void>
  write: (message: string) => void
  onSignal: typeof Platform.onProcessSignal
}

function liveEnvironment(): ReviewEnvironment {
  return {
    secrets: SecretsFile.readDecryptedSecrets,
    host: async () => {
      const { detectLanIPv4 } = await import('@expo-host/dev-loop/expo-runner/lan-host')
      return await detectLanIPv4()
    },
    startInstant: async () => {
      await CLI.mustRun(Repo.resolvePath('agent'), {
        args: ['unsandboxed', 'local-instantdb', 'start'],
        cwd: Repo.getRoot(),
        stdio: 'inherit',
      })
    },
    createInstant: async url => {
      const response = await fetch(`${url}/dash/apps/ephemeral`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000) as NonNullable<Parameters<typeof fetch>[1]>['signal'],
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `Tao Clerk phone review ${Platform.randomUUID()}`,
          rules: { code: { $default: { allow: { $default: 'false' } } } },
        }),
      })
      if (!response.ok) {
        Errors.throwHostEnvironment('Local InstantDB did not create a disposable review app.')
      }
      return await response.json()
    },
    compilePolicy: async source => {
      const { default: Compiler } = await import('@compiler')
      const { accountPolicyFromJSON } = await import('@account-server')
      const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewClerk' })
      const policy = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
      if (policy === undefined) {
        Errors.throwUnexpected('Auth Review must emit an account data policy.')
      }
      return accountPolicyFromJSON(JSON.parse(policy.code))
    },
    gateway: async options => {
      const { AccountServer } = await import('@account-server')
      return await AccountServer.start(options)
    },
    loadStudio: async () => {
      const { runStudioDev } = await import('@studio-tooling/StudioDev')
      return runStudioDev
    },
    // Source discovery honors Git ignores, so this source cannot live under .artifacts.
    project: async () => await FS.mkTmpDir('tao-clerk-phone-'),
    writeOwnership: FS.writeJson,
    write: message => HCI.writeLine(message),
    onSignal: Platform.onProcessSignal,
  }
}

/** Own a foreground phone review; private gateway credentials never enter files or child environments. */
export async function runClerkReview(
  options: ReviewOptions = {},
  environment: ReviewEnvironment = liveEnvironment(),
): Promise<number> {
  if (options.device !== undefined && options.device.trim() === '') {
    Errors.throwUserInput('--device requires a physical device name or UDID.')
  }
  const endpoint = URL.parse(options.instantUrl ?? 'http://127.0.0.1:9020')
  if (
    endpoint === null || endpoint.protocol !== 'http:'
    || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username !== '' || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== ''
    || endpoint.pathname !== '/'
  ) {
    Errors.throwUserInput('--instant-url requires a localhost HTTP origin without credentials.')
  }
  const host = options.host ?? await environment.host()
  const octets = host.split('.').map(Number)
  if (
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) || octets.some(value => value < 0 || value > 255)
    || octets[0] === 0 || octets[0] === 127 || octets[0]! >= 224
  ) {
    Errors.throwUserInput('Clerk phone review needs a reachable LAN IPv4 address; pass --host <address>.')
  }
  let stage = 'load development Clerk configuration'
  let projectRoot: string | undefined
  let gateway: Awaited<ReturnType<ReviewEnvironment['gateway']>> | undefined
  let signalCode: number | undefined
  const removeSignals = (['SIGHUP', 'SIGINT', 'SIGTERM'] as const).map((signal, index) =>
    environment.onSignal(signal, () => {
      signalCode = [129, 130, 143][index]
    })
  )
  const checkpoint = () => {
    if (signalCode !== undefined) {
      Errors.throwHostEnvironment('Clerk review startup was cancelled.')
    }
  }
  const ownershipPath = Repo.resolvePath(`.artifacts/auth/clerk-review/${Platform.randomUUID()}.json`)
  let ownership: Record<string, unknown> | undefined
  let exitCode = 1
  try {
    const stored = await environment.secrets()
    const publishableKey = stored['CLERK_PUBLISHABLE_KEY'] ?? ''
    const jwtKey = stored['CLERK_JWT_KEY'] ?? ''
    const decoded = publishableKey.startsWith('pk_test_')
      ? Buffer.from(publishableKey.slice(8), 'base64').toString('utf8')
      : ''
    const issuerHost = decoded.endsWith('$') ? decoded.slice(0, -1) : ''
    if (!/^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(issuerHost) || !jwtKey.trim()) {
      Errors.throwUserInput(
        'Configure development Clerk keys with just setup-clerk and materialize them with just secrets.',
      )
    }
    checkpoint()
    stage = 'start local InstantDB'
    await environment.startInstant()
    checkpoint()
    stage = 'create disposable InstantDB app'
    const created = await environment.createInstant(endpoint.origin)
    if (
      !Json.isRecord(created) || !Json.isRecord(created['app'])
      || typeof created['app']['id'] !== 'string' || !created['app']['id']
      || typeof created['app']['admin-token'] !== 'string' || !created['app']['admin-token']
      || typeof created['expires_ms'] !== 'number' || !Number.isFinite(created['expires_ms'])
    ) {
      Errors.throwHostEnvironment('Local InstantDB returned an invalid disposable app.')
    }
    checkpoint()
    stage = 'prepare disposable Auth Review project'
    projectRoot = await environment.project()
    await FS.chmod(projectRoot, 0o700)
    ownership = {
      path: projectRoot,
      owner: 'clerk-review',
      purpose: 'Disposable Auth Review source and trusted gateway database',
      cleanup: 'Removed when the foreground review exits; ephemeral Instant app expires automatically.',
      appId: created['app']['id'],
      expires_ms: created['expires_ms'],
      state: 'active',
    }
    await environment.writeOwnership(ownershipPath, ownership)
    const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
    const policy = await environment.compilePolicy(source)
    checkpoint()
    stage = 'start trusted LAN account gateway'
    gateway = await environment.gateway({
      host,
      port: 0,
      databasePath: FS.resolvePath('accounts.sqlite', projectRoot),
      issuer: 'tao-local:clerk-phone-review',
      resource: 'auth-review',
      policy,
      allowedOrigins: [],
      clerk: {
        issuer: `https://${issuerHost}`,
        jwtKey,
        authorizedParties: [`https://${issuerHost}`],
        allowMissingAuthorizedPartyWithoutOrigin: true,
      },
      instant: { apiURI: endpoint.origin, appId: created['app']['id'], adminToken: created['app']['admin-token'] },
    })
    checkpoint()
    await FS.writeText(
      FS.resolvePath('Auth Review.tao', projectRoot),
      source.replaceAll('pk_test_REPLACE_WITH_YOUR_KEY', publishableKey)
        .replaceAll('http://127.0.0.1:4738', gateway.url),
    )
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-clerk-phone-review" name "Clerk phone review" }\n',
    )
    environment.write(`Clerk phone review gateway: ${gateway.url}`)
    environment.write(
      options.device === undefined
        ? 'Keep the Mac and iPhone on the same LAN. In Studio, open Devices and launch AuthReviewClerk on the connected iPhone; use a development Clerk account. Studio prints its session and preview URLs below.'
        : `Keep the Mac and iPhone on the same LAN. Studio will launch AuthReviewClerk on ${options.device}; keep the phone unlocked and compare any pairing code shown in this terminal.`,
    )
    environment.write('Sign in on the iPhone; Mac preview authentication is not enabled for this review.')
    environment.write(
      'Press Ctrl+C to stop Studio and the gateway and remove this review project. The shared local InstantDB stack stays running; its disposable app expires automatically.',
    )
    checkpoint()
    stage = 'run Studio phone review'
    const runStudio = await environment.loadStudio()
    // Studio registers its signal handlers synchronously on entry. Recheck after its lazy import,
    // then enter it without yielding, so no signal can be lost during the ownership handoff.
    checkpoint()
    exitCode = await runStudio({
      appName: 'AuthReviewClerk',
      browser: options.device === undefined ? options.browser : false,
      device: options.device,
      entryPath: FS.resolvePath('Auth Review.tao', projectRoot),
      projectRoot,
      json: true,
    })
  } catch {
    if (signalCode === undefined) {
      // Provider, compiler and network failures can embed credentials or response bodies.
      environment.write(
        `Clerk phone review failed during: ${stage}. Check local setup and retry; private error details were omitted.`,
      )
      if (stage === 'load development Clerk configuration') {
        environment.write(
          'Configure development Clerk keys with just setup-clerk; if needed, materialize stored credentials with just secrets.',
        )
      }
    }
  } finally {
    let cleanupFailed = false
    for (
      const cleanup of [
        async () => await gateway?.stop(),
        async () => {
          if (projectRoot !== undefined) {
            await FS.remove(projectRoot)
          }
        },
      ]
    ) {
      try {
        await cleanup()
      } catch {
        exitCode = 1
        cleanupFailed = true
        environment.write(`Clerk review cleanup failed; inspect the ownership record at ${ownershipPath}.`)
      }
    }
    try {
      if (ownership !== undefined) {
        await environment.writeOwnership(ownershipPath, {
          ...ownership,
          state: cleanupFailed || await FS.exists(projectRoot!) ? 'cleanup-required' : 'removed',
        })
      }
    } catch {
      exitCode = 1
      environment.write(
        `Clerk review could not finalize its ownership record at ${ownershipPath}; private error details were omitted.`,
      )
    } finally {
      for (const remove of removeSignals) {
        remove()
      }
    }
  }
  return signalCode ?? exitCode
}
