import { EditorState, type Transaction } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { Expect, Test } from '@shared/test'
import {
  StudioCodeEditor,
  StudioDiagnosticNavigation,
  StudioOpenFileLifecycle,
} from '../studio-src/StudioClient'
import { StudioClientAssets } from '../studio-src/StudioClientAssets'
import {
  StudioDraftSync,
  type StudioDraftSyncRequest,
  type StudioDraftSyncResult,
} from '../studio-src/StudioDraftSync'
import { StudioInspector } from '../studio-src/StudioInspector'
import { studioProtocolChannel, studioProtocolVersion } from '../studio-src/StudioProtocol'

Test('Studio browser assets produce a self-contained CodeMirror client and escape injected config', async () => {
  const bundle = await StudioClientAssets.bundle()
  const html = StudioClientAssets.html({
    previewUrl: 'http://127.0.0.1:55102/?value=</script><script>bad()</script>',
  })

  Expect(bundle).toContain('Tao Studio root is missing')
  Expect(bundle).toContain('/api/language/lsp')
  Expect(bundle).toContain('/api/language/highlight')
  Expect(bundle).not.toContain('createHighlighterCore')
  Expect(bundle).toContain('/api/file/draft')
  Expect(bundle).toContain('/api/source-action/undo')
  Expect(bundle).toContain('Reload preview')
  Expect(bundle).toContain('Mode: Edit')
  Expect(bundle).toContain('Mode: Run')
  Expect(bundle).toContain('set-interaction-mode')
  Expect(bundle).toContain('Undo visual edit')
  Expect(bundle).toContain('/api/preview/cell/reconfigure')
  Expect(bundle).toContain('/api/preview/cell/instance')
  Expect(bundle).toContain('Apply & remount')
  Expect(bundle).toContain('Scenario details')
  Expect(bundle).toContain('Save to scenario')
  Expect(bundle).toContain('set-scenario-arguments')
  Expect(bundle).toContain('No editable arguments')
  Expect(bundle).toContain('Injected Studio network failure')
  Expect(bundle).toContain('Inert — runtime Scheme support is not available yet.')
  Expect(bundle).toContain('taoStudioPreviewInstanceId')
  Expect(bundle).not.toContain('taoStudioArgs')
  Expect(bundle).not.toContain('taoStudioState')
  Expect(html).toContain('<script type="module" src="/studio.js"></script>')
  Expect(html).not.toContain('</script><script>bad()</script>')
  Expect(html).toContain('\\u003c/script>')
})

Test('Studio browser assets bundle one CodeMirror view singleton', async () => {
  const viewModules = (await StudioClientAssets.testing.moduleInputs()).filter(path =>
    path.includes('@codemirror+view@') && path.endsWith('/@codemirror/view/dist/index.js')
  )

  Expect(viewModules).toHaveLength(1)
})

Test('Studio editor Mod-/ binding toggles Tao line comments for selected lines', () => {
  const source = 'view Card() {\n   Text("Hello")\n}\n'
  let state = EditorState.create({
    doc: source,
    extensions: StudioCodeEditor.extension,
    selection: { anchor: 0, head: source.indexOf('\n}') },
  })
  const commentBinding = state.facet(keymap).flat()
    .find(binding => binding.key === 'Mod-/' && binding.run !== undefined)
  if (commentBinding?.run === undefined) {
    throw new Error('CodeMirror basic setup did not install the Mod-/ comment binding.')
  }

  state = runEditorCommand(state, commentBinding.run)
  Expect(state.doc.toString()).toBe('// view Card() {\n//    Text("Hello")\n}\n')
  state = runEditorCommand(state, commentBinding.run)
  Expect(state.doc.toString()).toBe(source)
})

Test('Studio file-open lifecycle invalidates an older async navigation before it can activate', async () => {
  const lifecycle = new StudioOpenFileLifecycle()
  const firstLoaded = deferred<string>()
  let activePath: string | undefined

  const open = async (path: string, loaded: Promise<string>): Promise<void> => {
    const attempt = lifecycle.begin()
    const result = await loaded
    if (attempt.isCurrent()) {
      activePath = `${path}:${result}`
    }
  }

  const first = open('First.tao', firstLoaded.promise)
  await open('Second.tao', Promise.resolve('second'))
  firstLoaded.resolve('first')
  await first

  Expect(activePath).toBe('Second.tao:second')
})

