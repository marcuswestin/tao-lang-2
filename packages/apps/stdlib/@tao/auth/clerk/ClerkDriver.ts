import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'

export type ClerkDriverSession = Readonly<{ id: string; userId: string; getToken(): Promise<string | null> }>
export type ClerkDriverResult =
  | { status: 'complete'; session: ClerkDriverSession }
  | { status: 'challenge'; id: string; kind: 'EmailCode' }
  | { status: 'unsupported'; message: string }
export type ClerkDriver = {
  restore(signal: AbortSignal): Promise<ClerkDriverSession | null>
  signIn(input: TR.AuthInput, signal: AbortSignal): Promise<ClerkDriverResult>
  signOut(sessionId: string | undefined): Promise<void>
  subscribe(listener: (session: ClerkDriverSession | null) => void): () => void
  close(): void
}

export class ClerkRevocationError extends Errors.HostEnvironmentError {
  constructor(readonly sessionId: string) {
    super('The cancelled session could not be signed out. Revocation must be retried.')
  }
}

export class ClerkSignInRejectedError extends Errors.UserInputError {
  constructor() {
    super('The sign-in details were not accepted. Check them and try again.')
  }
}

type Session = {
  id: string
  status: string
  currentTask?: unknown
  user: { id: string } | null
  getToken(): Promise<string | null>
}
type SignIn = {
  id?: string
  status: string | null
  createdSessionId: string | null
  supportedSecondFactors: readonly { strategy: string; emailAddressId?: string }[] | null
  prepareSecondFactor(input: { strategy: 'email_code'; emailAddressId?: string }): Promise<SignIn>
  attemptSecondFactor(input: { strategy: 'email_code'; code: string }): Promise<SignIn>
  supportedFirstFactors: readonly { strategy: string; emailAddressId?: string }[] | null
  create(input: { identifier: string; password?: string; strategy?: 'password' }): Promise<SignIn>
  prepareFirstFactor(input: { strategy: 'email_code'; emailAddressId: string }): Promise<SignIn>
  attemptFirstFactor(input: { strategy: 'email_code'; code: string }): Promise<SignIn>
}
type SignUp = {
  id?: string
  status: string | null
  createdSessionId: string | null
  missingFields: readonly string[]
  unverifiedFields: readonly string[]
  create(input: { emailAddress: string; password?: string }): Promise<SignUp>
  prepareEmailAddressVerification(input: { strategy: 'email_code' }): Promise<SignUp>
  attemptEmailAddressVerification(input: { code: string }): Promise<SignUp>
}
/** Structural subset of useClerk's public SDK, also used by the focused driver tests. */
export type ClerkDriverSDK = {
  loaded: boolean
  client?: { signIn: SignIn; signUp: SignUp; sessions: readonly Session[] }
  session?: Session | null
  setActive(input: { session: string; navigate: () => Promise<void> }): Promise<void>
  signOut(callback: () => Promise<void>, input: { sessionId: string }): Promise<void>
  addListener(listener: () => void): () => void
}
type Rendezvous = {
  sdk?: ClerkDriverSDK
  host?: object
  driver?: object
  changed: Set<() => void>
  operations: number
  idle: Set<() => void>
  rejectsInput?: (error: unknown) => boolean
}
const hosts = new WeakMap<object, Rendezvous>()
const clients = new WeakMap<object, object>()
function rendezvous(configuration: object): Rendezvous {
  let entry = hosts.get(configuration)
  if (!entry) {
    entry = { changed: new Set(), operations: 0, idle: new Set() }
    hosts.set(configuration, entry)
  }
  return entry
}

export function releaseClerkHostWhenIdle(configuration: object, release: () => void): void {
  const entry = rendezvous(configuration)
  if (entry.operations === 0) {
    release()
  } else {
    entry.idle.add(release)
  }
}

