import { AppiumNoSuchElementError } from '@appium-driver'
import { Errors, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  type AppiumAndroidElement,
  type AppiumAndroidLeaseManager,
  type AppiumAndroidLocator,
  type AppiumAndroidWebDriverSession,
  createManagedAppiumAndroidController,
} from '../native/appium-android/AppiumAndroidController'
import { runManagedMobileFixture } from '../native/ManagedMobileFixture'
import { createManagedMobileGrant } from '../native/ManagedMobileGrant'

for (
  const scenario of [
    { layout: 'nested', add: 'create', attempts: 1 },
    { layout: 'flattened', add: 'create', attempts: 1 },
    { layout: 'nested', add: 'no-op', attempts: 1 },
    { layout: 'nested', add: 'create', attempts: 3 },
  ] as const
) {
  const { layout, add } = scenario
  Test(
    `managed Android fixture enters the ${layout} workspace textbox and ${
      add === 'create' ? 'proves the created row' : 'rejects a no-op Add with a searchable draft'
    }${scenario.attempts === 3 ? ' and retains artifacts across same-generation success and failure attempts' : ''}`,
    async () => {
      const root = await mkTestDir('managed-workspace-input-')
      const artifactRoots: string[] = []
      const retainedFiles: { path: string; bytes: Uint8Array }[] = []
      try {
        for (let attempt = 0; attempt < scenario.attempts; attempt++) {
          const failBeforeInput = attempt === 2
          const events: string[] = []
          const typed: string[] = []
          const rows: string[] = []
          const published: boolean[] = []
          let inputValue = ''
          let unrelatedValue = ''
          let driverClosed = false
          let serverClosed = false
          let screenshots = 0
          const grant = createManagedMobileGrant({
            identity: {
              session: 'session',
              checkout: '/checkout',
              loopGeneration: 'loop-1',
              target: { platform: 'android', id: 'emulator-owned' },
              resources: [{ name: 'android-emulator:emulator-owned', generation: 'retained-2' }],
              runtime: {
                session: 'session',
                checkout: '/checkout',
                loopGeneration: 'loop-1',
                kind: 'companion',
                appId: 'com.devtao.studio.companion',
                devUrl: 'taostudiocompanion://dev',
                projectRoot: '/checkout/app',
                appName: 'DataMVPApp',
                sourceRevision: 'source',
                compiledRevision: 'compiled',
                nonce: 'nonce',
              },
            },
            assertOwnerCurrent: async () => {},
            assertLoopCurrent: async () => {},
          })
          grant.bindRuntimeObserver(async () => {})
          type NativeNode = AppiumAndroidElement & {
            parent?: string
            attributes: Readonly<Record<string, string>>
          }
          const noneditable = async () =>
            Errors.throwHostEnvironment('Cannot set element: native container is not editable.')
          const unexpectedClick = async () => Errors.throwUnexpected('Only Add workspace may receive a click.')
          const nodes: NativeNode[] = [
            {
              id: 'unrelated-input',
              attributes: {
                className: 'android.widget.EditText',
                get text() {
                  return unrelatedValue
                },
              },
              isDisplayed: async () => true,
              getText: async () => unrelatedValue,
              getRect: async () => ({ x: 400, y: 0, width: 100, height: 40 }),
              click: unexpectedClick,
              sendKeys: async value => {
                typed.push('unrelated-input')
                unrelatedValue = value
              },
            },
            {
              id: 'workspace-wrapper',
              attributes: { className: 'android.view.ViewGroup', resourceId: 'workspaceName' },
              isDisplayed: async () => true,
              getText: async () => '',
              getRect: async () => ({ x: 0, y: 0, width: 200, height: 60 }),
              click: unexpectedClick,
              sendKeys: noneditable,
            },
            {
              id: 'workspace-editable',
              ...(layout === 'nested' ? { parent: 'workspace-wrapper' } : {}),
              attributes: {
                className: 'android.widget.EditText',
                get text() {
                  return inputValue
                },
              },
              isDisplayed: async () => true,
              getText: async () => inputValue,
              getRect: async () => ({ x: 10, y: 10, width: 180, height: 40 }),
              click: unexpectedClick,
              sendKeys: async value => {
                typed.push('workspace-editable')
                events.push('type:workspace-editable')
                inputValue = value
              },
            },
            {
              id: 'add-workspace',
              attributes: {
                className: 'android.widget.TextView',
                text: 'ADD WORKSPACE',
                description: 'Add workspace',
                resourceId: 'addWorkspace',
              },
              isDisplayed: async () => true,
              getText: async () => 'ADD WORKSPACE',
              sendKeys: noneditable,
              click: async () => {
                Expect(inputValue).toMatch(/^Managed [a-f0-9]{8}$/u)
                events.push('click:add-workspace')
                if (add === 'no-op') {
                  return
                }
                rows.push(inputValue)
                nodes.push({
                  id: 'workspace-region',
                  attributes: { className: 'android.view.ViewGroup', resourceId: 'workspaces' },
                  isDisplayed: async () => true,
                  getRect: async () => ({ x: 0, y: 100, width: 200, height: 60 }),
                  sendKeys: noneditable,
                  click: unexpectedClick,
                })
                nodes.push({
                  id: 'created-row',
                  ...(layout === 'nested' ? { parent: 'workspace-region' } : {}),
                  attributes: { className: 'android.widget.TextView', text: inputValue },
                  isDisplayed: async () => true,
                  getText: async () => rows[0]!,
                  getRect: async () => ({ x: 10, y: 110, width: 180, height: 40 }),
                  sendKeys: noneditable,
                  click: unexpectedClick,
                })
              },
            },
          ]
          // Interpret native selector predicates over distinct container and editable nodes,
          // rather than returning one permissive element for every selector.
          const find = (locator: AppiumAndroidLocator, parent?: AppiumAndroidElement): readonly NativeNode[] => {
            const predicates = [
              ...locator.value.matchAll(/\.(resourceId|className|text|description)\(("(?:\\.|[^"\\])*")\)/gu),
            ]
            Expect(locator.using).toBe('-android uiautomator')
            Expect(predicates.length).toBeGreaterThan(0)
            const found = nodes.filter(node =>
              (parent === undefined || node.parent === parent.id)
              && predicates.every(predicate => node.attributes[predicate[1]!] === JSON.parse(predicate[2]!))
            )
            for (const node of found) {
              events.push(`lookup:${node.id}`)
            }
            return found
          }
          const first = (found: readonly NativeNode[]): NativeNode => {
            if (found[0] === undefined) {
              throw new AppiumNoSuchElementError('The native fixture selector matched no element.', {
                typed: [...typed],
                inputCompleted: inputValue !== '',
              })
            }
            return found[0]
          }
          const leases: AppiumAndroidLeaseManager = {
            acquire: async () => Errors.throwUnexpected('Managed attachment must borrow the existing target lease.'),
            tryAcquire: async name => ({ generation: name, assertCurrent: async () => {}, release: async () => {} }),
          }
          const driver: AppiumAndroidWebDriverSession = {
            id: `driver-${attempt}`,
            findElement: async locator => first(find(locator)),
            findElements: async locator => find(locator),
            findElementWithin: async (parent, locator) => first(find(locator, parent)),
            findElementsWithin: async (parent, locator) => find(locator, parent),
            activateApp: async () => Errors.throwUnexpected('Managed fixture cannot activate its borrowed runtime.'),
            terminateApp: async () => Errors.throwUnexpected('Managed fixture cannot terminate its borrowed runtime.'),
            pressKey: async () => Errors.throwUnexpected('Workspace entry needs no key workaround.'),
            scroll: async () => Errors.throwUnexpected('Workspace entry needs no scroll workaround.'),
            screenshot: async () => {
              screenshots++
              return new Uint8Array([attempt + 1, screenshots])
            },
            deleteSession: async () => {
              driverClosed = true
            },
          }
          const completed = runManagedMobileFixture({
            grant,
            artifactRoot: root,
            onDriverProcess: async () => {},
            beforeFixtureAction: async (phase, current) => {
              Expect(current).toBe(grant)
              await current.assertCurrent()
              events.push(`before:${phase}`)
              if (failBeforeInput && phase === 'input') {
                Errors.throwHostEnvironment('Retained fixture input failure.')
              }
            },
            onCleanup: async proved => {
              published.push(proved)
            },
          }, {
            startServer: async ({ artifactRoot }) => {
              artifactRoots.push(artifactRoot)
              await FS.writeText(FS.resolvePath('driver.log', artifactRoot), `driver attempt ${attempt}`)
              return {
                url: 'http://127.0.0.1:4723',
                logs: () => '',
                close: async () => {
                  serverClosed = true
                },
              }
            },
            resources: () => ({
              leases,
              serverReservations: () => ({
                reserve: async () => Errors.throwUnexpected('No host server is launched.'),
              }),
              releaseAfterCleanup: async (closedDriver, closedServer) => {
                Expect([closedDriver, closedServer, driverClosed, serverClosed]).toEqual([true, true, true, true])
              },
            }),
            controller: () =>
              createManagedAppiumAndroidController({
                grant,
                client: { createSession: async () => driver },
                leases,
                target: { kind: 'emulator', serial: 'emulator-owned', appId: grant.identity.runtime.appId },
              }),
          })
          if (add === 'no-op') {
            await Expect(completed).rejects.toThrow(
              'Data MVP did not render the workspace created by managed native input.',
            )
            Expect(typed).toEqual(['workspace-editable'])
            Expect(inputValue).toMatch(/^Managed [a-f0-9]{8}$/u)
            Expect(nodes.find(node => node.id === 'workspace-editable')?.attributes['text']).toBe(inputValue)
            Expect(rows).toEqual([])
            Expect(events).toEqual([
              'lookup:workspace-wrapper',
              'lookup:workspace-editable',
              'before:input',
              'type:workspace-editable',
              'lookup:add-workspace',
              'before:add',
              'click:add-workspace',
              'before:observe',
            ])
            Expect(screenshots).toBe(1)
            Expect([driverClosed, serverClosed]).toEqual([true, true])
            Expect(published).toEqual([true])
            return
          }
          if (failBeforeInput) {
            await Expect(completed).rejects.toThrow('Retained fixture input failure.')
            Expect(typed).toEqual([])
            Expect(rows).toEqual([])
            Expect(screenshots).toBe(1)
            Expect([driverClosed, serverClosed]).toEqual([true, true])
            Expect(published).toEqual([true])
          } else {
            const evidence = await completed
            Expect(typed).toEqual(['workspace-editable'])
            Expect(unrelatedValue).toBe('')
            Expect(inputValue).toBe(evidence.workspaceName)
            Expect(rows).toEqual([evidence.workspaceName])
            Expect(events).toEqual([
              'lookup:workspace-wrapper',
              ...(layout === 'flattened' ? ['lookup:unrelated-input'] : []),
              'lookup:workspace-editable',
              'before:input',
              'type:workspace-editable',
              'lookup:add-workspace',
              'before:add',
              'click:add-workspace',
              'before:observe',
              'lookup:workspace-region',
              ...(layout === 'flattened' ? ['lookup:workspace-editable'] : []),
              'lookup:created-row',
            ])
            Expect(evidence.screenshots.length).toBe(2)
            Expect(evidence.driverClosed).toBe(true)
            Expect(evidence.targetReservationPreserved).toBe(true)
            Expect(published).toEqual([true])
          }
          const attemptRoot = artifactRoots[attempt]!
          Expect(FS.pathIsWithin(attemptRoot, root)).toBe(true)
          // Real controller screenshots and receipts plus the driver's fixed log name must
          // retain their original bytes after another invocation in the same generation.
          for (const retained of retainedFiles) {
            Expect(await FS.readFile(retained.path)).toEqual(retained.bytes)
          }
          const files: string[] = []
          for await (const path of FS.walk(attemptRoot)) {
            files.push(path)
            retainedFiles.push({ path, bytes: await FS.readFile(path) })
          }
          Expect(files.some(path => path.endsWith('.receipt.json'))).toBe(true)
          Expect(files.some(path => path.endsWith('before-workspace.png'))).toBe(true)
          Expect(files.some(path => path.endsWith('driver.log'))).toBe(true)
          Expect(files.some(path => path.endsWith('cleanup.json'))).toBe(failBeforeInput)
        }
        Expect(new Set(artifactRoots).size).toBe(scenario.attempts)
      } finally {
        await FS.remove(root)
      }
    },
    // The no-op case exhausts the fixture's real 30s row polling budget before proving cleanup.
    60_000,
  )
}
