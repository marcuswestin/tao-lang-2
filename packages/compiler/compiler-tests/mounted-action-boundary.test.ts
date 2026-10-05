import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler: mounted app action failure boundary', () => {
  for (
    const [spelling, guard] of [
      ['canonical', 'error Problem ->'],
      ['legacy', 'error -> Problem'],
    ]
  ) {
    Test(`renders a real compiled ${spelling} failure guard in only its host, with default recovery`, async () => {
      await withTaoFiles('tao-mounted-action-boundary-', {
        'Main.tao': `
        type InputFailure is one of InvalidInput
        action Reject() { fail InvalidInput "Use another title." }
        public app Demo {
          id "com.tao.boundary.demo" version "1.0.0" name "Demo" view Main
          guard { ${guard} { Label(Problem.Message) } }
        }
        public app Plain { id "com.tao.boundary.plain" version "1.0.0" name "Plain" view Main }
        public app Slow { id "com.tao.boundary.slow" version "1.0.0" name "Slow" view Later }
        public app Initial { id "com.tao.boundary.initial" version "1.0.0" name "Initial" view Start }
        public app InitialSync { id "com.tao.boundary.initial-sync" version "1.0.0" name "InitialSync" view StartSync }
        public app Raw {
          id "com.tao.boundary.raw" version "1.0.0" name "Raw" view Unsafe
          guard { ${guard} { Label(Problem.Message) } }
        }
        public app RawPlain { id "com.tao.boundary.rawplain" version "1.0.0" name "RawPlain" view Unsafe }
        view Main() { render Button(action { do Reject() }) }
        view Later() { render Button(action { do Pause() fail InvalidInput "Use another title." }) }
        view Start() {
          render Init(action {
            let Message = do ObserveInit()
            if Message == "First disposed init." { fail InvalidInput "First disposed init." }
            fail InvalidInput "Second live init."
          })
        }
        view StartSync() { render Init(action { do Reject() }) }
        view Unsafe() { render Button(action { do Explode() }) }
        action Explode() from ./Native.tsx
        action Pause() from ./Native.tsx
        action ObserveInit() returns text from ./Native.tsx
        view Button(Press action()) from ./Native.tsx
        view Label(Value text) from ./Native.tsx
        view Init(Begin action()) from ./Native.tsx
      `,
        'Native.tsx': `
        import React from 'react'
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        let suspension: Promise<void> | undefined
        let suspendedRenders = 0
        export function suspendButtons() { suspension = new Promise<void>(() => {}) }
        export function abortSuspension() { suspension = undefined }
        export function suspensionAttempts() { return suspendedRenders }
        export function Button(props: { Press: TR.ActionValue; Layout?: unknown; Tag?: string }) {
          if (suspension) { suspendedRenders += 1; throw suspension }
          return React.createElement('button', { onPress: () => props.Press.invoke() }, 'Fail')
        }
        export function Label(props: { Value: string; Layout?: unknown; Tag?: string }) {
          return React.createElement('label', {}, props.Value)
        }
        let release: (() => void) | undefined
        export function Pause() { return new Promise<void>(resolve => { release = resolve }) }
        export function releasePause() { release?.() }
        export function Explode() { throw new TypeError('credential=private provider detail') }
        let observedInits = 0
        let removedInitListeners = 0
        export async function ObserveInit() {
          observedInits += 1
          const message = observedInits === 1 ? 'First disposed init.' : 'Second live init.'
          TR.NativeSubscription().attach(() => { removedInitListeners += 1 })
          await Promise.resolve()
          return message
        }
        export function observedInitCount() { return observedInits }
        export function removedInitListenerCount() { return removedInitListeners }
        export function Init(props: { Begin: TR.ActionValue; Layout?: unknown; Tag?: string }) {
          React.useLayoutEffect(() => { void props.Begin.invoke() }, [])
          return null
        }
      `,
      }, async (paths, root) => {
        const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'], { appName: 'Demo' })
        const main = compiled.files.find(file =>
          file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
        )
        Assert.defined(main, 'the validated app source emits a module')
        Expect(main.code).toContain('TR.UseActionOwner()')
        Expect(main.code).toContain('owner: _TaoActionOwner,')
        const output = FS.resolvePath('output', root)
        for (const file of compiled.files) {
          await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
        }
        await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
        const program = FS.resolvePath('Check.ts', root)
        await FS.writeText(
          program,
          `
        import React from 'react'
        import { MockModule } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))}
        import { reactNativeStubs } from ${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/TestReactNative.ts'))
          }
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        MockModule('react-native', () => reactNativeStubs())
        MockModule('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }))
        const { Demo, Plain, Slow, Initial, InitialSync, Raw, RawPlain } = await import(${
            JSON.stringify(FS.resolvePath(main.relativePath, output))
          })
        const { releasePause, suspendButtons, abortSuspension, suspensionAttempts, observedInitCount, removedInitListenerCount } = await import(${
            JSON.stringify(FS.resolvePath('Native.tsx', output))
          })
        const { NavigationAppHost } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-navigation-app-host.ts'))
          })
        const { TaoErrorBoundary } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-error-containment.tsx'))
          })
        const { MountedAppActionBoundary } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-boundary.ts'))
          })
        const { default: TR } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
          })
        const Renderer = require('react-test-renderer')
        ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
        const warnings: unknown[] = []
        const originalError = console.error
        const originalWarn = console.warn
        console.error = (...values) => warnings.push(values)
        console.warn = (...values) => warnings.push(values)
        const unowned: unknown[] = []
        const stop = TR.Errors.onUnowned(error => unowned.push(error))
        const scope = TR.Auth.CreateScope()
        const originalHost = React.createElement(React.Suspense, { fallback: React.createElement('pending') },
          React.createElement(NavigationAppHost, { app: Demo }))
        let first: any, second: any, plain: any, nested: any, slow: any, strict: any, initial: any, initialSync: any,
          authFirst: any, authSecond: any, replacement: any, raw: any, rawPlain: any, suspending: any, aborting: any
        try {
          await Renderer.act(async () => {
            first = Renderer.create(React.createElement(NavigationAppHost, { app: Demo }))
            second = Renderer.create(React.createElement(NavigationAppHost, { app: Demo }))
            plain = Renderer.create(React.createElement(NavigationAppHost, { app: Plain }))
            nested = Renderer.create(React.createElement(MountedAppActionBoundary, { app: Plain },
              React.createElement(NavigationAppHost, { app: Demo })))
            slow = Renderer.create(React.createElement(NavigationAppHost, { app: Slow }))
            strict = Renderer.create(React.createElement(React.StrictMode, {},
              React.createElement(NavigationAppHost, { app: Demo })))
            initial = Renderer.create(React.createElement(React.StrictMode, {},
              React.createElement(NavigationAppHost, { app: Initial })))
            initialSync = Renderer.create(React.createElement(React.StrictMode, {},
              React.createElement(NavigationAppHost, { app: InitialSync })))
            authFirst = Renderer.create(React.createElement(TR.Auth.Host, { scope },
              React.createElement(NavigationAppHost, { app: Demo })))
            authSecond = Renderer.create(React.createElement(TR.Auth.Host, { scope },
              React.createElement(NavigationAppHost, { app: Demo })))
            replacement = Renderer.create(React.createElement(NavigationAppHost, { app: Slow }))
            raw = Renderer.create(React.createElement(NavigationAppHost, { app: Raw }))
            rawPlain = Renderer.create(React.createElement(NavigationAppHost, { app: RawPlain }))
            suspending = Renderer.create(originalHost)
            aborting = Renderer.create(originalHost)
          })
          await Renderer.act(async () => { await first.root.findByType('button').props.onPress() })
          const override = first.root.findByType('label').children
          const isolated = second.root.findAllByType('label').length === 0 && second.root.findAllByType('button').length === 1
          await Renderer.act(async () => { await plain.root.findByType('button').props.onPress() })
          const fallback = JSON.stringify(plain.toJSON())
          const failed = plain.root.findByType(TaoErrorBoundary).instance.render()
          await Renderer.act(async () => { failed.props.onRetry() })
          const recovered = plain.root.findAllByType('button').length === 1
          await Renderer.act(async () => { await nested.root.findByType('button').props.onPress() })
          const nearest = nested.root.findByType('label').children
          const outerHealthy = nested.root.findAllByType(TaoErrorBoundary)[0].instance.state.phase === 'healthy'
          await Renderer.act(async () => { await strict.root.findByType('button').props.onPress() })
          const strictMessage = strict.root.findByType('label').children
          const initialMessage = JSON.stringify(initial.toJSON())
          const initialSyncMessage = JSON.stringify(initialSync.toJSON())
          const disposedStrictRoot = unowned.length
          await Renderer.act(async () => { await authFirst.root.findByType('button').props.onPress() })
          const authIsolated = authFirst.root.findByType('label').children[0] === 'Use another title.'
            && authSecond.root.findAllByType('label').length === 0
            && authSecond.root.findAllByType('button').length === 1
          let pending: Promise<void> | undefined
          await Renderer.act(async () => { pending = slow.root.findByType('button').props.onPress() })
          await Renderer.act(async () => { slow.unmount() })
          await Renderer.act(async () => { releasePause(); await pending })
          await Renderer.act(async () => { pending = replacement.root.findByType('button').props.onPress() })
          await Renderer.act(async () => { replacement.update(React.createElement(NavigationAppHost, { app: Demo })) })
          await Renderer.act(async () => { releasePause(); await pending })
          const replacementHealthy = replacement.root.findAllByType('label').length === 0
            && replacement.root.findAllByType('button').length === 1
          await Renderer.act(async () => { await raw.root.findByType('button').props.onPress() })
          const rawMessage = raw.root.findByType('label').children[0]
          await Renderer.act(async () => { await rawPlain.root.findByType('button').props.onPress() })
          const rawDefault = JSON.stringify(rawPlain.toJSON())
          const diagnostic = TR.Errors.capture().find(report => report.message === 'credential=private provider detail')
          const unownedBeforeSuspension = unowned.length
          suspendButtons()
          await Renderer.act(async () => {
            React.startTransition(() => {
              aborting.update(React.createElement(React.Suspense, { fallback: React.createElement('pending') },
                React.createElement(NavigationAppHost, { app: Plain })))
            })
          })
          const abortWasSuspended = suspensionAttempts() > 0 && aborting.root.findAllByType('pending').length === 0
          abortSuspension()
          await Renderer.act(async () => { aborting.update(originalHost) })
          await Renderer.act(async () => { await aborting.root.findByType('button').props.onPress() })
          const abortedMessage = aborting.root.findByType('label').children
          const committedBoundary = suspending.root.findByType(TaoErrorBoundary).instance.props.actionBoundary
          suspendButtons()
          await Renderer.act(async () => {
            React.startTransition(() => {
              suspending.update(React.createElement(React.Suspense, { fallback: React.createElement('pending') },
                React.createElement(NavigationAppHost, { app: Plain })))
            })
          })
          const replacementSuspended = suspensionAttempts() > 0 && suspending.root.findAllByType('pending').length === 0
          await Renderer.act(async () => { await suspending.root.findByType('button').props.onPress() })
          const committedMessage = committedBoundary.failure?.publicMessage
          abortSuspension()
          await Renderer.act(async () => {
            suspending.update(React.createElement(React.Suspense, { fallback: React.createElement('pending') },
              React.createElement(NavigationAppHost, { app: Demo })))
          })
          runtimeConsole.info(JSON.stringify({ override, isolated, fallback, recovered, nearest, outerHealthy,
            strictMessage, initialMessage, initialSyncMessage, observedInits: observedInitCount(), removedInitListeners: removedInitListenerCount(), disposedStrictRoot, authIsolated, replacementHealthy, rawMessage, rawDefault,
            diagnostic: diagnostic?.message, replacementSuspended, committedMessage, abortedMessage, abortWasSuspended,
            unownedInitMessages: unowned.map((error: any) => error.message),
            unownedDuringSuspension: unowned.length - unownedBeforeSuspension, unowned: unowned.length }))
        } finally {
          await Renderer.act(async () => { first?.unmount(); second?.unmount(); plain?.unmount(); nested?.unmount();
            strict?.unmount(); initial?.unmount(); initialSync?.unmount(); authFirst?.unmount(); authSecond?.unmount(); replacement?.unmount(); raw?.unmount(); rawPlain?.unmount(); suspending?.unmount(); aborting?.unmount() })
          scope.dispose()
          stop(); console.error = originalError; console.warn = originalWarn
        }
      `,
        )
        const config = FS.resolvePath('tsconfig.json', root)
        await FS.writeJson(config, {
          extends: Repo.resolvePath('packages/tsconfig.base.json'),
          compilerOptions: {
            allowImportingTsExtensions: true,
            composite: false,
            declaration: false,
            incremental: false,
            jsx: 'react-jsx',
            lib: ['ES2023', 'DOM'],
            noEmit: true,
            rootDir: '/',
            typeRoots: [Repo.resolvePath('node_modules/@types')],
            types: ['bun', 'node'],
          },
          include: [program, `${output}/**/*.ts`, `${output}/**/*.tsx`],
        })
        const checked = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
          processPolicy: 'test',
        })
        Expect({ exitCode: checked.exitCode, stdout: checked.stdout, stderr: checked.stderr })
          .toEqual({ exitCode: 0, stdout: '', stderr: '' })
        const executed = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [program],
          cwd: root,
          processPolicy: 'test',
        })
        Expect({ exitCode: executed.exitCode, stderr: executed.stderr }).toEqual({ exitCode: 0, stderr: '' })
        const result = JSON.parse(executed.stdout)
        Expect(result.override).toEqual(['Use another title.'])
        Expect(result.isolated).toBe(true)
        Expect(result.fallback).toContain('Use another title.')
        Expect(result.fallback).toContain('Try again')
        Expect(result.recovered).toBe(true)
        Expect(result.nearest).toEqual(['Use another title.'])
        Expect(result.outerHealthy).toBe(true)
        Expect(result.strictMessage).toEqual(['Use another title.'])
        Expect(result.observedInits).toBe(2)
        Expect(result.removedInitListeners).toBe(2)
        Expect(result.initialMessage).toContain('Second live init.')
        Expect(result.initialMessage).not.toContain('First disposed init.')
        Expect(result.unownedInitMessages).toContain('First disposed init.')
        Expect(result.unownedInitMessages).not.toContain('Second live init.')
        Expect(result.initialSyncMessage).toContain('Use another title.')
        Expect(result.disposedStrictRoot).toBe(2)
        Expect(result.authIsolated).toBe(true)
        Expect(result.replacementHealthy).toBe(true)
        Expect(result.rawMessage).toContain("Couldn't finish")
        Expect(result.rawMessage).not.toContain('credential=private')
        Expect(result.rawDefault).toContain("Couldn't finish")
        Expect(result.rawDefault).not.toContain('credential=private')
        Expect(result.diagnostic).toBe('credential=private provider detail')
        Expect(result.replacementSuspended).toBe(true)
        Expect(result.committedMessage).toBe('Use another title.')
        Expect(result.abortedMessage).toEqual(['Use another title.'])
        Expect(result.abortWasSuspended).toBe(true)
        Expect(result.unownedDuringSuspension).toBe(0)
        Expect(result.unowned).toBe(4)
      })
    })
  }
})
