import { Errors, FS, Platform, readFirebaseConnections, Repo } from '@shared'
import { Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { StudioCdp } from '@studio-tooling/StudioCdp'
import type { DevLoopReceipt } from '../dev-cli-src/dev-loop/DevLoopStore'
import { assertManagedFirebaseSubject, openManagedFirebaseWeb } from '../dev-cli-src/dev-loop/ManagedFirebaseAcceptance'
import { runManagedLoopAcceptance } from '../dev-cli-src/dev-loop/ManagedLoopAcceptance'

for (
  const fault of ['none', 'source-before-dispatch', 'source-before-action', 'wrong-case', 'stale-generation'] as const
) {
  Test(`finite Firebase dispatch preserves its fixed subject and generation guards: ${fault}`, async () => {
    const checkout = await mkTestDir('managed-firebase-dispatch-')
    const projectRoot = FS.resolvePath('Apps/Firebase Live Acceptance', checkout)
    const controller = { pid: 90001, startedAt: 'controller-start', command: 'controller' }
    const receipt: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout,
      args: ['--web', '--ios'],
      generation: 'held-generation',
      state: 'ready',
      controller,
      children: [],
      createdAt: 'created',
      updatedAt: 'updated',
      selection: { projectRoot, appPath: FS.resolvePath('App.tao', projectRoot), appName: 'FirebaseLiveAcceptance' },
      targets: [{ target: 'web', dispatched: true }, { target: 'ios', dispatched: true }],
    }
    let artifactRoot: string | undefined
    let attached = 0
    let mutations = 0
    let receiptReads = 0
    try {
      for (const path of ['App.tao', 'Auth.tao', 'Items/Items.tao', 'Data.tao']) {
        await FS.writeText(
          FS.resolvePath(path, projectRoot),
          await FS.readText(Repo.resolvePath(`Apps/Firebase Live Acceptance/${path}`)),
        )
      }
      const connection = await readFirebaseConnections(Repo.resolvePath('Apps/Firebase Live Acceptance'))
      if (connection === undefined) {
        Errors.throwUnexpected('The reviewed public Firebase connection is missing.')
      }
      await FS.writeJson(FS.resolvePath('.tao/local/connections.json', projectRoot), { firebase: connection })
      const changeSubject = async () => {
        const path = FS.resolvePath('Auth.tao', projectRoot)
        await FS.writeText(
          path,
          (await FS.readText(path)).replace('on press FillMainAccount', 'on press CreateAccount'),
        )
      }
      if (fault === 'source-before-dispatch') {
        await changeSubject()
      }
      const captured = await withCapturedOutput(() =>
        runManagedLoopAcceptance({
          case: fault === 'wrong-case' ? 'mobile-interaction' : 'firebase-sync',
          session: receipt.session,
          target: 'ios',
        }, {
          run: async (command, options) => ({
            command,
            args: [...options?.args ?? []],
            exitCode: 0,
            signal: null,
            stdout: '',
            stderr: '',
          }),
          inventory: async () => ({ processCount: 0, peers: [], resources: [] }),
          receipt: async () => {
            receiptReads++
            return fault === 'stale-generation' && receiptReads > 1 ? { ...receipt, generation: 'successor' } : receipt
          },
          identities: () => new Map([[controller.pid, controller]]),
          mobileInteraction: async context => {
            attached++
            Expect(context.fixture).toBe('firebase-sync')
            Expect(context.target).toBe('ios')
            await context.assertCurrent()
            if (fault === 'source-before-action') {
              await changeSubject()
            }
            await context.assertCurrent()
            mutations++
            return { sourceRegression: true }
          },
        })
      )
      const report = JSON.parse(captured.stdout.trim()) as {
        artifactRoot: string
        evidenceKind: string
        rows: { name: string; detail?: string }[]
      }
      artifactRoot = report.artifactRoot
      Expect(report.evidenceKind).toBe('source regression')
      Expect(captured.result).toBe(fault === 'none' ? 0 : 1)
      Expect(attached).toBe(fault === 'none' || fault === 'source-before-action' ? 1 : 0)
      Expect(mutations).toBe(fault === 'none' ? 1 : 0)
      if (fault === 'wrong-case') {
        Expect(report.rows.some(row => row.detail?.includes('Data MVP Memory fixture'))).toBe(true)
      }
    } finally {
      if (artifactRoot !== undefined) {
        await FS.remove(artifactRoot)
      }
      await FS.remove(checkout)
    }
  })
}