/** A host owns its SDK client exclusively; another mounted app cannot overwrite its attempt. */
export function bindClerkDriverHost(
  configuration: object,
  sdk: ClerkDriverSDK,
  rejectsInput?: (error: unknown) => boolean,
): () => void {
  const entry = rendezvous(configuration)
  Assert.input(!entry.host, 'This Clerk configuration is already mounted in another app.')
  Assert.input(sdk.loaded && sdk.client, 'Clerk has not finished loading.')
  const client = sdk.client
  Assert.input(!clients.has(client) && !clients.has(sdk), 'This Clerk client is already used by another mounted app.')
  const owner = {}
  clients.set(client, owner)
  clients.set(sdk, owner)
  entry.host = owner
  entry.sdk = sdk
  entry.rejectsInput = rejectsInput
  for (const changed of entry.changed) {
    changed()
  }
  return () => {
    if (entry.host !== owner) {
      return
    }
    entry.host = undefined
    entry.sdk = undefined
    // SDK requests cannot be cancelled; hold ownership until late completions are revoked.
    releaseClerkHostWhenIdle(configuration, () => {
      if (clients.get(client) === owner) {
        clients.delete(client)
      }
      if (clients.get(sdk) === owner) {
        clients.delete(sdk)
      }
    })
    for (const changed of entry.changed) {
      changed()
    }
  }
}

