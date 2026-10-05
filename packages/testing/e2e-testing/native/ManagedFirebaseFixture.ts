import type { HostObservation, HostSession, HostTarget } from '@host-control'
import { Errors, FS, Platform, Time } from '@shared'
import type { ManagedMobileGrant } from './ManagedMobileGrant'

/** Fixed sample-account shortcuts only; credentials never enter the driver or evidence. */
export type ManagedFirebaseWeb = {
  createCrudAccount: () => Promise<'created' | 'existing-account-signin'>
  signInMainAccount: () => Promise<void>
  createItem: (marker: string) => Promise<void>
  observeItem: (marker: string) => Promise<string>
  screenshot: (name: string) => Promise<string>
  close: () => Promise<void>
}

export type ManagedFirebaseEvidence = {
  nativeMarker: string
  webMarker: string
  accounts: readonly {
    surface: 'web' | 'ios'
    sample: 'crud' | 'main'
    result: 'created' | 'existing-account-signin' | 'signed-in'
  }[]
  observations: readonly { surface: 'web' | 'ios'; marker: string; text: string }[]
  screenshots: readonly string[]
}

/** Cross-surface account creation and row propagation through real UI, under the existing grant. */
export async function runManagedFirebaseFixture(options: {
  grant: ManagedMobileGrant
  session: HostSession
  openWeb: () => Promise<ManagedFirebaseWeb>
  artifactRoot: string
}): Promise<ManagedFirebaseEvidence> {
  const { grant, session } = options
  if (grant.identity.target.platform !== 'ios' || grant.identity.runtime.appName !== 'FirebaseLiveAcceptance') {
    Errors.throwHostEnvironment('Firebase sync requires the selected FirebaseLiveAcceptance iOS runtime.')
  }
  const runtime = grant.identity.runtime
  const revision = { build: runtime.compiledRevision, source: runtime.sourceRevision }
  const observe = async (target: HostTarget): Promise<HostObservation> => {
    await grant.assertCurrent()
    const observation = await session.observe({ expectedRevision: revision, target })
    if (!observation.visible) {
      Errors.throwHostEnvironment('The Firebase acceptance control is not visible.')
    }
    return observation
  }
  const wait = async (target: HostTarget): Promise<HostObservation> => {
    const observation = await Time.pollUntil(async () => {
      try {
        return await observe(target)
      } catch (error) {
        await grant.assertCurrent()
        if (grant.signal.aborted) {
          throw error
        }
        return undefined
      }
    }, { timeoutMs: 30_000, intervalMs: 250 })
    if (observation === undefined) {
      Errors.throwHostEnvironment('Firebase acceptance did not reach its expected native control or exact item row.')
    }
    return observation
  }
  const click = async (tag: 'fillCrudAccount' | 'fillMainAccount' | 'createAccount' | 'signOut' | 'signIn') => {
    const observation = await wait({ kind: 'tag', value: tag })
    await grant.assertCurrent()
    await session.perform({ kind: 'click', observation, expectedRevision: revision, lease: session.descriptor().lease })
  }
  const inputTarget: HostTarget = {
    kind: 'scoped',
    scope: { kind: 'tag', value: 'itemTitle' },
    target: { kind: 'accessibility', role: 'textbox', name: '' },
  }
  const marker = `Firebase sync ${grant.identity.session.slice(0, 8)} ${Platform.randomUUID().slice(0, 8)}`
  const nativeMarker = `${marker} native`
  const webMarker = `${marker} web`
  const screenshots: string[] = []
  const observations: ManagedFirebaseEvidence['observations'][number][] = []
  const accounts: ManagedFirebaseEvidence['accounts'][number][] = []
  const web = await options.openWeb()
  try {
    // Each surface starts signed out; an already signed-in session is explicitly returned to the gate.
    const signedIn = await session.observe({ expectedRevision: revision, target: { kind: 'tag', value: 'signOut' } })
      .catch(async () => {
        await grant.assertCurrent()
        return undefined
      })
    if (signedIn?.visible) {
      await click('signOut')
    }
    accounts.push({ surface: 'web', sample: 'crud', result: await web.createCrudAccount() })
    await click('fillCrudAccount')
    await click('signIn')
    await wait(inputTarget)
    accounts.push({ surface: 'ios', sample: 'crud', result: 'signed-in' })
    screenshots.push((await session.captureScreenshot('firebase-native-crud-signed-in')).artifactPath)
    screenshots.push(await web.screenshot('firebase-web-crud-signed-in'))
    const input = await wait(inputTarget)
    await grant.assertCurrent()
    await session.perform({
      kind: 'type',
      observation: input,
      text: nativeMarker,
      expectedRevision: revision,
      lease: session.descriptor().lease,
    })
    const add = await wait({ kind: 'tag', value: 'addItem' })
    await grant.assertCurrent()
    await session.perform({
      kind: 'click',
      observation: add,
      expectedRevision: revision,
      lease: session.descriptor().lease,
    })
    const webRow = await web.observeItem(nativeMarker)
    if (webRow !== nativeMarker) {
      Errors.throwHostEnvironment('The web Firebase row did not exactly match the native-created marker.')
    }
    observations.push({ surface: 'web', marker: nativeMarker, text: webRow })
    screenshots.push(await web.screenshot('firebase-native-to-web'))
    await web.createItem(webMarker)
    const row = await wait({
      kind: 'scoped',
      scope: { kind: 'tag', value: 'items' },
      target: { kind: 'text', value: webMarker },
    })
    if (row.text !== webMarker) {
      Errors.throwHostEnvironment('The native Firebase row did not exactly match the web-created marker.')
    }
    observations.push({ surface: 'ios', marker: webMarker, text: row.text })
    await grant.assertCurrent()
    screenshots.push((await session.captureScreenshot('firebase-web-to-native')).artifactPath)
    await grant.assertCurrent()
    await FS.writeExclusiveFile(
      FS.resolvePath('firebase-crud-sync.json', options.artifactRoot),
      JSON.stringify({
        version: 1,
        classification: 'firebase-crud-sync',
        status: 'proved',
        accounts: [...accounts],
        nativeMarker,
        webMarker,
        observations: [...observations],
        screenshots: [...screenshots],
      }),
      { mode: 0o600 },
    )
    let mainStage: 'native-main-signout' | 'native-main-signup' | 'native-main-signin' | 'web-main-signin' =
      'native-main-signout'
    try {
      await click('signOut')
      mainStage = 'native-main-signup'
      await click('fillMainAccount')
      await click('createAccount')
      const account = await Time.pollUntil(async () => {
        try {
          await observe(inputTarget)
          return 'created' as const
        } catch {
          await grant.assertCurrent()
        }
        try {
          await observe({ kind: 'text', value: 'An account with this email already exists. Sign in instead.' })
          return 'existing-account-signin' as const
        } catch {
          await grant.assertCurrent()
          return undefined
        }
      }, { timeoutMs: 30_000, intervalMs: 250 })
      if (account === undefined) {
        Errors.throwHostEnvironment(
          'Firebase native signup reached neither account data nor the explicit existing-account notice.',
        )
      }
      if (account === 'existing-account-signin') {
        mainStage = 'native-main-signin'
        await click('signIn')
        await wait(inputTarget)
      }
      accounts.push({ surface: 'ios', sample: 'main', result: account })
      mainStage = 'web-main-signin'
      await web.signInMainAccount()
      accounts.push({ surface: 'web', sample: 'main', result: 'signed-in' })
    } catch (error) {
      try {
        await FS.writeExclusiveFile(
          FS.resolvePath('firebase-main-account-gate.json', options.artifactRoot),
          JSON.stringify({
            version: 1,
            classification: 'firebase-main-account-gate',
            status: 'failed',
            stage: mainStage,
          }),
          { mode: 0o600 },
        )
      } catch { /* The gate failure remains primary if its private metadata is unavailable. */ }
      Errors.throwHostEnvironment(`Firebase ${mainStage} gate failed after CRUD synchronization was proved.`, {
        cause: error,
      })
    }
    screenshots.push((await session.captureScreenshot('firebase-native-main-account')).artifactPath)
    screenshots.push(await web.screenshot('firebase-web-main-account'))
    return { nativeMarker, webMarker, accounts, observations, screenshots }
  } catch (error) {
    // Failures retain guarded visual evidence; an unavailable capture never replaces the original failure.
    try {
      await grant.assertCurrent()
      await session.captureScreenshot('firebase-native-failure')
    } catch { /* Revoked ownership or unavailable screenshots remain unproved. */ }
    try {
      await web.screenshot('firebase-web-failure')
    } catch { /* Page identity or screenshot availability may no longer be proved. */ }
    throw error
  } finally {
    await web.close()
  }
}