Test('Firebase subject follows canonical public connections while authored placeholders remain intact', async () => {
  const checkout = await mkTestDir('managed-firebase-subject-')
  const projectRoot = FS.resolvePath('Apps/Firebase Live Acceptance', checkout)
  const appPath = FS.resolvePath('App.tao', projectRoot)
  const connectionPath = FS.resolvePath('.tao/local/connections.json', projectRoot)
  const authPath = FS.resolvePath('Auth.tao', projectRoot)
  const reviewedApp = await FS.readText(Repo.resolvePath('Apps/Firebase Live Acceptance/App.tao'))
  const reviewedAuth = await FS.readText(Repo.resolvePath('Apps/Firebase Live Acceptance/Auth.tao'))
  const reviewedItems = await FS.readText(Repo.resolvePath('Apps/Firebase Live Acceptance/Items/Items.tao'))
  const reviewedData = await FS.readText(Repo.resolvePath('Apps/Firebase Live Acceptance/Data.tao'))
  const connection = await readFirebaseConnections(Repo.resolvePath('Apps/Firebase Live Acceptance'))
  if (connection === undefined) {
    Errors.throwUnexpected('The reviewed public Firebase connection is missing.')
  }
  const selection = { projectRoot, appPath, appName: 'FirebaseLiveAcceptance' }
  try {
    await FS.writeText(appPath, reviewedApp)
    await FS.writeText(authPath, reviewedAuth)
    await FS.writeText(FS.resolvePath('Items/Items.tao', projectRoot), reviewedItems)
    await FS.writeText(FS.resolvePath('Data.tao', projectRoot), reviewedData)
    await FS.writeJson(connectionPath, { firebase: connection })
    await assertManagedFirebaseSubject({ checkout, selection })
    const changedSources = [
      {
        path: appPath,
        source: reviewedApp.replace('StorageKey "firebase-live-acceptance"', 'StorageKey "different-store"')
          + '\n// StorageKey "firebase-live-acceptance"\n',
        original: reviewedApp,
      },
      {
        path: authPath,
        source: reviewedAuth.replace('on press FillMainAccount', 'on press CreateAccount')
          + '\n// #fillMainAccount\n',
        original: reviewedAuth,
      },
      {
        path: FS.resolvePath('Items/Items.tao', projectRoot),
        source: reviewedItems.replace('on press AddItem', 'on press NewItem') + '\n// #addItem\n',
        original: reviewedItems,
      },
      {
        path: FS.resolvePath('Data.tao', projectRoot),
        source: reviewedData.replace('Title text (title)', 'Title text (default "changed")'),
        original: reviewedData,
      },
      {
        path: authPath,
        source: reviewedAuth.replace(/Flow\.Password = "[^"]+"/u, 'Flow.Password = "changed-test-password"')
          + '\n// #fillMainAccount\n',
        original: reviewedAuth,
      },
    ]
    for (const changed of changedSources) {
      await FS.writeText(changed.path, changed.source)
      await Expect(assertManagedFirebaseSubject({ checkout, selection })).rejects.toThrow(
        'subject, provider, namespace',
      )
      await FS.writeText(changed.path, changed.original)
    }
    for (
      const changed of [
        { ...selection, appName: 'OtherApp' },
        { ...selection, appPath: FS.resolvePath('Other.tao', projectRoot) },
        { ...selection, projectRoot: FS.resolvePath('Apps/Hosted Firebase', checkout) },
      ]
    ) {
      await Expect(assertManagedFirebaseSubject({ checkout, selection: changed })).rejects.toThrow('restricted')
    }
    for (
      const changed of [{ ...connection, apiKey: 'changed-public-key' }, { ...connection, appId: 'changed-app' }, {
        ...connection,
        projectId: 'other-project',
      }]
    ) {
      await FS.writeJson(connectionPath, { firebase: changed })
      await Expect(assertManagedFirebaseSubject({ checkout, selection })).rejects.toThrow(
        'subject, provider, namespace',
      )
    }
  } finally {
    await FS.remove(checkout)
  }
})

