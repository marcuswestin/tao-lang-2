import { captureRuntime, restoreRuntimeCapture } from '@runtime/TR-runtime-capture'
import { Repo } from '@shared'
import { compileAndRenderApp, registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

/**
 * A capture is only worth taking if it can be put back. Nothing anywhere asserted that round trip
 * against a mounted app — the runtime capture tests exercise the registry, not a live navigator —
 * so a capture of an app with a navigator could be produced, refused on restore, and no test would
 * notice. Studio's device canvas is what made this visible: it can now ask a phone for its state,
 * and the state it gets back has to be restorable for that to mean anything.
 */
describe('runtime capture and restore round trip', () => {
  test('restores a capture of a navigating app back into the app it came from', async () => {
    const appPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
    await compileAndRenderApp(appPath, { appName: 'WordFlower' })

    const captured = await captureRuntime()
    const navigation = captured.domains.find(domain => domain.domain === 'navigation')
    expect(navigation).toBeDefined()

    // The same mounted app, the same navigator, the same instant: if this cannot be restored,
    // nothing that captures on one mount and restores on another can be either.
    await expect(restoreRuntimeCapture(captured)).resolves.toBeUndefined()
  })
})
