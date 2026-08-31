import { languageServerExtensions, LSPClient, type Transport } from '@codemirror/lsp-client'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import React from 'react'
import TR from 'tao-runtime/TR'

/** CodeEditorLsp connects one editor document to Studio's existing JSON-over-WebSocket LSP transport. */
export type CodeEditorLsp = {
  documentUri: string
  languageId?: string
  rootUri: string
  transport: Transport | Promise<Transport>
}

export type CodeEditorProps = {
  Change: TR.ActionValue<[TR.Value<string>]>
  Content: string
  Layout?: TR.TaoVisualLayout
  Lsp?: CodeEditorLsp
  Slots?: Readonly<Record<string, React.ReactNode>>
  Tag?: string
  children?: React.ReactNode
}

/** CodeMirror's standard interaction surface and Tao's line-comment convention. */
export const codeEditorBaseExtensions: readonly Extension[] = [
  basicSetup,
  EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }]),
]

/** CodeEditor is the foreign-view implementation used by Studio's Tao-authored editor surface. */
export function CodeEditor(props: CodeEditorProps): React.ReactElement {
  const mount = React.useRef<HTMLDivElement>(null)
  const editor = React.useRef<EditorView | undefined>(undefined)
  const change = React.useRef(props.Change)
  const content = React.useRef(props.Content)
  const applyingExternalContent = React.useRef(false)
  change.current = props.Change
  content.current = props.Content

  React.useEffect(() => {
    let cancelled = false
    let ownedClient: LSPClient | undefined

    const start = async (): Promise<void> => {
      const extensions: Extension[] = [...codeEditorBaseExtensions]
      if (props.Lsp) {
        ownedClient = new LSPClient({
          extensions: languageServerExtensions(),
          rootUri: props.Lsp.rootUri,
          timeout: 10_000,
        }).connect(await props.Lsp.transport)
        await ownedClient.initializing
        if (cancelled) {
          ownedClient.disconnect()
          return
        }
        extensions.push(ownedClient.plugin(props.Lsp.documentUri, props.Lsp.languageId ?? 'tao'))
      }
      if (cancelled || !mount.current) {
        return
      }
      editor.current = new EditorView({
        doc: content.current,
        extensions: [
          ...extensions,
          EditorView.updateListener.of(update => {
            if (update.docChanged && !applyingExternalContent.current) {
              void invokeEditorChange(change.current, update.state.doc.toString())
            }
          }),
        ],
        parent: mount.current,
      })
    }
    void start()

    return () => {
      cancelled = true
      editor.current?.destroy()
      editor.current = undefined
      ownedClient?.disconnect()
    }
  }, [props.Lsp?.documentUri, props.Lsp?.languageId, props.Lsp?.rootUri, props.Lsp?.transport])

  React.useEffect(() => {
    const view = editor.current
    if (!view || view.state.doc.toString() === props.Content) {
      return
    }
    applyingExternalContent.current = true
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.Content } })
    } finally {
      applyingExternalContent.current = false
    }
  }, [props.Content])

  const native = TR.VisualNativeProps(props.Layout, props.Tag)
  const dataSet = native['dataSet']
  const taoStudio = typeof dataSet === 'object' && dataSet !== null
    ? (dataSet as Record<string, unknown>)['taoStudio']
    : undefined
  return (
    <div
      data-tao-studio={typeof taoStudio === 'string' ? taoStudio : undefined}
      data-testid={props.Tag}
      style={props.Layout?.style as React.CSSProperties | undefined}
    >
      <div ref={mount} />
      {props.children}
      {Object.entries(props.Slots ?? {}).map(([name, content]) => <React.Fragment key={name}>{content}
      </React.Fragment>)}
    </div>
  )
}

/** invokeEditorChange preserves the Tao action boundary while exposing an ordinary editor string. */
export function invokeEditorChange(
  change: TR.ActionValue<[TR.Value<string>]>,
  content: string,
): void | Promise<void> {
  return change.invoke(TR.Value(content))
}

/** webSocketTransport adapts Studio's headerless JSON frames to @codemirror/lsp-client. */
export function webSocketTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const handlers = new Set<(value: string) => void>()
    const socket = new WebSocket(url)
    socket.addEventListener('open', () =>
      resolve({
        send(message) {
          socket.send(message)
        },
        subscribe(handler) {
          handlers.add(handler)
        },
        unsubscribe(handler) {
          handlers.delete(handler)
        },
      }))
    socket.addEventListener('message', event => {
      for (const handler of handlers) {
        handler(String(event.data))
      }
    })
    socket.addEventListener('error', () => reject(new Error('Could not connect to the Tao language server.')))
  })
}
