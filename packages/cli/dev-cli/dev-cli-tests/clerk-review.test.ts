import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import { runClerkReview } from '../dev-cli-src/clerk/ClerkReviewCommand'

async function fixture() {
  const root = await mkTestDir('clerk-review-')
  const events: string[] = []
  const output: string[] = []
  const handlers = new Map<string, () => void>()
  let gatewayOptions: Parameters<NonNullable<Parameters<typeof runClerkReview>[1]>['gateway']>[0] | undefined
  let source = ''
  const environment: NonNullable<Parameters<typeof runClerkReview>[1]> = {
    secrets: async () => ({
      CLERK_PUBLISHABLE_KEY: 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk',
      CLERK_JWT_KEY: 'public-signing-key',
      CLERK_SECRET_KEY: 'sk_test_never_forward',
    }),
    host: async () => '192.168.1.8',
    startInstant: async () => {
      events.push('start-instant')
    },
    createInstant: async url => {
      Expect(url).toBe('http://127.0.0.1:9020')
      events.push('create-instant')
      return { app: { id: 'review-app', 'admin-token': 'private-instant-token' }, expires_ms: 123456 }
    },
    project: async () => root,
    writeOwnership: FS.writeJson,
    compilePolicy: async () => ({ version: 1, accountEntity: 'Account', entities: {} }),
    gateway: async options => {
      gatewayOptions = options
      events.push('gateway')
      return {
        url: 'http://192.168.1.8:12345',
        stop: async () => {
          events.push('stop-gateway')
        },
      }
    },
    loadStudio: async () => async options => {
      events.push('studio')
      Expect(options.appName).toBe('AuthReviewClerk')
      Expect(options.projectRoot).toBe(root)
      Expect(options.json).toBe(true)
      source = await FS.readText(options.entryPath!)
      return 0
    },
    write: message => {
      output.push(message)
    },
    onSignal: (signal, handler) => {
      handlers.set(signal, handler)
      return () => {
        handlers.delete(signal)
      }
    },
  }
  return { root, events, output, handlers, environment, options: () => gatewayOptions, source: () => source }
}

Test('phone review uses a private ephemeral gateway and removes its source after Studio exits', async () => {
  const f = await fixture()
  Expect(await runClerkReview({ browser: false }, f.environment)).toBe(0)
  Expect(f.events).toEqual(['start-instant', 'create-instant', 'gateway', 'studio', 'stop-gateway'])
  Expect(f.options()?.host).toBe('192.168.1.8')
  Expect(f.options()?.instant).toEqual({
    apiURI: 'http://127.0.0.1:9020',
    appId: 'review-app',
    adminToken: 'private-instant-token',
  })
  Expect(f.options()?.clerk?.allowMissingAuthorizedPartyWithoutOrigin).toBe(true)
  Expect(f.options()?.allowedOrigins).toEqual([])
  Expect(f.source()).toContain('http://192.168.1.8:12345')
  Expect(f.source()).not.toContain('pk_test_REPLACE_WITH_YOUR_KEY')
  Expect(f.source()).not.toContain('private-instant-token')
  Expect(f.source()).not.toContain('sk_test_never_forward')
  Expect(f.output.join('\n')).not.toContain('private-instant-token')
  Expect(f.output.join('\n')).not.toContain('sk_test_never_forward')
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
})

Test('Studio startup failure stops the gateway and removes source without printing private details', async () => {
  const f = await fixture()
  f.environment.loadStudio = async () => async () => Errors.throwHostEnvironment('private-instant-token')
  Expect(await runClerkReview({}, f.environment)).toBe(1)
  Expect(f.events).toContain('stop-gateway')
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.output.join('\n')).toContain('run Studio phone review')
  Expect(f.output.join('\n')).not.toContain('private-instant-token')
})

Test('gateway failure removes the prepared source without starting Studio', async () => {
  const f = await fixture()
  f.environment.gateway = async () => Errors.throwHostEnvironment('private-instant-token')
  Expect(await runClerkReview({}, f.environment)).toBe(1)
  Expect(f.events).not.toContain('studio')
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.output.join('\n')).not.toContain('private-instant-token')
})

Test('interruption during preparation cancels before allocating the disposable app', async () => {
  const f = await fixture()
  f.environment.startInstant = async () => {
    f.handlers.get('SIGINT')!()
  }
  try {
    Expect(await runClerkReview({}, f.environment)).toBe(130)
    Expect(f.events).toEqual([])
    Expect(f.handlers.size).toBe(0)
  } finally {
    await FS.remove(f.root)
  }
})

Test('interruption during lazy Studio initialization never starts Studio and cleans up the gateway', async () => {
  const f = await fixture()
  const initializing = Deferred()
  const release = Deferred()
  const loadStudio = f.environment.loadStudio
  f.environment.loadStudio = async () => {
    initializing.resolve()
    await release.promise
    return await loadStudio()
  }
  const running = runClerkReview({}, f.environment)
  await initializing.promise
  f.handlers.get('SIGINT')!()
  release.resolve()
  Expect(await running).toBe(130)
  Expect(f.events).toEqual(['start-instant', 'create-instant', 'gateway', 'stop-gateway'])
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
})

Test('ownership finalization failure returns a sanitized failure and still removes signal handlers', async () => {
  const f = await fixture()
  let writes = 0
  f.environment.writeOwnership = async (path, ownership) => {
    if (++writes === 2) {
      Errors.throwHostEnvironment('private-instant-token')
    }
    await FS.writeJson(path, ownership)
  }
  Expect(await runClerkReview({}, f.environment)).toBe(1)
  Expect(f.events).toContain('stop-gateway')
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
  Expect(f.output.join('\n')).toContain('could not finalize its ownership record')
  Expect(f.output.join('\n')).not.toContain('private-instant-token')
})

Test('nonlocal Instant endpoints and loopback phone hosts fail before loading credentials', async () => {
  const f = await fixture()
  f.environment.secrets = async () => Errors.throwUnexpected('Must not load credentials')
  try {
    await Expect(runClerkReview({ instantUrl: 'https://api.instantdb.com' }, f.environment)).rejects.toThrow(
      'localhost HTTP',
    )
    await Expect(runClerkReview({ host: '127.0.0.1' }, f.environment)).rejects.toThrow('reachable LAN IPv4')
    Expect(f.events).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})