export function createClerkDriver(configuration: Readonly<Record<string, unknown>>): ClerkDriver {
  const entry = rendezvous(configuration)
  Assert.input(!entry.driver, 'This Clerk configuration already has an authentication connection.')
  const owner = {}
  entry.driver = owner
  let sdk: ClerkDriverSDK | undefined
  let closed = false
  let busy = false
  let unsubscribe: (() => void) | undefined
  let challenge: { id: string; signIn?: SignIn; signUp?: SignUp; secondFactor?: boolean } | undefined
  const listeners = new Set<(session: ClerkDriverSession | null) => void>()
  const closing = new AbortController()
  const unsupported = (): ClerkDriverResult => ({
    status: 'unsupported',
    message: 'This account requires a verification step that this app does not support.',
  })
  function session(value: Session | null | undefined): ClerkDriverSession | null {
    if (!value || value.status !== 'active' || value.currentTask || !value.user?.id) {
      return null
    }
    return { id: value.id, userId: value.user.id, getToken: () => value.getToken() }
  }
  function check(signal: AbortSignal, expected = sdk) {
    if (closed || signal.aborted || (expected && entry.sdk !== expected)) {
      throw Errors.abortError('The authentication request was cancelled.')
    }
  }
  function release() {
    if (entry.operations === 0) {
      for (const idle of entry.idle) {
        idle()
      }
      entry.idle.clear()
      if (closed && entry.driver === owner) {
        entry.driver = undefined
      }
    }
  }
  async function ready(signal: AbortSignal): Promise<ClerkDriverSDK> {
    check(signal)
    if (!entry.sdk) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          entry.changed.delete(changed)
          signal.removeEventListener('abort', cancel)
          closing.signal.removeEventListener('abort', cancel)
        }
        const cancel = () => {
          cleanup()
          reject(Errors.abortError('The authentication request was cancelled.'))
        }
        const changed = () => {
          if (entry.sdk) {
            cleanup()
            resolve()
          }
        }
        entry.changed.add(changed)
        signal.addEventListener('abort', cancel, { once: true })
        closing.signal.addEventListener('abort', cancel, { once: true })
        changed()
      })
    }
    check(signal)
    const loaded = entry.sdk!
    if (!sdk) {
      sdk = loaded
      unsubscribe = loaded.addListener(() => {
        // Activation is published only after the initiating operation survives cancellation.
        if (!closed && !busy && entry.sdk === loaded) {
          for (const listener of listeners) {
            listener(session(loaded.session))
          }
        }
      })
    }
    check(signal, loaded)
    return loaded
  }
  async function revoke(host: ClerkDriverSDK, sessionId: string) {
    try {
      // Tao owns navigation. Without a completion callback Clerk redirects and reloads the app.
      await host.signOut(async () => {}, { sessionId })
    } catch {
      const failure = new ClerkRevocationError(sessionId)
      throw failure
    }
  }
  async function complete(
    host: ClerkDriverSDK,
    attempt: SignIn | SignUp,
    signal: AbortSignal,
  ): Promise<ClerkDriverResult> {
    const id = attempt.createdSessionId
    if (attempt.status !== 'complete' || !id) {
      check(signal, host)
      return unsupported()
    }
    try {
      check(signal, host)
      // Pending tasks must never become a Tao principal, even if the attempt says complete.
      const created = host.client?.sessions.find(value => value.id === id)
      if (!session(created)) {
        await revoke(host, id)
        return unsupported()
      }
      await host.setActive({ session: id, navigate: async () => {} })
      check(signal, host)
      const active = session(host.session)
      if (!active || active.id !== id) {
        await revoke(host, id)
        return unsupported()
      }
      return { status: 'complete', session: active }
    } catch (error) {
      if (error instanceof ClerkRevocationError) {
        throw error
      }
      // Never sign out an unrelated, newer active session when an old operation finishes late.
      await revoke(host, id)
      throw error
    }
  }
  return {
    async restore(signal) {
      const host = await ready(signal)
      check(signal, host)
      return session(host.session)
    },
    async signIn(input, signal) {
      Assert.input(!busy, 'Wait for the current authentication request to finish before trying again.')
      busy = true
      entry.operations += 1
      try {
        const host = await ready(signal)
        check(signal, host)
        const client = host.client!
        if (input.method !== 'Password' && input.method !== 'EmailCode') {
          return unsupported()
        }
        if (input.challengeId) {
          const pending = challenge
          Assert.input(pending && pending.id === input.challengeId, 'This verification has expired. Start again.')
          const code = input.fields?.['Code'] ?? ''
          const attempt = pending.signUp
            ? await pending.signUp.attemptEmailAddressVerification({ code })
            : pending.secondFactor
            ? await pending.signIn!.attemptSecondFactor({ strategy: 'email_code', code })
            : await pending.signIn!.attemptFirstFactor({ strategy: 'email_code', code })
          const result = await complete(host, attempt, signal)
          if (result.status === 'complete') {
            challenge = undefined
          }
          return result
        }
        challenge = undefined
        const email = input.fields?.['Email'] ?? ''
        const password = input.method === 'Password' ? input.fields?.['Password'] ?? '' : undefined
        if (input.fields?.['Register'] === 'true') {
          const attempt = await client.signUp.create({
            emailAddress: email,
            ...(password === undefined ? {} : { password }),
          })
          if (attempt.status === 'complete') {
            return await complete(host, attempt, signal)
          }
          check(signal, host)
          if (
            attempt.missingFields.length || attempt.unverifiedFields.length !== 1
            || attempt.unverifiedFields[0] !== 'email_address'
          ) {
            return unsupported()
          }
          const prepared = await attempt.prepareEmailAddressVerification({ strategy: 'email_code' })
          check(signal, host)
          Assert.input(prepared.id, 'Unable to start email verification. Try again.')
          challenge = { id: prepared.id, signUp: prepared }
          return { status: 'challenge', id: prepared.id, kind: 'EmailCode' }
        }
        const attempt = await client.signIn.create({
          identifier: email,
          ...(password === undefined ? {} : { password, strategy: 'password' as const }),
        })
        if (attempt.status === 'complete') {
          return await complete(host, attempt, signal)
        }
        check(signal, host)
        if (attempt.status === 'needs_client_trust') {
          const factor = attempt.supportedSecondFactors?.find(value => value.strategy === 'email_code')
          if (!factor) {
            return unsupported()
          }
          const prepared = await attempt.prepareSecondFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId,
          })
          check(signal, host)
          Assert.input(prepared.id, 'Unable to start email verification. Try again.')
          challenge = { id: prepared.id, signIn: prepared, secondFactor: true }
          return { status: 'challenge', id: prepared.id, kind: 'EmailCode' }
        }
        if (input.method !== 'EmailCode' || attempt.status !== 'needs_first_factor') {
          return unsupported()
        }
        const factor = attempt.supportedFirstFactors?.find(value => value.strategy === 'email_code')
        if (!factor?.emailAddressId) {
          return unsupported()
        }
        const prepared = await attempt.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: factor.emailAddressId,
        })
        check(signal, host)
        Assert.input(prepared.id, 'Unable to start email verification. Try again.')
        challenge = { id: prepared.id, signIn: prepared }
        return { status: 'challenge', id: prepared.id, kind: 'EmailCode' }
      } catch (error) {
        if (!(error instanceof ClerkRevocationError) && entry.rejectsInput?.(error)) {
          const rejected = new ClerkSignInRejectedError()
          throw rejected
        }
        throw error
      } finally {
        busy = false
        entry.operations -= 1
        release()
      }
    },
    async signOut(sessionId) {
      challenge = undefined
      // No id means no owned session; SDK's no-argument signOut revokes every session.
      if (sessionId) {
        entry.operations += 1
        try {
          await (sdk ?? await ready(closing.signal)).signOut(async () => {}, { sessionId })
        } finally {
          entry.operations -= 1
          release()
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      closed = true
      challenge = undefined
      closing.abort()
      unsubscribe?.()
      listeners.clear()
      release()
    },
  }
}
