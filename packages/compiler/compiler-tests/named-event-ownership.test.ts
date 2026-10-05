import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('compiler: named event ownership', () => {
  Test(
    'keeps a source latest callback queued for the replaced app out of its committed replacement boundary',
    async () => {
      await withTaoFiles('tao-queued-event-ownership-', {
        'Main.tao': `
        action Latest(Key text) runs latest from ./Native.tsx
        public app First {
          id "com.tao.queued.first" version "1.0.0" name "First" view Shared
          guard { error Problem -> { Label(Problem.Message) } }
        }
        public app Replacement {
          id "com.tao.queued.replacement" version "1.0.0" name "Replacement" view Shared
          guard { error Problem -> { Label(Problem.Message) } }
        }
        public view Shared() { render Entry() { on change Latest } }
        view Entry(Change action(text)) from ./Native.tsx
        view Label(Value text) from ./Native.tsx
      `,
        'Native.tsx': `
        import React from 'react'
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import { actionOwner } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts'))
        }
        const owners: ReturnType<typeof actionOwner>[] = []
        const calls: string[] = []
        let release!: () => void, started!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        export const Started = new Promise<void>(resolve => { started = resolve })
        export function Release(): void { release() }
        export function Owners(): typeof owners { return owners }
        export function Calls(): readonly string[] { return calls }
        export async function Latest(key: string): Promise<void> {
          owners.push(actionOwner()); calls.push(key)
          if (key === 'first') { started(); await gate }
          else throw new TypeError('queued failure')
        }
        export function Entry(props: { Change: TR.ActionValue<[TR.Value<string>]>; Layout?: unknown; Tag?: string }) {
          return React.createElement('input', { onChange: (key: TR.Value<string>) => props.Change.invoke(key) })
        }
        export function Label(props: { Value: string; Layout?: unknown; Tag?: string }) {
          return React.createElement('label', {}, props.Value)
        }
      `,
      }, async (paths, root) => {
        const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'], { appName: 'First' })
        const main = compiled.files.find(file =>
          file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
        )
        Assert.defined(main, 'the genuine source latest event module is emitted')
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
        const { First, Replacement, Shared } = await import(${
            JSON.stringify(FS.resolvePath(main.relativePath, output))
          })
        const { Started, Release, Owners, Calls } = await import(${
            JSON.stringify(FS.resolvePath('Native.tsx', output))
          })
        const { MountedAppActionBoundary, ActionBoundaryContext } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-boundary.tsx'))
          })
        const { TaoErrorBoundary } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-error-containment.tsx'))
          })
        const { default: TR } = await import(${
            JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
          })
        const Renderer = require('react-test-renderer')
        ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
        const originalError = console.error, originalWarn = console.warn
        console.error = () => {}; console.warn = () => {}
        const unowned: unknown[] = []
        const stop = TR.Errors.onUnowned(error => unowned.push(error))
        let first: any, replacement: any, consumer: any
        let running: void | Promise<void>, queued: void | Promise<void>
        try {
          await Renderer.act(async () => {
            first = Renderer.create(React.createElement(MountedAppActionBoundary, { app: First }))
            replacement = Renderer.create(React.createElement(MountedAppActionBoundary, { app: Replacement }))
          })
          const firstBoundary = first.root.findByType(TaoErrorBoundary).instance.props.actionBoundary
          const replacementBoundary = replacement.root.findByType(TaoErrorBoundary).instance.props.actionBoundary
          const tree = (app: typeof First, boundary: typeof firstBoundary) => React.createElement(ActionBoundaryContext.Provider,
            { value: boundary }, React.createElement(Shared, { __tao: { app } }))
          await Renderer.act(async () => { consumer = Renderer.create(tree(First, firstBoundary)) })
          const event = consumer.root.findByType('input').props.onChange
          await Renderer.act(async () => { running = event(TR.Value('first')) })
          await Started
          await Renderer.act(async () => { queued = event(TR.Value('queued')) })
          const owner = Owners()[0]!
          await Renderer.act(async () => {
            consumer.update(tree(Replacement, replacementBoundary))
            first.unmount()
          })
          const rebound = owner.boundary === replacementBoundary
          await Renderer.act(async () => { Release(); await running; await queued })
          runtimeConsole.info(JSON.stringify({ calls: Calls(), rebound, sameOwner: owner === Owners()[1],
            replacementMessages: replacement.root.findAllByType('label').map((node: any) => node.children[0]),
            replacementFailure: replacementBoundary.failure, unowned: unowned.length }))
        } finally {
          Release()
          await Renderer.act(async () => { first?.unmount(); replacement?.unmount(); consumer?.unmount() })
          stop(); console.error = originalError; console.warn = originalWarn
        }
      `,
        )
        const result = await checkAndRun(root, output, program)
        Expect(result.calls).toEqual(['first', 'queued'])
        Expect(result.rebound).toBe(true)
        Expect(result.sameOwner).toBe(true)
        Expect(result.replacementMessages).toEqual([])
        Expect(result.replacementFailure).toBeUndefined()
        Expect(result.unowned).toBe(1)
      })
    },
  )

  Test('checks and mounts module, associated and auth-bound handlers without authored forwarding actions', async () => {
    await withTaoFiles('tao-named-event-ownership-', {
      'Main.tao': `
        use Books, Book, Reject, Change, CreateReject, ImmediateReject from ./Library
        public app Demo {
          id "com.tao.namedevents" version "1.0.0" name "Named events" view Main
          guard { error Problem -> { Label(Problem.Message) } }
        }
        public app Initial {
          id "com.tao.namedevents.initial" version "1.0.0" name "Initial events" view Start
          guard { error Problem -> { Label(Problem.Message) } }
        }
        public app AsyncInitial {
          id "com.tao.namedevents.async" version "1.0.0" name "Async initial events" view StartAsync
          guard { error Problem -> { Label(Problem.Message) } }
        }
        public app InlineInitial {
          id "com.tao.namedevents.inline" version "1.0.0" name "Inline initial events" view StartInline
          guard { error Problem -> { Label(Problem.Message) } }
        }
        view Main() {
          query Rows = Books with { }
          render Stack() {
            Button("Module") { on press Reject }
            Button("Auth") { on press CreateReject }
            Entry() { on change Change }
            loop Rows / Book { RowButton(Book) }
          }
        }
        view Start() { render Button("Init") { on press ImmediateReject } }
        view StartAsync() { render Button("Init") { on press Reject } }
        view StartInline() { render Button("Init") { on press -> { do Reject() } } }
        view RowButton(Row Book) {
          let Saved = Row.Reject
          render Button("Associated") { on press Saved }
        }
        view Button(Title text, Press action()) from ./Native.tsx
        view Entry(Change action(text)) from ./Native.tsx
        view Label(Value text) from ./Native.tsx
        view Stack() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      `,
      'Library.tao': `
        type InputFailure is one of InvalidInput
        public data Books / Book {
          Title text,
          action Book.Reject() { do Observe(Book.Title) fail InvalidInput "Row rejected." }
        }
        action Observe(Value text) from ./Native.tsx
        public action Reject() { do Observe("Reject") fail InvalidInput "Module rejected." }
        public action ImmediateReject() { fail InvalidInput "Initial rejected." }
        public action Change(Value text) { do Observe(Value) fail InvalidInput "Change rejected." }
        public action CreateReject() {
          create Book { Title: "rolled back" }
          fail InvalidInput "Create rejected."
        }
      `,
      'Native.tsx': `
        import React from 'react'
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        const observed: string[] = []
        export function Observe(value: string): void { observed.push(value) }
        export function Observed(): number { return observed.length }
        export function Seen(): readonly string[] { return observed }
        export function Button(props: { Title: string; Press: TR.ActionValue; Layout?: unknown; Tag?: string }) {
          React.useLayoutEffect(() => { if (props.Title === 'Init') void props.Press.invoke() }, [])
          return React.createElement('button', { title: props.Title, onPress: () => props.Press.invoke() }, props.Title)
        }
        export function Entry(props: { Change: TR.ActionValue<[TR.Value<string>]>; Layout?: unknown; Tag?: string }) {
          return React.createElement('input', { onChange: (value: TR.Value<string>) => props.Change.invoke(value) })
        }
        export function Label(props: { Value: string; Layout?: unknown; Tag?: string }) { return React.createElement('label', {}, props.Value) }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const validation = await workspace.validate(paths['Main.tao'])
      Assert(
        validation.diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
        'named event fixture validates',
        {
          diagnostics: JSON.stringify(validation.diagnostics),
        },
      )
      const compiled = await workspace.compile(paths['Main.tao'], { appName: 'Demo' })
      const main = compiled.files.find(file =>
        file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
      )
      const library = compiled.files.find(file =>
        file.sourcePath === paths['Library.tao'] && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(main, 'the real event consumer module is emitted')
      Assert.defined(library, 'the actual action and receiver witness module is emitted')
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
        const { Demo, Initial, AsyncInitial, InlineInitial } = await import(${
          JSON.stringify(FS.resolvePath(main.relativePath, output))
        })
        const { _TaoDataCatalog } = await import(${JSON.stringify(FS.resolvePath(library.relativePath, output))})
        const { Observed, Seen } = await import(${JSON.stringify(FS.resolvePath('Native.tsx', output))})
        const { NavigationAppHost } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-navigation-app-host.ts'))
        })
        const { default: TR } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
        })
        const Renderer = require('react-test-renderer')
        ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
        const originalError = console.error, originalWarn = console.warn
        console.error = () => {}; console.warn = () => {}
        const unowned: unknown[] = []
        const stop = TR.Errors.onUnowned(error => unowned.push(error))
        const firstScope = TR.Auth.CreateScope(), secondScope = TR.Auth.CreateScope()
        const firstStore = TR.Auth.Store(firstScope, _TaoDataCatalog), secondStore = TR.Auth.Store(secondScope, _TaoDataCatalog)
        TR.Data.Create(firstStore, 'Book', { Title: TR.Value('first') })
        TR.Data.Create(secondStore, 'Book', { Title: TR.Value('second') })
        const host = (app: typeof Demo, scope: typeof firstScope) => React.createElement(TR.Auth.Host, { scope },
          React.createElement(NavigationAppHost, { app }))
        let first: any, second: any, strict: any, initial: any, asyncInitial: any, inlineInitial: any
        const button = (tree: any, title: string) => tree.root.findAllByType('button').find((node: any) => node.props.title === title)
        const message = (tree: any) => tree.root.findByType('label').children[0]
        const remount = async (tree: any) => {
          await Renderer.act(async () => { tree.unmount() })
          let next: any
          await Renderer.act(async () => { next = Renderer.create(host(Demo, firstScope)) })
          return next
        }
        try {
          await Renderer.act(async () => {
            first = Renderer.create(host(Demo, firstScope)); second = Renderer.create(host(Demo, secondScope))
            strict = Renderer.create(React.createElement(React.StrictMode, {}, host(Demo, firstScope)))
            initial = Renderer.create(React.createElement(React.StrictMode, {}, host(Initial, firstScope)))
            asyncInitial = Renderer.create(React.createElement(React.StrictMode, {}, host(AsyncInitial, firstScope)))
            inlineInitial = Renderer.create(React.createElement(React.StrictMode, {}, host(InlineInitial, firstScope)))
          })
          const initialMessage = message(initial)
          await Renderer.act(async () => { await button(first, 'Module').props.onPress() })
          const moduleMessage = message(first)
          const isolated = second.root.findAllByType('label').length === 0
          first = await remount(first)
          await Renderer.act(async () => { await button(first, 'Associated').props.onPress() })
          const associatedMessage = message(first)
          first = await remount(first)
          await Renderer.act(async () => { await button(first, 'Auth').props.onPress() })
          const authMessage = message(first)
          const titles = (store: typeof firstStore) => store.query({ entity: 'Book', filters: [] }).map(row => TR.Member(TR.Value(row), ['Title']).evaluate().jsValue)
          const firstTitles = titles(firstStore), secondTitles = titles(secondStore), unscoped = titles(_TaoDataCatalog)
          first = await remount(first)
          await Renderer.act(async () => { await first.root.findByType('input').props.onChange(TR.Value('sent')) })
          const changeMessage = message(first)
          first = await remount(first)
          await Renderer.act(async () => { await button(strict, 'Module').props.onPress() })
          const strictMessage = message(strict)
          const stale = button(first, 'Module').props.onPress
          await Renderer.act(async () => { first.unmount() })
          const before = Observed(), beforeUnowned = unowned.length
          await stale()
          const disposedBody = Observed() === before + 1, disposedDelivery = unowned.length === beforeUnowned + 1
          const reports = TR.Errors.capture().filter(report => report.action === 'Reject')
          runtimeConsole.info(JSON.stringify({ moduleMessage, isolated, associatedMessage, authMessage, changeMessage,
            firstTitles, secondTitles, unscoped, strictMessage, initialMessage, disposedBody, disposedDelivery,
            seen: Seen(), reportActions: reports.map(report => report.action),
            asyncInitialMessages: asyncInitial.root.findAllByType('label').map((node: any) => node.children[0]),
            inlineInitialMessages: inlineInitial.root.findAllByType('label').map((node: any) => node.children[0]) }))
        } finally {
          await Renderer.act(async () => { first?.unmount(); second?.unmount(); strict?.unmount(); initial?.unmount(); asyncInitial?.unmount(); inlineInitial?.unmount() })
          firstScope.dispose(); secondScope.dispose(); stop(); console.error = originalError; console.warn = originalWarn
        }
      `,
      )
      const result = await checkAndRun(root, output, program)
      Expect(result.moduleMessage).toBe('Module rejected.')
      Expect(result.isolated).toBe(true)
      Expect(result.associatedMessage).toBe('Row rejected.')
      Expect(result.authMessage).toBe('Create rejected.')
      Expect(result.changeMessage).toBe('Change rejected.')
      Expect(result.seen).toContain('first')
      Expect(result.seen).not.toContain('second')
      Expect(result.seen).toContain('sent')
      Expect(result.firstTitles).toEqual(['first'])
      Expect(result.secondTitles).toEqual(['second'])
      Expect(result.unscoped).toEqual([])
      Expect(result.strictMessage).toBe('Module rejected.')
      Expect(result.initialMessage).toBe('Initial rejected.')
      Expect(result.disposedBody).toBe(true)
      Expect(result.disposedDelivery).toBe(true)
      Expect(result.reportActions.length).toBeGreaterThan(0)
      Expect(result.reportActions.every((name: string) => name === 'Reject')).toBe(true)
      Expect({ inline: result.inlineInitialMessages, named: result.asyncInitialMessages })
        .toEqual({ inline: ['Module rejected.'], named: ['Module rejected.'] })
    })
  })
})

async function checkAndRun(root: string, output: string, program: string): Promise<any> {
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
  return JSON.parse(executed.stdout)
}
