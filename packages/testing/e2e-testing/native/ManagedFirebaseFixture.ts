import { AppiumNoSuchElementError } from '@appium-driver'
import { HostControlError, type HostObservation, type HostSession, type HostTarget } from '@host-control'
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
  let stage:
    | 'native-runtime-tutorial'
    | 'native-runtime-menu'
    | 'native-data-load'
    | 'native-initial-signout'
    | 'web-crud-signup'
    | 'native-crud-fill'
    | 'native-crud-signin'
    | 'native-crud-item-title'
    | 'native-crud-create'
    | 'web-observe-native-item'
    | 'web-crud-create'
    | 'native-observe-web-item'
    | 'crud-sync-artifact'
    | 'main-account-gate' = 'native-runtime-tutorial'
  let stageTarget = 'Tao Runtime tutorial'
  let crudProved = false
  const observe = async (target: HostTarget): Promise<HostObservation> => {
    stageTarget = describeTarget(target)
    await grant.assertCurrent()
    const observation = await session.observe({ expectedRevision: revision, target })
    if (!observation.visible) {
      Errors.throwHostEnvironment('The Firebase acceptance control is not visible.')
    }
    return observation
  }
  const wait = async (target: HostTarget): Promise<HostObservation> => {
    let lastError: unknown
    const observation = await Time.pollUntil(async () => {
      try {
        return await observe(target)
      } catch (error) {
        lastError = error
        await grant.assertCurrent()
        if (grant.signal.aborted) {
          throw error
        }
        return undefined
      }
    }, { timeoutMs: 30_000, intervalMs: 250 })
    if (observation === undefined) {
      Errors.throwHostEnvironment('Firebase acceptance did not reach its expected native control or exact item row.', {
        cause: lastError,
      })
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
    const optionalControl = async (target: HostTarget): Promise<HostObservation | undefined> => {
      stageTarget = describeTarget(target)
      await grant.assertCurrent()
      try {
        return await session.observe({ expectedRevision: revision, target })
      } catch (error) {
        await grant.assertCurrent()
        if (
          error instanceof AppiumNoSuchElementError
          || (error instanceof HostControlError && error.code === 'assertion'
            && error.details?.['reason'] === 'element-not-found')
        ) {
          return undefined
        }
        throw error
      }
    }
    const exactVisibleText = (observation: HostObservation | undefined, text: string) =>
      observation?.visible === true && (observation.text === text || observation.accessibilityLabel === text)
    const scrollUntilVisible = async (target: HostTarget, deltaY: number): Promise<HostObservation> => {
      let scrolls = 0
      const result = await Time.pollUntil(async () => {
        const observation = await optionalControl(target)
        if (observation?.visible) {
          return observation
        }
        if (scrolls < 6) {
          await grant.assertCurrent()
          await session.perform({
            kind: 'scroll',
            deltaX: 0,
            deltaY,
            expectedRevision: revision,
            lease: session.descriptor().lease,
          })
          scrolls++
        }
        return undefined
      }, { timeoutMs: 30_000, intervalMs: 500 })
      if (result === undefined) {
        Errors.throwHostEnvironment('Firebase native did not reach its exact control after bounded scrolling.')
      }
      return result
    }
    const title = await optionalControl({ kind: 'text', value: 'Tao Runtime' })
    if (title?.visible) {
      const bodyText = 'This is the developer menu. It gives you access to useful tools in development builds.'
      if (!exactVisibleText(title, 'Tao Runtime')) {
        Errors.throwHostEnvironment(
          'Firebase runtime tutorial title did not exactly match; no tutorial input was sent.',
        )
      }
      const body = await optionalControl({ kind: 'text', value: bodyText })
      if (!exactVisibleText(body, bodyText)) {
        Errors.throwHostEnvironment('Firebase runtime tutorial body did not exactly match; no tutorial input was sent.')
      }
      // Observe the unique accessible button last: every observation invalidates previous control IDs.
      const button = await optionalControl({ kind: 'accessibility', name: 'Continue' })
      if (button === undefined || !exactVisibleText(button, 'Continue')) {
        Errors.throwHostEnvironment(
          'Firebase runtime tutorial Continue button was not exact and visible; no input was sent.',
        )
      }
      await grant.assertCurrent()
      await session.perform({
        kind: 'click',
        observation: button,
        expectedRevision: revision,
        lease: session.descriptor().lease,
      })
    }
    stage = 'native-runtime-menu'
    const menuTitle = await optionalControl({ kind: 'text', value: 'Tao Runtime' })
    if (menuTitle?.visible) {
      for (const text of ['Reload', 'Go home']) {
        const item = await wait({ kind: 'text', value: text })
        if (!exactVisibleText(item, text)) {
          Errors.throwHostEnvironment('Firebase runtime menu signature did not exactly match; no menu input was sent.')
        }
      }
      const close = await wait({ kind: 'accessibility', name: 'Close' })
      if (!exactVisibleText(close, 'Close')) {
        Errors.throwHostEnvironment('Firebase runtime menu Close control was not exact and visible; no input was sent.')
      }
      await grant.assertCurrent()
      await session.perform({
        kind: 'click',
        observation: close,
        expectedRevision: revision,
        lease: session.descriptor().lease,
      })
    }
    stage = 'native-data-load'
    const dataFailure = await optionalControl({ kind: 'text', value: "Couldn't load app data" })
    if (dataFailure?.visible) {
      Errors.throwHostEnvironment('Firebase native app data load failure is visible; account input was not sent.')
    }
    // Each surface starts signed out; an already signed-in session is explicitly returned to the gate.
    stage = 'native-initial-signout'
    const signedIn = await optionalControl({ kind: 'tag', value: 'signOut' })
    if (signedIn !== undefined) {
      await scrollUntilVisible({ kind: 'tag', value: 'signOut' }, -450)
      await click('signOut')
    }
    stage = 'web-crud-signup'
    stageTarget = 'web CRUD sample account'
    accounts.push({ surface: 'web', sample: 'crud', result: await web.createCrudAccount() })
    stage = 'native-crud-fill'
    await click('fillCrudAccount')
    stage = 'native-crud-signin'
    await click('signIn')
    stage = 'native-crud-item-title'
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
    stage = 'native-crud-create'
    const add = await wait({ kind: 'tag', value: 'addItem' })
    await grant.assertCurrent()
    await session.perform({
      kind: 'click',
      observation: add,
      expectedRevision: revision,
      lease: session.descriptor().lease,
    })
    stage = 'web-observe-native-item'
    stageTarget = 'web exact native-created item row'
    const webRow = await web.observeItem(nativeMarker)
    if (webRow !== nativeMarker) {
      Errors.throwHostEnvironment('The web Firebase row did not exactly match the native-created marker.')
    }
    observations.push({ surface: 'web', marker: nativeMarker, text: webRow })
    screenshots.push(await web.screenshot('firebase-native-to-web'))
    stage = 'web-crud-create'
    stageTarget = 'web item title and add item'
    await web.createItem(webMarker)
    stage = 'native-observe-web-item'
    // #items belongs to each loop row. The fresh marker is unique within this leased app,
    // so find its exact text across rows, scrolling the app when it lies below the viewport.
    const row = await scrollUntilVisible({ kind: 'text', value: webMarker }, 450)
    if (row.text !== webMarker) {
      Errors.throwHostEnvironment('The native Firebase row did not exactly match the web-created marker.')
    }
    observations.push({ surface: 'ios', marker: webMarker, text: row.text })
    await grant.assertCurrent()
    screenshots.push((await session.captureScreenshot('firebase-web-to-native')).artifactPath)
    await grant.assertCurrent()
    stage = 'crud-sync-artifact'
    stageTarget = 'private CRUD synchronization evidence'
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
    crudProved = true
    stage = 'main-account-gate'
    let mainStage: 'native-main-signout' | 'native-main-signup' | 'native-main-signin' | 'web-main-signin' =
      'native-main-signout'
    try {
      await scrollUntilVisible({ kind: 'tag', value: 'signOut' }, -450)
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
    if (!crudProved) {
      Errors.throwHostEnvironment(`Firebase ${stage} failed at ${stageTarget}.`, { cause: error })
    }
    throw error
  } finally {
    await web.close()
  }
}

function describeTarget(target: HostTarget): string {
  if (target.kind === 'scoped') {
    return `${describeTarget(target.scope)} / ${describeTarget(target.target)}`
  }
  if (target.kind === 'tag') {
    return `#${target.value}`
  }
  if (target.kind === 'text') {
    return `exact text '${target.value}'`
  }
  return `accessible ${target.role ?? 'control'} '${target.name}'`
}
