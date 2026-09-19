import { EditorState } from '@codemirror/state'
import { Expect, Test } from '@shared/test'
import TR from 'tao-runtime/TR'
import {
  codeEditorBaseExtensions,
  codeEditorExternalUpdate,
  CodeEditorHighlighting,
  invokeEditorChange,
  webSocketTransport,
} from '../code-editor-src/CodeEditor'

Test('@tao/code-editor installs CodeMirror editing and Tao line-comment language data', () => {
  const state = EditorState.create({ doc: 'view Main() { }', extensions: codeEditorBaseExtensions })
  Expect(state.languageDataAt<{ line?: string }>('commentTokens', 0)).toEqual([{ line: '//' }])
})

Test('@tao/code-editor invokes its Tao Change action with a runtime text value', async () => {
  const received: string[] = []
  const change = TR.Action((value: TR.Value<string>) => received.push(value.evaluate().jsValue)).jsValue

  await invokeEditorChange(change, 'updated Tao')

  Expect(received).toEqual(['updated Tao'])
})

Test('@tao/code-editor builds bounded syntax decorations from host tokens', () => {
  const decorations = CodeEditorHighlighting.testing.buildDecorations([
    { color: '#c792ea', from: 0, to: 4 },
    { color: '#82aaff', from: 5, to: 9 },
    { color: 'red; background: red', from: 10, to: 11 },
    { color: '#ffffff', from: 12, to: 20 },
  ], 13)

  Expect(decorations.size).toBe(2)
})

Test('@tao/code-editor maps external edits through the smallest changed range', () => {
  Expect(codeEditorExternalUpdate(
    'view Main() {\n   Text("old")\n}',
    'view Main() {\n   Text("new")\n}',
    { anchor: 27, head: 27 },
  )).toEqual({
    changes: { from: 23, insert: 'new', to: 26 },
    selection: { anchor: 27, head: 27 },
  })
})

Test('@tao/code-editor closes a failed startup socket before falling back', async () => {
  const original = globalThis.WebSocket
  let socket: FakeWebSocket | undefined
  class FakeWebSocket {
    readonly handlers = new Map<string, (event: unknown) => void>()
    closed = false

    constructor(_url: string) {
      socket = this
    }

    addEventListener(type: string, handler: (event: unknown) => void): void {
      this.handlers.set(type, handler)
    }

    close(): void {
      this.closed = true
    }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  try {
    const transport = webSocketTransport('ws://127.0.0.1:1234/lsp')
    socket?.handlers.get('error')?.(new Event('error'))

    await Expect(transport).rejects.toThrow('Could not connect to the Tao language server.')
    Expect(socket?.closed).toBe(true)
  } finally {
    globalThis.WebSocket = original
  }
})