for (const fault of ['auth-after-attach', 'items-after-attach', 'public-key-after-attach'] as const) {
  Test(`attached Firebase CDP refuses ${fault} before any physical input or text write`, async () => {
    const checkout = await mkTestDir('managed-firebase-attached-')
    const projectRoot = FS.resolvePath('Apps/Firebase Live Acceptance', checkout)
    const profile = FS.resolvePath('.tao/chrome-fixture', projectRoot)
    const connection = await readFirebaseConnections(Repo.resolvePath('Apps/Firebase Live Acceptance'))
    if (connection === undefined) {
      Errors.throwUnexpected('The reviewed public Firebase connection is missing.')
    }
    const sourcePaths = ['App.tao', 'Auth.tao', 'Items/Items.tao', 'Data.tao']
    const browser = { pid: 90002, startedAt: 'browser-start', command: `Chrome --user-data-dir=${profile}` }
    const controller = { pid: 90001, startedAt: 'controller-start', command: 'controller' }
    const receipt: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout,
      args: [],
      generation: 'held-generation',
      state: 'ready',
      createdAt: 'created',
      updatedAt: 'updated',
      children: [browser],
      controller,
      selection: { appName: 'FirebaseLiveAcceptance', projectRoot, appPath: FS.resolvePath('App.tao', projectRoot) },
      url: 'http://127.0.0.1:8081/',
      targets: [{
        target: 'web',
        dispatched: true,
        browser: { profile, devToolsUrl: 'http://127.0.0.1:9222', process: browser },
      }],
    }
    let attached = 0
    let evaluations = 0
    const mutations: string[] = []
    const cdp = StudioCdp.testing.create({
      subscribe: () => () => {},
      send: async <Result>(method: string): Promise<Result> => {
        if (method.startsWith('Input.') || method === 'Page.navigate') {
          mutations.push(method)
        }
        if (method === 'Runtime.evaluate') {
          evaluations++
        }
        return { result: { value: { url: receipt.url, bounded: true, found: true } } } as Result
      },
    })
    try {
      for (const path of sourcePaths) {
        await FS.writeText(
          FS.resolvePath(path, projectRoot),
          await FS.readText(Repo.resolvePath(`Apps/Firebase Live Acceptance/${path}`)),
        )
      }
      await FS.writeJson(FS.resolvePath('.tao/local/connections.json', projectRoot), { firebase: connection })
      await FS.writeText(FS.resolvePath('DevToolsActivePort', profile), '9222\n')
      const web = await openManagedFirebaseWeb({
        receipt,
        artifactRoot: checkout,
        assertCurrent: async () => {},
        attach: async () => {
          attached++
          if (fault === 'public-key-after-attach') {
            await FS.writeJson(FS.resolvePath('.tao/local/connections.json', projectRoot), {
              firebase: { ...connection, apiKey: 'changed-public-key' },
            })
          } else {
            const path = FS.resolvePath(fault === 'auth-after-attach' ? 'Auth.tao' : 'Items/Items.tao', projectRoot)
            const source = await FS.readText(path)
            await FS.writeText(
              path,
              source.replace(
                fault === 'auth-after-attach' ? 'on press FillCrudAccount' : 'on press AddItem',
                'on press CreateAccount',
              ),
            )
          }
          return cdp
        },
      }, {
        receipt: async () => receipt,
        identities: () => new Map([[browser.pid, browser], [controller.pid, controller]]),
        processTable: () => [{ ...browser, ppid: controller.pid }, { ...controller, ppid: 1 }],
      })
      await Expect(fault === 'items-after-attach' ? web.createItem('source-regression-row') : web.createCrudAccount())
        .rejects.toThrow('subject, provider, namespace')
      Expect(attached).toBe(1)
      Expect(evaluations).toBeGreaterThan(0)
      Expect(mutations).toEqual([])
    } finally {
      await cdp.close()
      await FS.remove(checkout)
    }
  })
}