Test('Studio diagnostic navigation converts compiler lines into a bounded CodeMirror selection', () => {
  const state = EditorState.create({ doc: 'first\nsecond line\nthird\n' })

  Expect(StudioDiagnosticNavigation.selection(state.doc, {
    end: { character: 50, line: 1 },
    start: { character: 2, line: 1 },
  })).toEqual({
    anchor: state.doc.line(2).from + 2,
    head: state.doc.line(2).to,
  })
})

Test('Studio inspector derives canonical render identity, palette views, and one-operation checkpoints', () => {
  const message = {
    channel: studioProtocolChannel,
    identity: {
      appName: 'Garden',
      path: '/workspace/Garden.tao',
      previewInstanceId: 'preview-1',
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    protocolVersion: studioProtocolVersion,
    range: { end: 42, start: 20 },
    type: 'preview-select-source',
  } as const
  const selected = StudioInspector.selection(message)
  const action = StudioInspector.singleAction({
    action: { entry: ['gap', 16], kind: 'set-layout-entry', renderId: selected.renderId },
    checkpointId: 'checkpoint-1',
    identity: selected.identity,
    requestId: 'request-1',
  })

  Expect(selected.renderId).toBe('/workspace/Garden.tao:20:42')
  Expect(action.checkpoint).toEqual({ id: 'checkpoint-1', phase: 'single' })
  Expect(StudioInspector.projectViews('view Card() { }\nview Form(Value text) { }\nview Empty() { }'))
    .toEqual(['Card', 'Empty'])
})

Test('Studio draft sync coalesces pending edits and advances the optimistic version serially', async () => {
  const firstWrite = deferred<StudioDraftSyncResult>()
  const writes: StudioDraftSyncRequest[] = []
  const sync = new StudioDraftSync({
    content: 'before',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
  }, {
    delayMs: 60_000,
    async write(request) {
      writes.push(request)
      if (writes.length === 1) {
        return await firstWrite.promise
      }
      return saved(request, 'source-3')
    },
  })

  sync.update('draft-a')
  sync.update('draft-b')
  const flushing = sync.flush()
  await until(() => writes.length === 1)
  sync.update('draft-c')
  firstWrite.resolve(saved(writes[0]!, 'source-2'))
  await flushing
  await sync.flush()

  Expect(writes.map(write => write.content)).toEqual(['draft-b', 'draft-c'])
  Expect(writes.map(write => write.sourceVersion)).toEqual(['source-1', 'source-2'])
})

Test('Studio draft sync keeps the last saved version after an invalid draft', async () => {
  const writes: StudioDraftSyncRequest[] = []
  const results: StudioDraftSyncResult[] = []
  const sync = new StudioDraftSync({
    content: 'before',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
  }, {
    delayMs: 60_000,
    onResult: result => results.push(result),
    async write(request) {
      writes.push(request)
      return writes.length === 1
        ? {
          diagnostics: ['Expected a closing brace.'],
          file: { content: 'before', path: request.path, sourceVersion: 'source-1' },
          saved: false,
        }
        : saved(request, 'source-2')
    },
  })

  sync.update('invalid')
  Expect((await sync.flush())?.saved).toBe(false)
  sync.update('valid again')
  Expect((await sync.flush())?.saved).toBe(true)

  Expect(writes.map(write => write.sourceVersion)).toEqual(['source-1', 'source-1'])
  Expect(results.map(result => result.saved)).toEqual([false, true])
})

function saved(request: StudioDraftSyncRequest, sourceVersion: string): StudioDraftSyncResult {
  return {
    diagnostics: [],
    file: { content: request.content, path: request.path, sourceVersion },
    saved: true,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await Promise.resolve()
  }
  throw new Error('Timed out waiting for draft synchronization.')
}

function runEditorCommand(state: EditorState, command: Command): EditorState {
  let next = state
  const target = {
    state,
    dispatch(transaction: Transaction) {
      next = transaction.state
    },
  }
  const handled = command(target as EditorView)
  Expect(handled).toBe(true)
  return next
}
